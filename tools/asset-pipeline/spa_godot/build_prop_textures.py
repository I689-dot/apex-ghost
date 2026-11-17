#!/usr/bin/env python3
"""Printed art for the Spa props build_props.py models (the boards as the reference video shows them: the user's call
for this private game), drawn here, never taken from the video or ACC.

   python3 -I tools/asset-pipeline/spa_godot/build_prop_textures.py <out dir> [<ambientCG dir>]

With <ambientCG dir> (CC0 material sets, <id>/<id>_2K-JPG_<map>.jpg; godot/assets_credits.md) also copies the scanned
materials the props wear into <out dir>/tex/<id>_<color|rough|metal|normal>.jpg at the size each needs (PBR below), and
draws balloon_normal.png (the envelope's 24 panels bulging between their seams). Writes balloon.png (the La Source balloon's envelope: red with the lettering three times round), podium.png (the black
PODIUM board), flag.png (a feather flag's print), banner.png (the footbridge's banner).
No real brands (the user, 2026-11-16): the boards keep the video's colours and layout with invented names, the game's
own name (CORSAGHOST) or the circuit's."""
import os
import sys

from PIL import Image, ImageDraw, ImageFont

FONT = '/usr/share/fonts/truetype/noto/NotoSans-Bold.ttf'
out = sys.argv[1]
acg = sys.argv[2] if len(sys.argv) > 2 else None
# ambientCG set -> texture size (px): the big painted and fabric surfaces at 2K, the small things at 1K
PBR = {'PaintedMetal001': 2048, 'Metal032': 2048, 'Fabric032': 2048, 'Plastic007': 1024, 'Rubber004': 1024, 'Plastic011': 1024, 'Wicker005': 1024, 'CorrugatedSteel005': 2048}
os.makedirs(out, exist_ok=True)


def font(px):
    return ImageFont.truetype(FONT, px)


def centred(d, box, text, f, fill):
    x0, y0, x1, y1 = box
    l, t, r, b = d.textbbox((0, 0), text, font=f)
    # no wider than 90 % of its panel: a longer name comes out smaller instead of running into the next one
    while r - l > (x1 - x0) * 0.9 and f.size > 12:
        f = font(int(f.size * 0.92))
        l, t, r, b = d.textbbox((0, 0), text, font=f)
    d.text(((x0 + x1 - (r - l)) / 2 - l, (y0 + y1 - (b - t)) / 2 - t), text, font=f, fill=fill)


# the balloon: an equirectangular envelope (u round, v top to bottom), a deep red with lighter seams and the lettering
# three times round its middle (one side always faces the track)
W, H = 2048, 1024
img = Image.new('RGB', (W, H), (150, 8, 16))
d = ImageDraw.Draw(img)
for k in range(24):
    x = k * W / 24
    d.line([(x, 0), (x, H)], fill=(122, 6, 12), width=4)
for k in range(3):
    centred(d, (k * W / 3, H * 0.36, (k + 1) * W / 3, H * 0.6), 'CORSAGHOST', font(110), (245, 245, 245))
d.rectangle([0, int(H * 0.88), W, H], fill=(60, 40, 30))
img.save(os.path.join(out, 'balloon.png'))

# the podium board: black, the game's name small above PODIUM in yellow, a thin yellow rule
img = Image.new('RGB', (1024, 512), (14, 14, 16))
d = ImageDraw.Draw(img)
centred(d, (0, 40, 1024, 170), 'CORSAGHOST', font(96), (238, 238, 238))
centred(d, (0, 180, 1024, 420), 'PODIUM', font(190), (246, 196, 40))
d.rectangle([180, 440, 844, 452], fill=(246, 196, 40))
img.save(os.path.join(out, 'podium.png'))

# a feather flag: white with a red-to-blue band and a word down its length (printed sideways)
img = Image.new('RGB', (256, 1024), (244, 244, 244))
d = ImageDraw.Draw(img)
for y in range(1024):
    t = y / 1023
    c = (int(220 * (1 - t) + 30 * t), int(40 * (1 - t) + 80 * t), int(40 * (1 - t) + 190 * t))
    d.line([(0, y), (60, y)], fill=c)
txt = Image.new('RGBA', (1024, 256), (0, 0, 0, 0))
centred(ImageDraw.Draw(txt), (0, 0, 1024, 256), 'SPA 24', font(150), (30, 50, 120, 255))
img.paste(txt.rotate(90, expand=True), (0, 0), txt.rotate(90, expand=True))
img.save(os.path.join(out, 'flag.png'))

# the footbridge's banner: white, the lettering in blue and red four times along; drawn at the panel's proportions
# (32 x 1.2 m) so the letters keep their shape
img = Image.new('RGB', (4096, 154), (246, 246, 246))
d = ImageDraw.Draw(img)
for k in range(4):
    centred(d, (k * 1024, 0, (k + 1) * 1024, 154), 'APEX FUEL', font(104), (30, 60, 150) if k % 2 == 0 else (210, 40, 40))
img.save(os.path.join(out, 'banner.png'))

# the balloon's panels: a normal map (tangent space, OpenGL: +y up) bulging across each of the 24 gores, the u direction
# round the envelope
import math
nw, nh = 1024, 256
nimg = Image.new('RGB', (nw, nh))
px = nimg.load()
for x in range(nw):
    g = (x / nw * 24) % 1.0
    # the panel's slope across: a gentle bulge, steepest at the seams
    sx = -math.sin((g - 0.5) * math.pi) * 0.35
    for y in range(nh):
        n = (sx, 0.0, 1.0)
        l = math.sqrt(n[0] ** 2 + n[2] ** 2)
        px[x, y] = (int((n[0] / l * 0.5 + 0.5) * 255), 128, int((n[2] / l * 0.5 + 0.5) * 255))
nimg.save(os.path.join(out, 'balloon_normal.png'))

if acg:
    td = os.path.join(out, 'tex')
    os.makedirs(td, exist_ok=True)
    for k, size in PBR.items():
        for src, dst in (('Color', 'color'), ('Roughness', 'rough'), ('Metalness', 'metal'), ('NormalGL', 'normal')):
            f = os.path.join(acg, k, f'{k}_2K-JPG_{src}.jpg')
            if os.path.exists(f):
                im = Image.open(f)
                im = im.convert('L' if dst in ('rough', 'metal') else 'RGB')
                if im.size[0] != size:
                    im = im.resize((size, size), Image.LANCZOS)
                im.save(os.path.join(td, f'{k}_{dst}.jpg'), quality=90)
    print('[prop textures] scanned materials:', ', '.join(PBR))
print('[prop textures] balloon, podium, flag, banner')

# advertising boards along the track (build_places.py BOARDS), one 2048 x 256 row each (an 8 m run of 1 m tall boards):
# 0 fuel (blue and red on white), 1 a red board with a mark, 2 a radio station (purple), 3 Circuit de Spa, 4 black boards
# (the video's colours; invented names)
rows = []
img = Image.new('RGB', (2048, 256), (246, 246, 246))
d = ImageDraw.Draw(img)
for k in range(2):
    centred(d, (k * 1024, 0, (k + 1) * 1024, 256), 'APEX FUEL', font(150), (30, 60, 150) if k == 0 else (215, 45, 40))
rows.append(img)
img = Image.new('RGB', (2048, 256), (200, 30, 40))
d = ImageDraw.Draw(img)
for k in range(4):
    x0 = k * 512
    d.rectangle([x0 + 30, 50, x0 + 110, 206], fill=(245, 245, 245))
    d.rectangle([x0 + 54, 74, x0 + 86, 182], fill=(200, 30, 40))
    centred(d, (x0 + 130, 0, x0 + 490, 256), 'RACE LAB', font(84), (245, 245, 245))
rows.append(img)
img = Image.new('RGB', (2048, 256), (88, 40, 150))
d = ImageDraw.Draw(img)
for k in range(4):
    centred(d, (k * 512, 0, (k + 1) * 512, 256), 'PITLANE FM', font(88), (245, 245, 245))
rows.append(img)
img = Image.new('RGB', (2048, 256), (244, 244, 244))
d = ImageDraw.Draw(img)
for k in range(2):
    centred(d, (k * 1024, 0, (k + 1) * 1024, 256), 'CIRCUIT DE SPA', font(120), (35, 35, 40))
    d.rectangle([k * 1024 + 60, 200, k * 1024 + 964, 214], fill=(215, 30, 40))
rows.append(img)
img = Image.new('RGB', (2048, 256), (14, 14, 16))
d = ImageDraw.Draw(img)
for k in range(4):
    centred(d, (k * 512, 0, (k + 1) * 512, 256), 'TORQUE WORKS', font(74), (238, 238, 238))
rows.append(img)
atlas = Image.new('RGB', (2048, 256 * len(rows)))
for k, r in enumerate(rows):
    atlas.paste(r, (0, k * 256))
atlas.save(os.path.join(out, 'boards.png'))
print('[prop textures] boards:', len(rows), 'rows')
