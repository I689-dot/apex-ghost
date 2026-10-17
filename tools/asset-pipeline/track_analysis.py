"""Track analysis (usd-core + numpy + Pillow).

python track_analysis.py <usdc> <out_dir>

Produces in <out_dir>:
  analysis.json        scale/offset used to convert USD units → game metres (consumed by Blender + optimizer)
  track_base.json      centreline, widths, gates, sectors, grid, start line (TrackData minus render chunks)
  collision_raw/*.bin  per-surface triangle soups in game metres (simplified later by optimize.mjs)
  debug_track.png      top-down verification plot

Coordinate frame: glTF/three.js (Y up). Race direction is the order of the centreline.
"""
from __future__ import annotations

import json
import math
import os
import re
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw
from pxr import Usd, UsdGeom, UsdShade

USD_PATH = Path(sys.argv[1])
OUT = Path(sys.argv[2])
OUT.mkdir(parents=True, exist_ok=True)

OFFICIAL_LENGTH_M = 5148.0  # Nürburgring GP-Strecke incl. Mercedes-Arena
GRID_SLOTS = 12
GATE_SPACING_M = 35.0  # dense checkpoints: resets put you back close to where you left the track
RUNOFF_MARGIN_M = 14.0

SURFACE_RULES: list[tuple[str, str]] = [
    # painted lines are drivable surface too: the asphalt has gaps under some of them (wheels dropped through)
    (r"^(lines|lines_yellow)", "asphalt"),
    (r"^(redline|box_decal|nurb_decal|adv2|logos|spons|display|plastic_cone)", "skip"),
    (r"^curb", "curb"),
    # drainage grates along the edges are driven over; the terrain around the circuit is ground (it had no
    # collision: leaving the grass dropped the car through the world)
    (r"^grille", "asphalt"),
    (r"^top2$", "grass"),
    # solid roadside structures (you could drive through posts, marshal boxes and the garages)
    (r"^(pole_|marshal_boxes|marshall_box|garage_0|building_0|timetower|electric_box|tuv_|medical_|box_struct)", "wall"),
    (r"^(asph|pits|travert_0|conc_green|conc_red|pavement|tiles)", "asphalt"),
    (r"^(grass|astroturf|travert_grass)", "grass"),
    (r"^gravel", "gravel"),
    (r"^(sand)", "sand"),
    (r"^(tyrewall|walls_new|wall_|grail|galvanized|fence_green|fences_b|sound_barrier|rockwall|metal_wall|box_fence|concrete_0)", "wall"),
]
SURFACES = ["asphalt", "curb", "grass", "gravel", "sand", "wall"]


def surface_of(mat: str) -> str | None:
    for rx, s in SURFACE_RULES:
        if re.match(rx, mat, re.I):
            return None if s == "skip" else s
    return None


# --------------------------------------------------------------- load USD ---
stage = Usd.Stage.Open(str(USD_PATH))
xc = UsdGeom.XformCache()
meshes: list[dict] = []
for prim in stage.Traverse():
    if not prim.IsA(UsdGeom.Mesh):
        continue
    m = UsdGeom.Mesh(prim)
    mat, _ = UsdShade.MaterialBindingAPI(prim).ComputeBoundMaterial()
    name = mat.GetPrim().GetName() if mat else ""
    pts = np.array(m.GetPointsAttr().Get(), dtype=np.float64)
    M = np.array(xc.GetLocalToWorldTransform(prim))
    w = pts @ M[:3, :3] + M[3, :3]
    counts = np.array(m.GetFaceVertexCountsAttr().Get())
    idx = np.array(m.GetFaceVertexIndicesAttr().Get())
    # fan-triangulate
    tris = []
    o = 0
    for c in counts:
        for k in range(1, c - 1):
            tris.append((idx[o], idx[o + k], idx[o + k + 1]))
        o += c
    meshes.append({"mat": name, "v": w, "t": np.array(tris, dtype=np.int64).reshape(-1, 3)})
print(f"[track] loaded {len(meshes)} meshes", flush=True)


def by_prefix(*prefixes: str) -> list[dict]:
    return [m for m in meshes if any(m["mat"].startswith(p) for p in prefixes)]


# ------------------------------------------------------------- raster ---
road = by_prefix("asph_new", "asph_003", "asph_mid")
allroad = np.concatenate([m["v"] for m in road])
mn = allroad.min(axis=0) - 20
mx = allroad.max(axis=0) + 20
RES = 0.25  # raw units per pixel (~0.5 m)
W = int((mx[0] - mn[0]) / RES) + 1
H = int((mx[2] - mn[2]) / RES) + 1


def to_px(x: np.ndarray, z: np.ndarray):
    return (x - mn[0]) / RES, (z - mn[2]) / RES


def rasterize(ms: list[dict], value=None, mode="1"):
    img = Image.new(mode, (W, H), 0)
    dr = ImageDraw.Draw(img)
    for m in ms:
        v, t = m["v"], m["t"]
        px, pz = to_px(v[:, 0], v[:, 2])
        for a, b, c in t:
            fill = 1 if value is None else float((v[a, 1] + v[b, 1] + v[c, 1]) / 3)
            dr.polygon([(px[a], pz[a]), (px[b], pz[b]), (px[c], pz[c])], fill=fill)
    return np.array(img)


road_mask = rasterize(road).astype(bool)
height = rasterize(road, value=True, mode="F")


# painted edge lines (long longitudinal components of lines_003) act as track boundaries
def components(m: dict) -> list[np.ndarray]:
    v, t = m["v"], m["t"]
    par = np.arange(len(v))

    def f(a):
        while par[a] != a:
            par[a] = par[par[a]]
            a = par[a]
        return a

    for a, b, c in t:
        ra, rb, rc = f(a), f(b), f(c)
        par[rb] = ra
        par[f(rc)] = ra
    lab = np.array([f(i) for i in range(len(v))])
    return [np.nonzero(lab == l)[0] for l in np.unique(lab)]


lines = by_prefix("lines_003")[0]
line_comps = components(lines)
boundary_img = Image.new("1", (W, H), 0)
bdr = ImageDraw.Draw(boundary_img)
slot_bars = []
finish = None
start_line = None
for comp in line_comps:
    v = lines["v"][comp]
    c = v.mean(axis=0)
    xz = v[:, [0, 2]] - c[[0, 2]]
    if len(v) < 3:
        continue
    ev, evec = np.linalg.eigh(np.cov(xz.T))
    major = evec[:, 1]
    length = float(np.ptp(xz @ major))
    width = float(np.ptp(xz @ evec[:, 0]))
    info = {"c": c, "len": length, "wid": width, "dir": major, "nv": len(v)}
    if length > 10:
        sel = set(comp.tolist())
        px, pz = to_px(lines["v"][:, 0], lines["v"][:, 2])
        for a, b, cc in lines["t"]:
            if a in sel:
                bdr.polygon([(px[a], pz[a]), (px[b], pz[b]), (px[cc], pz[cc])], fill=1)
    elif 0.9 < length < 1.25 and width < 0.3:
        slot_bars.append(info)
    if 5.5 < length < 7.5 and info["nv"] > 150 and width > 0.3:
        finish = info  # chequered finish line (many vertices)
    if 7.0 < length < 8.5 and info["nv"] < 40 and width < 0.2:
        start_line = start_line or info
# walls and barriers bound the racing surface too (otherwise the trace can cut an apex through a tyre wall)
# base height of the wall drawn at each pixel (NaN = no wall), to tell barriers from bridges overhead
wall_img = Image.new("F", (W, H), float("nan"))
wdr = ImageDraw.Draw(wall_img)
for m in meshes:
    if surface_of(m["mat"]) != "wall":
        continue
    v, t = m["v"], m["t"]
    px, pz = to_px(v[:, 0], v[:, 2])
    for a, b, c in t:
        bdr.line([(px[a], pz[a]), (px[b], pz[b]), (px[c], pz[c]), (px[a], pz[a])], fill=1, width=3)
        wdr.line([(px[a], pz[a]), (px[b], pz[b]), (px[c], pz[c]), (px[a], pz[a])], fill=float(min(v[a, 1], v[b, 1], v[c, 1])), width=3)
boundary = np.array(boundary_img).astype(bool)
wall_base = np.array(wall_img)
# curbs also bound the racing surface
curb_mask = rasterize(by_prefix("curb_b_001", "curbs_new", "curb_001", "curb_b_yellow")).astype(bool)
assert finish is not None, "finish line not found"
print(f"[track] finish line at {finish['c'].round(2)}, slot bars {len(slot_bars)}", flush=True)


# ------------------------------------------------------------ trace ---
def is_road(x: float, z: float) -> bool:
    i, j = int((x - mn[0]) / RES), int((z - mn[2]) / RES)
    if i < 0 or j < 0 or i >= W or j >= H:
        return False
    return bool(road_mask[j, i]) and not bool(boundary[j, i])


def edge_dist(p: np.ndarray, n: np.ndarray, maxd: float) -> float:
    d = 0.0
    while d < maxd:
        d += RES * 0.5
        q = p + n * d
        if not is_road(q[0], q[1]):
            return d
    return math.inf


# race direction: perpendicular to the finish line, pointing to the start line / grid side (NW)
fd = finish["dir"]
perp = np.array([fd[1], -fd[0]])
pole_side = np.mean([b["c"][[0, 2]] for b in slot_bars], axis=0) - finish["c"][[0, 2]]
if np.dot(perp, pole_side) < 0:
    perp = -perp
# the grid lies behind the start line, which is ahead of the finish line on this layout
p0 = finish["c"][[0, 2]].copy()
# The chequered strip only covers the pit-wall side of the straight: starting the trace there sent it down
# the narrow pit-lane corridor. Shift the start sideways onto the middle of the grid (its two columns are
# symmetric about the centre of the straight).
fdn = fd / np.linalg.norm(fd)
grid_mid = np.mean([b["c"][[0, 2]] for b in slot_bars], axis=0)
p0 = p0 + fdn * float(np.dot(grid_mid - p0, fdn))
d = perp / np.linalg.norm(perp)
d0 = d.copy()
STEP = 0.5  # raw units
HALF_MAX = 9.0  # raw units: beyond this a "side" is run-off or a junction
pts = [p0.copy()]
halfL, halfR = [], []
p = p0.copy()
prev_l, prev_r = 3.5, 3.5
closed_at: int | None = None
EXTRA = 1200
for it in range(30000):
    q = p + d * STEP
    n = np.array([d[1], -d[0]])  # left of travel (x,z with y up: left = (dz, -dx))
    l = edge_dist(q, n, HALF_MAX)
    r = edge_dist(q, -n, HALF_MAX)
    if math.isfinite(l) and math.isfinite(r) and l + r < 2 * HALF_MAX:
        shift = (l - r) / 2
        prev_l, prev_r = l, r
    elif math.isfinite(l):
        shift = l - prev_l
    elif math.isfinite(r):
        shift = prev_r - r
    else:
        shift = 0.0
    shift = max(-0.15, min(0.15, shift))
    q = q + n * shift
    nd = q - p
    nd /= np.linalg.norm(nd)
    d = d * 0.75 + nd * 0.25
    d /= np.linalg.norm(d)
    p = q
    pts.append(p.copy())
    halfL.append(min(l, prev_l + 1) if math.isfinite(l) else prev_l)
    halfR.append(min(r, prev_r + 1) if math.isfinite(r) else prev_r)
    # Close at the finish line, then keep tracing 300 steps: the very first steps were still converging
    # from the finish line's mid-point (near the pit wall); the extra steps replace them below.
    if closed_at is None and it > 2000:
        before = np.dot(pts[-2] - p0, d0)
        after = np.dot(p - p0, d0)
        if before < 0 <= after and np.linalg.norm(p - p0) < 15:
            closed_at = len(pts) - 1
    if closed_at is not None and len(pts) - 1 >= closed_at + EXTRA:
        break
else:
    try:
        import matplotlib

        matplotlib.use("Agg")
        import matplotlib.pyplot as plt

        tp = np.array(pts)
        fig, ax = plt.subplots(figsize=(14, 16), dpi=70)
        ax.imshow(road_mask[::2, ::2] * 1 + boundary[::2, ::2] * 2, origin="lower", extent=[mn[0], mn[0] + W * RES, mn[2], mn[2] + H * RES], cmap="viridis")
        ax.plot(tp[:, 0], tp[:, 1], "r-", lw=1)
        ax.plot(tp[-1, 0], tp[-1, 1], "wo", ms=8)
        plt.savefig(OUT / "debug_trace_fail.png", bbox_inches="tight")
    except Exception as e:  # noqa: BLE001
        print("[track] plot failed", e)
    raise SystemExit("[track] centreline trace did not close (see debug_trace_fail.png)")
# loop = [crossing … crossing+EXTRA) + [EXTRA … crossing): both pieces are converged and join seamlessly
c = closed_at
order = list(range(c, c + EXTRA)) + list(range(EXTRA, c))
hl_all = [halfL[0]] + halfL
hr_all = [halfR[0]] + halfR
halfL = [hl_all[i] for i in order]
halfR = [hr_all[i] for i in order]
pts = np.array([pts[i] for i in order])
p0 = pts[0].copy()
k = 5
ker = np.ones(2 * k + 1) / (2 * k + 1)


def circ_smooth(a: np.ndarray) -> np.ndarray:
    return np.convolve(np.concatenate([a[-k:], a, a[:k]]), ker, mode="valid")


def resample(xz: np.ndarray, n: int):
    seg_ = np.linalg.norm(np.diff(np.vstack([xz, xz[:1]]), axis=0), axis=1)
    cum_ = np.concatenate([[0], np.cumsum(seg_)])
    loop = np.vstack([xz, xz[:1]])
    s_ = np.linspace(0, cum_[-1], n, endpoint=False)
    return np.stack([np.interp(s_, cum_, loop[:, 0]), np.interp(s_, cum_, loop[:, 1])], axis=1), s_, cum_


# The raw trace zig-zags a little (edge-following corrections), which inflates its length.
# Measure the scale on a smoothed loop so the official lap length maps to the real centreline.
hl_raw = np.array(halfL)
hr_raw = np.array(halfR)
seg = np.linalg.norm(np.diff(np.vstack([pts, pts[:1]]), axis=0), axis=1)
raw_cum = np.concatenate([[0], np.cumsum(seg)])
raw_len_unsmoothed = float(raw_cum[-1])
smooth_raw, _, _ = resample(pts, int(raw_len_unsmoothed / 2.0))
for _ in range(2):
    smooth_raw = np.stack([circ_smooth(smooth_raw[:, 0]), circ_smooth(smooth_raw[:, 1])], axis=1)
raw_len = float(np.linalg.norm(np.diff(np.vstack([smooth_raw, smooth_raw[:1]]), axis=0), axis=1).sum())
SCALE = OFFICIAL_LENGTH_M / raw_len
print(f"[track] traced {len(pts)} pts, smoothed raw length {raw_len:.1f} units → scale {SCALE:.4f} m/unit", flush=True)
if not (1.8 < SCALE < 2.1):
    print("[track] WARNING scale outside the expected range, falling back to 1/0.5143", flush=True)
    SCALE = 1 / 0.5143

# ----------------------------------------------- resample (5 m) & heights ---
OFFSET = np.array([-(mn[0] + mx[0]) / 2, 0.0, -(mn[2] + mx[2]) / 2])


def sample_height(x: float, z: float) -> float:
    i, j = int((x - mn[0]) / RES), int((z - mn[2]) / RES)
    for rr in range(0, 12):
        for di in range(-rr, rr + 1):
            for dj in range(-rr, rr + 1):
                ii, jj = i + di, j + dj
                if 0 <= ii < W and 0 <= jj < H and road_mask[jj, ii]:
                    return float(height[jj, ii])
    return float(np.median(allroad[:, 1]))


n_out = int(round(OFFICIAL_LENGTH_M / 5.0))
xz, s_out, cum_s = resample(smooth_raw, n_out)


cx, cz = xz[:, 0].copy(), xz[:, 1].copy()
# half widths from the trace (fallback where the direct measurement below finds no road)
nearest = [int(np.argmin((pts[:, 0] - x) ** 2 + (pts[:, 1] - z) ** 2)) for x, z in zip(cx, cz)]
hl = circ_smooth(hl_raw[nearest])
hr = circ_smooth(hr_raw[nearest])

# Re-centre on the asphalt and measure the widths directly along each point's normal. The smoothing above
# straightens tight chicanes (Veedol) and hairpins, which put the line on the grass and let the widths of
# one side bleed into the other.
SEARCH = 9.0  # raw units either side (~18 m)
offs = np.arange(-SEARCH, SEARCH + 1e-9, RES * 0.5)


def normal_at(k: int):
    a_, b_ = (k - 1) % len(cx), (k + 1) % len(cx)
    tx_, tz_ = cx[b_] - cx[a_], cz[b_] - cz[a_]
    tl_ = math.hypot(tx_, tz_) or 1.0
    return tz_ / tl_, -tx_ / tl_  # left


def road_interval(k: int):
    nx_, nz_ = normal_at(k)
    flags = [is_road(cx[k] + nx_ * o, cz[k] + nz_ * o) for o in offs]
    segs, start = [], None
    for idx_, f in enumerate(flags + [False]):
        if f and start is None:
            start = idx_
        elif not f and start is not None:
            segs.append((offs[start], offs[idx_ - 1]))
            start = None
    if not segs:
        return None
    for a_, b_ in segs:
        if a_ <= 0 <= b_:
            return a_, b_
    a_, b_ = min(segs, key=lambda sg: min(abs(sg[0]), abs(sg[1])))
    return (a_, b_) if min(abs(a_), abs(b_)) < 4.0 else None


recentred = 0
for _ in range(3):
    shift = np.zeros(len(cx))
    for k in range(len(cx)):
        iv = road_interval(k)
        if iv is not None:
            shift[k] = max(-3.0, min(3.0, (iv[0] + iv[1]) / 2))
    shift = np.convolve(np.concatenate([shift[-2:], shift, shift[:2]]), np.ones(5) / 5, mode="valid")
    recentred = int((np.abs(shift) > 0.5).sum())
    for k in range(len(cx)):
        nx_, nz_ = normal_at(k)
        cx[k] += nx_ * shift[k]
        cz[k] += nz_ * shift[k]
# the per-point shifts leave a small zig-zag (it inflated the lap by ~2 %): smooth the positions lightly,
# then pull back onto the asphalt only the points the smoothing moved off it
ker3 = np.ones(3) / 3
for _ in range(6):
    cx = np.convolve(np.concatenate([cx[-1:], cx, cx[:1]]), ker3, mode="valid")
    cz = np.convolve(np.concatenate([cz[-1:], cz, cz[:1]]), ker3, mode="valid")
off_road = 0
for k in range(len(cx)):
    if not is_road(cx[k], cz[k]):
        iv = road_interval(k)
        if iv is not None:
            o_ = iv[0] + 0.5 if iv[0] > 0 else iv[1] - 0.5
            nx_, nz_ = normal_at(k)
            cx[k] += nx_ * o_
            cz[k] += nz_ * o_
            off_road += 1
print(f"[track] {off_road} points pulled back onto the asphalt after smoothing", flush=True)
measured = 0
for k in range(len(cx)):
    iv = road_interval(k)
    if iv is not None and iv[0] <= 0 <= iv[1]:
        hl[k], hr[k] = iv[1], -iv[0]
        measured += 1
hl = np.convolve(np.concatenate([hl[-1:], hl, hl[:1]]), np.ones(3) / 3, mode="valid")
hr = np.convolve(np.concatenate([hr[-1:], hr, hr[:1]]), np.ones(3) / 3, mode="valid")
print(f"[track] re-centred: {recentred} points still moving >1 m in the last pass; widths measured at {measured}/{len(cx)}", flush=True)
cy = circ_smooth(np.array([sample_height(x, z) for x, z in zip(cx, cz)]))

Y0 = float(cy[0])
OFFSET[1] = -Y0


def to_game(x, y, z):
    return [float((x + OFFSET[0]) * SCALE), float((y + OFFSET[1]) * SCALE), float((z + OFFSET[2]) * SCALE)]


cl = np.array([to_game(x, y, z) for x, y, z in zip(cx, cy, cz)])
segm = np.linalg.norm(np.diff(np.vstack([cl, cl[:1]]), axis=0), axis=1)
cumS = np.concatenate([[0], np.cumsum(segm)[:-1]])
length = float(segm.sum())
widthL = hl * SCALE
widthR = hr * SCALE

# Where a wall is the track edge (e.g. the pit-entry wall at the apex of the last corner), keep the usable
# width 1.2 m short of it: a car on the limit of "the track" must not touch concrete.
WALL_CLEAR_M = 1.2


def wall_dist(x: float, z: float, road_y: float, nx_: float, nz_: float, maxd: float) -> float:
    d = 0.0
    while d < maxd:
        d += RES * 0.5
        i, j = int((x + nx_ * d - mn[0]) / RES), int((z + nz_ * d - mn[2]) / RES)
        # a barrier stands on the ground; a bridge deck or gantry is well above the road
        if 0 <= i < W and 0 <= j < H and wall_base[j, i] < road_y + 1.0:
            return d
    return math.inf


clamped = 0
for k in range(len(cx)):
    a, b = (k - 1) % len(cx), (k + 1) % len(cx)
    tx_, tz_ = cx[b] - cx[a], cz[b] - cz[a]
    tl_ = math.hypot(tx_, tz_) or 1.0
    nx_, nz_ = tz_ / tl_, -tx_ / tl_  # left
    lim = []
    for side, arr in ((1.0, widthL), (-1.0, widthR)):
        dw = wall_dist(cx[k], cz[k], cy[k], side * nx_, side * nz_, (arr[k] + 3.0) / SCALE)
        lim.append(dw * SCALE - WALL_CLEAR_M if math.isfinite(dw) and dw * SCALE - WALL_CLEAR_M < arr[k] else None)
    # a structure "walling" both sides at once spans the road (gantry, bridge legs): not a barrier
    if lim[0] is not None and lim[1] is not None:
        continue
    for v_, arr in zip(lim, (widthL, widthR)):
        if v_ is not None:
            arr[k] = max(1.5, v_)
            clamped += 1
print(f"[track] widths clamped near walls at {clamped} points", flush=True)
print(f"[track] centreline {len(cl)} pts, length {length:.1f} m", flush=True)


def tangent(i: int) -> np.ndarray:
    a = cl[(i - 2) % len(cl)]
    b = cl[(i + 2) % len(cl)]
    t = np.array([b[0] - a[0], 0.0, b[2] - a[2]])
    return t / np.linalg.norm(t)


# ------------------------------------------------------------- gates ---
gates = []
n_g = int(round(length / GATE_SPACING_M))
for g in range(n_g):
    s = g * length / n_g
    i = int(np.searchsorted(cumS, s, side="right") - 1)
    t = tangent(i)
    hw = float(max(widthL[i], widthR[i]) + RUNOFF_MARGIN_M)
    gates.append({"s": float(cumS[i]), "p": [round(float(v), 3) for v in cl[i]], "d": [round(float(t[0]), 5), 0.0, round(float(t[2]), 5)], "hw": round(hw, 2)})
sector_gates = [int(round(n_g / 3)), int(round(2 * n_g / 3))]


# -------------------------------------------------------------- grid ---
def along(pxz: np.ndarray) -> float:
    """distance along the centreline (m) of a raw (x,z) point"""
    g = np.array(to_game(pxz[0], 0, pxz[1]))
    dd = (cl[:, 0] - g[0]) ** 2 + (cl[:, 2] - g[2]) ** 2
    return float(cumS[int(np.argmin(dd))])


race_dir_raw = perp / np.linalg.norm(perp)
cands = []
for b in slot_bars:
    c = b["c"]
    # transverse to the race direction and on the main straight between finish and start lines
    if abs(np.dot(b["dir"], race_dir_raw)) > 0.35:
        continue
    s = along(c[[0, 2]])
    if s < 0 or s > 350:
        continue
    cands.append((s, b))
cands.sort(key=lambda x: -x[0])
# de-duplicate (some boxes have two parallel bars)
grid_raw = []
for s, b in cands:
    if all(np.linalg.norm(b["c"][[0, 2]] - o["c"][[0, 2]]) > 1.0 for _, o in grid_raw):
        grid_raw.append((s, b))
grid = []
fwd = np.array([race_dir_raw[0], 0, race_dir_raw[1]])
yaw = math.atan2(fwd[0], fwd[2])  # rotation about +Y so that +Z (car forward) points along fwd
for s, b in grid_raw[:GRID_SLOTS]:
    gp = np.array(to_game(*b["c"]))
    gp -= fwd * 2.7  # bar marks the front of the box; car origin is mid-wheelbase
    gp[1] = float(sample_height(b["c"][0], b["c"][2]) + OFFSET[1]) * SCALE
    grid.append({"p": [round(float(v), 3) for v in gp], "yaw": round(yaw, 5)})
if len(grid) < GRID_SLOTS:
    print(f"[track] only {len(grid)} painted slots, generating the rest", flush=True)
    if len(grid) >= 2:
        step = np.array(grid[-2]["p"]) - np.array(grid[0]["p"]) if len(grid) >= 3 else fwd * -16
    while len(grid) < GRID_SLOTS:
        base = np.array(grid[-2]["p"]) if len(grid) >= 2 else np.zeros(3)
        nxt = base - fwd * 16.0
        grid.append({"p": [round(float(v), 3) for v in nxt], "yaw": round(yaw, 5)})
print(f"[track] grid slots {len(grid)}", flush=True)

# the first gate a car on the grid must cross
pole_s = along(grid_raw[0][1]["c"][[0, 2]]) if grid_raw else 0.0
first_gate = next((i for i, g in enumerate(gates) if g["s"] > pole_s + 5), 0)

# ----------------------------------------------------------- collision ---
col_dir = OUT / "collision_raw"
col_dir.mkdir(exist_ok=True)
col_meta = {}
for surf in SURFACES:
    vs, ts, off = [], [], 0
    for m in meshes:
        if surface_of(m["mat"]) != surf:
            continue
        v = (m["v"] + OFFSET) * SCALE
        vs.append(v.astype(np.float32))
        ts.append((m["t"] + off).astype(np.uint32))
        off += len(v)
    if not vs:
        continue
    V = np.concatenate(vs)
    T = np.concatenate(ts)
    (col_dir / f"{surf}.pos.bin").write_bytes(V.tobytes())
    (col_dir / f"{surf}.idx.bin").write_bytes(T.tobytes())
    col_meta[surf] = {"vertices": int(len(V)), "triangles": int(len(T))}
    print(f"[track] collision {surf}: {len(T)} tris", flush=True)

bounds_min = ((mn + OFFSET) * SCALE).tolist()
bounds_max = ((mx + OFFSET) * SCALE).tolist()
start_c = to_game(*start_line["c"]) if start_line else to_game(*grid_raw[0][1]["c"])
analysis = {
    "scale": SCALE,
    "offset": OFFSET.tolist(),
    "rawLength": raw_len,
    "collision": col_meta,
    "surfaceRules": SURFACE_RULES,
}
(OUT / "analysis.json").write_text(json.dumps(analysis, indent=1))

if os.environ.get("SPRINT_DEBUG"):
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    fig, ax = plt.subplots(figsize=(14, 14), dpi=80)
    ax.imshow(road_mask * 1 + boundary * 2, origin="lower", cmap="Greys", alpha=0.5, extent=[mn[0], mn[0] + W * RES, mn[2], mn[2] + H * RES])
    ax.plot(cx, cz, "b-", lw=1)
    for i in range(0, len(cx), 7):
        ax.text(cx[i], cz[i], f"{cumS[i]:.0f}", fontsize=7, color="r")
    i0 = int(np.searchsorted(cumS, 1500))
    i1 = int(np.searchsorted(cumS, 3500))
    xs, zs = cx[i0:i1], cz[i0:i1]
    ax.set_xlim(xs.min() - 60, xs.max() + 60)
    ax.set_ylim(zs.min() - 60, zs.max() + 60)
    plt.savefig(OUT / "debug_sprint.png", bbox_inches="tight")

# ---------------------------------------------------------- pit lane ---
# The pit lane is the narrow corridor beside the start/finish straight (behind the pit wall), with its own
# entry road on the inside of the last corner and an exit road after the first corner. Trace it like the
# circuit: from the chequered strip (which lies on the pit lane side), forwards to where it merges with the
# circuit (exit) and backwards to where it splits off (entry).
main_xz = np.stack([cx, cz], axis=1)


def dist_to_main(q: np.ndarray) -> tuple[float, int]:
    d2 = ((main_xz - q) ** 2).sum(axis=1)
    i = int(np.argmin(d2))
    return math.sqrt(float(d2[i])), i


def pit_trace(p_start: np.ndarray, d_start: np.ndarray, max_steps: int = 2400):
    p = p_start.copy()
    d = d_start / np.linalg.norm(d_start)
    pts_ = [p.copy()]
    prev_l_, prev_r_ = 1.5, 1.5
    left_main = False
    merged_at = None
    for it in range(max_steps):
        q = p + d * STEP
        n = np.array([d[1], -d[0]])
        l = edge_dist(q, n, 6.0)
        r_ = edge_dist(q, -n, 6.0)
        if math.isfinite(l) and math.isfinite(r_):
            shift = (l - r_) / 2
            prev_l_, prev_r_ = l, r_
        elif math.isfinite(l):
            shift = l - prev_l_
        elif math.isfinite(r_):
            shift = prev_r_ - r_
        else:
            shift = 0.0
        q = q + n * max(-0.15, min(0.15, shift))
        nd = q - p
        nd /= np.linalg.norm(nd)
        d = d * 0.75 + nd * 0.25
        d /= np.linalg.norm(d)
        p = q
        pts_.append(p.copy())
        dm, _ = dist_to_main(p)
        if dm > 5.0:
            left_main = True
        if left_main and dm < 1.2:
            merged_at = it
            break
    return np.array(pts_), merged_at


pit = None
try:
    fwd_dir = d0 / np.linalg.norm(d0)
    # find the corridor: scan sideways from the main straight at the line; the pit lane is the next strip of
    # asphalt after the track's edge (on the garage side, either side is tried)
    fin = finish["c"][[0, 2]]
    _, k0 = dist_to_main(fin)
    on_main = main_xz[k0]
    side = np.array([fwd_dir[1], -fwd_dir[0]])
    start = None
    offs_ = np.arange(0, 16, RES * 0.5)
    best = None
    for sgn in (-1.0, 1.0):
        flags = [is_road(*(on_main + side * sgn * o)) for o in offs_]
        i = 0
        while i < len(flags) and flags[i]:
            i += 1  # the track itself
        # road strips beyond it: the pit lane is the widest one of pit-lane width (the narrow strip in front of
        # the pit wall is run-off)
        while i < len(flags):
            while i < len(flags) and not flags[i]:
                i += 1
            j = i
            while j < len(flags) and flags[j]:
                j += 1
            w_ = offs_[min(j, len(offs_) - 1)] - offs_[min(i, len(offs_) - 1)]
            if 2.5 <= w_ <= 7.0 and (best is None or w_ > best[0]):
                best = (w_, sgn, (offs_[i] + offs_[min(j, len(offs_) - 1)]) / 2)
            i = j
    if best is not None:
        start = on_main + side * best[1] * best[2]
        print(f"[track] pit lane found {best[2] * SCALE:.1f} m beside the line, {best[0] * SCALE:.1f} m wide", flush=True)
    if start is None:
        for sgn in (-1.0, 1.0):
            row = ""
            for o in np.arange(0, 16, RES * 0.5):
                q_ = on_main + side * sgn * o
                i_, j_ = int((q_[0] - mn[0]) / RES), int((q_[1] - mn[2]) / RES)
                row += "#" if boundary[j_, i_] else ("." if road_mask[j_, i_] else " ")
            print(f"[track] scan {sgn:+.0f}: |{row}|", flush=True)
        raise RuntimeError("no corridor beside the start/finish line")
    ahead, merge_out = pit_trace(start, fwd_dir)
    behind, merge_in = pit_trace(start, -fwd_dir)
    if os.environ.get("PIT_DEBUG"):
        import matplotlib

        matplotlib.use("Agg")
        import matplotlib.pyplot as plt

        fig, ax = plt.subplots(figsize=(14, 14), dpi=80)
        ax.imshow(road_mask * 1 + boundary * 2, origin="lower", cmap="Greys", alpha=0.5, extent=[mn[0], mn[0] + W * RES, mn[2], mn[2] + H * RES])
        ax.plot(main_xz[:, 0], main_xz[:, 1], "b-", lw=1)
        ax.plot(ahead[:, 0], ahead[:, 1], "r-", lw=1.5)
        ax.plot(behind[:, 0], behind[:, 1], "m-", lw=1.5)
        c0 = finish["c"][[0, 2]]
        for b in slot_bars:
            ax.plot(b["c"][0], b["c"][2], "go", ms=3)
        ax.plot(main_xz[0, 0], main_xz[0, 1], "ko", ms=8)
        ax.set_xlim(c0[0] - 600, c0[0] + 600)
        ax.set_ylim(c0[1] - 600, c0[1] + 600)
        plt.savefig(OUT / "debug_pit.png", bbox_inches="tight")
    if merge_out is None or merge_in is None:
        print(f"[track] pit lane: trace did not merge (out {merge_out}, in {merge_in})", flush=True)
    else:
        pit_raw = np.vstack([behind[::-1], ahead[1:]])
        # resample every 2.5 m and smooth lightly
        segp = np.linalg.norm(np.diff(pit_raw, axis=0), axis=1)
        cump = np.concatenate([[0], np.cumsum(segp)])
        npts = max(4, int(cump[-1] * SCALE / 2.5))
        sp = np.linspace(0, cump[-1], npts)
        px_ = np.interp(sp, cump, pit_raw[:, 0])
        pz_ = np.interp(sp, cump, pit_raw[:, 1])
        for _ in range(3):
            px_[1:-1] = (px_[:-2] + px_[1:-1] + px_[2:]) / 3
            pz_[1:-1] = (pz_[:-2] + pz_[1:-1] + pz_[2:]) / 3
        pit_pts = [to_game(x, sample_height(x, z), z) for x, z in zip(px_, pz_)]
        pit_len = float(sum(np.linalg.norm(np.array(pit_pts[i + 1]) - np.array(pit_pts[i])) for i in range(len(pit_pts) - 1)))
        _, i_in = dist_to_main(pit_raw[0])
        _, i_out = dist_to_main(pit_raw[-1])
        # service boxes: on the straight part of the lane alongside the start/finish line (where the garages are)
        k_fin = int(np.argmin((px_ - start[0]) ** 2 + (pz_ - start[1]) ** 2))
        box_from = max(0, k_fin - int(70 / 2.5))
        box_to = min(len(pit_pts) - 1, k_fin + int(70 / 2.5))
        pit = {
            "points": [[round(v, 3) for v in q] for q in pit_pts],
            "length": round(pit_len, 1),
            "entryS": round(float(cumS[i_in]), 1),
            "exitS": round(float(cumS[i_out]), 1),
            "boxFrom": box_from,
            "boxTo": box_to,
            "speedLimitKmh": 60,
        }
        print(f"[track] pit lane {pit_len:.0f} m, entry at {cumS[i_in]:.0f} m, exit at {cumS[i_out]:.0f} m, boxes {box_from}..{box_to}", flush=True)
except Exception as e:  # noqa: BLE001
    print("[track] pit lane trace failed", e, flush=True)

r = lambda a: [round(float(v), 3) for v in a]
track = {
    "version": 1,
    "id": "nurburgring_gp_2022",
    "name": "Nürburgring GP",
    "length": round(length, 2),
    "centerline": [round(float(v), 3) for v in cl.reshape(-1)],
    "cumS": [round(float(v), 3) for v in cumS],
    "widthL": [round(float(v), 2) for v in widthL],
    "widthR": [round(float(v), 2) for v in widthR],
    "gates": gates,
    "sectorGates": sector_gates,
    "firstGate": first_gate,
    "minLapMs": int(length / 75.0 * 1000),
    "grid": grid,
    "startLine": {"p": r(start_c), "d": gates[0]["d"], "hw": 8.0},
    "finishLine": {"p": r(cl[0]), "d": gates[0]["d"], "hw": float(max(widthL[0], widthR[0]))},
    "bounds": {"min": r(bounds_min), "max": r(bounds_max)},
    "lights": [],
    "pitLane": pit,
}
(OUT / "track_base.json").write_text(json.dumps(track))

# ---------------------------------------------------- alternative layouts ---
# The map also contains the link road that skips the Müllenbachschleife (the northern loop): the GP-Strecke
# without it is the short layout. Built by tracing the link from its middle in both directions until it merges
# with the circuit, then splicing it into the GP centreline (same start/finish, grid and pit lane).
LAYOUTS = [
    {
        "id": "nurburgring_short",
        "name": "Nürburgring GP · Short (no Müllenbachschleife)",
        "link_hint": (-705.0, 1790.0),  # raw map units, a point on the link road
        "from_s": 1800.0,  # roughly where it leaves / rejoins the GP lap (m)
        "to_s": 3040.0,
    }
]


def measure_widths(xr: float, zr: float, nx_: float, nz_: float) -> tuple[float, float]:
    flags = [is_road(xr + nx_ * o, zr + nz_ * o) for o in offs]
    i0_ = len(offs) // 2
    a_ = b_ = i0_
    while a_ > 0 and flags[a_ - 1]:
        a_ -= 1
    while b_ < len(flags) - 1 and flags[b_ + 1]:
        b_ += 1
    return float(offs[b_]) * SCALE, float(-offs[a_]) * SCALE


def build_layout(spec: dict) -> dict | None:
    hint = np.array(spec["link_hint"])
    start_ = None
    for r_ in np.arange(0, 12, RES):
        for ang in np.linspace(0, 2 * math.pi, 24, endpoint=False):
            q_ = hint + r_ * np.array([math.cos(ang), math.sin(ang)])
            if is_road(q_[0], q_[1]) and dist_to_main(q_)[0] > 5:
                start_ = q_
                break
        if start_ is not None:
            break
    if start_ is None:
        print(f"[track] layout {spec['id']}: no link road near the hint", flush=True)
        return None
    i_a = int(np.searchsorted(cumS, spec["from_s"]))
    i_b = int(np.searchsorted(cumS, spec["to_s"]))
    fwd_, m_out = pit_trace(start_, main_xz[i_b] - start_)
    back_, m_in = pit_trace(start_, main_xz[i_a] - start_)
    if m_out is None or m_in is None:
        print(f"[track] layout {spec['id']}: the link trace did not merge", flush=True)
        return None
    _, k_in = dist_to_main(back_[-1])
    _, k_out = dist_to_main(fwd_[-1])
    if not (cumS[k_in] < cumS[k_out]):
        print(f"[track] layout {spec['id']}: link goes the wrong way ({cumS[k_in]:.0f} → {cumS[k_out]:.0f})", flush=True)
        return None
    link = np.vstack([back_[::-1], fwd_[1:]])
    # link points in game coordinates with heights and measured widths
    lp, lwl, lwr = [], [], []
    for k_ in range(0, len(link), 4):
        a_, b_ = link[max(0, k_ - 2)], link[min(len(link) - 1, k_ + 2)]
        tx_, tz_ = b_[0] - a_[0], b_[1] - a_[1]
        tl_ = math.hypot(tx_, tz_) or 1.0
        wl_, wr_ = measure_widths(link[k_][0], link[k_][1], tz_ / tl_, -tx_ / tl_)
        lp.append(to_game(link[k_][0], sample_height(link[k_][0], link[k_][1]), link[k_][1]))
        lwl.append(wl_)
        lwr.append(wr_)
    pts_ = np.vstack([cl[: k_in + 1], np.array(lp), cl[k_out:]])
    wl_all = np.concatenate([widthL[: k_in + 1], lwl, widthL[k_out:]])
    wr_all = np.concatenate([widthR[: k_in + 1], lwr, widthR[k_out:]])
    # resample every 5 m
    seg_ = np.linalg.norm(np.diff(np.vstack([pts_, pts_[:1]]), axis=0), axis=1)
    cum_ = np.concatenate([[0], np.cumsum(seg_)])
    total = float(cum_[-1])
    n_ = int(round(total / 5.0))
    s_new = np.linspace(0, total, n_, endpoint=False)
    loop = np.vstack([pts_, pts_[:1]])
    cl2 = np.stack([np.interp(s_new, cum_, loop[:, k]) for k in range(3)], axis=1)
    wl2 = np.interp(s_new, cum_, np.concatenate([wl_all, wl_all[:1]]))
    wr2 = np.interp(s_new, cum_, np.concatenate([wr_all, wr_all[:1]]))
    # light smoothing of the splice
    for _ in range(2):
        for k in (0, 2):
            cl2[1:-1, k] = (cl2[:-2, k] + cl2[1:-1, k] * 2 + cl2[2:, k]) / 4
    seg2 = np.linalg.norm(np.diff(np.vstack([cl2, cl2[:1]]), axis=0), axis=1)
    cum2 = np.concatenate([[0], np.cumsum(seg2)[:-1]])
    len2 = float(seg2.sum())

    def tan2(i: int) -> np.ndarray:
        a__ = cl2[(i - 2) % len(cl2)]
        b__ = cl2[(i + 2) % len(cl2)]
        t_ = np.array([b__[0] - a__[0], 0.0, b__[2] - a__[2]])
        return t_ / np.linalg.norm(t_)

    gates2 = []
    ng = int(round(len2 / GATE_SPACING_M))
    for g in range(ng):
        sg = g * len2 / ng
        i = int(np.searchsorted(cum2, sg, side="right") - 1)
        t_ = tan2(i)
        hw_ = float(max(wl2[i], wr2[i]) + RUNOFF_MARGIN_M)
        gates2.append({"s": float(cum2[i]), "p": [round(float(v), 3) for v in cl2[i]], "d": [round(float(t_[0]), 5), 0.0, round(float(t_[2]), 5)], "hw": round(hw_, 2)})
    first2 = next((i for i, g in enumerate(gates2) if g["s"] > pole_s + 5), 0)
    pit2 = None
    if pit:
        def near_s(p3):
            d2_ = ((cl2[:, 0] - p3[0]) ** 2 + (cl2[:, 2] - p3[2]) ** 2)
            return float(cum2[int(np.argmin(d2_))])
        pit2 = {**pit, "entryS": round(near_s(pit["points"][0]), 1), "exitS": round(near_s(pit["points"][-1]), 1)}
    print(f"[track] layout {spec['id']}: {len2:.0f} m (link {cumS[k_in]:.0f} → {cumS[k_out]:.0f} m of the GP lap), {len(gates2)} gates", flush=True)
    return {
        **track,
        "id": spec["id"],
        "name": spec["name"],
        "length": round(len2, 2),
        "centerline": [round(float(v), 3) for v in cl2.reshape(-1)],
        "cumS": [round(float(v), 3) for v in cum2],
        "widthL": [round(float(v), 2) for v in wl2],
        "widthR": [round(float(v), 2) for v in wr2],
        "gates": gates2,
        "sectorGates": [int(round(ng / 3)), int(round(2 * ng / 3))],
        "firstGate": first2,
        "minLapMs": int(len2 / 75.0 * 1000),
        "pitLane": pit2,
    }


for spec in LAYOUTS:
    try:
        lay = build_layout(spec)
        if lay:
            (OUT / f"track_base_{spec['id']}.json").write_text(json.dumps(lay))
    except Exception as e:  # noqa: BLE001
        print(f"[track] layout {spec['id']} failed: {e}", flush=True)
print(f"[track] gates {len(gates)}, sectors at {sector_gates}, first gate {first_gate}", flush=True)

# ------------------------------------------------------------- debug ---
try:
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    fig, ax = plt.subplots(figsize=(14, 16), dpi=80)
    ax.imshow(road_mask[::4, ::4] * 1 + boundary[::4, ::4] * 2, cmap="Greys", alpha=0.35, origin="lower",
              extent=[(mn[0] + OFFSET[0]) * SCALE, (mn[0] + OFFSET[0] + W * RES) * SCALE,
                      (mn[2] + OFFSET[2]) * SCALE, (mn[2] + OFFSET[2] + H * RES) * SCALE])
    ax.plot(cl[:, 0], cl[:, 2], "b-", lw=1)
    for i, g in enumerate(gates):
        p, dd, hw = np.array(g["p"]), np.array(g["d"]), g["hw"]
        sv = np.array([dd[2], 0, -dd[0]])
        a, b = p + sv * hw, p - sv * hw
        ax.plot([a[0], b[0]], [a[2], b[2]], "r-" if i == 0 else ("m-" if i in sector_gates else "g-"), lw=0.8)
        ax.text(p[0], p[2], str(i), fontsize=6)
    for i, gs in enumerate(grid):
        ax.plot(gs["p"][0], gs["p"][2], "ko", ms=3)
    ax.set_aspect("equal")
    plt.savefig(OUT / "debug_track.png", bbox_inches="tight")
    # zoom on the grid
    ax.set_xlim(cl[0, 0] - 150, cl[0, 0] + 150)
    ax.set_ylim(cl[0, 2] - 150, cl[0, 2] + 150)
    for t in ax.texts:
        t.set_clip_on(True)
    for i, gs in enumerate(grid):
        ax.text(gs["p"][0] + 1, gs["p"][2], str(i + 1), fontsize=9, color="k", clip_on=True)
    if pit:
        pp = np.array(pit["points"])
        ax.plot(pp[:, 0], pp[:, 2], "m-", lw=1.5)
        bx = pp[pit["boxFrom"] : pit["boxTo"] + 1]
        ax.plot(bx[:, 0], bx[:, 2], "c-", lw=3)
    plt.savefig(OUT / "debug_grid.png")
except Exception as e:  # noqa: BLE001
    print("[track] debug plot failed", e)
