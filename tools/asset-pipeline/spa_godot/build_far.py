#!/usr/bin/env python3
"""The Ardennes around Spa, which the source model lacks (its terrain stops 1.5-3.5 km out, then a flat horizon): a ring
of real terrain from the model's edge out to 9.5 km, for the Godot app's Spa.

   python3 -I tools/asset-pipeline/spa_godot/build_far.py <sources dir> godot/assets/maps/spa_g [<track.json>]

Any circuit (2026-11-18: the Nürburgring GP too: <sources dir> ~/apex-ghost-sources/terrain-nurburgring, out
godot/assets/track, track godot/data/track.json; its geofit from tools/asset-pipeline/far/geofit.py). The tiles are the
ones the ring and the cover reach (1 x 1 degree Copernicus, 3 x 3 degree WorldCover, named by their south-west corner).

<sources dir> holds (downloads, never committed):
  geofit.json   the game frame on the map (east, north = s * R @ (x, mirror * z) + t, metres about lat0 / lon0): the
                centreline fitted to OpenStreetMap's raceway (~2 m mean residual)
  dl/Copernicus_DSM_COG_10_N50_00_E00{5,6}_00_DEM.tif   Copernicus GLO-30 surface model (30 m; forest canopy included)
  dl/ESA_WorldCover_10m_2021_v200_N48E00{3,6}_Map.tif   ESA WorldCover 2021 land cover (10 m)

Writes far_terrain.glb (meshes "far_hi" and "far_lo": radial grids about the circuit, cells square, 35 m across at 2 km
and 150 m at 9 km on hi, 3x coarser on lo; triangles under the model's terrain dropped, the ring's inner edge on the
model's own heights and the real heights blended in over 500 m, so no step where they meet; UV = far_cover.png) and
far_cover.png (land cover around the circuit, 20 km square, ~10 m a texel: R tree cover, G grass and shrub, B crops,
A built-up, bare and water, as fractions; the shader colours them)."""
import json, os, struct, sys
import numpy as np
from PIL import Image

Image.MAX_IMAGE_PIXELS = None
R_E = 6378137.0
R0, R1 = 250.0, 9500.0
BLEND = 500.0
COVER_HALF = 10000.0
COVER_PX = 2048


class Geo:
    def __init__(self, fit):
        f = json.load(open(fit))
        self.lat0, self.lon0, self.m = f['lat0'], f['lon0'], f['mirror_z']
        self.s, self.R, self.t = f.get('s', 1.0), np.array(f['R']), np.array(f['t'])

    def latlon(self, x, z):
        p = self.s * (np.stack([x, self.m * z], -1) @ self.R.T) + self.t
        return self.lat0 + np.degrees(p[..., 1] / R_E), self.lon0 + np.degrees(p[..., 0] / (R_E * np.cos(np.radians(self.lat0))))


class Raster:
    """Lat / lon tiles [(path, lat of the top edge, lon of the left edge, dlat, dlon)], cropped to box on load."""

    def __init__(self, tiles, box, nearest=False):
        self.parts, self.nearest = [], nearest
        la0, la1, lo0, lo1 = box
        for path, top, left, dla, dlo in tiles:
            im = Image.open(path)
            W, H = im.size
            r0, r1 = max(0, int((top - la1) / dla) - 2), min(H, int((top - la0) / dla) + 3)
            c0, c1 = max(0, int((lo0 - left) / dlo) - 2), min(W, int((lo1 - left) / dlo) + 3)
            if r1 > r0 and c1 > c0:
                self.parts.append((np.asarray(im.crop((c0, r0, c1, r1))), top - r0 * dla, left + c0 * dlo, dla, dlo))

    def sample(self, lat, lon):
        out = np.full(lat.shape, np.nan, np.float32)
        for a, top, left, dla, dlo in self.parts:
            r, c = (top - lat) / dla - 0.5, (lon - left) / dlo - 0.5
            ok = (r >= 0) & (c >= 0) & (r < a.shape[0] - 1) & (c < a.shape[1] - 1)
            if self.nearest:
                out[ok] = a[np.round(r[ok]).astype(int), np.round(c[ok]).astype(int)]
                continue
            r0, c0 = np.floor(r[ok]).astype(int), np.floor(c[ok]).astype(int)
            fr, fc = r[ok] - r0, c[ok] - c0
            out[ok] = a[r0, c0] * (1 - fr) * (1 - fc) + a[r0 + 1, c0] * fr * (1 - fc) + a[r0, c0 + 1] * (1 - fr) * fc + a[r0 + 1, c0 + 1] * fr * fc
        return out


def glb_read(path):
    b = open(path, 'rb').read()
    n = struct.unpack('<I', b[12:16])[0]
    j = json.loads(b[20:20 + n])
    bin0 = 20 + n + 8

    def acc(i):
        a = j['accessors'][i]
        v = j['bufferViews'][a['bufferView']]
        dt = {5126: np.float32, 5125: np.uint32, 5123: np.uint16, 5121: np.uint8}[a['componentType']]
        k = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}[a['type']]
        off, st, sz = bin0 + v.get('byteOffset', 0) + a.get('byteOffset', 0), v.get('byteStride', 0), np.dtype(dt).itemsize
        if st and st != k * sz:
            raw = np.frombuffer(b, np.uint8, a['count'] * st, off).reshape(-1, st)[:, :k * sz]
            return np.frombuffer(raw.tobytes(), dt).reshape(-1, k)
        x = np.frombuffer(b, dt, a['count'] * k, off)
        return x.reshape(-1, k) if k > 1 else x

    # each mesh where its nodes put it (translation, rotation, scale or a matrix, down the node tree): the Nürburgring
    # model's meshes are stored in unit size, their nodes scale them up (Spa's nodes carry none)
    def local(nd):
        if 'matrix' in nd:
            return np.array(nd['matrix'], float).reshape(4, 4).T
        t = np.array(nd.get('translation', [0, 0, 0]), float)
        x, y, z, w = nd.get('rotation', [0, 0, 0, 1])
        r = np.array([[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
                      [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
                      [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]])
        sc = np.array(nd.get('scale', [1, 1, 1]), float)
        M = np.eye(4)
        M[:3, :3] = r * sc
        M[:3, 3] = t
        return M

    P, T, base = [], [], 0
    stack = [(i, np.eye(4)) for i in j['scenes'][j.get('scene', 0)]['nodes']]
    while stack:
        i, parent = stack.pop()
        nd = j['nodes'][i]
        M = parent @ local(nd)
        for c in nd.get('children', []):
            stack.append((c, M))
        if 'mesh' not in nd:
            continue
        for p in j['meshes'][nd['mesh']]['primitives']:
            pos = acc(p['attributes']['POSITION']).astype(np.float64)
            pos = pos @ M[:3, :3].T + M[:3, 3]
            idx = acc(p['indices']).reshape(-1, 3) if 'indices' in p else np.arange(len(pos)).reshape(-1, 3)
            P.append(pos)
            T.append(idx.astype(np.int64) + base)
            base += len(pos)
    return np.concatenate(P).astype(np.float64), np.concatenate(T)


def glb_write(path, meshes):
    """meshes: [(name, positions, normals, uvs, indices)] -> one node per mesh, no materials (the game sets them)."""
    blob, views, accs, gm, nodes = bytearray(), [], [], [], []

    def add(arr, target, comp, typ, minmax=False):
        while len(blob) % 4:
            blob.append(0)
        views.append({'buffer': 0, 'byteOffset': len(blob), 'byteLength': arr.nbytes, 'target': target})
        blob.extend(arr.tobytes())
        a = {'bufferView': len(views) - 1, 'componentType': comp, 'count': len(arr), 'type': typ}
        if minmax:
            a['min'], a['max'] = arr.min(0).tolist(), arr.max(0).tolist()
        accs.append(a)
        return len(accs) - 1

    for name, p, n, uv, idx in meshes:
        attrs = {'POSITION': add(p.astype(np.float32), 34962, 5126, 'VEC3', True), 'NORMAL': add(n.astype(np.float32), 34962, 5126, 'VEC3'),
                 'TEXCOORD_0': add(uv.astype(np.float32), 34962, 5126, 'VEC2')}
        gm.append({'name': name, 'primitives': [{'attributes': attrs, 'indices': add(idx.astype(np.uint32).reshape(-1), 34963, 5125, 'SCALAR')}]})
        nodes.append({'name': name, 'mesh': len(gm) - 1})
    while len(blob) % 4:
        blob.append(0)
    j = {'asset': {'version': '2.0', 'generator': 'apex-ghost build_far.py'}, 'scene': 0, 'scenes': [{'nodes': list(range(len(nodes)))}], 'nodes': nodes,
         'meshes': gm, 'accessors': accs, 'bufferViews': views, 'buffers': [{'byteLength': len(blob)}]}
    js = json.dumps(j, separators=(',', ':')).encode()
    js += b' ' * ((4 - len(js) % 4) % 4)
    with open(path, 'wb') as f:
        f.write(struct.pack('<III', 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(blob)))
        f.write(struct.pack('<II', len(js), 0x4E4F534A) + js)
        f.write(struct.pack('<II', len(blob), 0x004E4942) + bytes(blob))


def rasterize(P, T, x0, z0, cell, n):
    """The model terrain's height on a grid (nan outside it)."""
    H = np.full((n, n), np.nan)
    for t in T:
        a, b, c = P[t[0]], P[t[1]], P[t[2]]
        lo = np.floor((np.minimum(np.minimum(a, b), c)[[0, 2]] - [x0, z0]) / cell).astype(int)
        hi = np.ceil((np.maximum(np.maximum(a, b), c)[[0, 2]] - [x0, z0]) / cell).astype(int)
        lo, hi = np.clip(lo, 0, n - 1), np.clip(hi, 0, n - 1)
        if (hi < lo).any():
            continue
        gx, gz = np.meshgrid(np.arange(lo[0], hi[0] + 1), np.arange(lo[1], hi[1] + 1), indexing='ij')
        px, pz = x0 + gx * cell, z0 + gz * cell
        d = (b[2] - c[2]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[2] - c[2])
        if abs(d) < 1e-9:
            continue
        w0 = ((b[2] - c[2]) * (px - c[0]) + (c[0] - b[0]) * (pz - c[2])) / d
        w1 = ((c[2] - a[2]) * (px - c[0]) + (a[0] - c[0]) * (pz - c[2])) / d
        w2 = 1 - w0 - w1
        inside = (w0 >= -1e-6) & (w1 >= -1e-6) & (w2 >= -1e-6)
        H[gx[inside], gz[inside]] = (w0 * a[1] + w1 * b[1] + w2 * c[1])[inside]
    return H


def grid_sample(H, x0, z0, cell, x, z):
    """Nearest sample of a raster grid at points (nan outside)."""
    n = H.shape[0]
    i, k = np.round((x - x0) / cell).astype(int), np.round((z - z0) / cell).astype(int)
    ok = (i >= 0) & (k >= 0) & (i < n) & (k < n)
    out = np.full(x.shape, np.nan)
    out[ok] = H[i[ok], k[ok]]
    return out


def ring(cx, cz, segs):
    """A radial grid about (cx, cz): segs around, rings spaced so the cells stay square."""
    da = 2 * np.pi / segs
    radii = [R0]
    while radii[-1] < R1:
        radii.append(radii[-1] * (1 + da))
    radii = np.array(radii)
    a = np.arange(segs) * da
    rr, aa = np.meshgrid(radii, a, indexing='ij')
    x, z = cx + rr * np.cos(aa), cz + rr * np.sin(aa)
    nr = len(radii)
    q = []
    for i in range(nr - 1):
        for k in range(segs):
            k2 = (k + 1) % segs
            v00, v01, v10, v11 = i * segs + k, i * segs + k2, (i + 1) * segs + k, (i + 1) * segs + k2
            q.append((v00, v10, v11))
            q.append((v00, v11, v01))
    return x.reshape(-1), z.reshape(-1), np.array(q, np.int64)


def normals(p, tri):
    n = np.zeros_like(p)
    fn = np.cross(p[tri[:, 1]] - p[tri[:, 0]], p[tri[:, 2]] - p[tri[:, 0]])
    for c in range(3):
        np.add.at(n, tri[:, c], fn)
    n /= np.maximum(np.linalg.norm(n, axis=1, keepdims=True), 1e-9)
    n[n[:, 1] < 0] *= -1
    return n


def main():
    src, out = sys.argv[1], sys.argv[2]
    repo_godot = os.path.normpath(os.path.join(out, '..', '..', '..'))
    track_json = sys.argv[3] if len(sys.argv) > 3 else os.path.join(repo_godot, 'data/tracks/spa.json')
    G = Geo(os.path.join(src, 'geofit.json'))
    dl = os.path.join(src, 'dl')
    cl = np.array(json.load(open(track_json))['centerline'], float).reshape(-1, 3)
    cx, cz = cl[:, 0].mean(), cl[:, 2].mean()
    # every lat / lon the ring and the cover reach
    span = max(R1, COVER_HALF) * 1.5
    la_c, lo_c = G.latlon(np.array([cx - span, cx + span, cx - span, cx + span]), np.array([cz - span, cz - span, cz + span, cz + span]))
    box = (la_c.min(), la_c.max(), lo_c.min(), lo_c.max())
    # (the tiles' longitude spacing is 1.5" between 50 and 60 degrees north)
    lats = range(int(np.floor(box[0])), int(np.floor(box[1])) + 1)
    lons = range(int(np.floor(box[2])), int(np.floor(box[3])) + 1)
    dem_tiles = [(os.path.join(dl, f'Copernicus_DSM_COG_10_N{a:02d}_00_E{o:03d}_00_DEM.tif'), a + 1.0, float(o), 1 / 3600, 1.5 / 3600) for a in lats for o in lons]
    dem = Raster([t for t in dem_tiles if os.path.exists(t[0])], box)
    # the real heights in the game frame (vertical scale as the horizontal: the game frame is the model at 1.0103)
    la, lo = G.latlon(cl[:, 0], cl[:, 2])
    e0 = float(np.median(dem.sample(la, lo) - G.s * cl[:, 1]))
    print(f'[far] centre ({cx:.0f}, {cz:.0f}), elevation of game y 0: {e0:.1f} m')

    # the model's ground (its terrain and the track model's grass, run-off and roads around the circuit): height grid,
    # footprint, edge. The terrain alone left the track's surroundings uncovered: the ring came up through them at the
    # real surface's height, the forest canopy's included
    cell = 10.0
    gx0, gz0 = cx - 6000, cz - 6000
    gn = int(12000 / cell) + 1
    Hm = np.full((gn, gn), np.nan)
    for f in ('map_terrain.glb', 'map_track.glb'):
        P, T = glb_read(os.path.join(out, f))
        h = rasterize(P, T, gx0, gz0, cell, gn)
        Hm = np.where(np.isnan(Hm), h, np.where(np.isnan(h), Hm, np.maximum(Hm, h)))
    # close pinholes between pieces (one cell)
    nb = [np.roll(np.roll(Hm, a, 0), b, 1) for a in (-1, 0, 1) for b in (-1, 0, 1)]
    holes = np.isnan(Hm) & (sum((~np.isnan(n)).astype(int) for n in nb) >= 6)
    Hm[holes] = np.nanmean(np.stack(nb), 0)[holes]
    inside = ~np.isnan(Hm)
    # the footprint's edge cells and the model's height minus the real one there
    edge = inside & ~(np.roll(inside, 1, 0) & np.roll(inside, -1, 0) & np.roll(inside, 1, 1) & np.roll(inside, -1, 1))
    ei, ek = np.nonzero(edge)
    ex, ez = gx0 + ei * cell, gz0 + ek * cell
    la, lo = G.latlon(ex, ez)
    ed = Hm[ei, ek] - (dem.sample(la, lo) - e0) / G.s
    ed = np.nan_to_num(ed)
    print(f'[far] model terrain {inside.sum() * cell * cell / 1e6:.1f} km2, edge {len(ex)} cells, model - real at the edge: median {np.median(ed):.1f}, p10 / p90 {np.percentile(ed, 10):.1f} / {np.percentile(ed, 90):.1f} m')

    meshes = []
    for name, segs in (('far_hi', 360), ('far_lo', 120)):
        x, z, tri = ring(cx, cz, segs)
        la, lo = G.latlon(x, z)
        h = (dem.sample(la, lo) - e0) / G.s
        h = np.nan_to_num(h, nan=float(np.nanmedian(h)))
        hm = grid_sample(Hm, gx0, gz0, cell, x, z)
        ins = ~np.isnan(hm)
        # nearest edge cell: the model's offset there, faded out over BLEND
        d = np.full(len(x), np.inf)
        off = np.zeros(len(x))
        for s0 in range(0, len(x), 4000):
            dx = x[s0:s0 + 4000, None] - ex[None, :]
            dz = z[s0:s0 + 4000, None] - ez[None, :]
            d2 = dx * dx + dz * dz
            j = d2.argmin(1)
            d[s0:s0 + 4000] = np.sqrt(d2[np.arange(len(j)), j])
            off[s0:s0 + 4000] = ed[j]
        f = np.clip(d / BLEND, 0, 1)
        f = f * f * (3 - 2 * f)
        h = h + off * (1 - f)
        # under the model's terrain: just below it (the ring's inner edge tucks under the model's edge)
        h[ins] = hm[ins] - 1.5
        keep = ~(ins[tri[:, 0]] & ins[tri[:, 1]] & ins[tri[:, 2]])
        tri = tri[keep]
        used = np.unique(tri)
        remap = np.full(len(x), -1)
        remap[used] = np.arange(len(used))
        p = np.stack([x, h, z], -1)[used]
        tri = remap[tri]
        # glTF winding: counter-clockwise seen from above (+y)
        c = np.cross(p[tri[:, 1]] - p[tri[:, 0]], p[tri[:, 2]] - p[tri[:, 0]])
        flip = c[:, 1] < 0
        tri[flip] = tri[flip][:, [0, 2, 1]]
        uv = np.stack([(p[:, 0] - (cx - COVER_HALF)) / (2 * COVER_HALF), (p[:, 2] - (cz - COVER_HALF)) / (2 * COVER_HALF)], -1)
        meshes.append((name, p, normals(p, tri), uv, tri))
        print(f'[far] {name}: {len(p)} vertices, {len(tri)} triangles, heights {p[:, 1].min():.0f} to {p[:, 1].max():.0f} m')
    glb_write(os.path.join(out, 'far_terrain.glb'), meshes)

    # land cover, 2x2 samples a texel
    cov_tiles = []
    for a in sorted({int(np.floor(v / 3) * 3) for v in (box[0], box[1])}):
        for o in sorted({int(np.floor(v / 3) * 3) for v in (box[2], box[3])}):
            cov_tiles.append((os.path.join(dl, f'ESA_WorldCover_10m_2021_v200_N{a:02d}E{o:03d}_Map.tif'), a + 3.0, float(o), 1 / 12000, 1 / 12000))
    cov = Raster([t for t in cov_tiles if os.path.exists(t[0])], box, nearest=True)
    px = 2 * COVER_HALF / COVER_PX
    acc = np.zeros((COVER_PX, COVER_PX, 4), np.float32)
    for oy in (0.25, 0.75):
        for ox in (0.25, 0.75):
            jj, ii = np.meshgrid(np.arange(COVER_PX), np.arange(COVER_PX), indexing='ij')
            x = cx - COVER_HALF + (ii + ox) * px
            z = cz - COVER_HALF + (jj + oy) * px
            la, lo = G.latlon(x, z)
            k = cov.sample(la, lo)
            acc[..., 0] += k == 10
            acc[..., 1] += (k == 20) | (k == 30) | (k == 90) | (k == 100)
            acc[..., 2] += k == 40
            acc[..., 3] += (k == 50) | (k == 60) | (k == 80) | np.isnan(k)
    acc /= 4
    Image.fromarray((acc * 255 + 0.5).astype(np.uint8), 'RGBA').save(os.path.join(out, 'far_cover.png'), optimize=True)
    share = acc.reshape(-1, 4).mean(0)
    print(f'[far] cover: trees {share[0]:.0%}, grass {share[1]:.0%}, crops {share[2]:.0%}, built / bare / water {share[3]:.0%}')
    json.dump({'centre': [cx, cz], 'cover_half': COVER_HALF, 'e0': e0}, open(os.path.join(out, 'far_terrain.json'), 'w'))


main()
