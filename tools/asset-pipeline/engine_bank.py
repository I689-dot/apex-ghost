"""
Engine loop bank from a real onboard recording (the loop-based method used by racing games: Forza, ACC, rFactor).

Input: a recording of slow full-throttle rpm ramps and off-throttle overruns (e.g. Pole Position Production's
"Dodge Viper GTS Race Engine - t4 - ONBRD - RAMPS", Sonniss GDC bundle, royalty free). Steps:

  1. track the dominant engine order through the whole take (harmonic sum + Viterbi path, no octave jumps);
  2. classify every moment as on-load (rpm rising under power) or off-load (rpm falling on overrun);
  3. for every rpm of a grid and both loads, take the cleanest moment, time-warp it so the rpm is exactly
     constant (phase-locked to the tracked order) and cut a whole number of engine cycles, crossfaded end to
     start: a seamless constant-rpm loop;
  4. level every loop to the same loudness: the recording's own levels follow the mic, not the engine (they
     sag near the limiter and overrun comes out louder than full throttle); the game applies the loudness
     model (rise with rpm, quieter overrun).

Output: <out>.bin (int16 PCM, 48 kHz, all loops back to back) and <out>.json (rpm, offsets, lengths).

  python3 engine_bank.py viper_ramps.wav --order 2.5 --cyl 10 --out ../../apps/client/public/assets/audio/engine_v10
"""
import argparse
import json
import subprocess

import numpy as np
from scipy.ndimage import median_filter, uniform_filter1d
from scipy.signal import butter, sosfiltfilt

ap = argparse.ArgumentParser()
ap.add_argument("src")
ap.add_argument("--order", type=float, required=True, help="tracked engine order (cycles per revolution)")
ap.add_argument("--cyl", type=int, required=True)
ap.add_argument("--out", required=True)
ap.add_argument("--rpm-min", type=float, default=1200)
ap.add_argument("--rpm-max", type=float, default=6000)
ap.add_argument("--step", type=float, default=400)
ap.add_argument("--loop-s", type=float, default=0.42)
a = ap.parse_args()

SR = 48000
raw = subprocess.run(
    ["ffmpeg", "-loglevel", "error", "-i", a.src, "-ac", "1", "-ar", str(SR), "-f", "f32le", "-"], capture_output=True, check=True
).stdout
x = np.frombuffer(raw, dtype=np.float32).astype(np.float64)
x = sosfiltfilt(butter(2, 25, "highpass", fs=SR, output="sos"), x)  # wind rumble / DC
print(f"{a.src}: {len(x) / SR:.1f} s")

# ---- 1. order tracking -------------------------------------------------------------------------------------
HOP = 480  # 10 ms
NFFT = 16384
fmin = a.rpm_min * 0.7 / 60 * a.order
fmax = a.rpm_max * 1.15 / 60 * a.order
f = np.fft.rfftfreq(NFFT, 1 / SR)
nb = int(fmax * 7 / f[1]) + 4  # only the band the tracker looks at (memory: the full STFT would be GBs)
f = f[:nb]
win = np.hanning(NFFT).astype(np.float32)
starts = np.arange(0, len(x) - NFFT, HOP)
t = (starts + NFFT / 2) / SR
mag = np.empty((nb, len(starts)), dtype=np.float32)
xf32 = x.astype(np.float32)
for c in range(0, len(starts), 512):
    st = starts[c : c + 512]
    frames = np.stack([xf32[s0 : s0 + NFFT] for s0 in st]) * win
    mag[:, c : c + len(st)] = np.abs(np.fft.rfft(frames, axis=1))[:, :nb].T
Z = mag
S = np.log1p(mag / (mag.mean() + 1e-12))
cands = np.exp(np.linspace(np.log(fmin), np.log(fmax), 600))
df = f[1]
score = np.zeros((len(cands), S.shape[1]))
for k in range(1, 7):
    idx = np.clip(np.round(cands * k / df).astype(int), 0, len(f) - 1)
    score += S[idx] / k**0.25
# Viterbi: penalise jumps (log-frequency), forbid more than ~5 % per frame
lc = np.log(cands)
step = lc[1] - lc[0]
maxj = int(np.ceil(0.05 / step))
W = 6.0
n = S.shape[1]
acc = score[:, 0].copy()
back = np.zeros((len(cands), n), dtype=np.int32)
offs = np.arange(-maxj, maxj + 1)
pen = W * np.abs(offs * step) / 0.01
for j in range(1, n):
    best = np.full(len(cands), -1e18)
    arg = np.zeros(len(cands), dtype=np.int32)
    for o, p in zip(offs, pen):
        src = np.roll(acc, o) - p
        if o > 0:
            src[:o] = -1e18
        elif o < 0:
            src[o:] = -1e18
        better = src > best
        best[better] = src[better]
        arg[better] = (np.arange(len(cands)) - o)[better]
    acc = best + score[:, j]
    back[:, j] = arg
path = np.zeros(n, dtype=np.int32)
path[-1] = acc.argmax()
for j in range(n - 1, 0, -1):
    path[j - 1] = back[path[j], j]
f0 = cands[path]
conf = score[path, np.arange(n)] / (np.median(score, axis=0) + 1e-9)
# refine with parabolic interpolation on the 4th harmonic of the tracked order
k = 4
bins = f0 * k / df
b0 = np.round(bins).astype(int)
lm = np.abs(Z)
y0 = lm[np.clip(b0 - 1, 0, len(f) - 1), np.arange(n)]
y1 = lm[b0, np.arange(n)]
y2 = lm[np.clip(b0 + 1, 0, len(f) - 1), np.arange(n)]
d = 0.5 * (y0 - y2) / np.where(np.abs(y0 - 2 * y1 + y2) > 1e-12, y0 - 2 * y1 + y2, 1e-12)
fr = (b0 + np.clip(d, -0.5, 0.5)) * df / k
f0 = np.where(np.abs(fr / f0 - 1) < 0.03, fr, f0)
f0 = median_filter(f0, 5)
rpm = f0 / a.order * 60
tt = t  # frame centres (s)

# ---- 2. load classification --------------------------------------------------------------------------------
drpm = np.gradient(uniform_filter1d(rpm, 21), tt)
frame_rms = np.array([np.sqrt(np.mean(x[max(0, int(c * SR) - 2400) : int(c * SR) + 2400] ** 2)) for c in tt])
lvl = 20 * np.log10(frame_rms + 1e-9)
smooth = np.abs(np.gradient(drpm, tt))  # jerk: shifts, clutch, wheelspin
on = (drpm > 120) & (drpm < 3000) & (conf > 1.25) & (smooth < 6000)
off = (drpm < -100) & (drpm > -2500) & (conf > 1.15) & (smooth < 6000)
print(f"tracked {rpm.min():.0f}-{rpm.max():.0f} rpm, on-load {on.mean() * 100:.0f} % / off-load {off.mean() * 100:.0f} % of frames")

# ---- 3. constant-rpm loops ---------------------------------------------------------------------------------
fs_t = np.arange(len(x)) / SR
f_samp = np.interp(fs_t, tt, f0)
phase = np.cumsum(f_samp) / SR  # cycles of the tracked order


def cubic(sig, pos):
    i = np.floor(pos).astype(int)
    u = pos - i
    i = np.clip(i, 1, len(sig) - 3)
    p0, p1, p2, p3 = sig[i - 1], sig[i], sig[i + 1], sig[i + 2]
    return p1 + 0.5 * u * (p2 - p0 + u * (2 * p0 - 5 * p1 + 4 * p2 - p3 + u * (3 * (p1 - p2) + p3 - p0)))


def make_loop(centre_s, target_rpm):
    ft = target_rpm / 60 * a.order
    cyc_per_engine_cycle = a.order * 2  # one 4-stroke cycle = 2 revolutions
    cycles = max(1, round(a.loop_s * ft / cyc_per_engine_cycle)) * cyc_per_engine_cycle
    L = int(round(cycles / ft * SR))
    xf = int(0.04 * SR)
    total = L + xf
    ci = int(centre_s * SR)
    ph0 = phase[ci] - (total / 2) / SR * ft
    tgt = ph0 + np.arange(total) / SR * ft  # constant-rate phase
    pos = np.interp(tgt, phase, np.arange(len(x)))
    seg = cubic(x, pos)
    # crossfade the tail (which continues past the loop end) into the head: seamless, phase-aligned
    w = np.sin(np.linspace(0, np.pi / 2, xf)) ** 2
    out = seg[:L].copy()
    out[:xf] = seg[:xf] * w + seg[L : L + xf] * (1 - w)
    # the tracked rate over the source window: how much the warp had to bend it
    span = (pos[-1] - pos[0]) / SR
    return out, span / (total / SR)


grid = np.arange(a.rpm_min, a.rpm_max + 1, a.step)
loops = {"on": [], "off": []}
for name, mask in (("on", on), ("off", off)):
    for r in grid:
        sel = mask & (np.abs(rpm / r - 1) < 0.035)
        if not sel.any():
            # nearest usable moment
            cand = np.where(mask)[0]
            j = cand[np.argmin(np.abs(rpm[cand] - r))]
        else:
            cand = np.where(sel)[0]
            # prefer confident tracking and the gentlest ramp (least warping)
            j = cand[np.argmax(conf[cand] - np.abs(drpm[cand]) / 2000)]
        seg, stretch = make_loop(tt[j], r)
        loops[name].append({"rpm": float(r), "src_t": float(tt[j]), "src_rpm": float(rpm[j]), "stretch": float(stretch), "sig": seg})
        print(f"  {name:3s} {r:5.0f} rpm  from {tt[j]:6.2f} s ({rpm[j]:5.0f} rpm, {drpm[j]:+5.0f} rpm/s)  warp {stretch:.3f}")

# ---- 4. levels ---------------------------------------------------------------------------------------------
for name in loops:
    rms = np.array([np.sqrt(np.mean(L["sig"] ** 2)) for L in loops[name]])
    db = 20 * np.log10(rms)
    fit = np.full_like(db, -14.0)
    for L, d0, d1 in zip(loops[name], db, fit):
        L["sig"] *= 10 ** ((d1 - d0) / 20)
peak = max(np.abs(L["sig"]).max() for k in loops for L in loops[k])
pcm = []
meta = {"sampleRate": SR, "order": a.order, "cyl": a.cyl, "source": a.src.split("/")[-1], "loops": []}
off_i = 0
for i, r in enumerate(grid):
    e = {"rpm": float(r)}
    for name in ("on", "off"):
        s = np.clip(loops[name][i]["sig"] / peak * 0.95, -1, 1)
        q = np.round(s * 32767).astype(np.int16)
        pcm.append(q)
        e[name] = [off_i, len(q)]
        off_i += len(q)
    meta["loops"].append(e)
np.concatenate(pcm).tofile(a.out + ".bin")
with open(a.out + ".json", "w") as fh:
    json.dump(meta, fh, indent=1)
print(f"wrote {a.out}.bin ({off_i * 2 / 1e6:.2f} MB) and .json, {len(grid)} rpm steps")
