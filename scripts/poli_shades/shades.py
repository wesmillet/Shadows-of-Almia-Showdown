"""Sunglasses on the Poliwag line from the user's shades asset (tools/shadesart.py), per facing.

front:  the pair at sprite size over both eyes.
three-quarter (facings 1 and 7): the same pair, same size, sheared so the line through the lenses
        runs on the diagonal of the turned head (the far side higher), overhanging the far cheek a
        little as real frames do.
profile (2 and 6): one lens seen edge on in front of the eye, and the arm back to the ear.

Each facing's glasses are fitted to Idle frame 0 relative to the head marker. In every frame of
every animation the face is found again (which facing it shows, and where, near the head marker)
and the glasses for that facing drawn there; a spin frame showing the back of the head gets none.
"""
import os, shutil, sys
import xml.etree.ElementTree as ET
import numpy as np
from PIL import Image
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from shadesart import K, B, A, G, W, lens, pair

BASE, OUT = sys.argv[1], sys.argv[2]

class Glasses(dict):
    """A drawing, plus `force`: pixels drawn even where the head isn't (the far lens peeking past
    the face in profile)."""
    force = frozenset()

def sheared(px, tilt, up_right):
    """Shear a drawn pair vertically: one end `tilt` px higher than the other."""
    xs = [x for x, _ in px]
    x0, x1 = min(xs), max(xs)
    span = max(1, x1 - x0)
    out = {}
    for (x, y), c in px.items():
        t = (x - x0) / span if up_right else (x1 - x) / span
        out[(x, round(y - t * tilt))] = c
    # fill one-pixel tears in the frame lines the shear opens up
    for (x, y), c in list(out.items()):
        if c == K and (x + 1, y) not in out and (x + 1, y - 1) in out and out[(x + 1, y - 1)] == K:
            pass
    return out

def profile_px(w, h, toward, arm=5, peek=True):
    """The near lens seen from the side (the same lens, narrower) over the eye, and the arm back to
    the ear. Facing right: the lens's front edge is its right edge and the arm leaves from the left."""
    px = lens(0, 0, w, h, glint=1, rim=False, shine_from=1, gap=1)
    bar = 1
    for k in range(1, arm + 1): px[(-k, bar)] = K
    force = set()
    if peek:
        # the bridge, and the far lens's rim just showing past the front of the face, level
        # with the top of the near lens (above the mouth)
        shape = {(w, bar): K, (w + 1, 0): K, (w + 1, 1): A, (w + 1, 2): K, (w + 2, 1): K}
        for q, c in shape.items(): px[q] = c; force.add(q)
        px = {q: c for q, c in px.items() if c is not None}
        force = {q for q in force if q in px}
    if toward == 'l':
        px = {(w - 1 - x, y): c for (x, y), c in px.items()}
        force = {(w - 1 - x, y) for (x, y) in force}
    g = Glasses(px); g.force = frozenset(force)
    return g

def place_at(px, ox, oy):
    g = Glasses({(x + ox, y + oy): c for (x, y), c in px.items()})
    g.force = frozenset((x + ox, y + oy) for (x, y) in getattr(px, 'force', ()))
    return g

def cells_of(px):
    force = getattr(px, 'force', ())
    return [p for p, c in px.items() if c in (A, B, W, G) and p not in force]

def front(lw, lh, bridge, ox, oy, glint=1):
    px = place_at(pair(lw, lh, bridge, glint=glint, rim=False, bar_row=1, bar_h=2, shine_from=2, gap=1), ox, oy)
    return px

def three_q(lw, lh, bridge, ox, oy, tilt, toward, glint=1, lift=1):
    """The pair turned: sheared so the far end is `tilt` px higher, the far lens lifted `lift` px
    more over the far eye, and the bridge kept one unbroken line between the lenses."""
    bar_row, bar_h = 1, 2
    px = pair(lw, lh, bridge, glint=glint, rim=False, bar_row=bar_row, bar_h=bar_h, shine_from=2, gap=1)
    xs = [x for x, _ in px]; x0, x1 = min(xs), max(xs); span = max(1, x1 - x0)
    rx = 1 + lw + bridge          # the right lens's left edge; the left lens's right edge is lw
    def off(x):
        t = (x - x0) / span if toward == 'r' else (x1 - x) / span
        if toward == 'r': u = 1.0 if x >= rx else max(0.0, (x - lw) / max(1, rx - lw))
        else: u = 1.0 if x <= lw else max(0.0, (rx - x) / max(1, rx - lw))
        return round(t * tilt + u * lift)
    out = {(x, y - off(x)): c for (x, y), c in px.items()}
    # join the bridge: where neighbouring columns step more than a pixel, fill the frame line
    for x in range(lw, rx):
        for b in range(bar_row, bar_row + bar_h):
            ya, yb = b - off(x), b - off(x + 1)
            lo, hi = sorted((ya, yb))
            for y in range(lo + 1, hi):
                for q in ((x, y), (x + 1, y)):
                    if out.get(q, K) == K: out[q] = K; break
    return place_at(out, ox, oy)

def duo(near_w, far_w, lh, ox, oy, toward, arm=5):
    """A side view where the far eye still shows past the face: the near lens, and the far lens seen
    edge on (narrow) sharing its frame edge as the bridge, then the arm back from the near lens.
    ox is the drawing's left edge (lenses only)."""
    near = lens(0, 0, near_w, lh, glint=1, rim=False, shine_from=1, gap=1)
    far = lens(near_w - 1, 0, far_w, lh, glint=1, rim=False, shine_from=1, gap=1)
    px = {**far, **near}
    for y in (1, 2):                     # the bridge: both frame edges joined, two rows deep
        px[(near_w - 1, y)] = K
    for k in range(1, arm + 1): px[(-k, 1)] = K
    w = near_w + far_w - 1
    # the far lens may run past the face's edge (it is in front of the far eye): always drawn
    force = {q for q in far if q[0] > near_w - 1}
    if toward == 'l':
        px = {(w - 1 - x, y): c for (x, y), c in px.items()}
        force = {(w - 1 - x, y) for (x, y) in force}
    g = Glasses(px); g.force = frozenset(force)
    return place_at(g, ox, oy)

def stacked(lw, lh, near, far, arm_y, arm, toward):
    """A side view with the head turned so the eyes sit one above the other: two lenses of the same
    size, the near one over the upper eye and the far one below it (offset along the face), their
    frames touching as the bridge, and the arm from the near lens back to the ear. `near` and `far`
    are the lenses' top-left corners in the right-facing drawing; facing left mirrors it about
    `toward` = ('l', axis) where x -> axis - x."""
    px = {}
    px.update(lens(far[0], far[1], lw, lh, glint=1, rim=False, shine_from=1, gap=1))
    farset = set(px)
    px.update(lens(near[0], near[1], lw, lh, glint=1, rim=False, shine_from=1, gap=1))
    # the bridge: the frames joined where the lenses meet (corners are cut, so fill them)
    a = (near[0] + lw - 1, near[1] + lh - 1)          # the near lens's bottom-right corner
    b = far                                            # the far lens's top-left corner
    n = max(abs(b[0] - a[0]), abs(b[1] - a[1]), 1)
    for i in range(n + 1):
        px[(round(a[0] + (b[0] - a[0]) * i / n), round(a[1] + (b[1] - a[1]) * i / n))] = K
    for k in range(1, arm + 1): px[(near[0] - k, arm_y)] = K
    force = {q for q in farset if q in px and q not in lens(near[0], near[1], lw, lh)}
    if toward != 'r':
        axis = toward[1]
        px = {(axis - x, y): c for (x, y), c in px.items()}
        force = {(axis - x, y) for (x, y) in force}
    g = Glasses(px); g.force = frozenset(force)
    return g

def prof(lw, lh, ox, oy, toward, arm=5):
    return place_at(profile_px(lw, lh, toward, arm), ox, oy)

# Anchors: where each facing's glasses go relative to the head marker of Idle frame 0 (the top-left
# of the drawing, nub included), from the eyes in each view.
SPEC = {
    '0060': {0: front(6, 5, 1, -7, -5), 1: three_q(6, 5, 0, -8, -4, 2, 'r'), 7: three_q(6, 5, 0, -5, -4, 2, 'l'),
             2: prof(5, 5, -6, -3, 'r'), 6: prof(5, 5, 3, -3, 'l')},
    '0061': {0: front(7, 6, 3, -9, -4), 1: three_q(7, 6, 1, -9, -3, 4, 'r'), 7: three_q(7, 6, 3, -6, -3, 3, 'l'),
             2: stacked(4, 5, (-4, -2), (0, 2), -1, 4, 'r'), 6: stacked(4, 5, (-4, -2), (0, 2), -1, 4, ('l', 2))},
    '0062': {0: front(7, 5, 5, -10, -5), 1: three_q(7, 5, 2, -10, -3, 1, 'r'), 7: three_q(7, 5, 2, -7, -3, 1, 'l'),
             2: prof(5, 5, -5, -1, 'r'), 6: prof(5, 5, 3, -1, 'l')},
    '0186': {0: front(6, 6, 3, -8, -8), 1: three_q(6, 7, 2, -9, -7, 1, 'r'), 7: three_q(6, 7, 2, -5, -7, 1, 'l'),
             2: prof(5, 6, -4, -7, 'r'), 6: prof(5, 6, 2, -7, 'l')},
}
FACINGS = (0, 1, 7, 2, 6)
KEEP_FACING = False

def anims(path):
    r = ET.parse(f'{path}/AnimData.xml').getroot()
    return {a.find('Name').text: (int(a.find('FrameWidth').text), int(a.find('FrameHeight').text)) for a in r.iter('Anim') if a.find('CopyOf') is None}

def head(off, x0, y0, fw, fh):
    for y in range(fh):
        for x in range(fw):
            p = off.getpixel((x0 + x, y0 + y))
            if p[3] > 0 and p[:3] == (0, 0, 0): return (x, y)
    return None

def face_patches(dex, spec):
    fw, fh = anims(f'{BASE}/{dex}')['Idle']
    im = np.asarray(Image.open(f'{BASE}/{dex}/Idle-Anim.png').convert('RGBA')).astype(np.int32)
    off = Image.open(f'{BASE}/{dex}/Idle-Offsets.png').convert('RGBA')
    out = {}
    for d in FACINGS:
        hx, hy = head(off, 0, d * fh, fw, fh)
        cells = cells_of(spec[d])
        xs = [c[0] for c in cells]; ys = [c[1] for c in cells]
        x0, x1, y0, y1 = min(xs) - 2, max(xs) + 2, min(ys) - 2, max(ys) + 2
        P = np.zeros((y1 - y0 + 1, x1 - x0 + 1, 4), np.int32)
        for y in range(y0, y1 + 1):
            for x in range(x0, x1 + 1):
                X, Y = hx + x, hy + y
                if 0 <= X < fw and 0 <= Y < fh: P[y - y0, x - x0] = im[d * fh + Y, X]
        out[d] = (x0, y0, P)
    return out

def eye_like(arr, x, y):
    """A white, or a dark pixel inside the body with lighter neighbours (an eye or a pupil, not the outline)."""
    H, Wd = arr.shape[:2]
    if not (0 <= x < Wd and 0 <= y < H) or arr[y, x, 3] == 0: return False
    q = arr[y, x]
    if min(q[:3]) > 200: return True
    if max(q[:3]) >= 40: return False
    n = [(x + a, y + b) for a, b in ((1, 0), (-1, 0), (0, 1), (0, -1))]
    if any(not (0 <= u < Wd and 0 <= v < H) or arr[v, u, 3] == 0 for u, v in n): return False
    return sum(1 for u, v in n if max(arr[v, u, :3]) >= 40) >= 2

def idle_eyes(dex, spec):
    """Head-relative eye pixels under each facing's lenses in Idle frame 0."""
    fw, fh = anims(f'{BASE}/{dex}')['Idle']
    im = np.asarray(Image.open(f'{BASE}/{dex}/Idle-Anim.png').convert('RGBA')).astype(np.int32)
    off = Image.open(f'{BASE}/{dex}/Idle-Offsets.png').convert('RGBA')
    out = {}
    for d in FACINGS:
        hx, hy = head(off, 0, d * fh, fw, fh)
        fr = im[d * fh:(d + 1) * fh, 0:fw]
        out[d] = [(x, y) for (x, y) in cells_of(spec[d]) if eye_like(fr, hx + x, hy + y)]
    return out

def find_face(frame, h, patches, row, R=6, spin=False):
    """Outside spins the frame's own facing is kept unless its face isn't there at all (a move that
    turns the body), so a walk cycle's in-between frames never swap to another facing's glasses."""
    if not spin and row in patches:
        own = best_for(frame, h, patches, [row], R)
        if own[0] <= 120 or KEEP_FACING: return own
    return best_for(frame, h, patches, FACINGS, R)

def best_for(frame, h, patches, facings, R):
    row = facings[0] if len(facings) == 1 else None
    fh, fw = frame.shape[:2]
    big = np.zeros((fh + 40, fw + 40, 4), np.int32); big[20:20 + fh, 20:20 + fw] = frame
    best = None
    for c in facings:
        x0, y0, P = patches[c]
        ph, pw = P.shape[:2]
        pa = P[..., 3] > 0
        for dy in range(-R, R + 1):
            for dx in range(-R, R + 1):
                X, Y = 20 + h[0] + dx + x0, 20 + h[1] + dy + y0
                if X < 0 or Y < 0 or X + pw > big.shape[1] or Y + ph > big.shape[0]: continue
                Q = big[Y:Y + ph, X:X + pw]
                qa = Q[..., 3] > 0
                diff = np.abs(P[..., :3] - Q[..., :3]).sum(-1)
                sc = (diff[pa & qa].sum() + 300 * (pa ^ qa).sum()) / (ph * pw)
                if best is None or sc < best[0]: best = (sc, c, dx, dy)
    return best

def draw(im, ox, oy, fw, fh, hx, hy, px, facing, spin, strict=True):
    p = im.load()
    def opaque(x, y): return 0 <= x < fw and 0 <= y < fh and p[ox + x, oy + y][3] > 0
    force = getattr(px, 'force', frozenset())
    cells = cells_of(px)
    off_face = [(x, y) for (x, y) in cells if not opaque(hx + x, hy + y) and (x, y) not in force]
    # front and profile glasses sit on the face; a three-quarter pair may overhang the far cheek
    allow = len(cells) // 3 if facing in (1, 7) else max(2, len(cells) // 8)
    if strict and len(off_face) > allow: return False
    # in a spin, only where an eye is under the lenses: a white, or a dark pixel inside the body
    # (not the outline), so the back of the head never gets glasses
    def eye(x, y):
        q = p[ox + x, oy + y]
        if min(q[:3]) > 200: return True
        return max(q[:3]) < 40 and all(opaque(x + a, y + b) and max(p[ox + x + a, oy + y + b][:3]) >= 0 for a, b in ((1, 0), (-1, 0), (0, 1), (0, -1))) and sum(1 for a, b in ((1, 0), (-1, 0), (0, 1), (0, -1)) if max(p[ox + x + a, oy + y + b][:3]) >= 40) >= 2
    if spin and sum(1 for (x, y) in cells if (x, y) not in force and opaque(hx + x, hy + y) and eye(hx + x, hy + y)) < 2: return False
    for (x, y), c in px.items():
        X, Y = hx + x, hy + y
        if not (0 <= X < fw and 0 <= Y < fh): continue
        if (x, y) in force: p[ox + X, oy + Y] = c; continue
        # arm pixels only over the head (never a stick in the air)
        if c == K and not opaque(X, Y) and (x, y) not in px or (c == K and not opaque(X, Y) and not any(q in px and px[q] != K for q in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)))):
            continue
        p[ox + X, oy + Y] = c
    return True

def main(dex):
    src, dst = f'{BASE}/{dex}', f'{OUT}/{dex}-rad'
    if os.path.exists(dst): shutil.rmtree(dst)
    shutil.copytree(src, dst)
    global KEEP_FACING
    KEEP_FACING = dex in ('0062',)
    spec = SPEC[dex]
    patches = face_patches(dex, spec)
    eyes = idle_eyes(dex, spec)
    done = miss = 0
    for name, (fw, fh) in anims(src).items():
        im = Image.open(f'{src}/{name}-Anim.png').convert('RGBA')
        off = Image.open(f'{src}/{name}-Offsets.png').convert('RGBA')
        spin = name in ('Swing', 'Rotate')
        for d in range(im.height // fh):
            if d not in spec and not spin: continue
            for f in range(im.width // fw):
                if im.crop((f * fw, d * fh, (f + 1) * fw, (d + 1) * fh)).getbbox() is None: continue
                h = head(off, f * fw, d * fh, fw, fh)
                if not h: continue
                frame = np.asarray(im.crop((f * fw, d * fh, (f + 1) * fw, (d + 1) * fh))).astype(np.int32)
                sc, c, dx, dy = find_face(frame, h, patches, d, spin=spin)
                # in a spin the eyes must be where that facing has them (the back of the head has none)
                seen = sum(1 for (x, y) in eyes[c] if eye_like(frame, h[0] + dx + x, h[1] + dy + y)) if spin else 0
                if spin and (sc > (160 if c == d else 110) or seen * 2 < len(eyes[c])): ok = False
                elif sc > 200: ok = False
                else: ok = draw(im, f * fw, d * fh, fw, fh, h[0] + dx, h[1] + dy, spec[c], c, False)
                if not ok and not spin and d in spec:
                    # never a bare frame in a normal move: the row's own glasses where its face matches best
                    sc2, c2, dx2, dy2 = best_for(frame, h, patches, [d], 6)
                    ok = draw(im, f * fw, d * fh, fw, fh, h[0] + dx2, h[1] + dy2, spec[d], d, False, strict=False)
                done += ok; miss += not ok
                if not ok and d in spec and not spin: print('  BARE', dex, name, 'row', d, 'frame', f)
        im.save(f'{dst}/{name}-Anim.png')
    with open(f'{dst}/credits.txt', 'a') as fh_:
        fh_.write('\nSunglasses (from a shades design by the game\'s developer) added for Shadows of Almia Showdown, a gift for PoliRad Gaming, on the PMD SpriteCollab sprite above.\n')
    print(dex, 'with glasses', done, 'without', miss)

if __name__ == '__main__':
    for dex in sys.argv[3:]: main(dex)
