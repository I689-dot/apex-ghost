#!/usr/bin/env python3
"""Patches the .import files of the game's textures after a first import: VRAM-compressed (ASTC / ETC2 on phones) with
mipmaps for 3D textures (the web game's textures were plain PNGs: uncompressed, no mipmaps, 400+ MB of texture memory
and shimmering at a distance in Godot), compressed without mipmaps for the UI images. Then re-import:
  godot --headless --path godot --import
"""
import os, re, sys

root = os.path.join(os.path.dirname(__file__), '..', '..', 'godot', 'assets')
patched = 0
for dp, _, files in os.walk(root):
    for f in files:
        if not f.endswith('.import') or not re.search(r'\.(png|jpg|jpeg|webp)\.import$', f):
            continue
        p = os.path.join(dp, f)
        s = open(p).read()
        ui = os.sep + 'ui' + os.sep in dp + os.sep
        mode, mips = (1, 'false') if ui else (2, 'true')
        s2 = re.sub(r'compress/mode=\d+', f'compress/mode={mode}', s)
        s2 = re.sub(r'mipmaps/generate=\w+', f'mipmaps/generate={mips}', s2)
        s2 = re.sub(r'detect_3d/compress_to=\d+', 'detect_3d/compress_to=1', s2)
        if s2 != s:
            open(p, 'w').write(s2)
            patched += 1
print(f'{patched} import files patched')
