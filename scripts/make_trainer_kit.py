#!/usr/bin/env python3
"""A second original trainer, "Kit", in the Ranger sheets' format (see make_trainer.py for the
grid, frame order, outline and shading, which this reuses):

  python3 scripts/make_trainer_kit.py        # writes assets/rangers/orig_01.png and its manifest entry

A sporty kid on a first journey: a green bucket hat over short dark hair, a white windbreaker
with teal sleeves and a teal chest stripe, grey cargo shorts, white socks, slate trainers, and a
big orange hiking backpack. A slightly rounder, more cartoony face than Wren.
"""
import json, os, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from PIL import Image  # noqa: E402
from make_trainer import C, Canvas, H, ROOT, W, line  # noqa: E402

C.update({
    'hat': (78, 156, 84), 'hatd': (48, 108, 58), 'khair': (74, 48, 36), 'khairhi': (112, 76, 56),
    'wind': (236, 240, 238), 'teal': (36, 150, 152), 'shorts': (124, 128, 138), 'shortsd': (92, 96, 106),
    'shoe': (64, 72, 96), 'shoed': (46, 52, 72), 'pack': (238, 132, 44), 'packd': (190, 96, 30),
    'cheek': (240, 160, 150), 'kskin': (246, 210, 176), 'zipk': (176, 184, 188),
})


def hat_front(c):
    c.rect(6, 1, 15, 5, 'hat')               # crown
    c.row(0, 8, 13, 'hat')
    c.row(5, 6, 15, 'hatd')                  # band
    c.rect(3, 6, 18, 7, 'hat')               # wide floppy brim
    c.row(7, 4, 17, 'hatd')
    c.put(9, 2, 'white'); c.put(10, 2, 'white')   # a little sheen


def head_front(c):
    c.rect(6, 8, 15, 15, 'kskin')
    c.row(16, 7, 14, 'kskin')
    c.rect(5, 8, 5, 11, 'khair')             # hair peeking out under the brim
    c.rect(16, 8, 16, 11, 'khair')
    c.row(8, 6, 15, 'khair')
    for x in (7, 9, 12, 14):
        c.put(x, 9, 'khair')
    # big round eyes (2x2) with glints, rosy cheeks, a grin
    for ex in (7, 13):
        c.rect(ex, 10, ex + 1, 12, 'eye')
        c.put(ex, 10, 'white')
    c.put(6, 13, 'cheek'); c.put(15, 13, 'cheek')
    c.row(14, 10, 11, 'mouth')
    c.put(9, 13, 'mouth'); c.put(12, 13, 'mouth')
    hat_front(c)


def head_back(c):
    c.rect(6, 8, 15, 15, 'khair')
    c.row(16, 8, 13, 'khair')
    c.rect(5, 8, 16, 12, 'khair')
    for x, y in ((8, 12), (11, 13), (13, 12)):
        c.put(x, y, 'khairhi')
    hat_front(c)
    c.put(9, 2, 'hat'); c.put(10, 2, 'hat')
    c.rect(10, 3, 11, 4, 'hatd')             # back seam


def head_side(c):
    c.rect(6, 8, 13, 15, 'kskin')
    c.row(16, 7, 12, 'kskin')
    c.put(5, 12, 'kskin')                    # nose
    c.rect(11, 8, 15, 14, 'khair')
    c.row(15, 12, 14, 'khair')
    c.row(8, 6, 10, 'khair')
    c.put(6, 9, 'khair')
    c.rect(7, 10, 8, 12, 'eye')
    c.put(7, 10, 'white')
    c.put(9, 13, 'cheek')
    c.row(14, 6, 7, 'mouth')
    c.rect(7, 1, 15, 5, 'hat')
    c.row(0, 9, 13, 'hat')
    c.row(5, 7, 15, 'hatd')
    c.rect(3, 6, 17, 7, 'hat')
    c.row(7, 3, 17, 'hatd')
    c.put(10, 2, 'white')


def torso_front(c, swing=0):
    # the backpack's top corners peek over the shoulders
    c.rect(4, 15, 6, 18, 'pack'); c.rect(15, 15, 17, 18, 'pack')
    c.row(15, 4, 6, 'packd'); c.row(15, 15, 17, 'packd')
    c.rect(7, 17, 14, 24, 'wind')
    c.row(17, 9, 12, 'teal')                 # collar
    c.rect(7, 20, 14, 21, 'teal')            # chest stripe
    c.rect(10, 18, 10, 19, 'zipk'); c.rect(10, 22, 10, 23, 'zipk')
    c.row(24, 7, 14, 'teal')                 # hem
    c.rect(7, 17, 8, 19, 'packd')            # pack straps over the shoulders
    c.rect(13, 17, 14, 19, 'packd')
    for ax, sw in ((4, swing), (16, -swing)):
        c.rect(ax, 18 + sw, ax + 1, 22 + sw, 'teal')
        c.row(22 + sw, ax, ax + 1, 'wind')   # white cuff
        c.rect(ax, 23 + sw, ax + 1, 24 + sw, 'kskin')
    c.rect(6, 19, 6, 23, 'out')
    c.rect(15, 19, 15, 23, 'out')


def torso_back(c, swing=0):
    c.rect(7, 17, 14, 24, 'wind')
    for ax, sw in ((4, swing), (16, -swing)):
        c.rect(ax, 18 + sw, ax + 1, 22 + sw, 'teal')
        c.row(22 + sw, ax, ax + 1, 'wind')
        c.rect(ax, 23 + sw, ax + 1, 24 + sw, 'kskin')
    c.rect(6, 19, 6, 23, 'out')
    c.rect(15, 19, 15, 23, 'out')
    # the big backpack: rolled mat on top, front pocket, side loops
    c.rect(6, 15, 15, 26, 'pack')
    c.rect(7, 14, 14, 15, 'packd')           # rolled mat
    c.row(14, 7, 14, 'teal')
    c.rect(8, 21, 13, 25, 'packd')           # pocket
    c.row(21, 8, 13, 'pack')
    c.put(10, 23, 'zip'); c.put(11, 23, 'zip')
    c.put(6, 19, 'packd'); c.put(15, 19, 'packd')


def torso_side(c, arm=0):
    c.rect(12, 15, 17, 26, 'pack')           # backpack behind
    c.rect(13, 14, 16, 15, 'packd')
    c.row(14, 13, 16, 'teal')
    c.rect(16, 18, 17, 25, 'packd')
    c.rect(8, 17, 13, 24, 'wind')
    c.row(17, 8, 12, 'teal')
    c.row(20, 8, 12, 'teal')
    c.row(24, 8, 13, 'teal')
    c.rect(11, 17, 11, 19, 'packd')          # strap
    if arm == 0:
        c.rect(9, 18, 11, 21, 'teal'); c.row(22, 9, 11, 'wind'); c.rect(10, 23, 11, 24, 'kskin')
        c.rect(8, 19, 8, 22, 'out')
    elif arm < 0:
        c.rect(9, 18, 11, 20, 'teal'); c.rect(7, 20, 9, 21, 'teal'); c.row(22, 6, 8, 'wind')
        c.rect(6, 23, 7, 23, 'kskin')
    else:
        c.rect(10, 18, 12, 20, 'teal'); c.rect(12, 20, 14, 21, 'teal'); c.row(22, 13, 15, 'wind')
        c.rect(14, 23, 15, 23, 'kskin')


def legs_front(c, lift_l=0, lift_r=0):
    for x0, lift in ((7, lift_l), (12, lift_r)):
        c.rect(x0, 25, x0 + 2, 27 - lift, 'shorts')
        c.put(x0 + 1, 26 - lift, 'shortsd')  # cargo pocket
        c.rect(x0, 28 - lift, x0 + 2, 29 - lift, 'kskin')
        c.rect(x0, 30 - lift, x0 + 2, 31 - lift, 'sock')
        bx0, bx1 = (x0 - 1, x0 + 2) if x0 == 7 else (x0, x0 + 3)
        c.rect(bx0, 32 - lift, bx1, 33 - lift, 'shoe')
        c.row(34 - lift, bx0, bx1, 'sole')
    c.rect(10, 26, 11, 33, 'out')


def legs_side(c, front, back, bob):
    hip = 25 + bob
    for fx, far in ((back, True), (front, False)):
        foot_x = 9 + fx
        lift = 1 if (far and fx > 0 and abs(fx) >= 3) else 0
        top = hip
        knee_y = 28 - lift
        kx = round(10 + (foot_x + 1 - 10) * 0.45)
        line(c, 10, top, kx, top + 2, 'shortsd' if far else 'shorts', 3)
        line(c, kx, top + 3, foot_x + 1, 29 - lift, 'kskin', 3)
        c.row(30 - lift, foot_x, foot_x + 2, 'sock')
        c.row(31 - lift, foot_x, foot_x + 2, 'sock')
        c.rect(foot_x - 1, 32 - lift, foot_x + 2, 33 - lift, 'shoed' if far else 'shoe')
        c.row(34 - lift, foot_x - 1, foot_x + 2, 'sole')
        del knee_y


def frame(kind, phase=0):
    c = Canvas()
    if kind in ('down', 'up'):
        lift = {0: (0, 0), 1: (1, 0), 2: (0, 0), 3: (0, 1)}[phase]
        swing = {0: 0, 1: 1, 2: 0, 3: -1}[phase]
        legs_front(c, *lift)
        if kind == 'down':
            torso_front(c, swing)
            head_front(c)
        else:
            torso_back(c, swing)
            head_back(c)
    else:
        strides = [(0, 0, 0), (-4, 3, 0), (-2, 2, 1), (0, 0, 0), (3, -4, 0), (2, -2, 1)]
        f, b, bob = strides[phase % 6]
        legs_side(c, f, b, bob)
        torso_side(c, arm=(1 if f < 0 else -1 if f > 0 else 0))
        head_side(c)
    return c.image()


def main():
    frames = [frame('down'), frame('left'), frame('up')]
    frames += [frame('left', i) for i in range(6)]
    frames += [frame('down', i) for i in (1, 2, 3)]
    frames += [frame('up', i) for i in (1, 2, 3)]
    sheet = Image.new('RGBA', (W * len(frames), H), (0, 0, 0, 0))
    for i, f in enumerate(frames):
        sheet.alpha_composite(f, (i * W, 0))
    sheet.save(os.path.join(ROOT, 'assets', 'rangers', 'orig_01.png'))
    mp = os.path.join(ROOT, 'assets', 'rangers', 'manifest.json')
    man = json.load(open(mp))
    man['characters']['orig_01'] = {'file': 'orig_01.png', 'frame_w': W, 'frame_h': H, 'frames': len(frames), 'anchor': 'bottom-center'}
    json.dump(man, open(mp, 'w'), indent=2, ensure_ascii=False)
    open(mp, 'a').write('\n')
    print('wrote orig_01.png,', len(frames), 'frames')


if __name__ == '__main__':
    main()
