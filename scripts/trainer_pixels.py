#!/usr/bin/env python3
"""Original trainer looks drawn pixel by pixel in the Union Ranger sheets' style and format
(assets/rangers/manifest.json): 22x34 cells, 15 frames (idle down/left/up, walk left x6, walk down
x3, walk up x3), feet on row 31 with the outline below them, anchored bottom-centre.

  python3 scripts/trainer_pixels.py          # writes assets/rangers/orig_00.png (Wren), orig_01.png (Kit)

Ranger proportions: a head about 11 px tall and 11 wide (rows 1-11), a narrow neck, a torso with the
arms tight to it and big 3-px hands (rows 13-21), short legs (22-26) and chunky shoes with a
highlight, a toe cap and a light sole (27-31). Black outlines, inside as well as out; the hair's
outer edge is outlined in its own darkest tone.

Each look is written as character maps (one letter per pixel, `.` empty) for the head and torso
in the three views, plus a leg, a shoe and arm pieces the walk frames are assembled from.
"""
import json, os
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
W, H = 22, 34
BLACK = (16, 12, 20)


def grid():
    return [['.'] * W for _ in range(H)]


def stamp(g, y, x, chars):
    for i, ch in enumerate(chars):
        if ch != '.' and 0 <= x + i < W and 0 <= y < H:
            g[y][x + i] = ch


def stamp_rows(g, rows, y0=0, dy=0):
    for i, row in enumerate(rows):
        assert len(row) <= W, (i, row, len(row))
        stamp(g, y0 + i + dy, 0, row)


def mirror(s):
    return s[::-1]


def render(g, pal, hair_chars):
    """Colours the map and outlines it: hair edges in the hair outline colour, the rest black."""
    im = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    px = im.load()
    for y in range(H):
        for x in range(W):
            ch = g[y][x]
            if ch == '.':
                continue
            px[x, y] = (*(BLACK if ch == 'k' else pal[ch]), 255)
    for y in range(H):
        for x in range(W):
            if g[y][x] != '.':
                continue
            near = [g[y + dy][x + dx] for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)) if 0 <= x + dx < W and 0 <= y + dy < H]
            near = [c for c in near if c != '.']
            if not near:
                continue
            col = pal['h'] if all(c in hair_chars for c in near) else BLACK
            px[x, y] = (*col, 255)
    return im


# ------------------------------------------------------------------ shared assembly

def legs_front(g, look, lift_l=0, lift_r=0, back=False):
    """Two legs (rows 22-26) and shoes (27-31); a lifted foot sits a pixel higher."""
    leg, shoe = look['leg'], (look['shoe_back'] if back else look['shoe'])
    for side, lift in (('l', lift_l), ('r', lift_r)):
        for i, row in enumerate(leg):
            if i < lift:
                continue
            stamp(g, 22 + i - lift, 7 if side == 'l' else 11, row if side == 'l' else mirror(row))
        for i, row in enumerate(shoe):
            stamp(g, 27 + i - lift, 5 if side == 'l' else 11, row if side == 'l' else mirror(row))
    for y in range(22, 27):
        g[y][10] = 'k'


def thick_line(g, x0, y0, x1, y1, chars):
    """A 3-wide leg from (x0, y0) to (x1, y1); chars = left, middle, right tone, or a dict of
    {rows below the hip: tones} for legs that change down their length (shorts, skin, socks)."""
    n = max(abs(x1 - x0), abs(y1 - y0), 1)
    for i in range(n + 1):
        x = round(x0 + (x1 - x0) * i / n)
        y = round(y0 + (y1 - y0) * i / n)
        c = chars
        if isinstance(chars, dict):
            c = chars[max(k for k in chars if k <= y - y0)]
        stamp(g, y, x - 1, c)


def legs_side(g, look, near_dx, far_dx, near_lift=0, far_lift=0):
    """Side-on legs (facing left): far leg first, in its darker tones; feet are offsets from the hip."""
    for dx, lift, far in ((far_dx, far_lift, True), (near_dx, near_lift, False)):
        chars = look['leg_side_far'] if far else look['leg_side']
        hip_x = 11 if far else 9
        foot = 10 + dx
        thick_line(g, hip_x, 22, foot, 27 - lift, chars)
        shoe = look['shoe_side_far'] if far else look['shoe_side']
        for i, row in enumerate(shoe):
            stamp(g, 28 + i - lift, foot - 3, row)


def frame(look, kind, phase=0):
    g = grid()
    if kind in ('down', 'up'):
        lift = {0: (0, 0), 1: (1, 0), 2: (0, 0), 3: (0, 1)}[phase]
        legs_front(g, look, *lift, back=(kind == 'up'))
        stamp_rows(g, look[kind])
        # arms swing a pixel with the stride
        sw = {0: 0, 1: 1, 2: 0, 3: -1}[phase]
        if sw:
            shift_arm(g, 2, 6, sw)
            shift_arm(g, 14, 18, -sw)
    else:
        strides = [
            dict(near_dx=-1, far_dx=1),
            dict(near_dx=-4, far_dx=3, far_lift=1),
            dict(near_dx=-1, far_dx=2, far_lift=2),
            dict(near_dx=-1, far_dx=1),
            dict(near_dx=3, far_dx=-3, near_lift=1),
            dict(near_dx=1, far_dx=-1, near_lift=2),
        ]
        st = strides[phase % 6]
        legs_side(g, look, **st)
        stamp_rows(g, look['left'])
        arm = 'hang'
        if phase % 6 in (1, 2):
            arm = 'back'
        elif phase % 6 in (4, 5):
            arm = 'fwd'
        for y, x, chars in look['arm_side'][arm]:
            stamp(g, y, x, chars)
    return render(g, look['pal'], look['hair_chars'])


def shift_arm(g, x0, x1, dy):
    """Moves the hand rows (18-21) of one arm up or down a pixel."""
    rows = [[g[y][x] for x in range(x0, x1 + 1)] for y in range(17, 22)]
    for i, y in enumerate(range(17, 22)):
        src = i - dy
        for j, x in enumerate(range(x0, x1 + 1)):
            if 0 <= src < len(rows):
                ch = rows[src][j]
                if ch != '.' or g[y][x] in 'SsnTtk':
                    g[y][x] = ch if ch != '.' else g[y][x]


def sheet(look, out):
    frames = [frame(look, 'down'), frame(look, 'left'), frame(look, 'up')]
    frames += [frame(look, 'left', i) for i in range(6)]
    frames += [frame(look, 'down', i) for i in (1, 2, 3)]
    frames += [frame(look, 'up', i) for i in (1, 2, 3)]
    sh = Image.new('RGBA', (W * len(frames), H), (0, 0, 0, 0))
    for i, f in enumerate(frames):
        sh.alpha_composite(f, (i * W, 0))
    sh.save(os.path.join(ROOT, 'assets', 'rangers', out + '.png'))
    return len(frames)


# ------------------------------------------------------------------ Wren
# Messy auburn hair, amber goggles pushed up, mustard anorak with teal collar, cuffs and hem,
# a satchel on a strap, teal trousers, brown hiking boots.

WREN = {
    'pal': {
        'h': (76, 26, 8), 'H': (128, 48, 20), 'R': (178, 80, 40), 'r': (226, 128, 76),
        'S': (248, 216, 192), 's': (212, 160, 124), 'n': (160, 104, 76), 'w': (248, 248, 248), 'm': (184, 96, 84),
        'g': (64, 56, 64), 'G': (240, 150, 30), 'L': (255, 224, 130),
        'J': (228, 180, 56), 'Y': (252, 222, 120), 'j': (176, 126, 32), 'q': (104, 66, 16),
        'T': (40, 140, 140), 't': (20, 88, 92),
        'B': (186, 128, 70), 'b': (146, 90, 44), 'x': (92, 54, 24),
        'P': (44, 108, 112), 'p': (26, 70, 76), 'Q': (78, 146, 146),
        'O': (126, 78, 42), 'o': (80, 46, 22), 'U': (178, 122, 72), 'W': (212, 176, 132), 'V': (150, 112, 78),
    },
    'hair_chars': 'hHRr',
    #        0123456789012345678901
    'down': [
        "......................",
        "........h.hh.h........",
        ".......hRRhRRhh.......",
        "......hRrRRRrRRh......",
        ".....hgGLgggGLgh......",
        ".....hRggRrRggRh......",
        ".....hRHSHRSHRHh......",
        ".....hHSSSSSSSHh......",
        ".....hHSkSSSkSHh......",
        ".....kswkSSSkwsk......",
        "......ksSSSSSsk.......",
        ".......ksSnSsk........",
        "........knnnk.........",
        "......qjTTnTTjq.......",
        ".....qYJJJJJJxJq......",
        "....qYJkJJjJxkJjq.....",
        "....qYJkJJjxJkJjq.....",
        "....qTtkJJxjJktTq.....",
        "...kSSskJxjJJkSSsk....",
        "...ksSnkBBBbJkSsnk....",
        "....knnkBbBbTknnk.....",
        ".......kbbbbTk........",
    ],
    'up': [
        "......................",
        "........h.hh.h........",
        ".......hRRhRRhh.......",
        "......hRrRRRrRRh......",
        ".....hRrRRRRRrRh......",
        ".....hgggggggggh......",
        ".....hRRrRRRrRRh......",
        ".....hRrRRRRRrRh......",
        ".....hHRRRrRRRHh......",
        ".....hHRRRRRRRHh......",
        "......hHRHRHRHh.......",
        ".......hHnnnHh........",
        "........knnnk.........",
        "......qjTTTTTjq.......",
        ".....qYJxJJJJJJq......",
        "....qYJkJxJJJkJjq.....",
        "....qYJkJJxJJkJjq.....",
        "....qTtkJJJxJktTq.....",
        "...kSSskJJJJxkSSsk....",
        "...ksSnkJJjBBBbSnk....",
        "....knnkjjjBbBbnk.....",
        ".......kTTTbbbbk......",
    ],
    'left': [
        "......................",
        ".........h.hh.h.......",
        "........hRRhRRhh......",
        ".......hRrRRRRrRh.....",
        "......hgGLgRRRRRRh....",
        ".....hRgggRRrRRRRh....",
        ".....hHSHRRRRRRRRh....",
        ".....hSSSHRRRRRRRh....",
        "....kSSkSSsRRRRRRh....",
        "....kSSkwSsnRRRRh.....",
        ".....kSSSSsnRRRh......",
        "......kmSssRRhh.......",
        ".......knnnk..........",
        "......qTTTTTjq........",
        "......qYJJJJJjbq......",
        "......qYJJJJJjBbq.....",
        "......qYJJJJJjBbq.....",
        "......qYJJJJJjbbq.....",
        "......qYJJJJJjxbq.....",
        "......qjJJJJJjq.......",
        "......qTTTTTTtq.......",
        ".......kPPPPPk........",
    ],
    'arm_side': {
        'hang': [(14, 8, "qYJjq"), (15, 8, "qYJjq"), (16, 8, "qYJjq"), (17, 8, "qYJjq"), (18, 8, "qTTtq"), (19, 8, "kSSsk"), (20, 9, "snk")],
        'fwd': [(14, 7, "qYJjq"), (15, 6, "qYJjq"), (16, 5, "qYJjq"), (17, 4, "qTTtq"), (18, 4, "kSSsk"), (19, 5, "snk")],
        'back': [(14, 9, "qYJjq"), (15, 10, "qJJjq"), (16, 11, "qJJjq"), (17, 12, "qTTtq"), (18, 13, "kSSsk"), (19, 14, "snk")],
    },
    'leg': ["QPp", "QPp", "QPp", "QpP", "UOo"],
    'shoe': [".oUOo", "oUUOo", "oOOOo", "WWWWV", ".VVV."],
    'shoe_back': [".oOOo", "oOOOo", "oOOoo", "VWWWV", ".VVV."],
    'leg_side': "QPp",
    'leg_side_far': "ppp",
    'shoe_side': [".UOo.", "UUOOo", "OOOOo", "WWWWV"],
    'shoe_side_far': [".oOo.", "oOOOo", "ooooo", "VVVVV"],
}


# ------------------------------------------------------------------ Kit
# A sporty kid on a first journey: green bucket hat over short dark hair, a white windbreaker with
# teal sleeves, chest stripe and hem, grey cargo shorts, white socks, slate trainers with a white
# stripe, and a big orange hiking backpack (its top corners peek over the shoulders from the front).

KIT = {
    'pal': {
        'h': (40, 24, 18), 'H': (74, 48, 36), 'R': (112, 76, 56),
        'A': (78, 156, 84), 'a': (128, 200, 124), 'z': (40, 96, 50), 'Z': (30, 70, 40),
        'S': (248, 216, 192), 's': (212, 160, 124), 'n': (160, 104, 76), 'w': (248, 248, 248), 'c': (240, 158, 148),
        'X': (242, 244, 242), 'x': (196, 204, 210), 'y': (110, 118, 128),
        'T': (36, 150, 152), 't': (20, 98, 104),
        'K': (238, 132, 44), 'D': (178, 88, 26), 'E': (255, 182, 100),
        'G': (124, 128, 138), 'g': (88, 92, 102), 'I': (164, 168, 176), 'F': (236, 236, 236),
        'O': (70, 80, 106), 'o': (42, 48, 70), 'U': (112, 126, 154), 'W': (234, 234, 230), 'V': (170, 170, 176),
    },
    'hair_chars': 'hHR',
    #        0123456789012345678901
    'down': [
        "......................",
        "........zAAAz.........",
        ".......zAaaAAz........",
        "......zAaAAAAAz.......",
        "......zZZZZZZZz.......",
        "....zAAAAAAAAAAAz.....",
        ".....hHHSHHHSHHh......",
        ".....hHSSSSSSSHh......",
        ".....hHSkSSSkSHh......",
        ".....kswkSSSkwsk......",
        "......kcSSSSSck.......",
        ".......ksSnSsk........",
        "....EK..knnnk..KE.....",
        "....KDyTTXnXTTyDK.....",
        ".....yXDXXXXXDXy......",
        "....yTTkDXXXDkTTy.....",
        "....yTtkTTTTTktTy.....",
        "....yXxkXXXXXkxXy.....",
        "...kSSskXXxXXkSSsk....",
        "...ksSnkXXxXxkSsnk....",
        "....knnkxxxxxknnk.....",
        ".......kTTTTTk........",
    ],
    'up': [
        "......................",
        "........zAAAz.........",
        ".......zAAAAAz........",
        "......zAAAAAAAz.......",
        "......zZZZZZZZz.......",
        "....zAAAAAAAAAAAz.....",
        ".....hHHHHHHHHHh......",
        ".....hHRHHHHRHHh......",
        ".....hHHHRHHHHHh......",
        ".....hHHHHHHHHHh......",
        "......hHRHHHRHh.......",
        ".......hHnnnHh........",
        ".....tTTTTTTTTTt......",
        "....yTDEKKKKKKDTy.....",
        "....yTDEKKKKKKDTy.....",
        "....yTDKDDDDDKDTy.....",
        "....yTDKDKKKDKDTy.....",
        "....yXDKDKKKDKDXy.....",
        "...kSSDKDDDDDKDSSk....",
        "...ksSDKKKKKKKDSsk....",
        "....knDDDDDDDDDnk.....",
        ".......kTTTTTk........",
    ],
    'left': [
        "......................",
        ".........zAAAz........",
        "........zAaAAAz.......",
        ".......zAaAAAAAz......",
        ".......zZZZZZZZz......",
        "...zAAAAAAAAAAAAz.....",
        ".....hHSHHHHHHHh......",
        ".....hSSSHHRHHHh......",
        "....kSSkSSsHHHHh......",
        "....kSSkwSsnHHHh......",
        ".....kcSSSsnHHh.......",
        "......ksSssHHh........",
        ".......knnnk.EKK......",
        "......yTTTTTyDKKE.....",
        "......yXXXXXyDKKE.....",
        "......yXXXXXyDKKE.....",
        "......yTTTTTyDKKK.....",
        "......yXXXXXyDKKD.....",
        "......yXXXXXyDKKD.....",
        "......yxXXXXyDDDD.....",
        "......yTTTTTTtDD......",
        ".......kGGGGGk........",
    ],
    'arm_side': {
        'hang': [(14, 8, "yTTty"), (15, 8, "yTTty"), (16, 8, "yTTty"), (17, 8, "yTTty"), (18, 8, "yXXxy"), (19, 8, "kSSsk"), (20, 9, "snk")],
        'fwd': [(14, 7, "yTTty"), (15, 6, "yTTty"), (16, 5, "yTTty"), (17, 4, "yXXxy"), (18, 4, "kSSsk"), (19, 5, "snk")],
        'back': [(14, 9, "yTTty"), (15, 10, "yTTty"), (16, 11, "yTTty"), (17, 12, "yXXxy"), (18, 13, "kSSsk"), (19, 14, "snk")],
    },
    'leg': ["IGg", "IGg", "SSs", "FFF", "FFx"],
    'shoe': [".oUOo", "oUWOo", "oOOOo", "WWWWV", ".VVV."],
    'shoe_back': [".oOOo", "oOWOo", "oOOoo", "VWWWV", ".VVV."],
    'leg_side': {0: "IGg", 2: "SSs", 4: "FFF"},
    'leg_side_far': {0: "ggg", 2: "sss", 4: "xxx"},
    'shoe_side': [".UOo.", "UUWOo", "OOOOo", "WWWWV"],
    'shoe_side_far': [".oOo.", "oOOOo", "ooooo", "VVVVV"],
}


def main():
    looks = {'orig_00': WREN, 'orig_01': KIT}
    mp = os.path.join(ROOT, 'assets', 'rangers', 'manifest.json')
    man = json.load(open(mp))
    for key, look in looks.items():
        n = sheet(look, key)
        man['characters'][key] = {'file': key + '.png', 'frame_w': W, 'frame_h': H, 'frames': n, 'anchor': 'bottom-center'}
        print('wrote', key, n, 'frames')
    json.dump(man, open(mp, 'w'), indent=2, ensure_ascii=False)
    open(mp, 'a').write('\n')


if __name__ == '__main__':
    main()
