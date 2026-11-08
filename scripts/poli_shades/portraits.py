"""Shades on the Poliwag line's portraits at the asset's own detail (inner rim, two-pixel shines).

Each species' chosen expression becomes its Normal portrait (the one the game shows). The pair can
tilt (the right side higher) and the bridge stays one unbroken piece; `arm` runs the left temple
back to the edge of the head and hooks it down behind, round the ear. Flipped (^) portraits get the
glasses mirrored.
"""
import os, shutil, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from shadesart import pair, K, B
from PIL import Image

PBASE, OUT = sys.argv[1], sys.argv[2]
# lens w, lens h, bridge, x of the left nub, top y, tilt, left arm, expression shown in game
SPEC = {
    '0060': dict(lw=11, lh=9, br=4, ox=9, oy=7, tilt=0, arm=True, use='Happy'),
    '0061': dict(lw=10, lh=8, br=9, ox=6, oy=3, tilt=0, arm=False, use='Happy'),
    '0062': dict(lw=12, lh=10, br=8, ox=4, oy=4, tilt=0, arm=False, use='Happy'),
    '0186': dict(lw=10, lh=8, br=4, ox=9, oy=10, tilt=2, arm=True, use='Normal'),
}
BAR_ROW, BAR_H = 3, 3

def glasses(s):
    lw, lh, br, tilt = s['lw'], s['lh'], s['br'], s['tilt']
    px = pair(lw, lh, br, glint=2, rim=True, bar_row=BAR_ROW, bar_h=BAR_H, shine_from=2 if lw <= 10 else 3)
    xs = [x for x, _ in px]; x0, x1 = min(xs), max(xs)
    off = lambda x: round(tilt * (x - x0) / max(1, x1 - x0))
    out = {(x, y - off(x)): c for (x, y), c in px.items()}
    # keep the bridge whole where the tilt steps it: frame lines filled across, the rim between
    rx = 1 + lw + br
    for x in range(lw, rx):
        if off(x + 1) == off(x): continue
        for b in range(BAR_ROW, BAR_ROW + BAR_H):
            for y in (b - off(x), b - off(x + 1)):
                for q in ((x, y), (x + 1, y)):
                    if q not in out or (out[q] == B and b in (BAR_ROW, BAR_ROW + BAR_H - 1)):
                        out[q] = K if b in (BAR_ROW, BAR_ROW + BAR_H - 1) else B
        # the rim never sits outside the frame lines
    return {(x + s['ox'], y + s['oy']): c for (x, y), c in out.items()}

def left_arm(im, g, s):
    """The temple from the left nub back to the head's outline, then down round the ear, following
    the outline (the background is the colour at the image's left edge on each row)."""
    p = im.load()
    nub = min(g, key=lambda q: (q[0], q[1]))
    bg = lambda x, y: p[x, y][3] == 0 or (sum(abs(a - b) for a, b in zip(p[x, y][:3], p[0, y][:3])) < 40)
    def edge(y):
        x = 0
        while x < im.width - 1 and bg(x, y): x += 1
        return x
    x0, top = nub
    ex = edge(top)
    for x in range(ex, x0):
        p[x, top] = K; p[x, top + 1] = K
    # round the ear: down the outline for three rows, two pixels thick
    prev = ex
    for k in range(2, 5):
        y = top + k
        if y >= im.height: break
        e = max(edge(y), prev - 1)          # one step at a time, so the hook stays joined
        for x in range(min(e, prev), max(e, prev) + 2): p[x, y] = K
        prev = e

def apply(dex, s, src_dir, dst_dir):
    g = glasses(s)
    for fn in os.listdir(dst_dir):
        if not fn.endswith('.png'): continue
        im = Image.open(f'{src_dir}/{fn}').convert('RGBA'); W = im.width
        flip = fn.endswith('^.png')
        if flip: im = im.transpose(Image.FLIP_LEFT_RIGHT)
        p = im.load()
        for (x, y), c in g.items():
            if 0 <= x < W and 0 <= y < im.height: p[x, y] = c
        if s['arm']: left_arm(im, g, s)
        if flip: im = im.transpose(Image.FLIP_LEFT_RIGHT)
        im.save(f'{dst_dir}/{fn}')
    use = s['use']
    if use != 'Normal':
        shutil.copy(f'{dst_dir}/{use}.png', f'{dst_dir}/Normal.png')
        if os.path.exists(f'{dst_dir}/{use}^.png'): shutil.copy(f'{dst_dir}/{use}^.png', f'{dst_dir}/Normal^.png')

if __name__ == '__main__':
    for dex, s in SPEC.items():
        src, dst = f'{PBASE}/{dex}', f'{OUT}/{dex}-rad'
        if os.path.exists(dst): shutil.rmtree(dst)
        shutil.copytree(src, dst)
        apply(dex, s, src, dst)
        with open(f'{dst}/credits.txt', 'a') as f:
            f.write("\nSunglasses (from a shades design by the game's developer) added for Shadows of Almia Showdown, a gift for PoliRad Gaming.\n")
