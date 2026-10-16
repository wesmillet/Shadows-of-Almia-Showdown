#!/usr/bin/env python3
"""An original trainer sheet in the Ranger sheets' format (assets/rangers/manifest.json):
22x36 cells, 15 frames (idle down/left/up, walk left x6, walk down x3, walk up x3), feet on the
bottom row, black outline, three-tone shading.

  python3 scripts/make_trainer.py            # writes assets/rangers/orig_00.png and the manifest entry

"Wren", a field explorer: messy auburn hair, amber goggles pushed up on the forehead, a mustard
anorak with teal trim, a satchel on a brown strap, teal cargo trousers, brown hiking boots.
Drawn shape by shape on a pixel grid; the outline and the shading are added in passes.
"""
import json, os
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
W, H = 22, 36

# base colours; each gets a highlight and a shadow tone
C = {
    'skin': (244, 204, 168), 'hair': (168, 72, 40), 'jacket': (226, 178, 52), 'trim': (36, 132, 132),
    'pants': (40, 104, 108), 'boot': (120, 74, 40), 'sole': (232, 228, 216), 'strap': (110, 62, 30),
    'bag': (150, 94, 46), 'lens': (255, 176, 40), 'band': (40, 60, 70), 'eye': (30, 30, 40), 'zip': (180, 132, 30),
    'sock': (236, 236, 236),
}
OUT = (16, 14, 20)


def tone(rgb, k):
    return tuple(max(0, min(255, int(v * k))) for v in rgb)


class Canvas:
    def __init__(self):
        self.px = [[None] * W for _ in range(H)]

    def put(self, x, y, c):
        if 0 <= x < W and 0 <= y < H:
            self.px[y][x] = c

    def rect(self, x0, y0, x1, y1, c):
        for y in range(y0, y1 + 1):
            for x in range(x0, x1 + 1):
                self.put(x, y, c)

    def row(self, y, x0, x1, c):
        self.rect(x0, y, x1, y, c)

    def image(self):
        im = Image.new('RGBA', (W, H), (0, 0, 0, 0))
        filled = [[self.px[y][x] is not None for x in range(W)] for y in range(H)]
        for y in range(H):
            for x in range(W):
                c = self.px[y][x]
                if c is None:
                    continue
                if c in ('eye', 'out'):
                    im.putpixel((x, y), (*(C['eye'] if c == 'eye' else OUT), 255))
                    continue
                base = C[c]
                # shade: darker where the shape ends below/right, lighter where it starts above/left
                below = y + 1 >= H or self.px[y + 1][x] != c
                right = x + 1 >= W or self.px[y][x + 1] != c
                above = y == 0 or self.px[y - 1][x] != c
                left = x == 0 or self.px[y][x - 1] != c
                k = 1.0
                if below or right:
                    k = 0.78
                elif above or left:
                    k = 1.12
                im.putpixel((x, y), (*tone(base, k), 255))
        # outline every empty pixel touching the figure
        out = im.copy()
        for y in range(H):
            for x in range(W):
                if filled[y][x]:
                    continue
                if any(0 <= x + dx < W and 0 <= y + dy < H and filled[y + dy][x + dx] for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1))):
                    out.putpixel((x, y), (*OUT, 255))
        return out


# ------------------------------------------------------------------ parts
C['white'] = (250, 250, 250)
C['mouth'] = (196, 120, 100)
C['rim'] = (70, 60, 50)
C['hairhi'] = (214, 112, 66)
C['pantsd'] = (28, 76, 80)
C['bootd'] = (88, 54, 30)


def line(c, x0, y0, x1, y1, col, w=3):
    """A thick pixel line (legs)."""
    n = max(abs(x1 - x0), abs(y1 - y0), 1)
    for i in range(n + 1):
        x = round(x0 + (x1 - x0) * i / n)
        y = round(y0 + (y1 - y0) * i / n)
        c.rect(x - w // 2, y, x - w // 2 + w - 1, y, col)


def boot(c, x, y, toe):
    """A hiking boot with its sole: x is the heel side, toe = -1 (toe left) or +1."""
    xs = (x, x + 3) if toe > 0 else (x - 3, x)
    c.rect(xs[0], y - 2, xs[1], y - 1, 'boot')
    c.row(y, xs[0], xs[1], 'sole')
    c.put(x if toe > 0 else x, y - 3, 'sock')


def head_front(c):
    # rounded face
    c.rect(6, 8, 15, 15, 'skin')
    c.row(16, 7, 14, 'skin')
    # hair: crown, spikes, fringe, sideburns
    c.rect(6, 3, 15, 7, 'hair')
    c.row(2, 7, 14, 'hair')
    c.rect(5, 4, 16, 7, 'hair')
    for x, y in ((7, 1), (10, 0), (11, 1), (14, 1), (4, 5), (17, 5), (16, 3)):
        c.put(x, y, 'hair')
    for x in (6, 7, 9, 10, 12, 14, 15):
        c.put(x, 8, 'hair')                  # jagged fringe
    for x in (6, 10, 15):
        c.put(x, 9, 'hair')
    c.rect(5, 8, 5, 12, 'hair')
    c.rect(16, 8, 16, 12, 'hair')
    # goggles pushed up on the hair: rimmed lenses with a glint, strap round the head
    c.row(5, 5, 16, 'rim')
    for lx in (7, 12):
        c.rect(lx - 1, 4, lx + 2, 6, 'rim')
        c.rect(lx, 4, lx + 1, 5, 'lens')
        c.put(lx, 4, 'white')
    # eyes with a glint, mouth
    for ex in (8, 13):
        c.put(ex, 11, 'eye'); c.put(ex, 12, 'eye'); c.put(ex, 11, 'eye')
        c.put(ex - 1 if ex == 8 else ex + 1, 11, 'white')
    c.row(14, 10, 11, 'mouth')


def head_back(c):
    c.rect(6, 3, 15, 15, 'hair')
    c.rect(5, 4, 16, 13, 'hair')
    c.row(2, 7, 14, 'hair')
    c.row(16, 8, 13, 'hair')
    for x, y in ((7, 1), (10, 0), (11, 1), (14, 1), (4, 5), (17, 5), (16, 3), (6, 14), (15, 14)):
        c.put(x, y, 'hair')
    c.row(6, 5, 16, 'rim')                   # goggle strap round the back
    c.rect(10, 5, 11, 7, 'rim')              # buckle


def head_side(c):
    # profile facing left
    c.rect(6, 8, 13, 15, 'skin')
    c.row(16, 7, 12, 'skin')
    c.put(5, 12, 'skin')                     # nose
    c.rect(7, 2, 15, 7, 'hair')
    c.rect(11, 6, 16, 14, 'hair')            # back of the head
    c.row(15, 12, 15, 'hair')
    for x, y in ((8, 1), (11, 0), (14, 1), (17, 4), (17, 8), (16, 15), (6, 3)):
        c.put(x, y, 'hair')
    for x in (6, 7, 9):
        c.put(x, 8, 'hair')
    c.row(5, 6, 16, 'rim')
    c.rect(5, 4, 8, 6, 'rim')                # one lens, side on
    c.rect(6, 4, 7, 5, 'lens')
    c.put(6, 4, 'white')
    c.put(8, 11, 'eye'); c.put(8, 12, 'eye'); c.put(7, 11, 'white')
    c.row(14, 6, 7, 'mouth')


def hair_shine(c, pts):
    for x, y in pts:
        c.put(x, y, 'hairhi')


def torso_front(c, swing=0):
    c.rect(7, 17, 14, 24, 'jacket')
    c.row(17, 8, 13, 'trim')                 # collar
    c.rect(10, 18, 11, 23, 'zip')
    c.row(24, 7, 14, 'trim')                 # hem
    for ax, sw in ((4, swing), (16, -swing)):
        c.rect(ax, 18 + sw, ax + 1, 21 + sw, 'jacket')
        c.row(22 + sw, ax, ax + 1, 'trim')   # cuff
        c.rect(ax, 23 + sw, ax + 1, 24 + sw, 'skin')
    c.rect(6, 19, 6, 23, 'out')
    c.rect(15, 19, 15, 23, 'out')
    for i, y in enumerate(range(18, 23)):
        c.put(13 - i, y, 'strap')
    c.rect(5, 22, 8, 25, 'bag')
    c.row(22, 5, 8, 'strap')
    c.put(7, 23, 'zip')


def torso_back(c, swing=0):
    c.rect(7, 17, 14, 24, 'jacket')
    c.rect(8, 17, 13, 18, 'trim')            # hood folded at the neck
    c.row(24, 7, 14, 'trim')
    for ax, sw in ((4, swing), (16, -swing)):
        c.rect(ax, 18 + sw, ax + 1, 21 + sw, 'jacket')
        c.row(22 + sw, ax, ax + 1, 'trim')
        c.rect(ax, 23 + sw, ax + 1, 24 + sw, 'skin')
    c.rect(6, 19, 6, 23, 'out')
    c.rect(15, 19, 15, 23, 'out')
    for i, y in enumerate(range(18, 23)):
        c.put(8 + i, y, 'strap')
    c.rect(13, 22, 16, 25, 'bag')
    c.row(22, 13, 16, 'strap')


def torso_side(c, arm=0):
    c.rect(8, 17, 13, 24, 'jacket')
    c.row(17, 8, 12, 'trim')
    c.row(24, 8, 13, 'trim')
    c.rect(13, 20, 16, 24, 'bag')            # satchel behind
    c.row(20, 13, 16, 'strap')
    c.put(15, 22, 'zip')
    # near arm: hangs, or reaches forward (arm < 0) / back (arm > 0) with the stride
    if arm == 0:
        c.rect(9, 18, 11, 21, 'jacket'); c.row(22, 9, 11, 'trim'); c.rect(10, 23, 11, 24, 'skin')
        c.rect(8, 19, 8, 22, 'out')
    elif arm < 0:
        c.rect(9, 18, 11, 20, 'jacket'); c.rect(7, 20, 9, 21, 'jacket'); c.row(22, 6, 8, 'trim')
        c.rect(6, 23, 7, 23, 'skin')
    else:
        c.rect(10, 18, 12, 20, 'jacket'); c.rect(12, 20, 14, 21, 'jacket'); c.row(22, 13, 15, 'trim')
        c.rect(14, 23, 15, 23, 'skin')


def legs_front(c, lift_l=0, lift_r=0):
    for x0, lift in ((7, lift_l), (12, lift_r)):
        c.rect(x0, 25, x0 + 2, 30 - lift, 'pants')
        c.put(x0 + 1 if x0 == 7 else x0 + 1, 28 - lift, 'trim')   # cargo pocket
        c.row(31 - lift, x0, x0 + 2, 'sock')
        bx0, bx1 = (x0 - 1, x0 + 2) if x0 == 7 else (x0, x0 + 3)
        c.rect(bx0, 32 - lift, bx1, 33 - lift, 'boot')
        c.row(34 - lift, bx0, bx1, 'sole')
    c.rect(10, 26, 11, 33, 'out')            # gap between the legs


def legs_side(c, front, back, bob):
    """Stride seen side on (facing left). front/back: foot x offsets from the hip; the far leg is darker."""
    hip = 25 + bob
    for fx, col, far in ((back, 'pantsd', True), (front, 'pants', False)):
        foot_x = 9 + fx
        lift = 1 if (far and fx > 0 and abs(fx) >= 3) else 0
        line(c, 10, hip, foot_x + 1, 30 - lift, col, 3)
        c.row(31 - lift, foot_x, foot_x + 2, 'sock')
        c.rect(foot_x - 1, 32 - lift, foot_x + 2, 33 - lift, 'bootd' if far else 'boot')
        c.row(34 - lift, foot_x - 1, foot_x + 2, 'sole')


def frame(kind, phase=0):
    c = Canvas()
    if kind in ('down', 'up'):
        lift = {0: (0, 0), 1: (1, 0), 2: (0, 0), 3: (0, 1)}[phase]
        swing = {0: 0, 1: 1, 2: 0, 3: -1}[phase]
        legs_front(c, *lift)
        if kind == 'down':
            torso_front(c, swing)
            head_front(c)
            hair_shine(c, ((8, 3), (9, 3), (10, 2), (13, 3), (14, 4)))
        else:
            torso_back(c, swing)
            head_back(c)
            hair_shine(c, ((8, 3), (9, 3), (10, 2), (13, 3), (8, 9), (9, 10), (13, 9)))
    else:  # facing left
        strides = [(0, 0, 0), (-4, 3, 0), (-2, 2, 1), (0, 0, 0), (3, -4, 0), (2, -2, 1)]
        f, b, bob = strides[phase % 6]
        legs_side(c, f, b, bob)
        torso_side(c, arm=(1 if f < 0 else -1 if f > 0 else 0))
        head_side(c)
        hair_shine(c, ((9, 3), (10, 2), (12, 3), (14, 6), (14, 9)))
    return c.image()


def main():
    frames = [frame('down'), frame('left'), frame('up')]
    frames += [frame('left', i) for i in range(6)]          # walk_left 3-8
    frames += [frame('down', i) for i in (1, 2, 3)]          # walk_down 9-11
    frames += [frame('up', i) for i in (1, 2, 3)]            # walk_up 12-14
    sheet = Image.new('RGBA', (W * len(frames), H), (0, 0, 0, 0))
    for i, f in enumerate(frames):
        sheet.alpha_composite(f, (i * W, 0))
    sheet.save(os.path.join(ROOT, 'assets', 'rangers', 'orig_00.png'))
    mp = os.path.join(ROOT, 'assets', 'rangers', 'manifest.json')
    man = json.load(open(mp))
    man['characters']['orig_00'] = {'file': 'orig_00.png', 'frame_w': W, 'frame_h': H, 'frames': len(frames), 'anchor': 'bottom-center'}
    json.dump(man, open(mp, 'w'), indent=2, ensure_ascii=False)
    open(mp, 'a').write('\n')
    print('wrote orig_00.png,', len(frames), 'frames')


if __name__ == '__main__':
    main()
