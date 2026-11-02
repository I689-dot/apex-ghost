#!/usr/bin/env python3
"""Writes godot/data/car_hero_rects.json: the visible (non-transparent) rectangle of every car's menu picture, so the
lobby can crop the empty margins and show the car big. Run after sync-assets.sh."""
import glob, json, os
from PIL import Image

root = os.path.join(os.path.dirname(__file__), "..", "..", "godot")
out = {}
for f in sorted(glob.glob(os.path.join(root, "assets/ui/cars/*.webp"))):
    im = Image.open(f).convert("RGBA")
    box = im.getchannel("A").point(lambda a: 255 if a > 24 else 0).getbbox()
    if box:
        pad = 6
        x0, y0 = max(0, box[0] - pad), max(0, box[1] - pad)
        x1, y1 = min(im.width, box[2] + pad), min(im.height, box[3] + pad)
        out[os.path.basename(f)[:-5]] = [x0, y0, x1 - x0, y1 - y0]
json.dump(out, open(os.path.join(root, "data/car_hero_rects.json"), "w"), separators=(",", ":"))
print(len(out), "cars")
