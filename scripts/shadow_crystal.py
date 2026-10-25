"""Draws the Shadow Crystal's pixel art: the crystal cluster, its broken stump (after Darkrai wakes)
and the obsidian pedestal it hovers over. Writes assets/ui/shadow_crystal*.png.

  python3 scripts/shadow_crystal.py [preview.png]

Everything is drawn at art resolution (one pixel = one art pixel, the game scales it up like a
Pokémon sprite): facets are filled in flat bands of a small violet palette, the cluster gets a
one-pixel dark outline, and a dark core sits inside the main shard (the game pulses a glow on it).
"""
import os
import sys

import numpy as np
from PIL import Image, ImageDraw

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
OUT = os.path.join(ROOT, 'assets', 'ui')

OUTLINE = (22, 8, 40)
# Lit (left) and shaded (right) faces, top to bottom.
LIT = [(232, 206, 255), (196, 150, 255), (158, 104, 246), (122, 70, 214), (92, 46, 176), (70, 32, 140)]
DIM = [(150, 96, 236), (112, 64, 200), (84, 42, 164), (62, 28, 128), (46, 18, 98), (34, 12, 74)]
EDGE = (248, 236, 255)
CORE = (26, 6, 46)
CORE_RIM = (255, 92, 214)
CRACK = (255, 120, 230)

W, H = 48, 72


def mask(points, size=(W, H)):
    im = Image.new('L', size, 0)
    ImageDraw.Draw(im).polygon(points, fill=255)
    return np.array(im) > 0


def bands(canvas, m, palette, y0, y1, shift=0):
    """Fills mask `m` with `palette` in horizontal bands from y0 (lightest) to y1 (darkest)."""
    ys, xs = np.nonzero(m)
    for y, x in zip(ys, xs):
        t = (y - y0) / max(1, y1 - y0)
        k = int(np.clip(t * len(palette) + shift, 0, len(palette) - 1))
        canvas[y, x] = (*palette[k], 255)


def line(canvas, pts, color, step=1):
    im = Image.fromarray(canvas, 'RGBA')
    d = ImageDraw.Draw(im)
    for a, b in zip(pts, pts[1:]):
        d.line([a, b], fill=(*color, 255), width=1)
    canvas[:] = np.array(im)


def outline(canvas, color=OUTLINE):
    a = canvas[:, :, 3] > 0
    p = np.pad(a, 1)
    grown = a | p[:-2, 1:-1] | p[2:, 1:-1] | p[1:-1, :-2] | p[1:-1, 2:]
    ring = grown & ~a
    canvas[ring] = (*color, 255)


def heart(canvas, pts):
    """The night the crystal holds: a smoky dark lens, blackest in the middle (the game pulses a glow on it)."""
    m = mask(pts)
    ys, xs = np.nonzero(m)
    cy, cx = ys.mean(), xs.mean()
    hy, hx = (ys.max() - ys.min()) / 2 + 0.5, (xs.max() - xs.min()) / 2 + 0.5
    shades = [(16, 4, 34), (30, 8, 58), (48, 14, 88), (74, 26, 124)]
    for y, x in zip(ys, xs):
        r = max(abs(y - cy) / hy, abs(x - cx) / hx * 0.9)
        canvas[y, x] = (*shades[int(np.clip(r * len(shades), 0, len(shades) - 1))], 255)


def shard(canvas, tip, ls, rs, lb, rb, ridge, y0, y1, shift=0.0):
    """One crystal: a pointed prism split down a ridge into a lit left face and a shaded right face."""
    top_ridge, bottom_ridge = ridge
    left = mask([tip, ls, lb, bottom_ridge, top_ridge])
    right = mask([tip, top_ridge, bottom_ridge, rb, rs])
    bands(canvas, left, LIT, y0, y1, shift)
    bands(canvas, right, DIM, y0, y1, shift)
    # The cap: two brighter facets over the shoulders.
    cap_l = mask([tip, ls, top_ridge])
    cap_r = mask([tip, top_ridge, rs])
    canvas[cap_l] = (*LIT[0], 255)
    canvas[cap_r] = (*DIM[0], 255)
    line(canvas, [tip, top_ridge], EDGE)
    line(canvas, [top_ridge, (top_ridge[0], (top_ridge[1] + bottom_ridge[1]) // 2)], LIT[1])


def cluster(broken=False):
    c = np.zeros((H, W, 4), np.uint8)
    if not broken:
        # Behind: two side crystals leaning out.
        shard(c, (7, 26), (3, 38), (13, 34), (8, 71), (19, 71), ((9, 36), (13, 71)), 26, 76, 0.6)
        shard(c, (42, 18), (35, 29), (46, 32), (31, 71), (41, 71), ((40, 30), (36, 71)), 18, 76, 0.6)
        # The main crystal.
        shard(c, (24, 1), (14, 19), (34, 19), (16, 71), (33, 71), ((25, 21), (25, 71)), 1, 80)
        line(c, [(15, 21), (17, 66)], LIT[1])
        # Its dark heart.
        heart(c, [(24, 27), (29, 38), (28, 52), (24, 60), (20, 51), (19, 38)])
        # A small crystal in front, low on the left.
        shard(c, (17, 52), (13, 60), (21, 58), (14, 71), (22, 71), ((17, 59), (18, 71)), 52, 80, 1.0)
        # Glints.
        for x, y in ((22, 6), (23, 10), (6, 31), (41, 23), (16, 22)):
            c[y, x] = (*EDGE, 255)
    else:
        # Snapped off: jagged stumps, glowing cracks, fragments at the foot.
        def stump(pts_left, pts_right, y0, y1, shift):
            bands(c, mask(pts_left), LIT, y0, y1, shift)
            bands(c, mask(pts_right), DIM, y0, y1, shift)
        stump([(3, 52), (6, 48), (8, 51), (9, 49), (13, 71), (8, 71)], [(9, 49), (11, 46), (13, 50), (14, 47), (19, 71), (13, 71)], 40, 76, 1.2)
        stump([(31, 48), (34, 44), (36, 47), (36, 71), (31, 71)], [(36, 47), (38, 42), (41, 46), (44, 45), (41, 71), (36, 71)], 34, 76, 1.2)
        stump([(15, 40), (18, 34), (20, 38), (22, 31), (25, 36), (25, 71), (16, 71)],
              [(25, 36), (27, 33), (30, 39), (33, 35), (33, 71), (25, 71)], 30, 80, 1.6)
        # The emptied heart: an open wound where the night came out.
        heart(c, [(24, 38), (28, 47), (27, 58), (24, 63), (21, 57), (20, 47)])
        line(c, [(18, 37), (19, 46), (17, 55), (18, 66)], CRACK)
        line(c, [(31, 39), (30, 49), (32, 60)], CRACK)
        line(c, [(10, 50), (11, 60)], CRACK)
        # Pieces at its foot.
        for pts in ([(4, 70), (7, 65), (10, 70)], [(38, 71), (41, 66), (45, 69), (43, 71)], [(26, 71), (28, 67), (30, 71)]):
            m = mask(pts)
            c[m] = (*LIT[2], 255)
    outline(c)
    return Image.fromarray(c, 'RGBA')


def pedestal():
    """An obsidian slab with a glowing ring carved into its top and runes round its side."""
    PW, PH = 60, 22
    c = np.zeros((PH, PW, 4), np.uint8)
    cx, top = PW / 2 - 0.5, 8
    rx, ry, depth = 27.5, 7.5, 7
    yy, xx = np.mgrid[0:PH, 0:PW]
    def ell(cy, rx_, ry_):
        return ((xx - cx) / rx_) ** 2 + ((yy - cy) / ry_) ** 2 <= 1
    side = np.zeros_like(xx, bool)
    for dy in range(depth + 1):
        side |= ell(top + dy, rx, ry)
    topf = ell(top, rx, ry)
    side &= ~topf
    # Side: dark stone, a lighter lip under the top edge, runes glowing along it.
    c[side] = (40, 30, 56, 255)
    c[side & (yy <= top + ry + 1)] = (54, 42, 74, 255)
    for x in range(4, PW - 4, 5):
        col = np.nonzero(side[:, x])[0]
        if len(col) > 4:
            y = col[len(col) // 2]
            c[y, x] = (196, 120, 255, 255)
            c[y - 1, x] = (140, 80, 220, 255)
    # Top: polished stone, darker toward the back, with the glowing ring.
    c[topf] = (78, 64, 100, 255)
    c[topf & (yy < top - 3)] = (66, 54, 88, 255)
    ring = ell(top, rx - 4, ry - 1.6) & ~ell(top, rx - 5.5, ry - 2.6)
    c[ring] = (178, 104, 255, 255)
    inner = ell(top, rx - 9, ry - 3.4)
    c[inner] = (52, 38, 76, 255)
    c[topf & (yy == top - int(ry))] = (104, 90, 128, 255)
    outline(c, (14, 8, 24))
    return Image.fromarray(c, 'RGBA')


def main():
    os.makedirs(OUT, exist_ok=True)
    whole, broken, base = cluster(False), cluster(True), pedestal()
    whole.save(os.path.join(OUT, 'shadow_crystal.png'))
    broken.save(os.path.join(OUT, 'shadow_crystal_broken.png'))
    base.save(os.path.join(OUT, 'shadow_crystal_base.png'))
    if len(sys.argv) > 1:
        # A preview: both states on their pedestals over the arena floor, 6x.
        sheet = Image.new('RGBA', (150, 100), (226, 222, 214, 255))
        for i, im in enumerate((whole, broken)):
            ox = 10 + i * 72
            sheet.alpha_composite(base, (ox - 6, 74))
            sheet.alpha_composite(im, (ox, 10))
        sheet.resize((sheet.width * 6, sheet.height * 6), Image.NEAREST).save(sys.argv[1])


if __name__ == '__main__':
    main()
