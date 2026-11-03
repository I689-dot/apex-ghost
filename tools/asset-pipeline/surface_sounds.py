"""
Surface and contact sounds from real recordings (Freesound, see apps/client/public/assets/audio/CREDITS.md): tyres on
gravel, a car on a rumble strip (the kerbs), grass, tyre squeal, a metal scrape (a wall), and crashes in three
weights. Loops are cut from a steady stretch and crossfaded end to start; everything is mono, levelled to the same
loudness (the game sets the mix), 16-bit WAV at 32 kHz (MP3's encoder padding clicks at a loop point).

  python3 tools/asset-pipeline/surface_sounds.py   (downloads the previews into tools/asset-pipeline/out/surface/)
"""
import json
import subprocess
import urllib.request
import wave
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "tools/asset-pipeline/out/surface"
DST = ROOT / "apps/client/public/assets/audio/surface"
SR = 32000

# name: (freesound id, preview url, author, start s, length s, loop, level dBFS rms[, low-pass Hz])
SOUNDS = {
    "gravel": (577504, "https://cdn.freesound.org/previews/577/577504_97550-hq.mp3", "TRP", 2.0, 4.0, True, -20),
    "kerb": (62652, "https://cdn.freesound.org/previews/62/62652_791247-hq.mp3", "bsumusictech", 4.0, 7.0, True, -18),
    "grass": (665627, "https://cdn.freesound.org/previews/665/665627_1661766-hq.mp3", "felix.blume", 10.0, 6.0, True, -22),
    "squeal": (614627, "https://cdn.freesound.org/previews/614/614627_5790048-hq.mp3", "johnnydekk", 15.0, 4.0, True, -20),
    "scrape": (385939, "https://cdn.freesound.org/previews/385/385939_7097737-hq.mp3", "Pól", 0.2, 3.6, True, -20),
    "crash_light": (641048, "https://cdn.freesound.org/previews/641/641048_11537497-hq.mp3", "magnuswaker", 0.0, 1.6, False, -16),
    "crash_medium": (807437, "https://cdn.freesound.org/previews/807/807437_3797507-hq.mp3", "Logicogonist", 0.0, 1.0, False, -14),
    "crash_heavy": (592388, "https://cdn.freesound.org/previews/592/592388_11537497-hq.mp3", "magnuswaker", 0.0, 2.5, False, -13),
    "crash_debris": (237375, "https://cdn.freesound.org/previews/237/237375_1502374-hq.mp3", "squareal", 0.0, 4.0, False, -16),
    # tyres on turf: an off-road car on soft ground, the crunch filtered out (the old wind-in-grass loop is the brushing)
    "grass_tyre": (668552, "https://cdn.freesound.org/previews/668/668552_1661766-hq.mp3", "felix.blume", 240.0, 6.0, True, -21, 900),
    # a sand trap: tyres ploughing loose ground, softer than gravel
    "sand": (685230, "https://cdn.freesound.org/previews/685/685230_1661766-hq.mp3", "felix.blume", 96.5, 6.0, True, -21, 1400),
    # the tyres' roar on asphalt from inside a car (pitched with speed in the game)
    "road": (591079, "https://cdn.freesound.org/previews/591/591079_6411813-hq.mp3", "orlandorizo", 63.0, 6.0, True, -20),
    # tyres on a wet road from inside the car, rain on the roof (the hiss under the engine when it rains)
    "wet_road": (614175, "https://cdn.freesound.org/previews/614/614175_1130120-hq.mp3", "videofueralle", 29.5, 6.0, True, -21),
    # a wheel through a puddle
    "splash": (563021, "https://cdn.freesound.org/previews/563/563021_10713160-hq.mp3", "cookies+policy", 0.3, 3.0, False, -14),
}
XFADE = 0.25


def load(path: Path, lowpass: float = 0) -> np.ndarray:
    af = ["-af", f"lowpass=f={lowpass}:p=2,lowpass=f={lowpass}:p=2"] if lowpass else []
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", str(path), *af, "-ac", "1", "-ar", str(SR), "-f", "f32le", "-"], capture_output=True, check=True).stdout
    return np.frombuffer(raw, np.float32).copy()


def main() -> None:
    SRC.mkdir(parents=True, exist_ok=True)
    DST.mkdir(parents=True, exist_ok=True)
    meta = {}
    for name, (sid, url, author, start, length, loop, level, *opt) in SOUNDS.items():
        src = SRC / f"{sid}.mp3"
        if not src.exists():
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
            src.write_bytes(urllib.request.urlopen(req).read())
        x = load(src, opt[0] if opt else 0)
        a = int(start * SR)
        n = int(length * SR)
        if loop:
            # one extra crossfade length taken after the loop, faded over its start: seamless
            f = int(XFADE * SR)
            seg = x[a : a + n + f].copy()
            ramp = np.linspace(0, 1, f, dtype=np.float32)
            seg[:f] = seg[:f] * ramp + seg[n : n + f] * (1 - ramp)
            seg = seg[:n]
        else:
            seg = x[a : a + n].copy()
            # a short fade at the end (the cut) and none at the start (the hit)
            f = int(0.08 * SR)
            seg[-f:] *= np.linspace(1, 0, f, dtype=np.float32)
        seg -= seg.mean()
        rms = float(np.sqrt(np.mean(seg**2))) or 1.0
        seg *= 10 ** (level / 20) / rms
        peak = float(np.abs(seg).max())
        if peak > 0.98:
            seg *= 0.98 / peak
        with wave.open(str(DST / f"{name}.wav"), "wb") as w:
            w.setnchannels(1)
            w.setsampwidth(2)
            w.setframerate(SR)
            w.writeframes((seg * 32767).astype("<i2").tobytes())
        meta[name] = {"freesound": sid, "author": author, "loop": loop, "seconds": round(len(seg) / SR, 2)}
        print(f"{name}: {len(seg) / SR:.2f} s from {sid} by {author}")
    (DST / "sounds.json").write_text(json.dumps(meta, indent=1, ensure_ascii=False))


if __name__ == "__main__":
    main()
