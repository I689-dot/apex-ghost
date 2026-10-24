"""Blender headless car converter.

blender -b --factory-startup -P convert_car.py -- <in.usdc|.glb|.obj> <out.glb> <out_meta.json> [thumb.png]

Output conventions (glTF space): metres, +Y up, +Z forward, +X = driver's LEFT.
Origin: lateral centre, midpoint between the axles, ground (tyre contact) at y = 0.

Node layout in the GLB:
  car
   ├─ body                       (all static geometry, materials preserved)
   ├─ wheel_FL / FR / RL / RR    (empty at hub centre; steer + suspension pivot)
   │    ├─ wheel_XX_spin         (tyre, rim, disc: spins around local X)
   │    └─ wheel_XX_caliper      (static brake parts)
   └─ steering_wheel             (empty at hub; rotates around meta.steering.axis)
"""
from __future__ import annotations

import json
import math
import re
import sys
from pathlib import Path

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector

argv = sys.argv[sys.argv.index("--") + 1 :]
IN_USD, OUT_GLB, OUT_META = argv[0], argv[1], argv[2]
THUMB = argv[3] if len(argv) > 3 and argv[3] != "-" else None
CAR_ID = argv[4] if len(argv) > 4 else None

CONFIG_PATH = Path(__file__).resolve().parents[1] / "cars.config.json"
CFG = {}
if CAR_ID and CONFIG_PATH.exists():
    CFG = json.loads(CONFIG_PATH.read_text()).get("cars", {}).get(CAR_ID, {}).get("pipeline", {})

TARGET_TYRE_DIAMETER = 0.69  # m, typical GT3 18" wheel (30/68 front, 31/71 rear)

CALIPER_RE = re.compile(r"calip|etrier|brake_?cal|caliperdetail", re.I)
STEER_RE = re.compile(r"steer|volant|steeringwheel|_sw_|lenkrad", re.I)
STEER_EXCLUDE_RE = re.compile(r"column|shaft|rack", re.I)
TYRE_HINT_RE = re.compile(r"tyre|tire|rim|wheel|disc|disk|rotor|hub|reifen", re.I)
TYRE_NAME_RE = re.compile(r"tyre|tire|reifen|pneu", re.I)
TYRE_NAME_EXCLUDE_RE = re.compile(r"brake|disc|disk|hub|calip|rim|blur|well|house|arch|bolt|nut|valve|spare", re.I)
FRONT_LABEL_RE = re.compile(r"(^|[^a-z0-9])(lf|rf|fl|fr)([^a-z0-9]|$)", re.I)
REAR_LABEL_RE = re.compile(r"(^|[^a-z0-9])(lr|rr|rl)([^a-z0-9]|$)", re.I)
LIGHT_RE = re.compile(r"emis|light|lamp|(^|[_\s.])led|drl|(^|[_\s.])tail|brake_?l|stop_?l|indicator|turnsig|blinker", re.I)
INTERIOR_RE = re.compile(r"int_|interior|cockpit|seat|steer|dash|belt|pedal|display|gauge|roll_?cage|sparco", re.I)
JUNK_RE = re.compile(r"worldgridmaterial|shadow|collider|_col$|ground_?plane|turntable|stand\b", re.I)

log_lines: list[str] = []


def log(*a: object) -> None:
    s = " ".join(str(x) for x in a)
    log_lines.append(s)
    print("[car]", s, flush=True)


# ---------------------------------------------------------------- import ---
bpy.ops.wm.read_factory_settings(use_empty=True)
# USD (the Sketchfab exports in 3D MODELS/CARS), glTF/GLB and OBJ (the downloads in CARS-MODELS)
_ext = Path(IN_USD).suffix.lower()
if _ext in (".glb", ".gltf"):
    bpy.ops.import_scene.gltf(filepath=IN_USD)
elif _ext == ".obj":
    bpy.ops.wm.obj_import(filepath=IN_USD)
else:
    bpy.ops.wm.usd_import(filepath=IN_USD, import_cameras=False, import_lights=False, import_materials=True)


def _hex(c: str) -> tuple[float, float, float, float]:
    # sRGB hex → linear (Blender's colour sockets are linear)
    v = [int(c.lstrip("#")[i : i + 2], 16) / 255 for i in (0, 2, 4)]
    return (*[x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in v], 1.0)


def apply_material_overrides(rules: dict) -> None:
    """pipeline.materials in cars.config.json: {"<material name regex>": {color, texture, metallic, roughness}}.
    For downloads whose livery is a loose file (not linked to the paint) or with no material library at all (OBJ)."""
    for pattern, r in rules.items():
        rx = re.compile(pattern, re.I)
        for m in bpy.data.materials:
            if not rx.search(m.name):
                continue
            m.use_nodes = True
            nt = m.node_tree
            bsdf = next((n for n in nt.nodes if n.type == "BSDF_PRINCIPLED"), None)
            if bsdf is None:
                bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
                out = next((n for n in nt.nodes if n.type == "OUTPUT_MATERIAL"), None) or nt.nodes.new("ShaderNodeOutputMaterial")
                nt.links.new(bsdf.outputs[0], out.inputs[0])
            base = bsdf.inputs["Base Color"]
            if "texture" in r:
                # relative to the download's folder (the nearest parent of the model that has it)
                src = next(a / r["texture"] for a in Path(IN_USD).resolve().parents if (a / r["texture"]).exists())
                img = bpy.data.images.load(str(src), check_existing=True)
                tex = nt.nodes.new("ShaderNodeTexImage")
                tex.image = img
                for link in list(base.links):
                    nt.links.remove(link)
                nt.links.new(tex.outputs["Color"], base)
            elif "color" in r:
                for link in list(base.links):
                    nt.links.remove(link)
                base.default_value = _hex(r["color"])
            if "metallic" in r:
                bsdf.inputs["Metallic"].default_value = r["metallic"]
            if "roughness" in r:
                for link in list(bsdf.inputs["Roughness"].links):
                    nt.links.remove(link)
                bsdf.inputs["Roughness"].default_value = r["roughness"]
            log("material override", m.name, "<-", pattern)


if CFG.get("materials"):
    apply_material_overrides(CFG["materials"])

meshes = [o for o in bpy.data.objects if o.type == "MESH"]
# The semantic names (WHEEL_LF, FRONT_BUMPER, Tire_RR …) live on parent Xforms: keep them as hints.
HINT: dict[str, str] = {}
for o in meshes:
    names = []
    a = o
    while a is not None:
        names.append(a.name)
        a = a.parent
    HINT[o.name] = " ".join(n for n in names if not re.fullmatch(r"(Object|mesh|root|RootNode|Sketchfab_model|GLTF_SceneRootNode)[_\d.]*", n))
for o in meshes:
    if o.data.users > 1:
        o.data = o.data.copy()
    o.data.transform(o.matrix_world)
    o.parent = None
    o.matrix_world = Matrix.Identity(4)
for o in list(bpy.data.objects):
    if o.type != "MESH":
        bpy.data.objects.remove(o, do_unlink=True)

# drop junk / proxy geometry
for o in list(meshes):
    mats = [m.name for m in o.data.materials if m]
    if len(o.data.polygons) == 0 or (mats and all(JUNK_RE.search(m) for m in mats)) or JUNK_RE.search(HINT.get(o.name, "")):
        log("drop junk", o.name, mats[:3])
        meshes.remove(o)
        bpy.data.objects.remove(o, do_unlink=True)


# Windows identified by object name get their own material, so atlas-textured models
# (one material for glass and bodywork) can still have see-through windows.
_WIN_OBJ_RE = re.compile(r"(^|[^a-z])(glass|window|windscreen|windshield)", re.I)
for o in meshes:
    if not _WIN_OBJ_RE.search(HINT.get(o.name, "")):
        continue
    for slot in o.material_slots:
        m = slot.material
        if m is None or m.name.startswith("WINDOW_") or re.search(r"emissive|light|lamp", m.name, re.I):
            continue
        wm = m.copy()
        wm.name = "WINDOW_" + m.name
        slot.material = wm


def name_of(o: bpy.types.Object, poly_mat: int) -> str:
    mat = o.data.materials[poly_mat].name if poly_mat < len(o.data.materials) and o.data.materials[poly_mat] else ""
    return f"{HINT.get(o.name, o.name)} {mat}"


# --------------------------------------------------- connected components ---
class Part:
    __slots__ = ("obj", "label", "polys", "verts", "mn", "mx", "name", "nverts")

    def __init__(self, obj, label, polys, verts, name):
        self.obj = obj
        self.label = label
        self.polys = polys
        self.verts = verts
        self.mn = verts.min(axis=0)
        self.mx = verts.max(axis=0)
        self.name = name
        self.nverts = len(verts)

    @property
    def size(self):
        return self.mx - self.mn

    @property
    def center(self):
        return (self.mx + self.mn) * 0.5


def components(o: bpy.types.Object) -> list[Part]:
    me = o.data
    nv = len(me.vertices)
    co = np.empty(nv * 3, dtype=np.float64)
    me.vertices.foreach_get("co", co)
    co = co.reshape(-1, 3)
    ne = len(me.edges)
    ev = np.empty(ne * 2, dtype=np.int64)
    me.edges.foreach_get("vertices", ev)
    ev = ev.reshape(-1, 2)
    parent = np.arange(nv)

    def find(a: int) -> int:
        root = a
        while parent[root] != root:
            root = parent[root]
        while parent[a] != root:
            parent[a], a = root, parent[a]
        return root

    for a, b in ev.tolist():
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[ra] = rb
    labels = np.array([find(i) for i in range(nv)])
    npoly = len(me.polygons)
    ls = np.empty(npoly, dtype=np.int64)
    me.polygons.foreach_get("loop_start", ls)
    lv = np.empty(len(me.loops), dtype=np.int64)
    me.loops.foreach_get("vertex_index", lv)
    pm = np.empty(npoly, dtype=np.int64)
    me.polygons.foreach_get("material_index", pm)
    poly_label = labels[lv[ls]]
    parts = []
    uniq = np.unique(poly_label)
    order = np.argsort(poly_label, kind="stable")
    sorted_lab = poly_label[order]
    bounds = np.searchsorted(sorted_lab, uniq)
    bounds = np.append(bounds, len(order))
    vert_order = np.argsort(labels, kind="stable")
    vlab_sorted = labels[vert_order]
    for i, lab in enumerate(uniq):
        polys = order[bounds[i] : bounds[i + 1]]
        vs = vert_order[np.searchsorted(vlab_sorted, lab, "left") : np.searchsorted(vlab_sorted, lab, "right")]
        parts.append(Part(o, int(lab), polys, co[vs], name_of(o, int(pm[polys[0]]))))
    return parts


all_parts: list[Part] = []
for o in meshes:
    all_parts.extend(components(o))
log("parts", len(all_parts), "objects", len(meshes))

# ---- main-body crop: drop display props (spare tyres, stands, boards) far from the car
by_size = sorted(all_parts, key=lambda p: -p.nverts)
total_v = sum(p.nverts for p in all_parts)
acc = 0
main = []
for p in by_size:
    main.append(p)
    acc += p.nverts
    if acc > 0.5 * total_v:
        break
mmn = np.min([p.mn for p in main], axis=0)
mmx = np.max([p.mx for p in main], axis=0)
msz = mmx - mmn
horiz = max(msz[0], msz[1])
keep = []
for p in all_parts:
    c = p.center
    pad = np.array([0.18 * horiz, 0.18 * horiz, 0.35 * msz[2]])
    if np.all(c > mmn - pad) and np.all(c < mmx + pad):
        keep.append(p)
    else:
        p.name = "__stray__ " + p.name
dropped = [p for p in all_parts if p.name.startswith("__stray__")]
if dropped:
    log("cropped stray parts", len(dropped), "verts", sum(p.nverts for p in dropped))
all_parts = keep

allv = np.concatenate([p.verts for p in all_parts])
lo = np.percentile(allv, 0.2, axis=0)
hi = np.percentile(allv, 99.8, axis=0)
core = hi - lo
# Blender: Z is up. Length axis = larger horizontal extent.
LONG = 0 if core[0] > core[1] else 1
LAT = 1 - LONG
UP = 2
L = core[LONG]
# no part of a car sits further than ~0.32 L from its centre line (mirrors included)
max_lat = CFG.get("maxLateralFrac", 0.32) * L
lat_c = np.median(allv[:, LAT])
far = [p for p in all_parts if abs(p.center[LAT] - lat_c) > max_lat]
if far:
    log("lateral crop", len(far), "parts")
    for p in far:
        dropped.append(p)
    all_parts = [p for p in all_parts if abs(p.center[LAT] - lat_c) <= max_lat]
    allv = np.concatenate([p.verts for p in all_parts])
    lo = np.percentile(allv, 0.2, axis=0)
    hi = np.percentile(allv, 99.8, axis=0)
    core = hi - lo
    L = core[LONG]
log("core size", core.round(3), "long axis", "XY"[LONG])
mid_long = (lo[LONG] + hi[LONG]) / 2
mid_lat = (lo[LAT] + hi[LAT]) / 2
ground = lo[UP]


def quadrant(c) -> tuple[int, int]:
    return (1 if c[LONG] > mid_long else -1, 1 if c[LAT] > mid_lat else -1)


def wheel_from_group(group: list[Part], src: str) -> dict | None:
    mn = np.min([p.mn for p in group], axis=0)
    mx = np.max([p.mx for p in group], axis=0)
    s = mx - mn
    a, h, w = s[LONG], s[UP], s[LAT]
    if not (0.09 * L < h < 0.22 * L) or abs(a - h) / max(a, h) > 0.15 or not (0.08 * h < w < 0.9 * h):
        return None
    c = (mn + mx) / 2
    return {"c": c, "R": h / 2, "latMin": mn[LAT], "latMax": mx[LAT], "src": src}


wheels: dict[tuple[int, int], dict] = {}

# 1) by name: tyre meshes clustered per corner
named = [p for p in all_parts if TYRE_NAME_RE.search(p.name) and not TYRE_NAME_EXCLUDE_RE.search(p.name.split(" ")[-1] + " " + p.name)]
if named:
    groups: dict[tuple[int, int], list[Part]] = {}
    for p in named:
        groups.setdefault(quadrant(p.center), []).append(p)
    for q, g in groups.items():
        # keep the dominant ring: parts overlapping the biggest part's bbox
        big = max(g, key=lambda p: p.size[UP])
        g2 = [p for p in g if np.all(p.center > big.mn - 0.05 * L) and np.all(p.center < big.mx + 0.05 * L)]
        w = wheel_from_group(g2, "name")
        if w:
            wheels[q] = w
    if len(wheels) < 4:
        log("name-based tyres found only", len(wheels))


# 2) geometric: ring-shaped parts low in each corner
def ring_score(p: Part) -> float:
    s = p.size
    a, h, w = s[LONG], s[UP], s[LAT]
    if h < 0.09 * L or h > 0.22 * L:
        return 0
    if abs(a - h) / max(a, h) > 0.12:
        return 0
    if not (0.12 * h < w < 0.8 * h):
        return 0
    if p.mn[UP] > ground + 0.15 * h:
        return 0
    if p.nverts < 24:
        return 0
    c = p.center
    if abs(c[LAT] - mid_lat) < 0.22 * core[LAT]:
        return 0
    if abs(c[LONG] - mid_long) < 0.16 * L:
        return 0
    score = h * (1.0 - min(0.9, (p.mn[UP] - ground) / max(h, 1e-6)))
    if TYRE_HINT_RE.search(p.name):
        score *= 1.2
    return score


if len(wheels) < 4:
    quad: dict[tuple[int, int], list[Part]] = {}
    for p in all_parts:
        if ring_score(p) > 0:
            quad.setdefault(quadrant(p.center), []).append(p)
    for q, cands in quad.items():
        if q in wheels:
            continue
        best = max(cands, key=ring_score)
        R = best.size[UP] / 2
        c = best.center.copy()
        group = [p for p in cands if np.linalg.norm(p.center[[LONG, UP]] - c[[LONG, UP]]) < 0.3 * R]
        wheels[q] = {
            "c": c,
            "R": max(p.size[UP] for p in group) / 2,
            "latMin": min(p.mn[LAT] for p in group),
            "latMax": max(p.mx[LAT] for p in group),
            "src": "geometry",
        }
        wheels[q]["c"][UP] = best.mn[UP] + wheels[q]["R"]

# an axle's two tyres must match; otherwise trust the larger, rounder one and mirror it
for ql in (1, -1):
    a, b = wheels.get((ql, 1)), wheels.get((ql, -1))
    if a and b and abs(a["R"] - b["R"]) / max(a["R"], b["R"]) > 0.12:
        keep_q = (ql, 1) if a["R"] > b["R"] else (ql, -1)
        log("axle mismatch, keeping", keep_q)
        del wheels[(ql, -keep_q[1])]

# mirror missing wheels from the other side of the same axle
for ql in (1, -1):
    for qs in (1, -1):
        if (ql, qs) not in wheels and (ql, -qs) in wheels:
            w = wheels[(ql, -qs)]
            c = w["c"].copy()
            c[LAT] = 2 * mid_lat - c[LAT]
            wheels[(ql, qs)] = {"c": c, "R": w["R"], "latMin": 2 * mid_lat - w["latMax"], "latMax": 2 * mid_lat - w["latMin"], "src": "mirrored"}
            log("mirrored wheel", (ql, qs))

fallback_wheels = len(wheels) < 4
if fallback_wheels:
    log("WHEEL DETECTION FAILED: estimating hub positions from body bounds")
    R = 0.074 * L
    for ql in (1, -1):
        for qs in (1, -1):
            if (ql, qs) in wheels:
                continue
            c = np.zeros(3)
            c[LONG] = mid_long + ql * 0.29 * L
            c[LAT] = mid_lat + qs * (core[LAT] / 2 - 0.075 * L)
            c[UP] = ground + R
            wheels[(ql, qs)] = {"c": c, "R": R, "latMin": c[LAT] - 0.035 * L, "latMax": c[LAT] + 0.035 * L, "src": "estimated"}

# ------------------------------------------------------- orientation: front ---
front_score = 0.0  # >0 means +LONG is the front


def long_of_matching(rx: re.Pattern) -> float | None:
    sel = [p for p in all_parts if rx.search(p.name)]
    if not sel:
        return None
    w = np.array([p.nverts for p in sel], dtype=float)
    return float(np.average([p.center[LONG] for p in sel], weights=w))


# wheel corner labels (LF/RF vs LR/RR) are the strongest cue
fl = long_of_matching(FRONT_LABEL_RE)
rl = long_of_matching(REAR_LABEL_RE)
if fl is not None and rl is not None and abs(fl - rl) > 0.25 * L:
    front_score += 6.0 * np.sign(fl - rl)
    log("label front score", np.sign(fl - rl))
f = long_of_matching(re.compile(r"front|head|bumper_?f|splitter|grille|headlight|frontal", re.I))
r = long_of_matching(re.compile(r"rear|tail|wing|spoiler|diffus|exhaust|bumper_?r|heck", re.I))
if f is not None and r is not None and abs(f - r) > 0.1 * L:
    front_score += 3.0 * np.sign(f - r)
    log("name front score", np.sign(f - r))
elif f is not None and abs(f - mid_long) > 0.15 * L:
    front_score += 2.0 * np.sign(f - mid_long)
elif r is not None and abs(r - mid_long) > 0.15 * L:
    front_score -= 2.0 * np.sign(r - mid_long)

# rear wing: the highest geometry sits over the rear axle on race cars
top = allv[allv[:, UP] > hi[UP] - 0.06 * core[UP]]
if len(top):
    tl = np.median(top[:, LONG])
    if abs(tl - mid_long) > 0.22 * L:
        front_score -= 1.5 * np.sign(tl - mid_long)
        log("wing score", -np.sign(tl - mid_long))
# rear tyres are usually larger on RWD race cars
if not fallback_wheels:
    rf = np.mean([wheels[(1, s)]["R"] for s in (1, -1)])
    rr = np.mean([wheels[(-1, s)]["R"] for s in (1, -1)])
    if abs(rf - rr) / max(rf, rr) > 0.015:
        front_score += 0.75 * np.sign(rr - rf)
FRONT = 1 if front_score >= 0 else -1
if "flipFront" in CFG and CFG["flipFront"]:
    FRONT = -FRONT
    log("front flipped by config")
log("front direction", FRONT, "score", front_score)

# ---------------------------------------------------------- normalisation ---
mean_d = 2 * np.mean([w["R"] for w in wheels.values()])
if "realLengthM" in CFG:
    scale = CFG["realLengthM"] / L
    log("scale from real length", CFG["realLengthM"], "-> tyre diameter %.3f m" % (mean_d * scale))
    # re-derive suspicious wheel radii from the known scale
    for w in wheels.values():
        if not (0.27 < w["R"] * scale < 0.42):
            log("implausible tyre radius %.3f m, using 0.345" % (w["R"] * scale))
            w["R"] = 0.345 / scale
            # the detection probably found the rim: widen the tyre band outwards too
            half = 0.17 / scale
            w["latMin"], w["latMax"] = w["c"][LAT] - half, w["c"][LAT] + half
            w["src"] += "+r"
else:
    scale = TARGET_TYRE_DIAMETER / mean_d
    if not (4.0 < L * scale < 5.6):
        log("scale sanity failed (length %.2f m); scaling by length instead" % (L * scale))
        scale = 4.75 / L
front_axle = np.mean([wheels[(FRONT, s)]["c"][LONG] for s in (1, -1)])
rear_axle = np.mean([wheels[(-FRONT, s)]["c"][LONG] for s in (1, -1)])
origin = np.zeros(3)
origin[LONG] = (front_axle + rear_axle) / 2
origin[LAT] = mid_lat
origin[UP] = min(w["c"][UP] - w["R"] for w in wheels.values())



def to_norm(v: np.ndarray) -> np.ndarray:
    """model coords -> Blender normalised coords (front = -Y, left = +X, up = +Z), metres."""
    d = (np.asarray(v) - origin) * scale
    fwd = d[..., LONG] * FRONT
    # left side: when looking along forward with Z up, left = up x forward
    # forward axis vector in model space:
    lat = d[..., LAT]
    # sign of lateral so that +X is left: left = up x fwd
    fwd_vec = np.zeros(3)
    fwd_vec[LONG] = FRONT
    up_vec = np.array([0.0, 0.0, 1.0])
    left_vec = np.cross(up_vec, fwd_vec)
    lat_sign = left_vec[LAT]
    out = np.stack([lat * lat_sign, -fwd, d[..., UP]], axis=-1)
    return out


# build a 4x4 matrix equivalent of to_norm for mesh transform
M = np.zeros((4, 4))
fwd_vec = np.zeros(3)
fwd_vec[LONG] = FRONT
left_vec = np.cross(np.array([0.0, 0.0, 1.0]), fwd_vec)
LAT_SIGN = left_vec[LAT]
M[0, LAT] = LAT_SIGN * scale
M[1, LONG] = -FRONT * scale
M[2, UP] = scale
M[:3, 3] = -M[:3, :3] @ origin
M[3, 3] = 1
NORM = Matrix(M.tolist())

# normalised wheel data (Blender space)
wheel_norm = {}
for (ql, qs), w in wheels.items():
    c = to_norm(w["c"])
    is_front = ql == FRONT
    lat_n = sorted([to_norm(np.where(np.arange(3) == LAT, w["latMin"], w["c"]))[0],
                    to_norm(np.where(np.arange(3) == LAT, w["latMax"], w["c"]))[0]])
    side = "L" if c[0] > 0 else "R"
    key = ("F" if is_front else "R") + side
    wheel_norm[key] = {"c": c, "R": w["R"] * scale, "lat": lat_n, "src": w["src"]}
log("wheels", {k: (v["c"].round(3).tolist(), round(v["R"], 3), v["src"]) for k, v in wheel_norm.items()})

# ---------------------------------------------------- classify every face ---
# target ids: 0 body, 1-4 wheel spin, 5-8 caliper, 9 steering wheel, -1 delete
KEYS = ["FL", "FR", "RL", "RR"]
targets: dict[str, np.ndarray] = {}
for o in meshes:
    targets[o.name] = np.zeros(len(o.data.polygons), dtype=np.int64)

norm_core_lo = to_norm(lo)
norm_core_hi = to_norm(hi)
nlo = np.minimum(norm_core_lo, norm_core_hi)
nhi = np.maximum(norm_core_lo, norm_core_hi)


def wheel_hit(vn: np.ndarray, key: str, inboard: float) -> np.ndarray:
    w = wheel_norm[key]
    c, R = w["c"], w["R"]
    rad = np.hypot(vn[:, 1] - c[1], vn[:, 2] - c[2])
    lat_lo, lat_hi = w["lat"]
    outer_is_hi = c[0] > 0  # outer face is the one further from the centre line
    if outer_is_hi:
        band = (vn[:, 0] <= lat_hi + 0.01) & (vn[:, 0] >= lat_lo - inboard)
    else:
        band = (vn[:, 0] >= lat_lo - 0.01) & (vn[:, 0] <= lat_hi + inboard)
    return (rad <= R * 1.03) & band


wheel_vertex_count = {k: 0 for k in KEYS}
for p in dropped:
    targets[p.obj.name][p.polys] = -1
steer_parts: list[Part] = []
removed = 0
for p in all_parts:
    vn = to_norm(p.verts)
    pmn, pmx = vn.min(axis=0), vn.max(axis=0)
    # stands / ground plates / stray objects far outside the car
    if pmx[2] < 0.015 and (pmx[0] - pmn[0]) > 0.8:
        targets[p.obj.name][p.polys] = -1
        removed += 1
        continue
    cen = (pmn + pmx) / 2
    if np.any(cen < nlo - 0.4) or np.any(cen > nhi + 0.4):
        targets[p.obj.name][p.polys] = -1
        removed += 1
        continue
    assigned = False
    for i, k in enumerate(KEYS):
        if wheel_hit(vn, k, inboard=0.42 * wheel_norm[k]["R"]).all():
            tid = 5 + i if CALIPER_RE.search(p.name) else 1 + i
            targets[p.obj.name][p.polys] = tid
            wheel_vertex_count[k] += len(vn)
            assigned = True
            break
    if not assigned and STEER_RE.search(p.name) and not STEER_EXCLUDE_RE.search(p.name):
        if 0.35 < cen[2] < 1.25 and (pmx - pmn).max() < 0.6:
            steer_parts.append(p)
log("removed stray parts", removed)

# merged-wheel fallback: cut faces inside the wheel cylinder out of big parts
cut_wheels = []
for i, k in enumerate(KEYS):
    if wheel_vertex_count[k] < 300:
        cut_wheels.append(k)
        log("face-level wheel cut for", k)
        for o in meshes:
            me = o.data
            nv = len(me.vertices)
            co = np.empty(nv * 3)
            me.vertices.foreach_get("co", co)
            vn = to_norm(co.reshape(-1, 3))
            hit = wheel_hit(vn, k, inboard=0.3 * wheel_norm[k]["R"])
            ls = np.empty(len(me.polygons), dtype=np.int64)
            me.polygons.foreach_get("loop_start", ls)
            lt = np.empty(len(me.polygons), dtype=np.int64)
            me.polygons.foreach_get("loop_total", lt)
            lv = np.empty(len(me.loops), dtype=np.int64)
            me.loops.foreach_get("vertex_index", lv)
            inside = np.add.reduceat(hit[lv].astype(np.int64), ls) == lt
            t = targets[o.name]
            t[(t == 0) & inside] = 1 + i
            wheel_vertex_count[k] += int(inside.sum()) * 3

# steering wheel
steer = None
if steer_parts:
    sv = np.concatenate([to_norm(p.verts) for p in steer_parts])
    # keep the dominant cluster (driver side)
    lat_med = np.median(sv[:, 0])
    keep = [p for p in steer_parts if abs(to_norm(p.verts)[:, 0].mean() - lat_med) < 0.35]
    sv = np.concatenate([to_norm(p.verts) for p in keep])
    size = sv.max(axis=0) - sv.min(axis=0)
    if 0.18 < size.max() < 0.55:
        for p in keep:
            targets[p.obj.name][p.polys] = 9
        centre = (sv.max(axis=0) + sv.min(axis=0)) / 2
        cov = np.cov((sv - sv.mean(axis=0)).T)
        evals, evecs = np.linalg.eigh(cov)
        axis = evecs[:, 0]
        if axis[1] < 0:  # point towards the rear (+Y in Blender = backwards)
            axis = -axis
        # a real column points rearwards and up 10-40 degrees; otherwise PCA was fooled by paddles/buttons
        if not (0.05 < axis[2] < 0.65 and abs(axis[0]) < 0.3):
            log("steering axis implausible", axis.round(3), "-> default 22deg tilt")
            axis = np.array([0.0, math.cos(math.radians(22)), math.sin(math.radians(22))])
        steer = {"c": centre, "axis": axis, "diameter": float(np.sort(size)[-1])}
        log("steering wheel", centre.round(3), axis.round(3), "parts", len(keep))
    else:
        log("steering candidates rejected, size", size.round(3))

# ------------------------------------------------------- build the objects ---
def extract(tid: int, name: str) -> bpy.types.Object | None:
    pieces = []
    for o in meshes:
        t = targets[o.name]
        if not np.any(t == tid):
            continue
        me = o.data.copy()
        bm = bmesh.new()
        bm.from_mesh(me)
        bm.faces.ensure_lookup_table()
        kill = [bm.faces[i] for i in np.nonzero(t != tid)[0].tolist()]
        bmesh.ops.delete(bm, geom=kill, context="FACES")
        bm.to_mesh(me)
        bm.free()
        ob = bpy.data.objects.new(name + "_piece", me)
        bpy.context.scene.collection.objects.link(ob)
        pieces.append(ob)
    if not pieces:
        return None
    bpy.ops.object.select_all(action="DESELECT")
    for ob in pieces:
        ob.select_set(True)
    bpy.context.view_layer.objects.active = pieces[0]
    if len(pieces) > 1:
        bpy.ops.object.join()
    ob = bpy.context.view_layer.objects.active
    ob.name = name
    ob.data.name = name
    ob.data.transform(NORM)
    return ob


body = extract(0, "body")
spin = {k: extract(1 + i, f"wheel_{k}_spin") for i, k in enumerate(KEYS)}
cal = {k: extract(5 + i, f"wheel_{k}_caliper") for i, k in enumerate(KEYS)}
sw = extract(9, "steering_wheel_mesh") if steer else None
for o in meshes:
    bpy.data.objects.remove(o, do_unlink=True)

# Wheels for which nothing usable was found get a generic procedural wheel.
generic = []
for k in KEYS:
    ob = spin[k]
    ok = ob is not None and len(ob.data.polygons) > 60
    if ok:
        vs = np.array([v.co[:] for v in ob.data.vertices])
        ext = vs.max(axis=0) - vs.min(axis=0)
        d = 2 * wheel_norm[k]["R"]
        ok = ext[1] > 0.8 * d and ext[2] > 0.8 * d
    if not ok:
        generic.append(k)
        if ob is not None:
            bpy.data.objects.remove(ob, do_unlink=True)
        w = wheel_norm[k]
        # hide the baked tyre: cut every body face that lies inside the wheel cylinder
        bm = bmesh.new()
        bm.from_mesh(body.data)
        bm.verts.ensure_lookup_table()
        vco = np.array([v.co[:] for v in bm.verts])
        inside_v = wheel_hit(vco, k, inboard=0.3 * w["R"])
        kill = [f for f in bm.faces if all(inside_v[v.index] for v in f.verts)]
        bmesh.ops.delete(bm, geom=kill, context="FACES")
        bm.to_mesh(body.data)
        bm.free()
        log("cut baked tyre faces for", k, len(kill))
        width = max(0.2, abs(w["lat"][1] - w["lat"][0]))
        bpy.ops.mesh.primitive_cylinder_add(vertices=40, radius=w["R"], depth=width, rotation=(0, math.pi / 2, 0),
                                            location=Vector(w["c"].tolist()))
        tyre = bpy.context.active_object
        tyre.name = f"wheel_{k}_spin"
        mat = bpy.data.materials.new("generic_tyre")
        mat.use_nodes = True
        mat.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.02, 0.02, 0.02, 1)
        mat.node_tree.nodes["Principled BSDF"].inputs["Roughness"].default_value = 0.85
        tyre.data.materials.append(mat)
        bpy.ops.mesh.primitive_cylinder_add(vertices=24, radius=w["R"] * 0.66, depth=width * 1.02,
                                            rotation=(0, math.pi / 2, 0), location=Vector(w["c"].tolist()))
        rim = bpy.context.active_object
        rmat = bpy.data.materials.new("generic_rim")
        rmat.use_nodes = True
        rmat.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.25, 0.25, 0.27, 1)
        rmat.node_tree.nodes["Principled BSDF"].inputs["Metallic"].default_value = 1.0
        rmat.node_tree.nodes["Principled BSDF"].inputs["Roughness"].default_value = 0.3
        rim.data.materials.append(rmat)
        bpy.ops.object.select_all(action="DESELECT")
        rim.select_set(True)
        tyre.select_set(True)
        bpy.context.view_layer.objects.active = tyre
        bpy.ops.object.join()
        spin[k] = tyre
        tyre.matrix_world = Matrix.Identity(4)
        tyre.data.transform(Matrix.Translation(Vector(w["c"].tolist())) @ Matrix.Rotation(math.pi / 2, 4, "Y"))
if generic:
    log("GENERIC WHEEL FALLBACK used for", generic)

# hierarchy
root = bpy.data.objects.new("car", None)
bpy.context.scene.collection.objects.link(root)
body.parent = root
for k in KEYS:
    w = wheel_norm[k]
    hub = bpy.data.objects.new(f"wheel_{k}", None)
    bpy.context.scene.collection.objects.link(hub)
    hub.parent = root
    hub.location = Vector(w["c"].tolist())
    for ob in (spin[k], cal[k]):
        if ob is None:
            continue
        ob.data.transform(Matrix.Translation(-Vector(w["c"].tolist())))
        ob.parent = hub
        ob.location = (0, 0, 0)
if sw is not None:
    pivot = bpy.data.objects.new("steering_wheel", None)
    bpy.context.scene.collection.objects.link(pivot)
    pivot.parent = root
    pivot.location = Vector(steer["c"].tolist())
    sw.data.transform(Matrix.Translation(-Vector(steer["c"].tolist())))
    sw.parent = pivot

# ------------------------------------------------------------- analysis ---
bv = np.array([v.co[:] for v in body.data.vertices])
bmin, bmax = bv.min(axis=0), bv.max(axis=0)

# interior: faces whose names hint at cabin parts, or a seat/steering wheel
interior_faces = 0
mat_names = [m.name if m else "" for m in body.data.materials]
pm = np.empty(len(body.data.polygons), dtype=np.int64)
body.data.polygons.foreach_get("material_index", pm)
for i, n in enumerate(mat_names):
    if INTERIOR_RE.search(n):
        interior_faces += int((pm == i).sum())
has_interior = interior_faces > 500 or steer is not None
log("interior faces", interior_faces, "has interior", has_interior)


def roof_at(x: float, y: float) -> float:
    sel = bv[(np.abs(bv[:, 0] - x) < 0.25) & (np.abs(bv[:, 1] - y) < 0.25)]
    # 97th percentile ignores antennas, roof scoops and wipers
    return float(np.percentile(sel[:, 2], 97)) if len(sel) > 20 else float(bmax[2])


SEAT_RE = re.compile(r"seat|sparco|recaro|bucket", re.I)
SEAT_EXCLUDE_RE = re.compile(r"belt|harness|schroth|sabelt", re.I)
seat_box = None
seat_parts = [p for p in all_parts if SEAT_RE.search(p.name) and not SEAT_EXCLUDE_RE.search(p.name)]
if seat_parts:
    sv = np.concatenate([to_norm(p.verts) for p in seat_parts])
    sv = sv[(np.abs(sv[:, 0]) < 0.75) & (sv[:, 2] > 0.05) & (sv[:, 2] < 1.15) & (np.abs(sv[:, 1]) < 1.6)]
    if len(sv) > 50:
        # prefer the driver's (left) seat when there are two
        left = sv[sv[:, 0] > 0.1]
        if len(left) > 0.3 * len(sv):
            sv = left
        smin, smax = np.percentile(sv, 2, axis=0), np.percentile(sv, 98, axis=0)
        if 0.3 < smax[2] - smin[2] < 1.1 and 0.25 < smax[1] - smin[1] < 1.3:
            seat_box = (smin, smax)
            log("seat box", smin.round(3), smax.round(3))

if steer is not None:
    c, ax = steer["c"], steer["axis"]
    eye = c + ax * 0.5 + np.array([0, 0, 0.06])
    driver_side = "left" if c[0] > 0 else "right"
elif seat_box is not None:
    smin, smax = seat_box
    # reclined GT driver: eyes ~0.8 m above the cushion, a little ahead of the seat back
    eye = np.array([(smin[0] + smax[0]) / 2, smax[1] - 0.32 * (smax[1] - smin[1]), smin[2] + 0.8])
    driver_side = "left" if eye[0] > 0 else "right"
    log("eye from seat", eye.round(3))
else:
    # no steering wheel: put the driver on the left, at the highest roof point
    ys = np.linspace(bmin[1] * 0.3, bmax[1] * 0.3, 30)
    roofs = [roof_at(0.0, y) for y in ys]
    y_top = ys[int(np.argmax(roofs))]
    eye = np.array([0.36, y_top + 0.2, max(roofs) - 0.22])
    driver_side = "left"
eye[2] = min(eye[2], roof_at(eye[0], eye[1]) - 0.11)

# ---- refine the eye with ray casts: never inside geometry, clear view through the windshield
from mathutils.bvhtree import BVHTree

GLASS_RE = re.compile(r"glass|window|windscreen|windshield|lexan|visor|clear|(^|[_\s])net", re.I)
bpy.context.view_layer.update()
_verts, _polys, _off = [], [], 0
for ob in [body] + ([sw] if sw is not None else []):
    me = ob.data
    mw = ob.matrix_world
    mats = me.materials
    for poly in me.polygons:
        m = mats[poly.material_index] if poly.material_index < len(mats) else None
        if m is not None and GLASS_RE.search(m.name):
            continue
        _polys.append([_off + v for v in poly.vertices])
    _verts.extend([mw @ v.co for v in me.vertices])
    _off += len(me.vertices)
bvh = BVHTree.FromPolygons(_verts, _polys)
DIRS6 = [Vector(d) for d in ((1, 0, 0), (-1, 0, 0), (0, 1, 0), (0, -1, 0), (0, 0, 1), (0, 0, -1))]
def _dirs(yaws, pitches):
    out = []
    for yaw in np.radians(yaws):
        for pitch in np.radians(pitches):
            out.append(Vector((math.sin(yaw) * math.cos(pitch), -math.cos(yaw) * math.cos(pitch), math.sin(pitch))))
    return out


VIEW = _dirs(np.linspace(-30, 30, 7), (-7.0, -3.0, 1.0))  # through the windshield: should be open
DASH = _dirs(np.linspace(-20, 20, 5), (-20.0, -28.0))  # dashboard / hood: should be close below
ROOF = _dirs(np.linspace(-15, 15, 3), (35.0,))  # roof: should be just above


def eye_score(e: Vector, e0: Vector) -> float:
    inside = 0
    for d in DIRS6:
        loc, n, _, _ = bvh.ray_cast(e, d, 3.0)
        if loc is not None and n.dot(d) > 0:
            inside += 1
    if inside >= 3:
        return -1e9
    open_ = 0
    for d in VIEW:
        loc, _, _, dist = bvh.ray_cast(e, d, 8.0)
        if loc is None or dist > 1.4:
            open_ += 1
    dash = 0
    for d in DASH:
        loc, _, _, dist = bvh.ray_cast(e, d, 2.0)
        if loc is not None and 0.2 < dist < 1.8:
            dash += 1
    roof = 0
    for d in ROOF:
        loc, _, _, dist = bvh.ray_cast(e, d, 1.2)
        if loc is not None and dist > 0.1:
            roof += 1
    loc, _, _, head = bvh.ray_cast(e, Vector((0, 0, 1)), 1.5)
    head = head if loc is not None else 1.5
    head_pen = 0.0 if 0.05 < head < 0.45 else 0.6
    return open_ / len(VIEW) + 0.5 * dash / len(DASH) + 0.3 * roof / len(ROOF) - head_pen - 0.45 * (e - e0).length - 0.25 * inside


e0 = Vector((float(eye[0]), float(eye[1]), float(eye[2])))
wide = steer is None
best, best_s = e0, eye_score(e0, e0)
for dx in (-0.08, 0.0, 0.08):
    for dy in np.arange(-0.9 if wide else -0.4, (0.91 if wide else 0.41), 0.1):
        for dz in (-0.15, -0.08, 0.0, 0.06):
            e = e0 + Vector((dx, float(dy), dz))
            if steer is not None and not (float(steer["c"][1]) + 0.3 <= e.y <= float(steer["c"][1]) + 0.75):
                continue  # 0.3-0.75 m behind the steering wheel (Blender +Y is rearwards)
            sc = eye_score(e, e0)
            if sc > best_s:
                best, best_s = e, sc
log("eye search", np.array(e0).round(3), "->", np.array(best).round(3), "score %.2f" % best_s)
eye = np.array([best.x, best.y, best.z])
if "cockpitOffset" in CFG:
    # manual nudge from cars.config.json, given in game space (x left, y up, z forward)
    ox, oy, oz = CFG["cockpitOffset"]
    eye = eye + np.array([ox, -oz, oy])
    log("eye offset by config", CFG["cockpitOffset"], "->", eye.round(3))

# lights: split light-ish materials into LIGHT_HEAD_* / LIGHT_TAIL_* copies by face position
def is_emissive(m) -> bool:
    if m is None or not m.use_nodes:
        return False
    bsdf = next((n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None)
    if bsdf is None:
        return False
    inp = bsdf.inputs.get("Emission Color")
    strength = bsdf.inputs.get("Emission Strength")
    if inp is None:
        return False
    lit = inp.is_linked or max(inp.default_value[:3]) > 0.05
    return lit and (strength is None or strength.default_value > 0)


head_mats, tail_mats = set(), set()
pc = np.empty(len(body.data.polygons) * 3)
body.data.polygons.foreach_get("center", pc)
pc = pc.reshape(-1, 3)
front_zone = bmin[1] + 0.22 * (bmax[1] - bmin[1])
rear_zone = bmax[1] - 0.22 * (bmax[1] - bmin[1])
new_pm = pm.copy()
for i, n in enumerate(mat_names):
    m = body.data.materials[i]
    if not (LIGHT_RE.search(n) or is_emissive(m)) or re.search(r"interior|int_|display|dash|led_?rpm|cockpit", n, re.I):
        continue
    faces = pm == i
    for zone_mask, prefix, bucket in ((pc[:, 1] < front_zone, "LIGHT_HEAD_", head_mats),
                                      (pc[:, 1] > rear_zone, "LIGHT_TAIL_", tail_mats)):
        sel = faces & zone_mask
        if sel.sum() < 4:
            continue
        nm = m.copy()
        nm.name = prefix + n
        body.data.materials.append(nm)
        new_pm[sel] = len(body.data.materials) - 1
        bucket.add(nm.name)
body.data.polygons.foreach_set("material_index", new_pm)
body.data.update()


def g(v):  # Blender -> glTF coordinates
    return [round(float(v[0]), 4), round(float(v[2]), 4), round(float(-v[1]), 4)]


tris = sum(len(p.vertices) - 2 for ob in bpy.data.objects if ob.type == "MESH" for p in ob.data.polygons)
meta = {
    "source": IN_USD,
    "lengthM": round(float(bmax[1] - bmin[1]), 3),
    "widthM": round(float(bmax[0] - bmin[0]), 3),
    "heightM": round(float(bmax[2] - bmin[2]), 3),
    "bboxMin": g([bmin[0], bmax[1], bmin[2]]),
    "bboxMax": g([bmax[0], bmin[1], bmax[2]]),
    "wheels": {k: {"position": g(w["c"]), "radius": round(float(w["R"]), 4),
                   "width": round(float(abs(w["lat"][1] - w["lat"][0])), 4), "source": w["src"]}
               for k, w in wheel_norm.items()},
    "wheelbase": round(float(abs(wheel_norm["FL"]["c"][1] - wheel_norm["RL"]["c"][1])), 4),
    "trackFront": round(float(abs(wheel_norm["FL"]["c"][0] - wheel_norm["FR"]["c"][0])), 4),
    "trackRear": round(float(abs(wheel_norm["RL"]["c"][0] - wheel_norm["RR"]["c"][0])), 4),
    "genericWheels": generic,
    "faceCutWheels": cut_wheels,
    "steering": {"position": g(steer["c"]), "axis": g(steer["axis"]), "diameter": round(steer["diameter"], 3)} if steer else None,
    "cockpitCamera": {"position": g(eye), "driverSide": driver_side},
    "hasInterior": bool(has_interior),
    "lights": {"head": sorted(head_mats), "tail": sorted(tail_mats)},
    "triangles": int(tris),
    "log": log_lines,
}
Path(OUT_META).write_text(json.dumps(meta, indent=1))

# ------------------------------------------------- see-through glass ---
# Some sources ship opaque windows; in a cockpit-only game that would blind the driver.
WINDOW_RE = re.compile(r"glass|window|windscreen|windshield|lexan|visor", re.I)
NOT_WINDOW_RE = re.compile(r"emissive|light|lamp|led|mirror|LIGHT_", re.I)
_face_share: dict[str, int] = {}
_bpm = np.empty(len(body.data.polygons), dtype=np.int64)
body.data.polygons.foreach_get("material_index", _bpm)
for i, m in enumerate(body.data.materials):
    if m is not None:
        _face_share[m.name] = _face_share.get(m.name, 0) + int((_bpm == i).sum())
_total_faces = max(1, len(body.data.polygons))
for m in bpy.data.materials:
    if not m.use_nodes or not WINDOW_RE.search(m.name) or NOT_WINDOW_RE.search(m.name):
        continue
    if _face_share.get(m.name, 0) > 0.15 * _total_faces:
        log("not making catch-all material transparent:", m.name)
        continue
    bsdf = next((n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None)
    if bsdf is None:
        continue
    a = bsdf.inputs["Alpha"]
    if not a.is_linked and a.default_value > 0.95:
        a.default_value = 0.22
        bsdf.inputs["Roughness"].default_value = 0.05
        log("made window transparent:", m.name)
    m.blend_method = "BLEND"

# ---------------------------------------------------------------- export ---
for m in bpy.data.materials:
    if m.use_nodes:
        for n in m.node_tree.nodes:
            if n.type == "TEX_IMAGE" and n.image is not None:
                n.image.pack() if n.image.packed_file is None and n.image.filepath else None
bpy.ops.object.select_all(action="SELECT")
bpy.ops.export_scene.gltf(
    filepath=OUT_GLB,
    export_format="GLB",
    export_yup=True,
    export_apply=True,
    export_image_format="AUTO",
    export_cameras=False,
    export_lights=False,
    export_extras=False,
    export_animations=False,
)
log("exported", OUT_GLB, "tris", tris)

# ------------------------------------------------------------- thumbnail ---
if THUMB:
    scn = bpy.context.scene
    scn.render.engine = "CYCLES"
    scn.cycles.device = "CPU"
    scn.cycles.samples = 24
    scn.cycles.use_denoising = True
    scn.render.resolution_x = 640
    scn.render.resolution_y = 360
    scn.render.film_transparent = True
    scn.render.image_settings.file_format = "PNG"
    scn.render.image_settings.color_mode = "RGBA"
    scn.view_settings.view_transform = "AgX"
    world = bpy.data.worlds.new("w")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.55, 0.6, 0.68, 1)
    world.node_tree.nodes["Background"].inputs["Strength"].default_value = 1.2
    scn.world = world
    sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN"))
    sun.data.energy = 4
    sun.rotation_euler = (math.radians(50), math.radians(10), math.radians(-35))
    scn.collection.objects.link(sun)
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    cam.data.lens = 50
    scn.collection.objects.link(cam)
    # three-quarter front view (front = -Y)
    cam.location = Vector((4.6, -5.6, 1.9))
    direction = Vector((0, 0, 0.45)) - cam.location
    cam.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
    scn.camera = cam
    scn.render.filepath = THUMB
    bpy.ops.render.render(write_still=True)
    log("thumbnail", THUMB)

    # what the driver sees: verifies the cockpit camera anchor
    ccam = bpy.data.objects.new("cockpit_cam", bpy.data.cameras.new("cockpit_cam"))
    ccam.data.sensor_fit = "HORIZONTAL"
    ccam.data.angle = math.radians(72)
    ccam.data.clip_start = 0.03
    scn.collection.objects.link(ccam)
    ccam.location = Vector((float(eye[0]), float(eye[1]), float(eye[2])))
    ccam.rotation_euler = (math.radians(86), 0, math.pi)
    scn.camera = ccam
    scn.render.film_transparent = False
    scn.cycles.samples = 12
    scn.render.filepath = THUMB.replace(".png", "_cockpit.png")
    bpy.ops.render.render(write_still=True)
    scn.camera = cam
    scn.render.film_transparent = True
    Path(OUT_META).write_text(json.dumps(meta | {"log": log_lines}, indent=1))

    # ---- debug render: wheels red, calipers blue, steering wheel green, eye = yellow ball
    def flat(name, rgb):
        m = bpy.data.materials.new(name)
        m.use_nodes = True
        b = m.node_tree.nodes["Principled BSDF"]
        b.inputs["Base Color"].default_value = (*rgb, 1)
        b.inputs["Emission Color"].default_value = (*rgb, 1)
        b.inputs["Emission Strength"].default_value = 2.0
        return m

    def paint(ob, m):
        if ob is None:
            return
        ob.data.materials.clear()
        ob.data.materials.append(m)

    red, blue, green, yellow = flat("dbg_r", (1, 0, 0)), flat("dbg_b", (0, 0.2, 1)), flat("dbg_g", (0, 1, 0)), flat("dbg_y", (1, 1, 0))
    for k in KEYS:
        paint(spin[k], red)
        paint(cal[k], blue)
    paint(sw, green)
    bpy.ops.mesh.primitive_uv_sphere_add(radius=0.07, location=Vector((eye[0], eye[1], eye[2])))
    paint(bpy.context.active_object, yellow)
    body.hide_render = False
    # side view from the left, plus a top-down cut-away so the cabin is visible
    cam.location = Vector((7.5, 0, 0.8))
    cam.rotation_euler = (Vector((0, 0, 0.6)) - cam.location).to_track_quat("-Z", "Y").to_euler()
    scn.cycles.samples = 8
    scn.render.filepath = THUMB.replace(".png", "_debug_side.png")
    bpy.ops.render.render(write_still=True)
    for m in body.data.materials:
        if m is not None:
            m.blend_method = "BLEND"
    body.hide_render = True
    cam.location = Vector((0.01, 0.01, 8))
    cam.rotation_euler = (0, 0, 0)
    scn.render.filepath = THUMB.replace(".png", "_debug_top.png")
    bpy.ops.render.render(write_still=True)

