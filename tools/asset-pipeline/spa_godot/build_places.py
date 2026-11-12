#!/usr/bin/env python3
"""Where things stand around the Godot app's Spa, read off the reference video: spectators on the banks and along the
fences (the grandstands' seats are found in the game, SpaCrowd) and the props build_props.py models (SpaProps).

   python3 -I tools/asset-pipeline/spa_godot/build_places.py <sprites dir> godot/assets/maps/spa_g

<sprites dir>: render_people.py's output (PEOPLE below picks the figures, ANGLES the views). Writes crowd_atlas.png
(one column per figure, one row per view, 128 x 256 px a cell showing 1.15 x 2.3 m, feet on the bottom edge) and
crowd_zones.bin (float32 x, y, z, yaw to the track, per person: on the model's ground, not on roads, walls or fences) and
props_places.json ([prop, x, y, z, yaw] each: yaw turns the prop's printed face, glTF +Z, to the given heading)."""
import json, math, os, struct, sys
import numpy as np
from PIL import Image

PEOPLE = ['0', '1', '2', 'mob/0-0', 'mob/0-4', 'mob/0-5', 'mob/0-6', 'mob/0-7', 'mob/0-8', 'mob/0-9']
ANGLES = (0, 35, -35)
CW, CH = 128, 256

# [lap m from, to, side (+1 right of the direction of travel, -1 left), metres from the centreline from, to, people a
# square metre where the groups are, frame] from the video
ZONES = [
    [1640, 2000, -1, 16, 30, 0.07, 'f017-f019: Kemmel, groups up the left bank'],
    [2560, 2630, -1, 12, 22, 0.15, 'f025: Les Combes exit, left'],
    [3690, 3800, 1, 14, 26, 0.12, 'f037: Pouhon, the hill on the right'],
    [4440, 4620, -1, 10, 17, 0.20, 'f043-f044: Fagnes, along the fence on the left'],
    [4840, 4990, -1, 10, 20, 0.15, 'f047: Campus, the left bank'],
]
# open terraces where the video has them packed (the model has a bare bank): [lap m from, to, side, first row's distance
# from the centreline (m), rows, row depth, row rise, frame]
TERRACES = [
    [560, 880, -1, 13.0, 14, 0.8, 0.42, 'f008-f011: the hill after La Source, terraces full of spectators'],
]
# advertising boards where the video has them (the model's are blank or missing): [lap m from, to, side, metres from the
# centreline, height of the bottom edge, height (m), art row (build_prop_textures.py boards.png), frame]
BOARDS = [
    [1150, 1235, -1, 11.5, 0.4, 1.0, 1, 'T3 Raidillon: Laune boards on the left wall'],
    [1235, 1290, -1, 11.5, 0.4, 1.0, 2, 'T3 Raidillon: Classic 21'],
    [1160, 1290, -1, 15.0, 2.4, 1.4, 3, 'T3 Raidillon: Circuit de Spa boards higher on the bank'],
    [1180, 1330, 1, 12.0, 1.6, 1.3, 0, 'T3-T4: TotalEnergies boards behind the right-hand rail'],
    [2360, 2420, -1, 18.0, 0.8, 1.6, 4, 'f022: Fanatec boards braking for Les Combes'],
    [2950, 3020, -1, 16.0, 0.8, 1.6, 4, 'f029: Fanatec boards at Bruxelles'],
]

# people a running metre of terrace row, and the share of places taken
TERRACE_SEAT = 0.62
TERRACE_FULL = 0.85

GROUND_RE = ('grass', 'top2', 'sand_spa_dirt', 'gravel', 'astroturf', 'asph', 'pavement')
# the crowd stands on these only
CROWD_GROUND = ('grass', 'top2', 'sand_spa_dirt')
# what keeps spectators off the track: every one stands behind all of these between him and the centreline (the user's
# rule: fans behind the fences)
BARRIER_RE = ('fence', 'grail', 'wall_spa', 'grille')
# a spectator this far behind the outermost barrier at least (m), and barriers looked for this far out
BEHIND = 1.2
BARRIER_REACH = 35.0

# [prop, where, turn (deg from the direction of travel: 180 faces the cars coming; None: faces the video's camera), frame]
# where: [lap m, metres right of the centreline (- left)], or ['view', lap m of the video frame, degrees right of the
# view's centre, metres away] for what the video shows off the track: the angle from the object's pixel column with the
# matched camera's focal length (1738 px at 2560 x 1440, 45 deg vertical field), the distance from its known size; the
# camera 8.5 m behind the car, looking along the track
PROPS = [
    ['balloon', ['view', 410, -28.9, 47], None, 'f006: La Source, left at the hairpin exit (16 m envelope, 586 px)'],
    ['tv_crane', ['view', 368, 31.6, 58], None, 'f005: La Source, right beyond the tyre wall (tip 16 m up, 13.5 deg)'],
    ['podium_board', ['view', 368, -11.3, 39], None, 'f005: La Source, right of the white house (6 m board, 267 px)'],
    ['podium_board', ['view', 2369, -7.9, 78], None, 'f022: braking for Les Combes (133 px)'],
    ['tv_crane', ['view', 2512, -23.3, 120], None, 'f024: Les Combes, far left'],
    ['tv_crane', ['view', 2773, 14.6, 110], None, 'f027: towards Bruxelles, right'],
    ['podium_board', ['view', 2982, -13.8, 43], None, 'f029: Bruxelles (240 px)'],
    ['tv_crane', ['view', 2982, -18.5, 65], None, 'f029: Bruxelles, left of the board'],
    ['tv_crane', ['view', 4087, 19.4, 200], None, 'f040: after Pouhon, far right'],
    ['podium_board', ['view', 4582, 7.0, 56], None, 'f044: Fagnes (187 px)'],
    ['tv_crane', ['view', 4936, 17.8, 65], None, 'f048: Campus, right of the gantry'],
    ['tv_crane', ['view', 6442, 19.6, 150], None, 'f062: towards the chicane, right'],
    ['footbridge', [6574, 0], 180, 'f063: over the track before the chicane (overhead in the frame)'],
] + [['bollard', [s, 5.8], 180, 'f007-f009: on the pit exit line'] for s in range(470, 730, 12)] \
  + [['feather_flag', [s, 16.5], 270, 'f008: on the right, behind the green pit-exit wall'] for s in range(480, 720, 8)] \
  + [['marquee', [s, 42 + 6 * (k % 2)], 180, 'f043: Fagnes, tents on the right'] for k, s in enumerate(range(4500, 4560, 7))] \
  + [['marquee', [s, -40 - 6 * (k % 2)], 180, 'f052-f053: Blanchimont approach, tents on the left'] for k, s in enumerate(range(5330, 5400, 7))]


def glb_prims(path):
    b = open(path, 'rb').read()
    n = struct.unpack('<I', b[12:16])[0]
    j = json.loads(b[20:20 + n])
    bin0 = 20 + n + 8

    def acc(i):
        a = j['accessors'][i]
        v = j['bufferViews'][a['bufferView']]
        dt = {5126: np.float32, 5125: np.uint32, 5123: np.uint16}[a['componentType']]
        k = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3}[a['type']]
        x = np.frombuffer(b, dt, a['count'] * k, bin0 + v.get('byteOffset', 0) + a.get('byteOffset', 0))
        return x.reshape(-1, k) if k > 1 else x

    for m in j['meshes']:
        for p in m['primitives']:
            yield j['materials'][p['material']]['name'], acc(p['attributes']['POSITION']).astype(np.float64), acc(p['indices']).reshape(-1, 3)


def atlas(src, out):
    img = Image.new('RGBA', (CW * len(PEOPLE), CH * len(ANGLES)), (0, 0, 0, 0))
    for c, p in enumerate(PEOPLE):
        for r, a in enumerate(ANGLES):
            img.paste(Image.open(os.path.join(src, f'{p}_{a}.png')).convert('RGBA').resize((CW, CH), Image.LANCZOS), (c * CW, r * CH))
    # spread the figures' colours into the transparent texels (no dark fringe once mipmapped)
    a = np.asarray(img).astype(np.float32)
    rgb, al = a[..., :3].copy(), a[..., 3] > 8
    filled = al.copy()
    for _ in range(12):
        acc = np.zeros_like(rgb)
        cnt = np.zeros(al.shape, np.float32)
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            m = np.roll(filled, (dy, dx), (0, 1))
            acc += np.roll(rgb, (dy, dx), (0, 1)) * m[..., None]
            cnt += m
        grow = ~filled & (cnt > 0)
        rgb[grow] = acc[grow] / cnt[grow, None]
        filled |= grow
    a[..., :3] = rgb
    Image.fromarray(a.clip(0, 255).astype(np.uint8), 'RGBA').save(os.path.join(out, 'crowd_atlas.png'), optimize=True)


def ground(T, x, z, level):
    """The highest ground triangle's height at (x, z) (a vertical ray); level: only where one could stand."""
    lo, hi = T.min(1), T.max(1)
    cand = np.nonzero((lo[:, 0] <= x) & (hi[:, 0] >= x) & (lo[:, 2] <= z) & (hi[:, 2] >= z))[0]
    best = None
    for k in cand:
        a, b, c = T[k]
        d = (b[2] - c[2]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[2] - c[2])
        if abs(d) < 1e-9:
            continue
        w0 = ((b[2] - c[2]) * (x - c[0]) + (c[0] - b[0]) * (z - c[2])) / d
        w1 = ((c[2] - a[2]) * (x - c[0]) + (a[0] - c[0]) * (z - c[2])) / d
        w2 = 1 - w0 - w1
        if min(w0, w1, w2) < -1e-6:
            continue
        n = np.cross(b - a, c - a)
        if level and abs(n[1]) / max(np.linalg.norm(n), 1e-9) < 0.75:
            continue
        y = w0 * a[1] + w1 * b[1] + w2 * c[1]
        best = y if best is None else max(best, y)
    return best


def frame(cl, cum, s):
    i = min(np.searchsorted(cum, s % cum[-1]), len(cl) - 2)
    f = cl[i + 1] - cl[i]
    f = f / max(np.hypot(f[0], f[2]), 1e-6)
    return cl[i], f, np.array([-f[2], 0.0, f[0]])


def props(out, cl, cum, T):
    rows = []
    for name, where, turn, _ in PROPS:
        if where[0] == 'view':
            c, f, r = frame(cl, cum, where[1])
            cam = c - f * 8.5
            a = math.radians(where[2])
            p = cam + (f * math.cos(a) + r * math.sin(a)) * where[3]
        else:
            c, f, r = frame(cl, cum, where[0])
            p = c + r * where[1]
            cam = None
        y = ground(T, p[0], p[2], False)
        if turn is None:
            yaw = math.atan2(cam[0] - p[0], cam[2] - p[2])
        else:
            yaw = math.atan2(f[0], f[2]) + math.radians(turn)
        rows.append([name, float(p[0]), float(c[1] if y is None else y), float(p[2]), yaw])
    json.dump(rows, open(os.path.join(out, 'props_places.json'), 'w'))
    print(f'[places] {len(rows)} props')


def terraces(out, cl, cum, T):
    """Stepped concrete terraces along the lap (TERRACES): treads and risers from a front wall at the first row to a back
    wall down to the ground, every 2 m of lap; written to terraces.json (positions, normals, indices; SpaProps draws
    them). Returns the spectators on their rows (x, y, z, yaw)."""
    P, N, I, people = [], [], [], []
    rng = np.random.default_rng(11)

    def quad(a, b, c, d, n):
        k = len(P)
        P.extend([a, b, c, d])
        N.extend([n] * 4)
        I.extend([k, k + 1, k + 2, k, k + 2, k + 3])

    for s0, s1, side, d0, rows, dep, rise, _ in TERRACES:
        ss = np.arange(s0, s1 + 0.1, 2.0)
        frames = [frame(cl, cum, s) for s in ss]
        # the stand's front at the ground in front of it, half a metre up
        g = [ground(T, *(c + r * side * d0)[[0, 2]], False) for c, f, r in frames]
        g = np.array([v if v is not None else c[1] for v, (c, f, r) in zip(g, frames)])
        h0 = np.convolve(g, np.ones(9) / 9, mode='same') + 0.5
        h0[:4] = h0[4]
        h0[-4:] = h0[-5]
        for j in range(len(ss) - 1):
            (ca, fa, ra), (cb, fb, rb) = frames[j], frames[j + 1]

            def pt(c, r, d, h):
                q = c + r * side * d
                return [float(q[0]), float(h), float(q[2])]

            out_n = (ra * -side).tolist()
            # front wall from the ground up to the first tread
            quad(pt(ca, ra, d0, h0[j] - 1.2), pt(cb, rb, d0, h0[j + 1] - 1.2), pt(cb, rb, d0, h0[j + 1]), pt(ca, ra, d0, h0[j]), out_n)
            for k in range(rows):
                d, hA, hB = d0 + k * dep, h0[j] + k * rise, h0[j + 1] + k * rise
                # tread, then the riser up to the next row
                quad(pt(ca, ra, d, hA), pt(cb, rb, d, hB), pt(cb, rb, d + dep, hB), pt(ca, ra, d + dep, hA), [0.0, 1.0, 0.0])
                if k + 1 < rows:
                    quad(pt(ca, ra, d + dep, hA), pt(cb, rb, d + dep, hB), pt(cb, rb, d + dep, hB + rise), pt(ca, ra, d + dep, hA + rise), out_n)
                # spectators along the row
                for u in np.arange(0.0, 2.0, 1.0 / TERRACE_SEAT * 0.62):
                    if rng.random() > TERRACE_FULL:
                        continue
                    t = u / 2.0
                    c = ca + (cb - ca) * t
                    r = ra + (rb - ra) * t
                    q = c + r * side * (d + dep * (0.35 + 0.3 * rng.random()))
                    people.append((float(q[0]), float(hA + (hB - hA) * t), float(q[2]), float(np.arctan2(c[0] - q[0], c[2] - q[2]))))
            # back wall from the top row down below the ground
            dB, hA, hB = d0 + rows * dep, h0[j] + (rows - 1) * rise, h0[j + 1] + (rows - 1) * rise
            quad(pt(ca, ra, dB, hA), pt(cb, rb, dB, hB), pt(cb, rb, dB, hB - 6.0), pt(ca, ra, dB, hA - 6.0), (ra * side).tolist())
    json.dump({'positions': [v for p_ in P for v in p_], 'normals': [v for n_ in N for v in n_], 'indices': I}, open(os.path.join(out, 'terraces.json'), 'w'))
    print(f'[places] terraces: {len(I) // 3} triangles, {len(people)} spectators')
    return people


def boards(out, cl, cum):
    """BOARDS as strips of quads every 2 m, standing on the centreline's side, facing it: boards.json (positions, normals,
    uvs, indices; SpaProps draws them with boards.png, u along the run every 8 m, v the art row)."""
    P, N, U, I = [], [], [], []
    rows = 5
    for s0, s1, side, dist, z0, hgt, row, _ in BOARDS:
        ss = np.arange(s0, s1 + 0.1, 2.0)
        for a, b in zip(ss[:-1], ss[1:]):
            (ca, fa, ra), (cb, fb, rb) = frame(cl, cum, a), frame(cl, cum, b)
            pa, pb = ca + ra * side * dist, cb + rb * side * dist
            n = (-(ra + rb) / 2 * side).tolist()
            ua, ub = (a - s0) / 8.0, (b - s0) / 8.0
            v0, v1 = (row + 1) / rows, row / rows
            k = len(P)
            P.extend([[pa[0], pa[1] + z0, pa[2]], [pb[0], pb[1] + z0, pb[2]], [pb[0], pb[1] + z0 + hgt, pb[2]], [pa[0], pa[1] + z0 + hgt, pa[2]]])
            N.extend([n] * 4)
            # read left to right from the track (u along the lap reads mirrored on the right-hand side's... both checked
            # in the game: the right-hand runs need u reversed)
            if side > 0:
                ua, ub = -ua, -ub
            U.extend([[ua, v0], [ub, v0], [ub, v1], [ua, v1]])
            I.extend([k, k + 1, k + 2, k, k + 2, k + 3])
    flat = lambda a: [float(v) for p_ in a for v in p_]
    json.dump({'positions': flat(P), 'normals': flat(N), 'uvs': flat(U), 'indices': I}, open(os.path.join(out, 'boards.json'), 'w'))
    print(f'[places] boards: {len(I) // 6} panels')


def zones(out):
    godot = os.path.normpath(os.path.join(out, '..', '..', '..'))
    t = json.load(open(os.path.join(godot, 'data/tracks/spa.json')))
    cl = np.array(t['centerline'], float).reshape(-1, 3)
    cum = np.array(t['cumS'], float)
    tris = []
    for f in ('map_terrain.glb', 'map_track.glb'):
        for name, P, I in glb_prims(os.path.join(out, f)):
            if name.startswith(GROUND_RE):
                tris.append((name, P[I]))
    props(out, cl, cum, np.concatenate([t for _, t in tris]))
    T = np.concatenate([t for n, t in tris if n.startswith(CROWD_GROUND)])
    terrace_people = terraces(out, cl, cum, np.concatenate([t for _, t in tris]))
    boards(out, cl, cum)
    # the barriers as segments seen from above (their triangles stand upright: each one's longest edge in x, z)
    seg = []
    for f in ('map_track.glb', 'map_scenery.glb'):
        for name, P, I in glb_prims(os.path.join(out, f)):
            if name.startswith(BARRIER_RE):
                tr = P[I]
                e = [(tr[:, a][:, [0, 2]], tr[:, b][:, [0, 2]]) for a, b in ((0, 1), (1, 2), (2, 0))]
                ln = np.stack([np.linalg.norm(q - p, axis=1) for p, q in e], 1)
                k = ln.argmax(1)
                pa = np.choose(k[:, None], [e[0][0], e[1][0], e[2][0]])
                pb = np.choose(k[:, None], [e[0][1], e[1][1], e[2][1]])
                tall = (tr[:, :, 1].max(1) - tr[:, :, 1].min(1)) > 0.3
                seg.append(np.concatenate([pa, pb], 1)[tall & (ln.max(1) > 0.05)])
    seg = np.unique(np.round(np.concatenate(seg), 2), axis=0)
    cell = 20.0
    grid = {}
    for i, (ax, az, bx, bz) in enumerate(seg):
        for gx in range(int(np.floor(min(ax, bx) / cell)), int(np.floor(max(ax, bx) / cell)) + 1):
            for gz in range(int(np.floor(min(az, bz) / cell)), int(np.floor(max(az, bz) / cell)) + 1):
                grid.setdefault((gx, gz), []).append(i)

    def crossings(c, d):
        # distances along the ray c + d * t (t in 0..BARRIER_REACH, x z) where it crosses a barrier
        ids = set()
        for t in np.arange(0, BARRIER_REACH + cell, cell / 2):
            q = c + d * t
            for gx in (-1, 0, 1):
                for gz in (-1, 0, 1):
                    ids.update(grid.get((int(np.floor(q[0] / cell)) + gx, int(np.floor(q[1] / cell)) + gz), ()))
        if not ids:
            return []
        S = seg[list(ids)]
        a, b = S[:, :2], S[:, 2:]
        e = b - a
        den = d[0] * e[:, 1] - d[1] * e[:, 0]
        ok = np.abs(den) > 1e-9
        w = a - c
        t = np.where(ok, (w[:, 0] * e[:, 1] - w[:, 1] * e[:, 0]) / np.where(ok, den, 1), -1)
        u = np.where(ok, (w[:, 0] * d[1] - w[:, 1] * d[0]) / np.where(ok, den, 1), -1)
        hit = ok & (t > 2.0) & (t < BARRIER_REACH) & (u >= 0) & (u <= 1)
        return sorted(t[hit].tolist())
    rng = np.random.default_rng(7)
    people = []
    for s0, s1, side, d0, d1, dens, _ in ZONES:
        # candidate spots on a 0.9 m lattice across the band, kept where a smooth noise says "a group stands here"
        for s in np.arange(s0, s1, 0.9):
            i = min(np.searchsorted(cum, s), len(cl) - 2)
            f = cl[i + 1] - cl[i]
            f = f / max(np.hypot(f[0], f[2]), 1e-6)
            right = np.array([-f[2], 0.0, f[0]])
            for d in np.arange(d0, d1, 0.9):
                g = 0.5 + 0.5 * np.sin(s * 0.045 + d * 0.3) * np.sin(s * 0.11 + 1.7)
                if rng.random() > dens * 0.81 * 2.0 * g:
                    continue
                dd = d + rng.uniform(-0.4, 0.4)
                ray = np.array([right[0], right[2]]) * side
                hits = crossings(np.array([cl[i][0], cl[i][2]]), ray)
                if not hits:
                    continue
                # behind the outermost barrier: one short of it steps back past it, keeping its place in the band
                if dd < hits[-1] + BEHIND:
                    dd = hits[-1] + BEHIND + (dd - d0) * 0.5
                p = cl[i] + right * side * dd + f * rng.uniform(-0.4, 0.4)
                people.append((p[0], p[2], np.arctan2(cl[i][0] - p[0], cl[i][2] - p[2])))
    people = np.array(people)
    out_rows = []
    for x, z, yaw in people:
        y = ground(T, x, z, True)
        if y is not None:
            out_rows.append((x, y, z, yaw))
    out_rows += terrace_people
    arr = np.array(out_rows, np.float32)
    arr.tofile(os.path.join(out, 'crowd_zones.bin'))
    print(f'[places] {len(arr)} people on the banks ({len(people)} spots tried)')


src, out = sys.argv[1], sys.argv[2]
atlas(src, out)
zones(out)
