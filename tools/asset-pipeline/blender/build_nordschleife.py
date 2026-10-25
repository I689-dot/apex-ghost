"""Nordschleife builder (Blender headless): the 20.8 km Nordschleife, joined to the GP map.

  blender -b --factory-startup -P tools/asset-pipeline/blender/build_nordschleife.py -- <repo root> [maps/nordschleife.json]
         [--fixture <dir>]   # offline test data instead of downloads: <dir>/osm.json + <dir>/dem.py (def elevation(lat, lon))

No source model of the Nordschleife exists, so the road is built from one of two sources (maps/nordschleife.json):
  - "source": "terrain" (default, offline): the channel the GP map's satellite terrain leaves for the Nordschleife,
    traced by tools/asset-pipeline/trace_nordschleife.mjs (centreline + heights from the banks);
  - "source": "osm": OpenStreetMap (© OpenStreetMap contributors, ODbL) raceway centreline (Overpass API) and
    EU-DEM 25 m elevation (Copernicus, via opentopodata.org), aligned to the game by ICP on the GP; cached.
Google Earth / Street View were used only as visual reference for widths, kerbs, barriers and banking (config).

Steps:
 1. download/cache OSM raceways + DEM samples (cache: tools/asset-pipeline/out/<map out>/cache/);
 2. align OSM to the game frame: ICP of the game's GP lap line onto the OSM GP raceway points (similarity, <~2 m);
 3. extract the Nordschleife path (ways named like "Nordschleife"), cut where it merges with the GP, orient it
    clockwise and find where it leaves (exit) and rejoins (return) the GP lap;
 4. elevation: DEM minus the GP's DEM↔game offset, smoothed; config crests/banking added; ramps into the GP heights;
 5. geometry in 1 km chunks (game metres): asphalt with crown, painted edge lines, red/white kerbs on the inside of
    corners, grass verges, double armco with posts, a terrain corridor that blends into the GP map's satellite terrain;
 6. writes the map folder optimize.mjs packs (`pnpm assets --only optimize --map nordschleife`):
    map_track.glb, map_scenery.glb, map_terrain.glb, chunks.json, collision_raw/*.bin, track_base.json
    (layout nurburgring_24h: GP start → exit → Nordschleife → return → GP finish).
The GP's own chunks and collision are referenced, not copied (maps/nordschleife.json "baseMap").
"""
from __future__ import annotations

import hashlib
import importlib.util
import json
import math
import os
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

import bpy
import numpy as np

argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
ROOT = Path(argv[0]) if argv else Path(__file__).resolve().parents[3]
CFG_FILE = ROOT / "tools/asset-pipeline/maps" / (argv[1] if len(argv) > 1 and not argv[1].startswith("--") else "nordschleife.json")
FIXTURE = Path(argv[argv.index("--fixture") + 1]) if "--fixture" in argv else None
MAP = json.loads(CFG_FILE.read_text())
NS = MAP["nordschleife"]
OUT = ROOT / "tools/asset-pipeline/out" / MAP["out"]
CACHE = OUT / "cache"
PUB = ROOT / "apps/client/public"
OUT.mkdir(parents=True, exist_ok=True)
CACHE.mkdir(parents=True, exist_ok=True)


def log(*a):
    print("[map]", *a, flush=True)


# ----------------------------------------------------------------------------------------- inputs ---
base_index = json.loads((PUB / "assets/tracks.json").read_text())["tracks"]
gp_entry = next(t for t in base_index if (t.get("map") or "nurburgring") == MAP["baseMap"] and t.get("default", False)) if any(
    t.get("default") for t in base_index
) else base_index[0]
GP = json.loads((PUB / gp_entry["file"].split("?")[0]).read_text())
gp_cl = np.array(GP["centerline"], float).reshape(-1, 3)
gp_s = np.array(GP["cumS"], float)
GP_L = float(GP["length"])
log(f"GP layout {GP['id']}: {GP_L:.0f} m, {len(gp_cl)} points")

REF = tuple(NS.get("refLatLon", [50.3356, 6.9475]))
R_E = 6378137.0


def ll_to_en(lat, lon):
    lat = np.asarray(lat, float)
    lon = np.asarray(lon, float)
    e = np.radians(lon - REF[1]) * R_E * math.cos(math.radians(REF[0]))
    n = np.radians(lat - REF[0]) * R_E
    return np.stack([e, n], -1)


def en_to_ll(en):
    en = np.asarray(en, float)
    lat = REF[0] + np.degrees(en[..., 1] / R_E)
    lon = REF[1] + np.degrees(en[..., 0] / (R_E * math.cos(math.radians(REF[0]))))
    return lat, lon


def http_json(url, data=None):
    for i in range(5):
        try:
            req = urllib.request.Request(url, data=data, headers={"User-Agent": "apex-ghost-track-builder/1.0 (private game)"})
            with urllib.request.urlopen(req, timeout=180) as r:
                return json.loads(r.read().decode())
        except Exception as e:  # noqa: BLE001
            log(f"download retry {i + 1}: {e}")
            time.sleep(4 * (i + 1))
    raise RuntimeError(f"download failed: {url}")


def osm_data():
    if FIXTURE:
        return json.loads((FIXTURE / "osm.json").read_text())
    f = CACHE / "osm_raceways.json"
    if f.exists():
        return json.loads(f.read_text())
    s, w, n, e = NS["bbox"]
    q = f'[out:json][timeout:120];way["highway"="raceway"]({s},{w},{n},{e});out geom tags;'
    log("downloading OpenStreetMap raceways (Overpass API)…")
    d = http_json("https://overpass-api.de/api/interpreter", urllib.parse.urlencode({"data": q}).encode())
    f.write_text(json.dumps(d))
    return d


_dem_mod = None


def dem(lat, lon):
    """Elevations (m a.s.l.) for arrays of lat/lon; EU-DEM via opentopodata (100 points/request, 1 req/s), cached."""
    global _dem_mod
    lat = np.asarray(lat, float).ravel()
    lon = np.asarray(lon, float).ravel()
    if FIXTURE:
        if _dem_mod is None:
            spec = importlib.util.spec_from_file_location("dem_fixture", FIXTURE / "dem.py")
            _dem_mod = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(_dem_mod)
        return np.array([_dem_mod.elevation(a, b) for a, b in zip(lat, lon)], float)
    key = hashlib.sha1(np.round(np.stack([lat, lon], 1), 6).tobytes()).hexdigest()[:16]
    f = CACHE / f"dem_{key}.json"
    if f.exists():
        return np.array(json.loads(f.read_text()), float)
    out = []
    log(f"downloading {len(lat)} DEM samples ({NS.get('demDataset', 'eudem25m')})…")
    for i in range(0, len(lat), 100):
        locs = "|".join(f"{a:.6f},{b:.6f}" for a, b in zip(lat[i : i + 100], lon[i : i + 100]))
        r = http_json(f"https://api.opentopodata.org/v1/{NS.get('demDataset', 'eudem25m')}?locations={locs}")
        out += [x["elevation"] if x["elevation"] is not None else float("nan") for x in r["results"]]
        time.sleep(1.05)
    arr = np.array(out, float)
    if np.isnan(arr).any():  # fill gaps from neighbours
        good = ~np.isnan(arr)
        arr[~good] = np.interp(np.flatnonzero(~good), np.flatnonzero(good), arr[good])
    f.write_text(json.dumps(arr.tolist()))
    return arr


# -------------------------------------------------------------------------------- geometry helpers ---
def resample(pts, step):
    seg = np.linalg.norm(np.diff(pts[:, :2], axis=0), axis=1)
    s = np.concatenate([[0], np.cumsum(seg)])
    t = np.linspace(0, s[-1], max(2, int(s[-1] / step) + 1))
    return np.stack([np.interp(t, s, pts[:, k]) for k in range(pts.shape[1])], 1)


def smooth1d(a, sigma_pts, wrap=False):
    if sigma_pts <= 0:
        return a.copy()
    r = int(3 * sigma_pts)
    k = np.exp(-0.5 * (np.arange(-r, r + 1) / sigma_pts) ** 2)
    k /= k.sum()
    pad = np.concatenate([a[-r:], a, a[:r]]) if wrap else np.concatenate([np.full(r, a[0]), a, np.full(r, a[-1])])
    return np.convolve(pad, k, mode="valid")


class Grid2D:
    """Nearest-point queries on a 2D point set (Blender's KD-tree)."""

    def __init__(self, pts, cell=25.0):
        from mathutils.kdtree import KDTree

        self.p = np.asarray(pts, float)
        self.kd = KDTree(len(self.p))
        for i, (x, y) in enumerate(self.p):
            self.kd.insert((x, y, 0.0), i)
        self.kd.balance()

    def nearest(self, q, max_r=None):
        q = np.asarray(q, float)
        out_i = np.empty(len(q), int)
        out_d = np.empty(len(q))
        for k, (x, y) in enumerate(q):
            _, i, d = self.kd.find((x, y, 0.0))
            out_i[k], out_d[k] = i, d
        return out_i, out_d


def umeyama(src, dst):
    ms, md = src.mean(0), dst.mean(0)
    A, B = src - ms, dst - md
    U, S, Vt = np.linalg.svd(B.T @ A / len(src))
    D = np.eye(2)
    if np.linalg.det(U @ Vt) < 0:
        D[1, 1] = -1
    R = U @ D @ Vt
    s = float(np.trace(np.diag(S) @ D) / (A**2).sum(1).mean())
    return s, R, md - s * R @ ms


# ------------------------------------------------------------------- junctions: along the GP's own link roads ---
def load_base_collision():
    """The GP map's collision (game metres): {surface: [triangles (k, 3, 3)]}."""
    import gzip
    import struct

    out = {}
    for f in [GP["collision"]["file"], *GP["collision"].get("extra", [])]:
        raw = (PUB / f.split("?")[0]).read_bytes()
        if raw[:2] == b"\x1f\x8b":
            raw = gzip.decompress(raw)
        cnt = struct.unpack_from("<I", raw, 8)[0]
        o = 12
        for _ in range(cnt):
            si, nv, ni = struct.unpack_from("<III", raw, o)
            o += 12
            pos = np.frombuffer(raw, "<f4", nv * 3, o).reshape(-1, 3)
            o += nv * 12
            idx = np.frombuffer(raw, "<u4", ni, o).reshape(-1, 3)
            o += ni * 4
            out.setdefault(GP["collision"]["surfaces"][si], []).append(pos[idx])
    return {k: np.concatenate(v) for k, v in out.items()}


BASE_COL = load_base_collision()


def raster(tris, x0, z0, W, H, res, value="mask", tol=0.02):
    """Rasterise triangles top-down: mask (bool) or max height. `tol`: barycentric slack (relative to the triangle)."""
    out = np.full((H, W), -np.inf) if value == "height" else np.zeros((H, W), bool)
    cx = tris[:, :, 0]
    cz = tris[:, :, 2]
    sel = (cx.max(1) >= x0) & (cx.min(1) <= x0 + W * res) & (cz.max(1) >= z0) & (cz.min(1) <= z0 + H * res)
    for t in tris[sel]:
        i0, i1 = int(max(0, (t[:, 0].min() - x0) / res)), int(min(W - 1, (t[:, 0].max() - x0) / res))
        j0, j1 = int(max(0, (t[:, 2].min() - z0) / res)), int(min(H - 1, (t[:, 2].max() - z0) / res))
        if i1 < i0 or j1 < j0:
            continue
        gx, gz = np.meshgrid(x0 + (np.arange(i0, i1 + 1) + 0.5) * res, z0 + (np.arange(j0, j1 + 1) + 0.5) * res)
        (ax, ay, az), (bx, by, bz), (qx, qy, qz) = t
        den = (bz - qz) * (ax - qx) + (qx - bx) * (az - qz)
        if abs(den) < 1e-9:
            continue
        w1 = ((bz - qz) * (gx - qx) + (qx - bx) * (gz - qz)) / den
        w2 = ((qz - az) * (gx - qx) + (ax - qx) * (gz - qz)) / den
        w3 = 1 - w1 - w2
        inside = (w1 >= -tol) & (w2 >= -tol) & (w3 >= -tol)
        if value == "height":
            h = w1 * ay + w2 * by + w3 * qy
            blk = out[j0 : j1 + 1, i0 : i1 + 1]
            blk[inside] = np.maximum(blk[inside], h[inside])
        else:
            out[j0 : j1 + 1, i0 : i1 + 1] |= inside
    return out


def route_to_gp(E, yE, inward, sign=+1):
    """Cheapest way from E (end of the Nordschleife path) onto the GP lap, preferring the GP map's own asphalt
    (the real link roads are modelled) and avoiding its walls. Returns points GP → E, their heights and a flag
    'on the GP's asphalt' per point."""
    import heapq

    res = 1.0
    gi, _ = Grid2D(gp_cl[:, [0, 2]]).nearest(E[None])
    G = gp_cl[gi[0], [0, 2]]
    lo = np.minimum(E, G) - 140
    hi = np.maximum(E, G) + 140
    W, H = int((hi[0] - lo[0]) / res), int((hi[1] - lo[1]) / res)
    asph = raster(BASE_COL.get("asphalt", np.zeros((0, 3, 3))), lo[0], lo[1], W, H, res)
    # heights: the GP map's ground (asphalt, kerbs, grass, run-off) where it exists, so the new road meets it
    ground = np.concatenate([BASE_COL[k] for k in ("asphalt", "curb", "grass", "sand", "gravel") if k in BASE_COL])
    asph_h = raster(ground, lo[0], lo[1], W, H, res, "height")
    wall = raster(BASE_COL.get("wall", np.zeros((0, 3, 3))), lo[0], lo[1], W, H, res)
    # distance to the asphalt edge (chamfer), so the route keeps to the middle of the link road
    dist = np.where(asph, 1e3, 0.0)
    for _ in range(2):
        for j in range(H):
            for i in range(W):
                if dist[j, i] == 0:
                    continue
                v = dist[j, i]
                if i > 0:
                    v = min(v, dist[j, i - 1] + 1)
                if j > 0:
                    v = min(v, dist[j - 1, i] + 1)
                dist[j, i] = v
        for j in range(H - 1, -1, -1):
            for i in range(W - 1, -1, -1):
                v = dist[j, i]
                if i < W - 1:
                    v = min(v, dist[j, i + 1] + 1)
                if j < H - 1:
                    v = min(v, dist[j + 1, i] + 1)
                dist[j, i] = v
    soft = raster(np.concatenate([BASE_COL[k] for k in ("sand", "gravel") if k in BASE_COL] or [np.zeros((0, 3, 3))]), lo[0], lo[1], W, H, res)
    # asphalt, kept to the middle; grass is possible (the channel itself), gravel traps and walls are not
    cost = np.where(asph, 1.0 + 3.0 / (1.0 + dist), 12.0) + np.where(soft & ~asph, 6.0, 0.0) + np.where(wall, 300.0, 0.0)
    goal = np.zeros((H, W), bool)
    seg = resample(gp_cl[:, [0, 2]], 0.5)
    gi_ = ((seg[:, 0] - lo[0]) / res).astype(int)
    gj_ = ((seg[:, 1] - lo[1]) / res).astype(int)
    ok = (gi_ >= 0) & (gj_ >= 0) & (gi_ < W) & (gj_ < H)
    goal[gj_[ok], gi_[ok]] = True
    si, sj = int((E[0] - lo[0]) / res), int((E[1] - lo[1]) / res)
    best = np.full((H, W), np.inf)
    prev = np.full((H, W, 2), -1, int)
    best[sj, si] = 0
    pq = [(0.0, sj, si)]
    end = None
    goal_k = np.full((H, W), -1, int)
    seg_idx = np.interp(np.arange(len(seg)), np.linspace(0, len(seg) - 1, len(gp_cl)), np.arange(len(gp_cl))).astype(int)
    goal_k[gj_[ok], gi_[ok]] = seg_idx[ok]
    reached = []
    while pq:
        c, j, i = heapq.heappop(pq)
        if c > best[j, i]:
            continue
        if goal[j, i]:
            reached.append((c, j, i))
            if len(reached) > 400:
                break
            continue
        for dj, di, l in ((-1, 0, 1), (1, 0, 1), (0, -1, 1), (0, 1, 1), (-1, -1, 1.414), (-1, 1, 1.414), (1, -1, 1.414), (1, 1, 1.414)):
            q, r = j + dj, i + di
            if 0 <= q < H and 0 <= r < W:
                nc = c + l * cost[q, r]
                if nc < best[q, r]:
                    best[q, r] = nc
                    prev[q, r] = (j, i)
                    heapq.heappush(pq, (nc, q, r))
    if not reached:
        raise SystemExit("junction routing failed: no way from the Nordschleife onto the GP lap")

    def trace_back(j, i):
        cells = [(j, i)]
        while tuple(prev[cells[-1]]) != (-1, -1):
            cells.append(tuple(prev[cells[-1]]))
        return np.array(cells)  # goal (GP) … start (E)

    # join the GP lap at a shallow angle (the link roads merge tangentially): cost + a penalty on the joining angle
    best_c = None
    for c, j, i in reached:
        cells_ = trace_back(j, i)
        if len(cells_) < 12:
            continue
        k = goal_k[j, i]
        tg = gp_cl[(k + 1) % len(gp_cl), [0, 2]] - gp_cl[k - 1, [0, 2]]
        tg /= np.linalg.norm(tg) or 1
        d = cells_[min(15, len(cells_) - 1), ::-1] - cells_[0, ::-1]
        d = d / (np.linalg.norm(d) or 1)
        # leaving (sign +1): the connector heads on in the GP's direction; joining (-1): it arrives along it
        ang = math.degrees(math.acos(max(-1.0, min(1.0, sign * float(np.dot(tg, d))))))
        score = c + 1.5 * ang**1.3
        if best_c is None or score < best_c[0]:
            best_c = (score, cells_, ang)
    cells = best_c[1]
    log(f"junction: joins the GP lap at {best_c[2]:.0f}°")
    pts = np.c_[lo[0] + (cells[:, 1] + 0.5) * res, lo[1] + (cells[:, 0] + 0.5) * res]
    on = asph[cells[:, 0], cells[:, 1]]
    hh = asph_h[cells[:, 0], cells[:, 1]]
    # smooth the pixel staircase into a drivable curve (keep the ends: GP lap point and E)
    for _ in range(120):
        pts[1:-1] = (pts[:-2] + 2 * pts[1:-1] + pts[2:]) / 4
    gy = float(gp_cl[int(np.argmin(np.hypot(*(gp_cl[:, [0, 2]] - pts[0]).T))), 1])
    known = np.isfinite(hh)
    t = np.arange(len(pts))
    ys = np.interp(t, np.r_[0, t[known], len(pts) - 1], np.r_[gy, hh[known], yE]) if known.any() else np.linspace(gy, yE, len(pts))
    # blend the last stretch into the trace's direction
    crossed = int((wall[cells[:, 0], cells[:, 1]]).sum())
    log(f"junction: {len(pts)} m from the GP lap to the Nordschleife, {int(on.sum())} m on the GP's own asphalt" + (f", crossing {crossed} m of GP wall" if crossed else ""))
    return pts[:-1], ys[:-1], on[:-1]


SOURCE = NS.get("source", "osm")
if SOURCE == "osm":
    
# ------------------------------------------------------------------------------------ 1. OSM data ---
    osm = osm_data()
    ways = [w for w in osm["elements"] if w.get("type") == "way" and "geometry" in w]
    log(f"OSM: {len(ways)} raceway ways")
    # OSM maps the Nordschleife as ~50 one-way raceways named after its corners (only a 28 m piece is called
    # "Nordschleife"), so it is chained head to tail in the racing direction from `osmStart`, skipping the sprint
    # circuit, pit lanes, rallycross and other link roads (`osmExclude`), until `osmEnd` leads back onto the GP. The
    # 24h layout's link roads ("Anbindung zur Nordschleife" after the NGK chicane, "Anbindung zum GP Kurs" onto the
    # start straight) join the T13 straight mid-way, so a way may also be entered or left at an inner node.
    import re

    excl = re.compile(NS.get("osmExclude", "sprint|boxengasse|rallycross|müllenbach|variante|schikane|goodyear|ford-kurve|michael-schumacher|anbindung"), re.I)
    wname = lambda w: w.get("tags", {}).get("name", "")
    cand = [w for w in ways if not excl.search(wname(w)) and len(w["geometry"]) > 1]
    end_key = lambda p: (round(p["lat"], 6), round(p["lon"], 6))
    by_node = {}
    for w in cand:
        for k, p in enumerate(w["geometry"][:-1]):
            by_node.setdefault(end_key(p), []).append((w, k))
    named = lambda nm: next((w for w in ways if wname(w) == nm and len(w["geometry"]) > 1), None)
    start = named(NS.get("osmStart", "Anbindung zur Nordschleife"))
    finish = named(NS["osmEnd"]) if NS.get("osmEnd") else None
    if start is None:
        raise SystemExit(f"no OSM raceway named '{NS.get('osmStart')}' in the bbox: check maps/nordschleife.json osmStart/bbox")
    wlen = lambda w: float(np.sum(np.linalg.norm(np.diff(ll_to_en([p["lat"] for p in w["geometry"]], [p["lon"] for p in w["geometry"]]), axis=0), axis=1)))
    ns_ways, used, total = [start], {start["id"]}, wlen(start)
    while total < NS.get("osmMaxM", 24000):
        here = end_key(ns_ways[-1]["geometry"][-1])
        if finish is not None and total > NS.get("osmMaxM", 24000) / 2:
            # `osmEnd` leaves from here, or from an inner node of the way that starts here
            if end_key(finish["geometry"][0]) == here:
                ns_ways.append(finish)
                total += wlen(finish)
                break
            fk = end_key(finish["geometry"][0])
            via = next((w for w, k in by_node.get(here, []) if any(end_key(p) == fk for p in w["geometry"][k + 1 :])), None)
            if via is not None:
                k0 = next(k for k, p in enumerate(via["geometry"]) if end_key(p) == here)
                k1 = next(k for k, p in enumerate(via["geometry"]) if k > k0 and end_key(p) == fk)
                part = {**via, "geometry": via["geometry"][k0 : k1 + 1]}
                ns_ways += [part, finish]
                total += wlen(part) + wlen(finish)
                break
        # ways starting here, or the rest of a way passing through here (a link road joining it mid-way)
        nxt = [{**w, "geometry": w["geometry"][k:]} for w, k in by_node.get(here, []) if w["id"] not in used]
        if not nxt:
            break
        w = max(nxt, key=lambda x: (wname(x) != "", wlen(x)))  # the named (racing) way at a fork, then the longer
        ns_ways.append(w)
        used.add(w["id"])
        total += wlen(w)
    other_ways = [w for w in ways if w["id"] not in used]
    log(f"OSM: Nordschleife chained from {wname(start)}: {len(ns_ways)} ways, {total:.0f} m ({' > '.join(wname(w) or '?' for w in ns_ways[:6])} … {' > '.join(wname(w) or '?' for w in ns_ways[-4:])}); {len(other_ways)} other raceway ways")

    # ---------------------------------------------------------------- 2. align OSM ↔ game (ICP on the GP) ---
    gp_xz = np.stack([gp_cl[:, 0], -gp_cl[:, 2]], 1)  # game (x, -z): east/north-like, right-handed in 2D
    osm_pts = np.concatenate(
        [resample(ll_to_en([p["lat"] for p in w["geometry"]], [p["lon"] for p in w["geometry"]]), 3.0) for w in (other_ways or ways) if len(w["geometry"]) > 1]
    )
    gp_center_en = ll_to_en(*NS.get("gpCenterLatLon", [50.3330, 6.9425]))
    near = osm_pts[np.hypot(*(osm_pts - gp_center_en).T) < 1600]
    grid = Grid2D(near, 20.0)
    src = gp_xz[:: max(1, len(gp_xz) // 400)]
    best = None
    for ang in range(0, 360, 15):
        a = math.radians(ang)
        R = np.array([[math.cos(a), -math.sin(a)], [math.sin(a), math.cos(a)]])
        s, t = 1.0, near.mean(0) - R @ src.mean(0)
        for it in range(40):
            cur = (s * (R @ src.T)).T + t
            idx, d = grid.nearest(cur)
            keep = d <= np.quantile(d, 0.8)
            s, R, t = umeyama(src[keep], near[idx[keep]])
            if not NS.get("alignScale", False):
                s = 1.0
                t = (near[idx[keep]] - (R @ src[keep].T).T).mean(0)
        cur = (s * (R @ src.T)).T + t
        _, d = grid.nearest(cur)
        score = float(np.median(d))
        if best is None or score < best[0]:
            best = (score, s, R, t, float(np.quantile(d, 0.9)))
    score, S_AL, R_AL, T_AL, p90 = best
    log(f"alignment GP lap line → OSM: median {score:.2f} m, p90 {p90:.2f} m, rotation {math.degrees(math.atan2(R_AL[1, 0], R_AL[0, 0])):.2f}°, scale {S_AL:.4f}")
    if score > NS.get("maxAlignErrorM", 6.0):
        raise SystemExit("alignment failed: the OSM GP and the game's lap line do not match (check bbox/gpCenterLatLon)")


    # the OSM ↔ game transform, for tools that place other OSM data (forest_scatter.mjs: the woods)
    (OUT / "osm_align.json").write_text(json.dumps({"refLatLon": list(REF), "R": R_AL.tolist(), "T": T_AL.tolist(), "S": S_AL}))

    def en_to_game(en):
        """OSM metres → game (x, z)."""
        g = ((R_AL.T @ (np.asarray(en) - T_AL).T) / S_AL).T
        return np.stack([g[:, 0], -g[:, 1]], 1)


    def game_to_en(xz):
        g = np.stack([xz[:, 0], -xz[:, 1]], 1)
        return (S_AL * (R_AL @ g.T)).T + T_AL


    # -------------------------------------------------------------------- 3. the Nordschleife path ---
    # the chained ways (already in the racing direction), end to end
    ns_en = np.concatenate([ll_to_en([p["lat"] for p in w["geometry"]], [p["lon"] for p in w["geometry"]])[0 if k == 0 else 1 :] for k, w in enumerate(ns_ways)])
    ns_xz = en_to_game(ns_en)
    ns_xz = resample(ns_xz, 2.0)
    gp_grid = Grid2D(gp_cl[:, [0, 2]], 20.0)
    _, d_gp = gp_grid.nearest(ns_xz, max_r=8)
    merge = NS.get("gpMergeDistM", 14.0)
    off = d_gp > merge
    # the longest run away from the GP is the Nordschleife proper
    runs, cur = [], None
    for i, o in enumerate(off):
        if o and cur is None:
            cur = i
        if (not o or i == len(off) - 1) and cur is not None:
            runs.append((cur, i if not o else i + 1))
            cur = None
    a0, a1 = max(runs, key=lambda r: r[1] - r[0])
    # keep a few metres of overlap with the GP road so the asphalt meets
    a0 = max(0, a0 - int(merge / 2))
    a1 = min(len(ns_xz), a1 + int(merge / 2))
    path_xz = ns_xz[a0:a1]
else:
    # "source": "terrain": the channel the GP map's terrain leaves for the Nordschleife (trace_nordschleife.mjs)
    trace_file = OUT / NS.get("traceFile", "ns_trace.json")
    if not trace_file.exists():
        raise SystemExit(f"{trace_file} missing: run `node tools/asset-pipeline/trace_nordschleife.mjs` first")
    tr = np.array(json.loads(trace_file.read_text())["points"], float)
    path_xz, path_y = tr[:, [0, 2]], tr[:, 1]
    gp_grid = Grid2D(gp_cl[:, [0, 2]], 20.0)

    def bridge(E, inward, yE):
        """Smooth connector from the nearest GP lap point to E, arriving along `inward` (Hermite)."""
        i, d = gp_grid.nearest(E[None])
        i = int(i[0])
        G = gp_cl[i, [0, 2]]
        tg = gp_cl[(i + 1) % len(gp_cl), [0, 2]] - gp_cl[i - 1, [0, 2]]
        tg /= np.linalg.norm(tg)
        if np.dot(tg, E - G) < 0:
            tg = -tg
        ti = inward / np.linalg.norm(inward)
        L_ = float(np.linalg.norm(E - G))
        t = np.linspace(0, 1, max(3, int(L_ / 2)))[:, None]
        h00, h10, h01, h11 = 2 * t**3 - 3 * t**2 + 1, t**3 - 2 * t**2 + t, -2 * t**3 + 3 * t**2, t**3 - t**2
        pts = h00 * G + h10 * tg * L_ + h01 * E + h11 * ti * L_
        ys = (gp_cl[i, 1] * (1 - t) + yE * t).ravel()
        return pts[:-1], ys[:-1], float(d[0])

    log(f"terrain trace: {len(tr)} points")
if SOURCE == "osm":
    la_, lo_ = en_to_ll(game_to_en(path_xz[[0, -1]]))
    path_y = np.interp(np.arange(len(path_xz)), [0, len(path_xz) - 1], dem(la_, lo_) - float(np.median(dem(*en_to_ll(game_to_en(gp_cl[::5][:, [0, 2]]))) - gp_cl[::5, 1])))
gp_grid = Grid2D(gp_cl[:, [0, 2]], 20.0)


def project_s(p):
    i, _ = gp_grid.nearest(p[None], max_r=10)
    return float(gp_s[i[0]]), int(i[0])


def signed_area(xz):
    x, y = xz[:, 0], -xz[:, 1]
    return 0.5 * float(np.sum(x * np.roll(y, -1) - np.roll(x, -1) * y))


gp_sign = np.sign(signed_area(gp_cl[:, [0, 2]]))
s_a, _ = project_s(path_xz[0])
s_b, _ = project_s(path_xz[-1])


def loop_of(order):
    """Lap: GP 0→exit, Nordschleife, GP return→L."""
    p = path_xz if order == 0 else path_xz[::-1]
    se, sr = (s_a, s_b) if order == 0 else (s_b, s_a)
    return np.concatenate([gp_cl[gp_s <= se][:, [0, 2]], p, gp_cl[gp_s >= sr][:, [0, 2]]]), se, sr


# direction: the Nordschleife is driven clockwise like the GP (the joined lap keeps the GP's winding)
orders = [0, 1] if NS.get("reverse") is None else [1 if NS["reverse"] else 0]
cands = []
for o in orders:
    loop, se, sr = loop_of(o)
    cands.append((np.sign(signed_area(loop)) == gp_sign, se < sr, o))
cands.sort(key=lambda c: (not c[0], not c[1]))
ORDER = cands[0][2]
if ORDER == 1:
    path_xz, path_y = path_xz[::-1].copy(), path_y[::-1].copy()

# junctions: from the GP lap onto the Nordschleife (leaving forwards) and back (joining forwards)
if NS.get("routeJunctions", True):
    b0, y0_, on0 = route_to_gp(path_xz[0], path_y[0], path_xz[min(5, len(path_xz) - 1)] - path_xz[0], +1)
    b1, y1_, on1 = route_to_gp(path_xz[-1], path_y[-1], path_xz[max(-6, -len(path_xz))] - path_xz[-1], -1)
    path_xz = np.concatenate([b0, path_xz, b1[::-1]])
    path_y = np.concatenate([y0_, path_y, y1_[::-1]])
    path_on = np.concatenate([on0, np.zeros(len(path_xz) - len(on0) - len(on1), bool), on1[::-1]])
    path_conn = np.concatenate([np.ones(len(b0), bool), np.zeros(len(path_xz) - len(b0) - len(b1), bool), np.ones(len(b1), bool)])
    # round off where the connectors meet the traced road (±50 m), keeping the GP ends fixed
    _r = resample(np.c_[path_xz, path_y, path_on.astype(float), path_conn.astype(float)], 2.0)
    path_xz, path_y, path_on, path_conn = _r[:, :2], _r[:, 2], _r[:, 3] > 0.5, _r[:, 4] > 0.5
    _sj = np.concatenate([[0], np.cumsum(np.linalg.norm(np.diff(path_xz, axis=0), axis=1))])
    for jn in (np.flatnonzero(path_conn[:-1] & ~path_conn[1:]), np.flatnonzero(~path_conn[:-1] & path_conn[1:])):
        for j in jn:
            win = np.flatnonzero(np.abs(_sj - _sj[j]) < 50.0)
            a_, b_ = max(1, win[0]), min(len(path_xz) - 2, win[-1])
            for _ in range(150):
                path_xz[a_ : b_ + 1] = (path_xz[a_ - 1 : b_] + 2 * path_xz[a_ : b_ + 1] + path_xz[a_ + 1 : b_ + 2]) / 4
else:
    path_on = np.zeros(len(path_xz), bool)
    path_conn = np.zeros(len(path_xz), bool)
S_EXIT, _ = project_s(path_xz[0])
S_RETURN, _ = project_s(path_xz[-1])
log(f"Nordschleife path: {np.sum(np.linalg.norm(np.diff(path_xz, axis=0), axis=1)) / 1000:.2f} km between the GP junctions")
if NS.get("exitS") is not None:
    S_EXIT = float(NS["exitS"])
if NS.get("returnS") is not None:
    S_RETURN = float(NS["returnS"])
log(f"junctions on the GP lap: exit at {S_EXIT:.0f} m, return at {S_RETURN:.0f} m (direction {'reversed' if ORDER else 'as mapped'})")
if S_RETURN < S_EXIT:
    log("warning: the Nordschleife returns before it left the GP lap; set exitS/returnS/reverse in maps/nordschleife.json")

# ------------------------------------------------------------------------------- 4. elevation ---
STEP = NS.get("stepM", 3.0)
if SOURCE == "osm":
    P = resample(path_xz, STEP)
    PY = resample(np.c_[path_xz, path_y], STEP)
else:
    PY = resample(np.c_[path_xz, path_y], STEP)
    P = PY[:, :2]
_flags = resample(np.c_[path_xz, path_on.astype(float), path_conn.astype(float)], STEP)
ON_BASE = _flags[:, 2] > 0.5  # on the GP map's own asphalt (its link roads)
CONN = _flags[:, 3] > 0.5  # routed junction connectors
n = len(P)
seg = np.linalg.norm(np.diff(P, axis=0), axis=1)
S = np.concatenate([[0], np.cumsum(seg)])
L_NS = float(S[-1])
if SOURCE == "osm":
    lat, lon = en_to_ll(game_to_en(P))
    gp_lat, gp_lon = en_to_ll(game_to_en(gp_cl[::5][:, [0, 2]]))
    dem_offset = float(np.median(dem(gp_lat, gp_lon) - gp_cl[::5, 1]))
    log(f"DEM ↔ game height offset {dem_offset:.1f} m (from the GP)")
    Y = dem(lat, lon) - dem_offset
    Y = np.where(CONN, PY[:, 2], Y)  # the routed connectors follow the GP map's asphalt
else:
    Y = PY[:, 2].copy()
Y = smooth1d(Y, NS.get("elevationSmoothM", 18.0) / STEP)
# no stretch steeper than the real road's steepest (~17 % down the Fuchsröhre side, ~11 % up): the terrain banks and
# a 25 m DEM can jump where the road is cut into a hillside. Clamp the grade (forward + backward), then re-smooth.
G_MAX = NS.get("maxGrade", 0.17)
for _ in range(6):
    for i in range(1, n):
        dy = G_MAX * (S[i] - S[i - 1])
        Y[i] = min(max(Y[i], Y[i - 1] - dy), Y[i - 1] + dy)
    for i in range(n - 2, -1, -1):
        dy = G_MAX * (S[i + 1] - S[i])
        Y[i] = min(max(Y[i], Y[i + 1] - dy), Y[i + 1] + dy)
    Y = smooth1d(Y, 10.0 / STEP)


def feature_index(f):
    """Path index of a configured feature: lat/lon (OSM source) or `at` = share of the Nordschleife (any source)."""
    if f.get("at") is not None and (SOURCE != "osm" or f.get("lat") is None):
        return int(np.searchsorted(S, f["at"] * L_NS))
    if f.get("lat") is None or SOURCE != "osm":
        return None
    q = en_to_game(ll_to_en(f["lat"], f["lon"])[None])[0]
    k = int(np.argmin(np.hypot(*(P - q).T)))
    return k if np.hypot(*(P[k] - q)) < 200 else None


# config crests (jumps the elevation data flattens): +h over a Gaussian of `len` metres around the named point
for c in NS.get("crests", []):
    k = feature_index(c)
    if k is None:
        continue
    Y += c["heightM"] * np.exp(-0.5 * ((S - S[k]) / (c["lengthM"] / 2.5)) ** 2)
    log(f"crest {c['name']}: +{c['heightM']} m at {S[k]:.0f} m")
# blend into the GP's asphalt at both junctions. Its lap line's stored heights are off by up to ~3 m near the finish
# (they wrap with a step at the line), so the asphalt itself is read where the path meets it.
def gp_asphalt_y(xz, guess):
    tris = np.concatenate([BASE_COL[k] for k in ("asphalt", "curb") if k in BASE_COL])
    tris = tris[np.hypot(tris[:, :, 0].mean(1) - xz[0], tris[:, :, 2].mean(1) - xz[1]) < 30]
    hs = []
    for (ax, ay, az), (bx, by, bz), (qx, qy, qz) in tris:
        den = (bz - qz) * (ax - qx) + (qx - bx) * (az - qz)
        if abs(den) < 1e-9:
            continue
        a_ = ((bz - qz) * (xz[0] - qx) + (qx - bx) * (xz[1] - qz)) / den
        b_ = ((qz - az) * (xz[0] - qx) + (ax - qx) * (xz[1] - qz)) / den
        if min(a_, b_, 1 - a_ - b_) >= -1e-4:
            hs.append(a_ * ay + b_ * by + (1 - a_ - b_) * qy)
    return min(hs, key=lambda h: abs(h - guess)) if hs else guess


y_exit = gp_asphalt_y(P[0], float(np.interp(S_EXIT, gp_s, gp_cl[:, 1])))
y_ret = gp_asphalt_y(P[-1], float(np.interp(S_RETURN, gp_s, gp_cl[:, 1])))
log(f"junction heights from the GP's asphalt: exit {y_exit:.2f} m (lap line {np.interp(S_EXIT, gp_s, gp_cl[:, 1]):.2f}), "
    f"return {y_ret:.2f} m (lap line {np.interp(S_RETURN, gp_s, gp_cl[:, 1]):.2f})")
ramp = NS.get("junctionRampM", 160.0)
w0 = np.clip(1 - S / ramp, 0, 1) ** 2
w1 = np.clip(1 - (L_NS - S) / ramp, 0, 1) ** 2
Y = Y + w0 * (y_exit - Y[0]) + w1 * (y_ret - Y[-1])

# near the junctions the new road may not dip under the GP map's own ground (its grass would sit above the asphalt)
def base_ground_height(x, z, tris):
    best = -np.inf
    for (ax, ay, az), (bx, by, bz), (qx, qy, qz) in tris:
        den = (bz - qz) * (ax - qx) + (qx - bx) * (az - qz)
        if abs(den) < 1e-9:
            continue
        w1 = ((bz - qz) * (x - qx) + (qx - bx) * (z - qz)) / den
        w2 = ((qz - az) * (x - qx) + (ax - qx) * (z - qz)) / den
        w3 = 1 - w1 - w2
        if w1 >= -1e-4 and w2 >= -1e-4 and w3 >= -1e-4:
            best = max(best, w1 * ay + w2 * by + w3 * qy)
    return best


# the GP's ground as optimize.mjs keeps it (newRoadTest): its other ground goes where it is nearer the new road than
# the GP lap, more than 25 m from the lap and within the corridor + 10 m. There it is mostly the GP's own hole fill
# across the old channel, up to 5 m above the real terrain: following it lifted the road 3.4 m at Hatzenbogen and set
# it down again in a kink. Its verges along the GP road stay, and the new road must not dip under them.
def gp_ground_kept():
    soft = np.concatenate([BASE_COL[k] for k in ("grass", "sand", "gravel") if k in BASE_COL])
    cen = soft.mean(1)[:, [0, 2]]
    _, dn = Grid2D(P, 25.0).nearest(cen)
    _, db = Grid2D(gp_cl[:, [0, 2]], 25.0).nearest(cen)
    dropped = (dn < CORRIDOR_M + 10.0) & (db > 25.0) & (dn < db)
    return np.concatenate([*(BASE_COL[k] for k in ("asphalt", "curb") if k in BASE_COL), soft[~dropped]])


CORRIDOR_M = NS.get("corridorM", 90.0)
GP_KEPT = gp_ground_kept()
_gnd = GP_KEPT
_gcen = _gnd.mean(1)
_dgp0 = Grid2D(gp_cl[:, [0, 2]]).nearest(P)[1]
# junction zones: the new road is the only drivable surface along its connectors (optimize.mjs removes the GP's
# ground under it), so it must never lie below the GP's ground there. The GP ground is followed from the GP lap
# outwards, always taking the surface nearest the previous one (bridges and other overhead decks are ignored);
# the road is lifted onto it across its width, then the grade is clamped and the profile smoothed (no steps).
def ground_heights(x, z, tris):
    hs = []
    for (ax, ay, az), (bx, by, bz), (qx, qy, qz) in tris:
        den = (bz - qz) * (ax - qx) + (qx - bx) * (az - qz)
        if abs(den) < 1e-9:
            continue
        w1 = ((bz - qz) * (x - qx) + (qx - bx) * (z - qz)) / den
        w2 = ((qz - az) * (x - qx) + (ax - qx) * (z - qz)) / den
        w3 = 1 - w1 - w2
        if w1 >= -1e-4 and w2 >= -1e-4 and w3 >= -1e-4:
            hs.append(w1 * ay + w2 * by + w3 * qy)
    return hs


floor_ = np.full(n, -np.inf)
TT = np.gradient(P, axis=0)
hw0 = NS.get("roadWidthM", 9.4) / 2
for idxs, y_start in ((range(n), y_exit), (range(n - 1, -1, -1), y_ret)):
    prev = y_start
    for i in idxs:
        if _dgp0[i] > 120.0:
            break
        T_ = TT[i] / (np.linalg.norm(TT[i]) or 1)
        Lv = np.array([T_[1], -T_[0]])
        near_t = _gnd[np.hypot(_gcen[:, 0] - P[i, 0], _gcen[:, 2] - P[i, 1]) < 40]
        # the walk follows the ground under the middle of the road; the edges lift it by at most 0.3 m (following the
        # highest point across, it climbed the bank beside the link road at the return: 1.8 m above the GP's asphalt)
        across = []
        for o in np.linspace(-hw0, hw0, 7):
            hs = [h for h in ground_heights(*(P[i] + Lv * o), near_t) if abs(h - prev) < 1.5]
            across.append(min(hs, key=lambda v: abs(v - prev)) if hs else None)
        found = [h for h in across if h is not None]
        if found:
            mid = across[3] if across[3] is not None else float(np.median(found))
            floor_[i] = max(floor_[i], min(max(found), mid + 0.3) + 0.03)
            prev = mid


def smooth_lift(need, slope=0.015, sigma_m=8.0):
    """A lift ≥ `need` everywhere, without steps: a hard max leaves one where the floor ends (a 0.3 m shelf at
    185 km/h after the Sabine-Schmitz-Kurve threw the cars). The upper envelope of cones (the lift fades at `slope`
    per metre either side), its corners rounded. A flat max over a window instead lifted the last metres before the
    return junction by what a dip 20 m earlier needed: 1 m above the GP's asphalt they meet."""
    need = np.maximum(need, 0.0)
    if need.max() <= 0:
        return need
    lift = need.copy()
    for k in range(1, int(need.max() / (slope * STEP)) + 1):
        drop = slope * STEP * k
        lift[k:] = np.maximum(lift[k:], need[:-k] - drop)
        lift[:-k] = np.maximum(lift[:-k], need[k:] - drop)
    r_ = int(math.ceil(2 * sigma_m / STEP))
    wide = np.array([lift[max(0, i - r_) : i + r_ + 1].max() for i in range(n)])
    k_ = np.exp(-0.5 * (np.arange(-r_, r_ + 1) / (sigma_m / STEP)) ** 2)
    return np.convolve(np.pad(wide, r_, mode="edge"), k_ / k_.sum(), "valid")


if np.isfinite(floor_).any():
    before = Y.copy()
    # where the road lies on the GP's ground it follows it (up and down), fading to the elevation data where that ends:
    # a normalised local average of the difference, weighted by how much of the window has ground. (A lower bound
    # alone, applied in a loop, piled up: the last 120 m before the return were lifted 2–3 m, ending 1.8 m above the
    # GP's asphalt they join.)
    fin = np.isfinite(floor_)
    r_ = int(math.ceil(3 * 25.0 / STEP))  # σ 25 m: the DEM lay 2.4 m under the GP's ground at the return (σ 10 m: a 12 % kink)
    k_ = np.exp(-0.5 * (np.arange(-r_, r_ + 1) / (25.0 / STEP)) ** 2)
    cw = np.convolve(np.pad(fin.astype(float), r_), k_ / k_.sum(), "valid")
    cd = np.convolve(np.pad(np.where(fin, floor_ - Y, 0.0), r_), k_ / k_.sum(), "valid")
    Y = Y + np.where(cw > 1e-6, cd / np.maximum(cw, 1e-6), 0.0) * np.minimum(1.0, 2.0 * cw)
    for i in range(1, n):  # grade clamp, both ways
        dy = G_MAX * (S[i] - S[i - 1])
        Y[i] = min(max(Y[i], Y[i - 1] - dy), Y[i - 1] + dy)
    for i in range(n - 2, -1, -1):
        dy = G_MAX * (S[i + 1] - S[i])
        Y[i] = min(max(Y[i], Y[i + 1] - dy), Y[i + 1] + dy)
    Y = smooth1d(Y, 4.0 / STEP)
    Y = Y + smooth_lift(floor_ - Y)  # what smoothing left under the ground (a few cm)
    log(f"junctions: new road on the GP's ground (moved by {np.min(Y - before):+.2f} … {np.max(Y - before):+.2f} m)")

# frames, curvature, banking
T = np.gradient(P, axis=0)
T /= np.linalg.norm(T, axis=1, keepdims=True)
T = np.stack([smooth1d(T[:, 0], 2), smooth1d(T[:, 1], 2)], 1)
T /= np.linalg.norm(T, axis=1, keepdims=True)
LEFT = np.stack([T[:, 1], -T[:, 0]], 1)  # same convention as gateSide(): (dz, -dx)
heading = np.unwrap(np.arctan2(T[:, 0], T[:, 1]))
curv = smooth1d(np.gradient(heading) / STEP, 4)  # 1/m; + = turning towards… sign checked below via LEFT
# + curvature should mean turning left; verify with the cross product of consecutive tangents
cross = T[:-1, 0] * T[1:, 1] - T[:-1, 1] * T[1:, 0]
if np.sum(cross * curv[:-1]) > 0:
    curv = -curv
BANK = np.zeros(n)
for b in NS.get("banking", []):
    k = feature_index(b)
    if k is None:
        continue
    if b.get("at") is not None and (SOURCE != "osm" or b.get("lat") is None):
        # snap to the tightest bend within ±400 m (the hairpin itself)
        win = np.flatnonzero(np.abs(S - S[k]) < 400)
        k = int(win[np.argmax(np.abs(curv[win]))])
    q = P[k]
    d = np.hypot(*(P - q).T)
    w = np.clip(1 - (d - b["radiusM"]) / 30.0, 0, 1)
    BANK = np.where(w > 0, np.sign(curv) * np.radians(b["bankDeg"]) * w, BANK)
    if w.max() > 0:
        log(f"banking {b['name']}: {b['bankDeg']}° over {int((w > 0).sum() * STEP)} m")
BANK = smooth1d(BANK, 4)
HW = np.full(n, NS.get("roadWidthM", 9.4) / 2)
for wr in NS.get("widths", []):  # [{fromM, toM, widthM}] along the Nordschleife path
    HW[(S >= wr["fromM"]) & (S <= wr["toM"])] = wr["widthM"] / 2
HW = smooth1d(HW, 6)
# distance of each path point to the GP lap line: junction handling (no side objects across the GP)
_gpk = Grid2D(gp_cl[:, [0, 2]])
_, D_GP = _gpk.nearest(P)
if ON_BASE.any():
    _, D_ON = Grid2D(P[ON_BASE]).nearest(P)
else:
    D_ON = np.full(n, np.inf)
# no armco, kerbs or verges of our own near the GP's roads: its own barriers and run-off are there (and offset barriers
# would cut across the tighter junction curves). Measured to its paved ground, not its lap line: Hatzenbogen runs
# 50–90 m from the GP's back straight, within 120 m of the lap, and was left bare (no lines, verges or armco).
_paved = np.concatenate([BASE_COL[k] for k in ("asphalt", "curb") if k in BASE_COL])
_paved = _paved[Grid2D(P, 25.0).nearest(_paved.mean(1)[:, [0, 2]])[1] < 400.0]
_samples = []
for _t in _paved:
    _k = max(1, int(max(np.linalg.norm(_t[1] - _t[0]), np.linalg.norm(_t[2] - _t[0]), np.linalg.norm(_t[2] - _t[1])) / 2.0))
    for _a in range(_k + 1):
        for _b in range(_k + 1 - _a):
            _samples.append((_t[0] * (1 - (_a + _b) / _k) + _t[1] * (_a / _k) + _t[2] * (_b / _k))[[0, 2]])
_, D_PAVED = Grid2D(np.array(_samples) if _samples else np.array([[1e9, 1e9]]), 25.0).nearest(P)
FREE = D_PAVED > NS.get("gpPavedClearM", 30.0)
log(f"side objects: {int((~FREE).sum() * STEP)} m of the path within {NS.get('gpPavedClearM', 30.0):.0f} m of the GP's roads")
if os.environ.get("NS_DEBUG"):
    for i in list(range(0, 60, 3)) + list(range(n - 60, n, 3)):
        log(f"dbg i={i} S={S[i]:.0f} D_GP={D_GP[i]:.1f} on={ON_BASE[i]} conn={CONN[i]} free={FREE[i]} y={Y[i]:.1f}")
# junction zones: a 0.5 m raster of the GP map's asphalt and ground height, so the new road's vertices sit exactly on
# the GP's ground there and no quad of new asphalt is laid over the GP's own asphalt (no steps, no z-fighting)
JZONE = D_GP < 120.0
JR = None
if JZONE.any():
    _jp = P[JZONE]
    _lo = _jp.min(0) - 20
    _hi = _jp.max(0) + 20
    _res = 0.5
    _W, _H = int((_hi[0] - _lo[0]) / _res) + 1, int((_hi[1] - _lo[1]) / _res) + 1
    _ground = GP_KEPT
    # exact edges: with the default slack a grass bank's big triangles reached 0.5 m+ over the road, and lifted its edge
    JR = (_lo, _res, _W, _H, raster(BASE_COL["asphalt"], _lo[0], _lo[1], _W, _H, _res, tol=0.0),
          raster(_ground, _lo[0], _lo[1], _W, _H, _res, "height", tol=0.0), raster(BASE_COL["asphalt"], _lo[0], _lo[1], _W, _H, _res, "height", tol=0.0))


def j_lookup(x, z):
    """(on GP asphalt, GP ground height or nan) at a point of a junction zone."""
    if JR is None:
        return False, float("nan")
    lo_, res_, W_, H_, am, hm, ahm = JR
    i_, j_ = int((x - lo_[0]) / res_), int((z - lo_[1]) / res_)
    if 0 <= i_ < W_ and 0 <= j_ < H_:
        h = ahm[j_, i_] if am[j_, i_] else hm[j_, i_]
        return bool(am[j_, i_]), (float(h) if np.isfinite(h) else float("nan"))
    return False, float("nan")


def snap_junction(i0, verts, faces, drop_on_asphalt, up=0.005):
    """In junction zones: vertices onto the GP's ground; optionally drop quads lying wholly on the GP's asphalt."""
    out_v = list(verts)
    on = [False] * len(verts)
    for k, (x, y, z) in enumerate(verts):
        a_, h_ = j_lookup(x, z)
        on[k] = a_
        if not np.isfinite(h_):
            continue
        if a_ and abs(h_ + up - y) < 1.0:  # over the GP's asphalt: flush with it (no step where the roads meet)
            out_v[k] = (x, h_ + up, z)
        elif y < h_ + up < y + 0.25:  # over its other ground: never below it (a bank or a deck above stays)
            out_v[k] = (x, h_ + up, z)
    if drop_on_asphalt:
        # wholly: its corners, edge midpoints and centre (where the GP's road edge curves away, corners on its asphalt
        # with grass between them left a gap in the new road at the Nordschleife exit)
        def wholly_on(f):
            if not all(on[q] for q in f):
                return False
            pts = [verts[q] for q in f]
            mids = [((a[0] + b[0]) / 2, (a[2] + b[2]) / 2) for a, b in zip(pts, pts[1:] + pts[:1])]
            mids.append((sum(p[0] for p in pts) / len(pts), sum(p[2] for p in pts) / len(pts)))
            return all(j_lookup(x, z)[0] for x, z in mids)

        faces = [f for f in faces if not wholly_on(f)]
    return out_v, faces

# terrain cross-fall for the corridor where the map's terrain has holes: DEM at ±40 m every 30 m (few requests)
if SOURCE == "osm":
    _k = np.arange(0, n, max(1, int(30 / STEP)))
    _side = []
    for sgn in (-1, 1):
        q = P[_k] + LEFT[_k] * (40.0 * sgn)
        la_, lo_ = en_to_ll(game_to_en(q))
        _side.append((dem(la_, lo_) - dem_offset - Y[_k]) / 40.0)
    SLOPE_L = np.interp(np.arange(n), _k, _side[1])  # height change per metre to the left
    SLOPE_R = np.interp(np.arange(n), _k, _side[0])  # … to the right
else:  # the terrain itself is under the corridor (raycasts); flat fallback inside the channel
    SLOPE_L = SLOPE_R = np.zeros(n)

# ------------------------------------------------------------------- terrain under the corridor ---
terrain_bvh = None
terrain_uv = None
raw_terrain = ROOT / "tools/asset-pipeline/out" / NS.get("baseOut", "map") / "map_terrain.glb"
sat_image = None
if raw_terrain.exists():
    from mathutils import Vector
    from mathutils.bvhtree import BVHTree

    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(raw_terrain))
    ter = [o for o in bpy.data.objects if o.type == "MESH"]
    verts, polys, uvs = [], [], []
    for o in ter:
        me = o.data
        M = o.matrix_world
        base = len(verts)
        verts += [M @ v.co for v in me.vertices]
        polys += [[base + i for i in p.vertices] for p in me.polygons]
        if me.uv_layers:
            uv = np.zeros(len(me.loops) * 2)
            me.uv_layers[0].data.foreach_get("uv", uv)
            lv = np.zeros(len(me.loops), int)
            me.loops.foreach_get("vertex_index", lv)
            vu = np.zeros((len(me.vertices), 2))
            vu[lv] = uv.reshape(-1, 2)
            uvs.append((np.array([[v.x, v.y] for v in (M @ vv.co for vv in me.vertices)]), vu))
        for m in me.materials:
            for nd in m.node_tree.nodes if m and m.node_tree else []:
                if nd.type == "TEX_IMAGE" and nd.image:
                    sat_image = nd.image
    terrain_bvh = BVHTree.FromPolygons(verts, polys)
    if sat_image is not None and sat_image.size[0] > 0:  # keep the photo's pixels: the scene is reset below
        sat_px = np.empty(len(sat_image.pixels), np.float32)
        sat_image.pixels.foreach_get(sat_px)
        sat_image = sat_px.reshape(sat_image.size[1], sat_image.size[0], 4)[::-1, :, :3]
    else:
        sat_image = None
    if uvs:  # the satellite photo is mapped planar: fit uv = A·(x, y) + b
        xy = np.concatenate([u[0] for u in uvs])
        uv = np.concatenate([u[1] for u in uvs])
        X = np.c_[xy, np.ones(len(xy))]
        terrain_uv, *_ = np.linalg.lstsq(X, uv, rcond=None)
        err = np.abs(X @ terrain_uv - uv).max()
        log(f"terrain: {len(polys)} faces, planar UV fit error {err:.4f}")
        if err > 0.01:
            terrain_uv = None
    log(f"terrain from {raw_terrain.relative_to(ROOT)}")
else:
    log("no raw GP terrain (run `pnpm assets --only map --map nurburgring` first): the corridor follows the DEM only")


def terrain_height(xs, zs, fallback):
    """Game terrain height under (x, z) (Blender: (x, -z)); DEM fallback where the terrain has a hole."""
    out = np.array(fallback, float)
    if terrain_bvh is None:
        return out
    from mathutils import Vector

    for k, (x, z) in enumerate(zip(xs, zs)):
        hit = terrain_bvh.ray_cast(Vector((x, -z, 3000.0)), Vector((0, 0, -1)))
        if hit[0] is not None:
            out[k] = hit[0].z
    return out


# ------------------------------------------------------------------------------- 5. geometry ---
bpy.ops.wm.read_factory_settings(use_empty=True)


def make_image(name, arr):
    h, w = arr.shape[:2]
    img = bpy.data.images.new(name, w, h, alpha=arr.shape[2] == 4)
    rgba = np.ones((h, w, 4), np.float32)
    rgba[..., : arr.shape[2]] = arr
    img.pixels.foreach_set(rgba[::-1].ravel())
    img.pack()
    return img


rng = np.random.default_rng(5)


def noise_tex(base, amp, size=256, grain=0.5):
    f = rng.random((size // 8, size // 8))
    f = np.kron(f, np.ones((8, 8)))
    for _ in range(2):
        f = (f + np.roll(f, 4, 0) + np.roll(f, 4, 1) + np.roll(f, -4, 0) + np.roll(f, -4, 1)) / 5
    g = rng.random((size, size))
    v = (f - 0.5) * amp + (g - 0.5) * amp * grain
    return np.clip(np.array(base)[None, None, :] * (1 + v[..., None]), 0, 1)


def kerb_tex():
    a = np.zeros((64, 16, 3))
    a[:32] = (0.75, 0.08, 0.06)
    a[32:] = (0.92, 0.92, 0.9)
    return a


def rail_tex():
    a = noise_tex((0.62, 0.64, 0.66), 0.25, 64)
    a[::16] *= 0.7  # the W-profile folds
    return a


def material(name, img, rough, metal=0.0, cull=True):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = next(nd for nd in nt.nodes if nd.type == "BSDF_PRINCIPLED")
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = img
    nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Metallic"].default_value = metal
    m.use_backface_culling = cull
    return m


MATS = {
    # names follow the GP map's semantic materials, so the client's regexes (track.ts) and optimize treat them alike
    # base colours sampled from the GP map's own textures (sRGB), so both parts of the lap match
    "asph": material("asph_ns", make_image("asph_ns", noise_tex((0.35, 0.35, 0.355), 0.3)), 0.9),
    "lines": material("lines_ns", make_image("lines_ns", noise_tex((0.86, 0.86, 0.84), 0.1, 32)), 0.7),
    "curb": material("curb_ns", make_image("curb_ns", kerb_tex()), 0.55),
    "grass": material("grass_ns", make_image("grass_ns", noise_tex((0.38, 0.42, 0.28), 0.35)), 0.95),
    "rail": material("grail_ns", make_image("grail_ns", rail_tex()), 0.35, 0.8, cull=False),
    "post": material("galvanized_ns", make_image("galvanized_ns", noise_tex((0.5, 0.52, 0.54), 0.2, 32)), 0.4, 0.8, cull=False),
}
if sat_image is not None and terrain_uv is not None:
    MATS["sat"] = material("top2", make_image("top2_photo", sat_image), 0.95)

# cross-section (metres from the centreline, + = left)
EDGE_LINE = 0.12
VERGE = NS.get("vergeM", 4.5)
ARMCO_GAP = NS.get("armcoOffsetM", 0.6)  # from the verge's outer edge
CORRIDOR = [8.0, 18.0, 35.0, 60.0, NS.get("corridorM", 90.0)]  # beyond the road edge
KERB_W = 1.1
CONFORM = raw_terrain.exists() and NS.get("conformTerrain", True)
CSTRIDE = max(1, int(round(NS.get("corridorStepM", 9.0) / NS.get("stepM", 3.0))))
SAT_FROM = 35.0  # corridor columns from here on show the satellite photo
kerb_on = smooth1d((np.abs(curv) > 1 / NS.get("kerbRadiusM", 140.0)).astype(float), 3) > 0.3
kerb_side = np.sign(curv)  # inside of the corner


from mathutils.kdtree import KDTree as _KD

ROAD_KD = _KD(n)
for _i in range(n):
    ROAD_KD.insert((P[_i, 0], P[_i, 1], 0.0), _i)
ROAD_KD.balance()


def owned(x, z, i):
    """(x, z) belongs to path point i's stretch: no stretch further along the lap (> 60 m away along it) is nearer."""
    d_own = math.hypot(x - P[i, 0], z - P[i, 1])
    for _co, j, d in ROAD_KD.find_range((x, z, 0.0), d_own - 0.5):
        if abs(S[j] - S[i]) > 60.0:
            return False
    return True


def yp(i, o):
    """Surface height at path point i, lateral offset o (crown 2 %, banking)."""
    return Y[i] + math.tan(BANK[i]) * o - 0.02 * min(abs(o), HW[i])


chunk_len = MAP.get("chunkLenM", 1000.0)
n_chunks = int(math.ceil(L_NS / chunk_len))
col = {k: ([], []) for k in ("asphalt", "curb", "grass", "wall")}
chunks = []


def add(store, verts, faces):
    vs, fs = store
    b = len(vs)
    vs.extend(verts)
    fs.extend([[b + i for i in f] for f in faces])


def strip(i0, i1, offs, heights, uv_u):
    """Quad strip between path points i0..i1 across the lateral offsets `offs` (list of functions of i)."""
    verts, faces, uvs = [], [], []
    m = len(offs)
    for i in range(i0, i1 + 1):
        for k in range(m):
            o = offs[k](i)
            x = P[i, 0] + LEFT[i, 0] * o
            z = P[i, 1] + LEFT[i, 1] * o
            verts.append((x, heights[k](i, o), z))
            uvs.append((uv_u[k](o), S[i] / 4.0))
    for r in range(i1 - i0):
        for k in range(m - 1):
            a = r * m + k
            b = a + m
            faces.append([a, a + 1, b + 1, b])
    return verts, orient_up(verts, faces), uvs


def orient_up(verts, faces):
    """Flip faces whose normal points down (game y): ground strips must face the sky."""
    if not faces:
        return faces
    V = np.asarray(verts, float)
    F = np.asarray(faces)
    n_y = np.cross(V[F[:, 1]] - V[F[:, 0]], V[F[:, 2]] - V[F[:, 0]])[:, 1]
    if (n_y < 0).mean() > 0.5:
        return [f[::-1] for f in faces]
    return faces


def to_blender(v):
    return (v[0], -v[2], v[1])


def emit(name, parts):
    """parts: list of (material key, verts, faces, uvs) → one Blender object with several material slots."""
    me = bpy.data.meshes.new(name)
    V, F, U, MI = [], [], [], []
    keys = []
    for key, verts, faces, uvs in parts:
        if not faces:
            continue
        if key not in keys:
            keys.append(key)
        b = len(V)
        V += [to_blender(v) for v in verts]
        U += uvs
        F += [[b + i for i in f] for f in faces]
        MI += [keys.index(key)] * len(faces)
    if not F:
        return None
    me.from_pydata(V, [], F)
    for k in keys:
        me.materials.append(MATS[k])
    me.polygons.foreach_set("material_index", MI)
    uvl = me.uv_layers.new(name="UVMap")
    li = np.zeros(len(me.loops), int)
    me.loops.foreach_get("vertex_index", li)
    U = np.array(U, float)
    uvl.data.foreach_set("uv", U[li].ravel())
    me.validate()
    me.update()
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    v = np.array(V)
    c = (v.min(0) + v.max(0)) / 2
    chunks.append({"name": name, "kind": name.split("_")[1], "center": [float(c[0]), float(c[2]), float(-c[1])],
                   "radius": float(np.linalg.norm(v.max(0) - v.min(0)) / 2), "tris": len(F)})
    return ob


for ci in range(n_chunks):
    i0 = int(np.searchsorted(S, ci * chunk_len))
    i1 = min(n - 1, int(np.searchsorted(S, (ci + 1) * chunk_len)) + 1)
    if i1 - i0 < 2:
        continue
    track_parts, scen_parts, terr_parts = [], [], []
    # asphalt: 5 columns edge to edge (not where it lies inside the GP's road; 2 cm up where it overlaps it)
    offs = [lambda i, f=f: f * HW[i] for f in (-1, -0.5, 0, 0.5, 1)]
    hs = [lambda i, o: yp(i, o)] * 5
    a_runs, cur = [], None
    for i in range(i0, i1 + 1):
        ok = True  # the new road runs right onto the GP's asphalt (a few cm above it where they overlap)
        if ok and cur is None:
            cur = i
        if (not ok or i == i1) and cur is not None:
            if i - cur >= 1:
                a_runs.append((cur, i))
            cur = None
    for a0, a1 in a_runs:
        v, f, u = strip(a0, a1, offs, hs, [lambda o: o / 4.0] * 5)
        if JZONE[a0 : a1 + 1].any():
            v, f = snap_junction(a0, v, f, False, 0.01)
        if f:
            track_parts.append(("asph", v, f, u))
            add(col["asphalt"], v, f)
    # everything beside the road stops where the Nordschleife runs along/onto the GP (its own verges, walls and
    # fences are there): no armco across the GP track at the junctions
    subruns, cur = [], None
    for i in range(i0, i1 + 1):
        if FREE[i] and cur is None:
            cur = i
        if (not FREE[i] or i == i1) and cur is not None:
            if (i if not FREE[i] else i) - cur >= 2:
                subruns.append((cur, i))
            cur = None
    for i0, i1 in subruns:
        # painted edge lines (1 cm up: optimize snaps stacked layers for the wheels)
        for side in (-1, 1):
            o_in = [lambda i, s=side: s * (HW[i] - 0.25), lambda i, s=side: s * (HW[i] - 0.25 - EDGE_LINE)]
            if side < 0:
                o_in = o_in[::-1]
            v, f, u = strip(i0, i1, o_in, [lambda i, o: yp(i, o) + 0.01] * 2, [lambda o: 0.0, lambda o: 1.0])
            if JZONE[i0 : i1 + 1].any():
                v, f = snap_junction(i0, v, f, True, 0.015)
            track_parts.append(("lines", v, f, u))
        # kerbs on the inside of corners, then grass verge (outside the kerb where there is one)
        for side in (-1, 1):
            runs_k = []
            cur = None
            for i in range(i0, i1 + 1):
                on = kerb_on[i] and kerb_side[i] == side
                if on and cur is None:
                    cur = i
                if (not on or i == i1) and cur is not None:
                    runs_k.append((cur, i))
                    cur = None
            for a, b in runs_k:
                if b - a < 2:
                    continue
                o = [lambda i, s=side: s * HW[i], lambda i, s=side: s * (HW[i] + KERB_W)]
                if side < 0:
                    o = o[::-1]
                hk = [lambda i, oo: yp(i, oo) + 0.04] * 2
                v, f, u = strip(a, b, o, hk, [lambda oo: 0.0, lambda oo: 1.0])
                # stripes every 1 m along the lap: v-coordinate = S / 2 (texture is half red, half white)
                u = [(uu[0], uu[1] * 2.0) for uu in u]
                if JZONE[a : b + 1].any():
                    v, f = snap_junction(a, v, f, True, 0.045)
                track_parts.append(("curb", v, f, u))
                add(col["curb"], v, f)
            o = [lambda i, s=side: s * HW[i], lambda i, s=side: s * (HW[i] + VERGE)]
            if side < 0:
                o = o[::-1]
            hv = [lambda i, oo: yp(i, math.copysign(HW[i], oo)) - 0.04 * max(0.0, abs(oo) - HW[i])] * 2
            v, f, u = strip(i0, i1, o, hv, [lambda oo: oo / 3.0] * 2)
            if JZONE[i0 : i1 + 1].any():
                v, f = snap_junction(i0, v, f, True, 0.0)
            track_parts.append(("grass", v, f, u))
            add(col["grass"], v, f)
        # armco: two W-beams on posts every 4 m, both sides
        for side in (-1, 1):
            oa = lambda i, s=side: s * (HW[i] + VERGE + ARMCO_GAP)  # noqa: E731
            y0 = lambda i, oo: yp(i, math.copysign(HW[i], oo)) - 0.04 * VERGE  # noqa: E731
            for lo, hi in ((0.40, 0.72), (0.80, 1.12)):
                v, f, u = strip(i0, i1, [oa, oa], [lambda i, oo, lo=lo: y0(i, oo) + lo, lambda i, oo, hi=hi: y0(i, oo) + hi], [lambda oo: 0.0, lambda oo: 1.0])
                if side > 0:  # face the road
                    f = [ff[::-1] for ff in f]
                scen_parts.append(("rail", v, f, u))
                add(col["wall"], v, f)
            pv, pf, pu = [], [], []
            last = -1e9
            for i in range(i0, i1 + 1):
                if S[i] - last < 4.0:
                    continue
                last = S[i]
                o = oa(i) + side * 0.12
                cx, cz = P[i, 0] + LEFT[i, 0] * o, P[i, 1] + LEFT[i, 1] * o
                yb = y0(i, o) - 0.2
                b = len(pv)
                for dx, dz in ((-0.06, -0.06), (0.06, -0.06), (0.06, 0.06), (-0.06, 0.06)):
                    pv += [(cx + dx, yb, cz + dz), (cx + dx, yb + 1.15, cz + dz)]
                    pu += [(0, 0), (0, 1)]
                for k in range(4):
                    a0, a1 = b + 2 * k, b + 2 * ((k + 1) % 4)
                    pf.append([a0, a1, a1 + 1, a0 + 1])
            scen_parts.append(("post", pv, pf, pu))
        # terrain corridor: verge edge → blends into the map's terrain (grass close, the satellite photo further out).
        # Every CSTRIDE-th path point (~9 m): it is gentle ground, the road keeps the full resolution.
        rows = list(range(i0, i1 + 1, CSTRIDE))
        if rows[-1] != i1:
            rows.append(i1)
        for side in (-1, 1):
            cols = [VERGE] + CORRIDOR
            offs_all = [lambda i, s=side, c=c: s * (HW[i] + c) for c in cols]
            xs = np.array([P[i, 0] + LEFT[i, 0] * oc(i) for i in rows for oc in offs_all])
            zs = np.array([P[i, 1] + LEFT[i, 1] * oc(i) for i in rows for oc in offs_all])
            fb = np.array([Y[i] + (SLOPE_L[i] if side > 0 else SLOPE_R[i]) * abs(oc(i)) for i in rows for oc in offs_all])
            th = terrain_height(xs, zs, fb).reshape(len(rows), len(cols))
            # height of every (row, column): road side → terrain at the outer edge
            H_ = np.zeros_like(th)
            for r, i in enumerate(rows):
                road_y = yp(i, math.copysign(HW[i], side)) - 0.04 * VERGE
                for k, c in enumerate(cols):
                    w = min(1.0, max(0.0, (c - VERGE) / (CORRIDOR[-1] - VERGE)))
                    w = w * w * (3 - 2 * w)
                    # beyond the verge: tucked 15 cm under the (conformed) map terrain, so it only shows in the channel
                    H_[r, k] = road_y * (1 - w) + th[r, k] * w - (0.15 if k > 0 and CONFORM else 0.05 if 0 < w < 1 else 0.0)
            split = next((k for k, c in enumerate(cols) if c >= SAT_FROM), len(cols) - 1) if "sat" in MATS else len(cols) - 1
            for key, ks in (("grass", range(0, split + 1)), ("sat", range(split, len(cols)))):
                ks = list(ks)
                if len(ks) < 2 or (key == "sat" and "sat" not in MATS):
                    continue
                verts, uvs, faces = [], [], []
                for r, i in enumerate(rows):
                    for k in ks:
                        o = offs_all[k](i)
                        x, z = P[i, 0] + LEFT[i, 0] * o, P[i, 1] + LEFT[i, 1] * o
                        verts.append((x, H_[r, k], z))
                        if key == "sat":
                            uv = np.array([x, -z, 1.0]) @ terrain_uv
                            uvs.append((float(uv[0]), float(uv[1])))
                        else:
                            uvs.append((o / 3.0, S[i] / 3.0))
                m = len(ks)
                # ground that is nearer another stretch of the road belongs to that stretch's corridor: where the
                # Nordschleife passes itself at another height (the Breidscheid valley) this one hung over it
                own = [owned(verts[q][0], verts[q][2], rows[q // m]) for q in range(len(verts))]
                for r in range(len(rows) - 1):
                    for k in range(m - 1):
                        q = r * m + k
                        if own[q] and own[q + 1] and own[q + 1 + m] and own[q + m]:
                            faces.append([q, q + 1, q + 1 + m, q + m])
                faces = orient_up(verts, faces)
                terr_parts.append((key, verts, faces, uvs))
                add(col["grass"], verts, faces)
    emit(f"chunk_track_ns{ci:02d}", track_parts)
    emit(f"chunk_scenery_ns{ci:02d}", scen_parts)
    emit(f"chunk_terrain_ns{ci:02d}", terr_parts)
log(f"geometry: {n_chunks} chunks, {sum(c['tris'] for c in chunks)} faces")

# ------------------------------------------------------------------- 5b. conform the map's terrain ---
# The GP map's terrain is coarse (~150 m triangles): along the channel its straight edges cut across the curves and
# hang over the new road. A copy of it is refined near the Nordschleife and pulled down to the road profile; the
# combined layout uses this copy instead of the GP's (same node name: optimize.mjs swaps it).
if CONFORM:
    import bmesh
    from mathutils import Vector
    from mathutils.kdtree import KDTree

    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=str(raw_terrain))
    ter_objs = [o for o in bpy.data.objects if o not in before and o.type == "MESH"]
    # the corridor's satellite material and the conformed terrain show the same photo: share one image, so the
    # exported GLB carries one 2048² texture instead of two (−0.8 MB download, −2.8 MB GPU)
    if "sat" in MATS:
        ter_img = next((nd.image for o in ter_objs for s in o.material_slots if s.material and s.material.use_nodes
                        for nd in s.material.node_tree.nodes if nd.type == "TEX_IMAGE" and nd.image), None)
        sat_nodes = [nd for nd in MATS["sat"].node_tree.nodes if nd.type == "TEX_IMAGE"]
        if ter_img is not None and sat_nodes:
            old = sat_nodes[0].image
            sat_nodes[0].image = ter_img
            if old is not None and old.users == 0:
                bpy.data.images.remove(old)
    kd = KDTree(n)
    for i in range(n):
        kd.insert((P[i, 0], -P[i, 1], 0.0), i)
    kd.balance()
    band = CORRIDOR[-1] + 20.0
    for ob in ter_objs:
        me = ob.data
        me.transform(ob.matrix_world)
        ob.matrix_world.identity()
        bm = bmesh.new()
        bm.from_mesh(me)
        from mathutils.bvhtree import BVHTree

        # holes: the GP map's terrain leaves a channel where its own (approximate) Nordschleife ran. Where that
        # channel strays from the new road and its corridor, the sky shows through. Gaps enclosed by the terrain, away
        # from the GP (its own holes sit under its track and buildings, covered by its ground), get a grid patch:
        # heights from the terrain around, the photo's planar UVs, refined and conformed below like the rest.
        bm.faces.ensure_lookup_table()
        bvh0 = BVHTree.FromBMesh(bm)
        others = [BVHTree.FromPolygons([o.matrix_world @ v.co for v in o.data.vertices], [p.vertices[:] for p in o.data.polygons])
                  for o in ter_objs if o is not ob]
        V0 = np.array([v.co[:] for v in bm.verts])
        rh = NS.get("holeCellM", 12.0)
        hx0, hy0 = float(V0[:, 0].min()), float(V0[:, 1].min())
        HW_, HH_ = int((V0[:, 0].max() - hx0) / rh) + 1, int((V0[:, 1].max() - hy0) / rh) + 1
        down = Vector((0, 0, -1))
        cov = np.array([[any(b.ray_cast(Vector((hx0 + (i + 0.5) * rh, hy0 + (j + 0.5) * rh, 5000.0)), down)[2] is not None for b in (bvh0, *others))
                         for i in range(HW_)] for j in range(HH_)])
        # the GP's ground counts where optimize.mjs keeps it (GP_KEPT)
        near_road = CORRIDOR[-1] + 10.0
        gp_paved = np.concatenate([BASE_COL[k] for k in ("asphalt", "curb") if k in BASE_COL])
        cov |= raster(GP_KEPT, hx0, -(hy0 + HH_ * rh), HW_, HH_, rh)[::-1]  # game z = −Blender y
        # the GP's paved ground per cell (highest point): the patch stays off it and under its edges
        paved_h = raster(gp_paved, hx0, -(hy0 + HH_ * rh), HW_, HH_, rh, "height")[::-1]
        # outside the terrain: open cells reachable from the border
        from collections import deque

        outside = np.zeros_like(cov)
        q = deque((j, i) for j in range(HH_) for i in (0, HW_ - 1)) + deque((j, i) for i in range(HW_) for j in (0, HH_ - 1))
        while q:
            j, i = q.popleft()
            if 0 <= j < HH_ and 0 <= i < HW_ and not cov[j, i] and not outside[j, i]:
                outside[j, i] = True
                q.extend(((j + 1, i), (j - 1, i), (j, i + 1), (j, i - 1)))
        hole = ~cov & ~outside
        gpk0 = KDTree(len(gp_cl))
        for k, g_ in enumerate(gp_cl):
            gpk0.insert((g_[0], -g_[2], 0.0), k)
        gpk0.balance()
        for j, i in zip(*np.nonzero(hole)):
            q_ = (hx0 + (i + 0.5) * rh, hy0 + (j + 0.5) * rh, 0.0)
            if gpk0.find(q_)[2] < NS.get("gpClearM", 120) and kd.find(q_)[2] > near_road:
                hole[j, i] = False
        if hole.any():
            # one cell beyond the gap, under the terrain's edge (no crack between the patch's steps and the edge)
            patch = hole.copy()
            patch[1:] |= hole[:-1]
            patch[:-1] |= hole[1:]
            patch[:, 1:] |= hole[:, :-1]
            patch[:, :-1] |= hole[:, 1:]
            patch &= ~np.isfinite(paved_h)  # (12 m cells: one step further reached over the GP's road, 2.5 m above it)
            tkd = KDTree(len(V0))
            for k, v_ in enumerate(V0):
                tkd.insert((v_[0], v_[1], 0.0), k)
            tkd.balance()
            uvl = bm.loops.layers.uv.active
            A, U = [], []
            for f in bm.faces:
                for lp in f.loops:
                    A.append((lp.vert.co.x, lp.vert.co.y, 1.0))
                    U.append(lp[uvl].uv[:])
            fit, res_uv, *_ = np.linalg.lstsq(np.array(A), np.array(U), rcond=None)
            mat_i = bm.faces[0].material_index
            corner = {}

            def cvert(i, j):
                if (i, j) not in corner:
                    x, y = hx0 + i * rh, hy0 + j * rh
                    near_ = tkd.find_n((x, y, 0.0), 8)
                    w_ = [1.0 / max(d_, 1.0) ** 2 for _, _, d_ in near_]
                    zz = sum(wk * V0[k, 2] for wk, (_, k, _) in zip(w_, near_)) / sum(w_) - 0.4
                    # a corner next to the GP's paved ground stays 0.3 m under it
                    near_paved = paved_h[max(0, j - 1) : j + 1, max(0, i - 1) : i + 1]
                    if np.isfinite(near_paved).any():
                        zz = min(zz, float(near_paved[np.isfinite(near_paved)].min()) - 0.3)
                    corner[(i, j)] = bm.verts.new((x, y, zz))
                return corner[(i, j)]

            for j, i in zip(*np.nonzero(patch)):
                f = bm.faces.new((cvert(i, j), cvert(i + 1, j), cvert(i + 1, j + 1), cvert(i, j + 1)))
                f.material_index = mat_i
                for lp in f.loops:
                    lp[uvl].uv = tuple(np.array((lp.vert.co.x, lp.vert.co.y, 1.0)) @ fit)
            uv_rms = float(np.sqrt(res_uv.sum() / len(U))) if len(res_uv) else 0.0
            log(f"terrain {ob.name}: {int(hole.sum())} cells ({hole.sum() * rh * rh / 1e4:.1f} ha) of enclosed gaps patched (UV fit rms {uv_rms:.4f})")
        # faces the road passes under (vertical rays from the path) or with a corner in the band
        bm.faces.ensure_lookup_table()
        bm.faces.index_update()  # the patch's new faces: BVH hits are face indices

        bvh = BVHTree.FromBMesh(bm)
        hit_faces = set()
        for i in range(0, n, 3):
            for o in (-30.0, 0.0, 30.0):
                x, z = P[i, 0] + LEFT[i, 0] * o, P[i, 1] + LEFT[i, 1] * o
                h = bvh.ray_cast(Vector((x, -z, 5000.0)), Vector((0, 0, -1)))
                if h[2] is not None:
                    hit_faces.add(h[2])
        for it in range(5):
            # target edge length: ~10 m where the profile changes fast (near the road), ~22 m further out
            edges = set()
            for f in bm.faces:
                dmin = min(kd.find((v.co.x, v.co.y, 0.0))[2] for v in f.verts)
                if dmin > band and not (it == 0 and f.index in hit_faces):
                    continue
                target = 10.0 if dmin < HW.max() + 40.0 else 22.0
                edges.update(e for e in f.edges if e.calc_length() > target)
            if not edges:
                break
            bmesh.ops.subdivide_edges(bm, edges=list(edges), cuts=1, use_grid_fill=True)
            bmesh.ops.triangulate(bm, faces=bm.faces[:])
            bm.faces.ensure_lookup_table()
        moved = 0
        gpk = KDTree(len(gp_cl))
        for i, q in enumerate(gp_cl):
            gpk.insert((q[0], -q[2], 0.0), i)
        gpk.balance()
        for v in bm.verts:
            _, j, d = kd.find((v.co.x, v.co.y, 0.0))
            c = d - HW[j]
            dg = gpk.find((v.co.x, v.co.y, 0.0))[2]
            if c > CORRIDOR[-1] or dg < 25.0 or dg < d:  # near the junctions the GP keeps its own ground
                continue
            side = 1.0 if ((v.co.x - P[j, 0]) * LEFT[j, 0] + (-v.co.y - P[j, 1]) * LEFT[j, 1]) > 0 else -1.0
            road_y = yp(j, math.copysign(HW[j], side)) - 0.04 * VERGE
            if c < VERGE:
                v.co.z = road_y - 0.3
            else:
                w = min(1.0, (c - VERGE) / (CORRIDOR[-1] - VERGE))
                w = w * w * (3 - 2 * w)
                v.co.z = road_y * (1 - w) + v.co.z * w
            moved += 1
        # last: nothing of it above the road. Coarse triangles span between stretches at different heights (they take
        # the nearest stretch's profile), and pushed up through the asphalt in a few places (0.7 m at Pflanzgarten).
        # Rays down across the road every path point; any face above it is pulled under the road.
        for it in range(4):
            bm.faces.ensure_lookup_table()
            bm.faces.index_update()
            bvh2 = BVHTree.FromBMesh(bm)
            lowered = 0
            for i in range(n):
                for f_ in (-1.1, -0.8, -0.4, 0.0, 0.4, 0.8, 1.1):
                    o = f_ * (HW[i] + 0.5)
                    x, z = P[i, 0] + LEFT[i, 0] * o, P[i, 1] + LEFT[i, 1] * o
                    road_y = yp(i, max(-HW[i], min(HW[i], o)))
                    h = bvh2.ray_cast(Vector((x, -z, road_y + 6.0)), Vector((0, 0, -1)), 6.0 + 0.2)
                    if h[2] is None:
                        continue
                    for v in bm.faces[h[2]].verts:
                        if v.co.z > road_y - 0.3:
                            v.co.z = road_y - 0.3
                            lowered += 1
            if lowered == 0:
                break
            log(f"terrain pass {it + 1}: {lowered} vertices pulled under the road")
        bm.to_mesh(me)
        bm.free()
        me.update()
        ob.name = "chunk_terrain_0_0" if ob is ter_objs[0] else f"chunk_terrain_gp{ter_objs.index(ob)}"
        me.name = ob.name
        V = np.array([v.co[:] for v in me.vertices])
        c_ = (V.min(0) + V.max(0)) / 2
        chunks.append({"name": ob.name, "kind": "terrain", "center": [float(c_[0]), float(c_[2]), float(-c_[1])],
                       "radius": float(np.linalg.norm(V.max(0) - V.min(0)) / 2), "tris": len(me.polygons), "replacesBase": True})
        tris = [[me.loops[li].vertex_index for li in p.loop_indices] for p in me.polygons]
        add(col["grass"], [(x, z_, -y) for x, y, z_ in V], tris)
        log(f"terrain {ob.name}: refined to {len(me.polygons)} faces near the Nordschleife, {moved} vertices conformed")


# ------------------------------------------------------------------------------------ 6. export ---
for kind in ("track", "scenery", "terrain"):
    bpy.ops.object.select_all(action="DESELECT")
    sel = [o for o in bpy.data.objects if o.name.startswith(f"chunk_{kind}_")]
    for o in sel:
        o.select_set(True)
    bpy.ops.export_scene.gltf(
        filepath=str(OUT / f"map_{kind}.glb"), export_format="GLB", use_selection=True, export_yup=True, export_apply=True,
        export_image_format="AUTO", export_cameras=False, export_lights=False, export_animations=False,
    )
    log(f"exported map_{kind}.glb ({len(sel)} chunks)")
(OUT / "chunks.json").write_text(json.dumps(chunks, indent=1))

cdir = OUT / "collision_raw"
cdir.mkdir(exist_ok=True)
for k, (vs, fs) in col.items():
    tri = []
    for f in fs:
        for t in range(1, len(f) - 1):
            tri += [f[0], f[t], f[t + 1]]
    np.array(vs, np.float32).tofile(cdir / f"{k}.pos.bin")
    np.array(tri, np.uint32).tofile(cdir / f"{k}.idx.bin")
    log(f"collision {k}: {len(tri) // 3} tris")

# ----------------------------------------------------------------------- 7. the combined layout ---
gp_keep_a = gp_s <= S_EXIT
gp_keep_b = gp_s >= S_RETURN
STEP_OUT = 5.0
P_out = resample(np.c_[P, Y, HW], STEP_OUT)
cl = np.concatenate([gp_cl[gp_keep_a], np.c_[P_out[:, 0], P_out[:, 2], P_out[:, 1]], gp_cl[gp_keep_b]])
# round off the joins (GP lap ↔ connector) over ±40 m so the racing line has no kink
for jb in (int(gp_keep_a.sum()), int(gp_keep_a.sum()) + len(P_out)):
    lo_i, hi_i = max(1, jb - 8), min(len(cl) - 2, jb + 8)
    for _ in range(12):
        cl[lo_i:hi_i, [0, 2]] = (cl[lo_i - 1 : hi_i - 1, [0, 2]] + 2 * cl[lo_i:hi_i, [0, 2]] + cl[lo_i + 1 : hi_i + 1, [0, 2]]) / 4
wl = np.concatenate([np.array(GP["widthL"])[gp_keep_a], P_out[:, 3], np.array(GP["widthL"])[gp_keep_b]])
wr = np.concatenate([np.array(GP["widthR"])[gp_keep_a], P_out[:, 3], np.array(GP["widthR"])[gp_keep_b]])
cum = np.concatenate([[0], np.cumsum(np.linalg.norm(np.diff(cl[:, [0, 2]], axis=0), axis=1))])
L = float(cum[-1] + np.linalg.norm(cl[0, [0, 2]] - cl[-1, [0, 2]]))
gates = []
gstep = NS.get("gateStepM", 35.0)
for i in range(len(cl)):
    if not gates or cum[i] - gates[-1]["s"] >= gstep:
        j = min(len(cl) - 1, i + 1)
        t = cl[j] - cl[max(0, i - 1)]
        t = t / (np.linalg.norm(t[[0, 2]]) or 1)
        hw = float(max(wl[i], wr[i]) + 14.0)
        gates.append({"s": float(cum[i]), "p": [round(float(v), 3) for v in cl[i]], "d": [round(float(t[0]), 5), 0.0, round(float(t[2]), 5)], "hw": round(hw, 2)})
ng = len(gates)
pole_s = GP["gates"][GP["firstGate"]]["s"]  # the GP's first gate after the grid (kept part of the lap)
first_gate = next((k for k, g in enumerate(gates) if g["s"] >= pole_s - 1.0), 0)
pit = GP.get("pitLane")
if pit:
    if pit["exitS"] > S_EXIT:
        log("the GP pit exit is after the Nordschleife junction: no pit lane on the combined layout")
        pit = None
    elif pit["entryS"] >= S_RETURN:
        pit = {**pit, "entryS": round(pit["entryS"] + (S_EXIT + L_NS - S_RETURN), 1)}
    else:
        # the GP pit entry is on the skipped GP part: enter where the combined lap passes closest to it
        e = np.array(pit["points"][0])[[0, 2]]
        d = np.hypot(*(cl[:, [0, 2]] - e).T)
        k = int(np.argmin(d))
        if d[k] < 25.0:
            pit = {**pit, "entryS": round(float(cum[k]), 1)}
            log(f"pit entry moved to {cum[k]:.0f} m of the combined lap ({d[k]:.1f} m from the GP's entry)")
        else:
            log("the GP pit entry is on the skipped GP part and the combined lap does not pass it: no pit lane")
            pit = None
lid = MAP.get("layoutId", "nurburgring_24h")
base = {
    "version": 1,
    "id": lid,
    "name": MAP.get("layoutName", "Nürburgring Gesamtstrecke"),
    "length": round(L, 2),
    "centerline": [round(float(v), 3) for v in cl.ravel()],
    "cumS": [round(float(v), 3) for v in cum],
    "widthL": [round(float(v), 2) for v in wl],
    "widthR": [round(float(v), 2) for v in wr],
    "gates": gates,
    "sectorGates": [int(round(ng / 3)), int(round(2 * ng / 3))],
    "firstGate": first_gate,
    "minLapMs": int(GP["minLapMs"] * L / GP_L),
    "grid": GP["grid"],
    "startLine": GP["startLine"],
    "finishLine": GP["finishLine"],
    "bounds": {"min": [round(float(v), 3) for v in cl.min(0) - 50], "max": [round(float(v), 3) for v in cl.max(0) + 50]},
    "lights": [],
    "pitLane": pit,
}
(OUT / "track_base.json").write_text(json.dumps(base))
log(f"layout {lid}: {L / 1000:.2f} km (GP 0–{S_EXIT:.0f} m + Nordschleife {L_NS / 1000:.2f} km + GP {S_RETURN:.0f}–{GP_L:.0f} m), {ng} gates")
if SOURCE == "osm":
    (OUT / "attribution.txt").write_text(
        "Nordschleife centreline: © OpenStreetMap contributors (ODbL, https://www.openstreetmap.org/copyright)\n"
        "Elevation: EU-DEM v1.1 (Copernicus Land Monitoring Service), via opentopodata.org\n"
    )
log("done")
