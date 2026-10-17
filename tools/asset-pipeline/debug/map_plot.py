"""Debug: top-down plot of selected map materials (usd-core + matplotlib)."""
import sys, numpy as np
from pxr import Usd, UsdGeom, UsdShade
import matplotlib; matplotlib.use('Agg'); import matplotlib.pyplot as plt
st = Usd.Stage.Open(sys.argv[1]); out = sys.argv[2]
want = sys.argv[3].split(',')
box = [float(v) for v in sys.argv[4].split(',')] if len(sys.argv) > 4 else None
xc = UsdGeom.XformCache()
fig, ax = plt.subplots(figsize=(14, 14), dpi=90)
cols = ['k', 'r', 'b', 'g', 'm', 'c', 'orange', 'y']
for p in st.Traverse():
    if not p.IsA(UsdGeom.Mesh): continue
    mat, _ = UsdShade.MaterialBindingAPI(p).ComputeBoundMaterial()
    mn = mat.GetPrim().GetName() if mat else ''
    hit = [i for i, w in enumerate(want) if mn.startswith(w)]
    if not hit: continue
    pts = np.array(UsdGeom.Mesh(p).GetPointsAttr().Get())
    M = np.array(xc.GetLocalToWorldTransform(p))
    w = pts @ M[:3, :3] + M[3, :3]
    if box:
        sel = (w[:, 0] > box[0]) & (w[:, 0] < box[1]) & (w[:, 2] > box[2]) & (w[:, 2] < box[3]); w = w[sel]
    ax.scatter(w[:, 0], w[:, 2], s=0.3 if not box else 1.5, c=cols[hit[0] % len(cols)], label=mn)
ax.set_aspect('equal'); ax.legend(markerscale=10, fontsize=7); ax.grid(True, alpha=.3)
plt.savefig(out, bbox_inches='tight')
