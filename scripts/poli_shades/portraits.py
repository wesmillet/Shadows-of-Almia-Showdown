"""Shades on the Poliwag line's portraits at the asset's own detail (inner rim, two-pixel shines)."""
import os, shutil, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from shadesart import pair
from shades4 import sheared
from PIL import Image

PBASE, OUT = sys.argv[1], sys.argv[2]
# (lens w, lens h, bridge, x of the left nub, top y, tilt (0 = level; >0 the right side higher))
SPEC = {
    '0060': (11, 9, 4, 9, 7, 0),
    '0061': (10, 8, 9, 6, 3, 1),
    '0062': (11, 8, 7, 5, 5, 1),
    '0186': (10, 8, 4, 9, 10, 2),
}

def glasses(dex):
    lw, lh, br, ox, oy, tilt = SPEC[dex]
    px = pair(lw, lh, br, glint=2, rim=True, bar_row=3, bar_h=3, shine_from=2 if lw <= 10 else 3)
    if tilt: px = sheared(px, tilt, up_right=True)
    return {(x + ox, y + oy): c for (x, y), c in px.items()}

for dex in SPEC:
    src, dst = f'{PBASE}/{dex}', f'{OUT}/{dex}-rad'
    if os.path.exists(dst): shutil.rmtree(dst)
    shutil.copytree(src, dst)
    g = glasses(dex)
    for fn in os.listdir(dst):
        if not fn.endswith('.png'): continue
        im = Image.open(f'{dst}/{fn}').convert('RGBA'); p = im.load()
        for (x, y), c in g.items():
            if 0 <= x < im.width and 0 <= y < im.height: p[x, y] = c
        im.save(f'{dst}/{fn}')
    with open(f'{dst}/credits.txt', 'a') as f:
        f.write("\nSunglasses (from a shades design by the game's developer) added for Shadows of Almia Showdown, a gift for PoliRad Gaming.\n")
