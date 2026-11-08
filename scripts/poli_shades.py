"""Wayfarer sunglasses for the Poliwag line, built pixel by pixel per facing.

Front: two lenses under one top bar; the bar and the first lens row make a two-pixel bridge; the
bottom row of each lens rounds in; a white shine runs down from the top left of each lens.
Three-quarter: the near lens full, the far one squeezed toward the turned-away side, joined by a
short bridge (tilted when the head is); the arm runs back from the near lens toward the ear.
Profile: one narrow lens in front of the eye and the arm straight back to the ear.

Anchors are the lens interiors' top-left corners relative to the head marker of Idle frame 0;
every frame of every animation draws the glasses at its own head marker, and leaves them off when
the face isn't there (a spin, a back view)."""
import os, shutil, sys
import xml.etree.ElementTree as ET
from PIL import Image
import numpy as np

BASE, OUT = sys.argv[1], sys.argv[2]
# Black wayfarers like the reference: near-black frame, black lenses a shade lighter (so the frame
# still reads as a rim up close), a faint sheen on the top row, and the white shine.
K = (8, 8, 12, 255)
L = (52, 52, 66, 255)    # lens top row (sheen)
M = (26, 26, 34, 255)    # lens
D = (20, 20, 27, 255)    # lens bottom
W = (255, 255, 255, 255)
G = (176, 178, 206, 255)

def lens(px, x0, y0, w, h, round_side='both', shine='front'):
    """One lens: interior w x h at (x0, y0), its frame round it; returns the interior cells."""
    cells = []
    for r in range(h):
        a, b = x0, x0 + w - 1
        if r == h - 1 and h >= 3:
            if round_side in ('both', 'left'): a += 1
            if round_side in ('both', 'right'): b -= 1
        for x in range(a, b + 1):
            cells.append((x, y0 + r))
            px[(x, y0 + r)] = L if r == 0 else (D if r == h - 1 else M)
    # frame: left/right of every row, the top bar, the bottom under the last row (and its steps)
    rows = {}
    for (x, y) in cells: rows.setdefault(y, []).append(x)
    for y, xs in rows.items():
        px.setdefault((min(xs) - 1, y), K) if (min(xs) - 1, y) not in px or px[(min(xs) - 1, y)] == K else None
        px[(min(xs) - 1, y)] = px.get((min(xs) - 1, y), K) if px.get((min(xs) - 1, y)) not in (L, M, D) else px[(min(xs) - 1, y)]
        if (max(xs) + 1, y) not in px or px[(max(xs) + 1, y)] == K: px[(max(xs) + 1, y)] = K
        if px.get((min(xs) - 1, y)) is None: px[(min(xs) - 1, y)] = K
    for x in range(x0 - 1, x0 + w + 1): px[(x, y0 - 1)] = K
    ys = sorted(rows)
    for i, y in enumerate(ys):
        below = rows.get(y + 1, [])
        for x in rows[y]:
            if x not in below: px[(x, y + 1)] = K
    # the step where the bottom row rounds in
    last = ys[-1]
    for x in (min(rows[last]) - 1, max(rows[last]) + 1): px[(x, last)] = K
    # shine
    if shine == 'front' and w >= 4:
        px[(x0 + 1, y0)] = W; px[(x0, y0 + 1)] = W
        if w >= 5 and h >= 4: px[(x0 + 2, y0)] = G
    elif shine == 'left':
        px[(x0, y0)] = W
    elif shine == 'right':
        px[(x0 + w - 1, y0)] = W
    return cells

def join(px, a, b):
    """Bridge between two frames' top corners: two pixels thick, along a line if the pair is tilted."""
    (x1, y1), (x2, y2) = a, b
    n = max(abs(x2 - x1), abs(y2 - y1), 1)
    for k in range(n + 1):
        x = round(x1 + (x2 - x1) * k / n); y = round(y1 + (y2 - y1) * k / n)
        px[(x, y)] = K
        if px.get((x, y + 1)) not in (L, M, D, W, G): px[(x, y + 1)] = K

def front(lx, ly, rx, ry, w, h):
    px = {}
    cells = lens(px, lx, ly, w, h) + lens(px, rx, ry, w, h)
    join(px, (lx + w, ly - 1), (rx - 1, ry - 1))
    return px, cells, []

def three_quarter(nx, ny, w, h, fx, fy, fw, toward):
    """toward 'r': the face turns right (near lens left, far lens right, arm back to the left)."""
    px = {}
    if toward == 'r':
        cells = lens(px, nx, ny, w, h) + lens(px, fx, fy, fw, h, round_side='right', shine='left')
        join(px, (nx + w, ny - 1), (fx - 1, fy - 1))
        arm = [(nx - 2 - k, ny + (k // 3)) for k in range(4)]
    else:
        cells = lens(px, nx, ny, w, h) + lens(px, fx, fy, fw, h, round_side='left', shine='right')
        join(px, (fx + fw, fy - 1), (nx - 1, ny - 1))
        arm = [(nx + w + 1 + k, ny + (k // 3)) for k in range(4)]
    return px, cells, arm

def profile(x0, y0, w, h, toward):
    """toward 'r': facing right, the lens's back edge slopes in at the bottom, the arm goes left."""
    px = {}
    if toward == 'r':
        cells = lens(px, x0, y0, w, h, round_side='left', shine='right')
        arm = [(x0 - 2 - k, y0) for k in range(5)]
    else:
        cells = lens(px, x0, y0, w, h, round_side='right', shine='left')
        arm = [(x0 + w + 1 + k, y0) for k in range(5)]
    return px, cells, arm

SPEC = {
    '0060': {0: front(-6, -4, 2, -4, 5, 3), 1: three_quarter(-6, -3, 5, 3, 1, -3, 4, 'r'), 7: three_quarter(3, -3, 5, 3, -3, -3, 4, 'l'),
             2: profile(-5, -2, 3, 3, 'r'), 6: profile(4, -2, 3, 3, 'l')},
    '0061': {0: front(-7, -3, 3, -3, 5, 4), 1: three_quarter(-7, -2, 5, 4, 0, -4, 4, 'r'), 7: three_quarter(3, -2, 5, 4, -4, -4, 4, 'l'),
             2: profile(-3, -1, 3, 4, 'r'), 6: profile(2, -1, 3, 4, 'l')},
    '0062': {0: front(-8, -4, 4, -4, 5, 3), 1: three_quarter(-8, -2, 5, 3, 1, -2, 4, 'r'), 7: three_quarter(4, -2, 5, 3, -4, -2, 4, 'l'),
             2: profile(-5, 0, 3, 3, 'r'), 6: profile(4, 0, 3, 3, 'l')},
    '0186': {0: front(-6, -8, 2, -8, 5, 4), 1: three_quarter(-7, -7, 5, 4, 0, -7, 4, 'r'), 7: three_quarter(4, -7, 5, 4, -3, -7, 4, 'l'),
             2: profile(-3, -7, 3, 4, 'r'), 6: profile(3, -7, 3, 4, 'l')},
}

def anims(path):
    r = ET.parse(f'{path}/AnimData.xml').getroot()
    return {a.find('Name').text: (int(a.find('FrameWidth').text), int(a.find('FrameHeight').text)) for a in r.iter('Anim') if a.find('CopyOf') is None}

def head(off, x0, y0, fw, fh):
    for y in range(fh):
        for x in range(fw):
            p = off.getpixel((x0 + x, y0 + y))
            if p[3] > 0 and p[:3] == (0, 0, 0): return (x, y)
    return None

def place(im, ox, oy, fw, fh, hx, hy, glasses, spin=False):
    px_, cells, arm = glasses
    p = im.load()
    def opaque(x, y): return 0 <= x < fw and 0 <= y < fh and p[ox + x, oy + y][3] > 0
    # most of each lens on the face (a pixel or two may stand proud of the outline, as real frames do)
    off_face = [(x, y) for (x, y) in cells if not opaque(hx + x, hy + y)]
    if len(off_face) > max(2, len(cells) // 8): return False
    if any(not any(opaque(hx + x + a, hy + y + b) for a, b in ((1, 0), (-1, 0), (0, 1), (0, -1))) for (x, y) in off_face): return False
    # In a spin (Swing, Rotate) the back of the head comes round in a front-facing row: there the
    # glasses need an eye under them. Anywhere else they stay on even with the eyes shut (that's
    # what sunglasses are for), so they never blink off mid-move.
    if spin and not any(min(p[ox + hx + x, oy + hy + y][:3]) > 200 or max(p[ox + hx + x, oy + hy + y][:3]) < 40 for (x, y) in cells): return False
    for (x, y) in arm:
        if opaque(hx + x, hy + y): p[ox + hx + x, oy + hy + y] = K
    for (x, y), c in px_.items():
        X, Y = hx + x, hy + y
        if not (0 <= X < fw and 0 <= Y < fh): continue
        if not opaque(X, Y) and not any(opaque(X + a, Y + b) for a, b in ((1, 0), (-1, 0), (0, 1), (0, -1))): continue
        p[ox + X, oy + Y] = c
    return True

FACINGS = (0, 1, 7, 2, 6)

def face_patches(dex):
    """The face round each facing's glasses in Idle frame 0 (head-relative), to find that face again in any frame."""
    fw, fh = anims(f'{BASE}/{dex}')['Idle']
    im = np.asarray(Image.open(f'{BASE}/{dex}/Idle-Anim.png').convert('RGBA')).astype(np.int32)
    off = Image.open(f'{BASE}/{dex}/Idle-Offsets.png').convert('RGBA')
    out = {}
    for d in FACINGS:
        hx, hy = head(off, 0, d * fh, fw, fh)
        cells = SPEC[dex][d][1]
        xs = [c[0] for c in cells]; ys = [c[1] for c in cells]
        x0, x1, y0, y1 = min(xs) - 2, max(xs) + 2, min(ys) - 2, max(ys) + 2
        pad = np.zeros((y1 - y0 + 1, x1 - x0 + 1, 4), np.int32)
        for y in range(y0, y1 + 1):
            for x in range(x0, x1 + 1):
                X, Y = hx + x, hy + y
                if 0 <= X < fw and 0 <= Y < fh: pad[y - y0, x - x0] = im[d * fh + Y, X]
        out[d] = (x0, y0, pad)
    return out

def find_face(frame, h, patches, row, R=6):
    """Best (score, facing, dx, dy): which facing's face is in this frame, and where, near the head marker."""
    fh, fw = frame.shape[:2]
    big = np.zeros((fh + 40, fw + 40, 4), np.int32); big[20:20 + fh, 20:20 + fw] = frame
    best = None
    for c in FACINGS:
        x0, y0, P = patches[c]
        ph, pw = P.shape[:2]
        pa = P[..., 3] > 0
        for dy in range(-R, R + 1):
            for dx in range(-R, R + 1):
                X, Y = 20 + h[0] + dx + x0, 20 + h[1] + dy + y0
                if X < 0 or Y < 0 or X + pw > big.shape[1] or Y + ph > big.shape[0]: continue
                Q = big[Y:Y + ph, X:X + pw]
                qa = Q[..., 3] > 0
                both = pa & qa
                diff = np.abs(P[..., :3] - Q[..., :3]).sum(-1)
                sc = (diff[both].sum() + 300 * (pa ^ qa).sum()) / (ph * pw)
                if c == row: sc *= 0.85
                if best is None or sc < best[0]: best = (sc, c, dx, dy)
    return best

def main(dex):
    src, dst = f'{BASE}/{dex}', f'{OUT}/{dex}-rad'
    if os.path.exists(dst): shutil.rmtree(dst)
    shutil.copytree(src, dst)
    done = miss = 0
    patches = face_patches(dex)
    for name, (fw, fh) in anims(src).items():
        im = Image.open(f'{src}/{name}-Anim.png').convert('RGBA')
        off = Image.open(f'{src}/{name}-Offsets.png').convert('RGBA')
        for d in range(im.height // fh):
            if d not in SPEC[dex] and name not in ('Swing', 'Rotate'): continue
            for f in range(im.width // fw):
                if im.crop((f * fw, d * fh, (f + 1) * fw, (d + 1) * fh)).getbbox() is None: continue
                h = head(off, f * fw, d * fh, fw, fh)
                if not h: continue
                # Find the face: which facing it shows (a spin passes through all of them) and where
                # (some moves crouch or lean past the head marker). A spin frame with no face in it
                # (the back of the head) gets no glasses; elsewhere the closest match is used.
                frame = np.asarray(im.crop((f * fw, d * fh, (f + 1) * fw, (d + 1) * fh))).astype(np.int32)
                sc, c, dx, dy = find_face(frame, h, patches, d)
                spin = name in ('Swing', 'Rotate')
                if spin and sc > (160 if c == d else 110): ok = False
                elif sc > 200: ok = False
                else: ok = place(im, f * fw, d * fh, fw, fh, h[0] + dx, h[1] + dy, SPEC[dex][c], spin=spin)
                done += ok; miss += not ok
        im.save(f'{dst}/{name}-Anim.png')
    with open(f'{dst}/credits.txt', 'a') as fh_:
        fh_.write('\nSunglasses added for Shadows of Almia Showdown (a gift for PoliRad Gaming), on the PMD SpriteCollab sprite above.\n')
    print(dex, 'with glasses', done, 'without', miss)

for dex in sys.argv[3:]: main(dex)
