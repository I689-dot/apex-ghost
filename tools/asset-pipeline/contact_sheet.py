"""Debug helper: montage of car thumbnails + side debug renders."""
import glob, os, sys
from PIL import Image, ImageDraw
out = sys.argv[1]
d = 'tools/asset-pipeline/out/cars'
ids = sorted(os.path.basename(f)[:-4] for f in glob.glob(f'{d}/*.png') if '_debug' not in f)
ids = [i for i in ids if not sys.argv[2:] or i in sys.argv[2:]]
W, H = 320, 180
sheet = Image.new('RGB', (W * 3, H * len(ids)), (40, 40, 48))
dr = ImageDraw.Draw(sheet)
for r, i in enumerate(ids):
    for c, suffix in enumerate(['', '_debug_side', '_debug_top']):
        p = f'{d}/{i}{suffix}.png'
        if os.path.exists(p):
            im = Image.open(p).convert('RGBA')
            bg = Image.new('RGBA', im.size, (200, 205, 215, 255)); bg.alpha_composite(im)
            sheet.paste(bg.convert('RGB').resize((W, H)), (c * W, r * H))
    dr.text((4, r * H + 4), i, fill=(255, 0, 0))
sheet.save(out)
