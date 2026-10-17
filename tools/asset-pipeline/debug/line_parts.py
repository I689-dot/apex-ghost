import sys, numpy as np
from pxr import Usd, UsdGeom, UsdShade
st = Usd.Stage.Open(sys.argv[1]); want = sys.argv[2]; box = [float(v) for v in sys.argv[3].split(',')]
xc = UsdGeom.XformCache()
for p in st.Traverse():
    if not p.IsA(UsdGeom.Mesh): continue
    mat, _ = UsdShade.MaterialBindingAPI(p).ComputeBoundMaterial()
    if not mat or not mat.GetPrim().GetName().startswith(want): continue
    m = UsdGeom.Mesh(p)
    pts = np.array(m.GetPointsAttr().Get()); M = np.array(xc.GetLocalToWorldTransform(p))
    w = pts @ M[:3, :3] + M[3, :3]
    idx = np.array(m.GetFaceVertexIndicesAttr().Get()); cnt = np.array(m.GetFaceVertexCountsAttr().Get())
    par = np.arange(len(w))
    def f(a):
        while par[a] != a:
            par[a] = par[par[a]]; a = par[a]
        return a
    o = 0
    for c in cnt:
        r0 = f(idx[o])
        for k in range(1, c):
            r = f(idx[o + k])
            if r != r0: par[r] = r0
        o += c
    lab = np.array([f(i) for i in range(len(w))])
    rows = []
    for l in np.unique(lab):
        v = w[lab == l]
        c = v.mean(axis=0)
        if not (box[0] < c[0] < box[1] and box[2] < c[2] < box[3]): continue
        xz = v[:, [0, 2]] - c[[0, 2]]
        ev, evec = np.linalg.eigh(np.cov(xz.T)) if len(v) > 2 else (np.zeros(2), np.eye(2))
        major = evec[:, 1]; ext = np.ptp(xz @ major); minor = np.ptp(xz @ evec[:, 0])
        ang = np.degrees(np.arctan2(major[1], major[0])) % 180
        rows.append((c[0], c[1], c[2], ext, minor, ang, len(v)))
    rows.sort(key=lambda r: r[0])
    for r in rows: print("c=(%.2f,%.2f,%.2f) len=%.2f wid=%.2f ang=%.0f nv=%d" % r)
