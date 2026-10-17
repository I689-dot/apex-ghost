"""Asset inventory: walks `3D MODELS/` and writes ASSET_REPORT.md + asset_inventory.json.

Run with the usd-core venv:  python tools/asset-pipeline/inventory.py
"""
from __future__ import annotations

import json
import os
import re
import struct
import sys
from pathlib import Path

from pxr import Gf, Usd, UsdGeom, UsdShade

ROOT = Path(__file__).resolve().parents[2]
ASSETS = ROOT / "3D MODELS"
OUT_MD = ROOT / "ASSET_REPORT.md"
OUT_JSON = ROOT / "tools" / "asset-pipeline" / "out" / "asset_inventory.json"

INTERIOR_HINTS = re.compile(
    r"(steer|wheel_?s|seat|dash|interior|INT_|cockpit|belt|pedal|gauge|display)", re.I
)
GRID_HINTS = re.compile(r"(grid|start|spawn|pit|pole|AC_|slot|position|finish|timing|checkpoint)", re.I)


def image_size(path: Path) -> tuple[int, int] | None:
    try:
        with open(path, "rb") as f:
            head = f.read(26)
            if head[:8] == b"\x89PNG\r\n\x1a\n":
                w, h = struct.unpack(">II", head[16:24])
                return w, h
            if head[:2] == b"\xff\xd8":
                f.seek(2)
                while True:
                    marker = f.read(2)
                    if len(marker) < 2 or marker[0] != 0xFF:
                        return None
                    if marker[1] in (0xC0, 0xC1, 0xC2):
                        f.read(3)
                        h, w = struct.unpack(">HH", f.read(4))
                        return w, h
                    seg_len = struct.unpack(">H", f.read(2))[0]
                    f.seek(seg_len - 2, 1)
    except OSError:
        return None
    return None


def hierarchy(prim: Usd.Prim, depth: int, max_depth: int, lines: list[str], budget: list[int]) -> None:
    if budget[0] <= 0:
        return
    for child in prim.GetChildren():
        if budget[0] <= 0:
            lines.append("  " * depth + "- …")
            return
        budget[0] -= 1
        lines.append("  " * depth + f"- `{child.GetName()}` ({child.GetTypeName() or 'Prim'})")
        if depth + 1 < max_depth:
            hierarchy(child, depth + 1, max_depth, lines, budget)


def inspect(path: Path, kind: str) -> dict:
    stage = Usd.Stage.Open(str(path))
    up = UsdGeom.GetStageUpAxis(stage)
    mpu = UsdGeom.GetStageMetersPerUnit(stage)
    cache = UsdGeom.BBoxCache(Usd.TimeCode.Default(), [UsdGeom.Tokens.default_, UsdGeom.Tokens.render])
    mesh_count = 0
    tri_count = 0
    materials: set[str] = set()
    interior_names: list[str] = []
    grid_names: list[str] = []
    xform_names: list[str] = []
    lights: list[str] = []
    mesh_names: list[str] = []
    for prim in stage.Traverse():
        name = prim.GetName()
        if prim.IsA(UsdGeom.Mesh):
            mesh_count += 1
            mesh_names.append(str(prim.GetPath()))
            counts = UsdGeom.Mesh(prim).GetFaceVertexCountsAttr().Get()
            if counts is not None:
                tri_count += int(sum(max(0, c - 2) for c in counts))
            mat, _ = UsdShade.MaterialBindingAPI(prim).ComputeBoundMaterial()
            if mat:
                materials.add(mat.GetPrim().GetName())
        elif prim.GetTypeName() == "Xform":
            xform_names.append(str(prim.GetPath()))
        if "Light" in (prim.GetTypeName() or ""):
            lights.append(str(prim.GetPath()))
        if INTERIOR_HINTS.search(name):
            interior_names.append(name)
        if GRID_HINTS.search(name):
            grid_names.append(str(prim.GetPath()))
    bbox = cache.ComputeWorldBound(stage.GetPseudoRoot()).ComputeAlignedRange()
    mn, mx = bbox.GetMin(), bbox.GetMax()
    lines: list[str] = []
    hierarchy(stage.GetPseudoRoot(), 0, 4, lines, [60])
    tex_dir = path.parent / "0"
    textures = []
    if tex_dir.is_dir():
        for t in sorted(tex_dir.iterdir()):
            sz = image_size(t)
            textures.append({"file": t.name, "bytes": t.stat().st_size, "res": f"{sz[0]}x{sz[1]}" if sz else "?"})
    return {
        "kind": kind,
        "name": path.parent.name,
        "file": str(path.relative_to(ROOT)),
        "bytes": path.stat().st_size,
        "texBytes": sum(t["bytes"] for t in textures),
        "upAxis": up,
        "metersPerUnit": mpu,
        "meshCount": mesh_count,
        "triangles": tri_count,
        "materials": sorted(materials),
        "textures": textures,
        "bboxMin": [round(v, 3) for v in mn],
        "bboxMax": [round(v, 3) for v in mx],
        "hierarchy": lines,
        "interiorHints": sorted(set(interior_names))[:40],
        "gridHints": grid_names[:80],
        "lights": lights[:40],
        "xformCount": len(xform_names),
        "meshNames": mesh_names[:400],
    }


def main() -> None:
    results = []
    for kind in ("MAP", "CARS"):
        for d in sorted((ASSETS / kind).iterdir()):
            f = d / "scene.usdc"
            if f.exists():
                print("inspecting", f, file=sys.stderr)
                results.append(inspect(f, kind.lower()))
    OUT_JSON.parent.mkdir(parents=True, exist_ok=True)
    OUT_JSON.write_text(json.dumps(results, indent=1))

    md = ["# Asset Report", "", "Generated by `tools/asset-pipeline/inventory.py` (usd-core).", ""]
    md += ["## Summary", "", "| Kind | Name | USDC size | Textures | Meshes | Triangles | Up | m/unit | BBox size (units) | Interior |",
           "|---|---|---|---|---|---|---|---|---|---|"]
    for r in results:
        size = [round(r["bboxMax"][i] - r["bboxMin"][i], 2) for i in range(3)]
        interior = "yes" if r["interiorHints"] else "no"
        md.append(
            f"| {r['kind']} | {r['name']} | {r['bytes']/1e6:.1f} MB | {len(r['textures'])} ({r['texBytes']/1e6:.1f} MB) | "
            f"{r['meshCount']} | {r['triangles']:,} | {r['upAxis']} | {r['metersPerUnit']} | {size} | {interior} |"
        )
    for r in results:
        md += ["", f"## {r['kind']}: {r['name']}", "",
               f"- File: `{r['file']}` ({r['bytes']/1e6:.2f} MB)",
               f"- Up axis: {r['upAxis']}, metersPerUnit: {r['metersPerUnit']}",
               f"- Bounding box: min {r['bboxMin']} max {r['bboxMax']}",
               f"- Meshes: {r['meshCount']}, triangles: {r['triangles']:,}, Xforms: {r['xformCount']}",
               f"- Interior hints: {', '.join(r['interiorHints'][:20]) or 'none'}",
               f"- Grid/marker hints: {', '.join(r['gridHints'][:20]) or 'none'}",
               f"- Lights: {', '.join(r['lights'][:10]) or 'none'}",
               "", "<details><summary>Hierarchy (top levels)</summary>", "", *r["hierarchy"], "", "</details>", "",
               "<details><summary>Materials / textures</summary>", "",
               "Materials: " + ", ".join(f"`{m}`" for m in r["materials"]), "",
               "| Texture | Size | Resolution |", "|---|---|---|",
               *[f"| {t['file']} | {t['bytes']/1e3:.0f} KB | {t['res']} |" for t in r["textures"]],
               "", "</details>"]
    OUT_MD.write_text("\n".join(md) + "\n")
    print("wrote", OUT_MD, file=sys.stderr)


if __name__ == "__main__":
    main()
