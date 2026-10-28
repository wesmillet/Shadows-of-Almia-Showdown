#!/usr/bin/env python3
"""Stand-in sprite sheets for species SpriteCollab has not drawn yet.

SpriteCollab (the game's sprite source, scripts/fetch-sprites.py) has no
overworld sprites for some species the game needs. This builds a sheet set in
the same format (AnimData.xml plus <Action>-Anim/-Offsets/-Shadow.png, eight
direction rows) from the Generation V animated battle sprites in the PokeAPI
sprites repository (github.com/PokeAPI/sprites), so the species can be played
now. SpriteCollab's portraits are used as usual. A file named STANDIN in the
sprite folder marks the set; when SpriteCollab art appears, delete the folder
and run scripts/fetch-sprites.py for that dex instead.

How a set is built:
  - Battle sprites only face two ways, so the front sprite (facing down-left)
    serves down, down-left and left, mirrored for down-right and right; the back
    sprite (facing up-right) serves up-right and up, mirrored for up-left.
  - Each frame is scaled to SpriteCollab's size (SCALE), its colours snapped back
    to the sprite's own palette, and given a dark outline.
  - Idle: six frames of the battle animation. Walk: Idle frames with a step bob.
    Attack: a lunge forward and back (HitFrame on the furthest). Hurt: a recoil.
    Sleep: the first frame, settling. Every other action falls back to these in
    the game (src/sprites/pokemonSprite.ts FALLBACKS).
  - Shiny colours: the shiny battle sprite is the same drawing recoloured, so the
    colour pairs go to data/shiny.json (sprite), and the portrait's pairs come from
    SpriteCollab's shiny portrait, as scripts/shiny-palettes.py does.

Usage:
  python3 scripts/standin-sprites.py 0564 0565 0558
"""
import io
import json
import math
import os
import subprocess
import sys
import urllib.request

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SPRITES = os.path.join(ROOT, 'assets', 'pokemon')
PORTRAITS = os.path.join(ROOT, 'assets', 'portraits')
SHINY = os.path.join(ROOT, 'data', 'shiny.json')
WORK = os.environ.get('SPRITECOLLAB_DIR', '/tmp/spritecollab')
BW = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/versions/generation-v/black-white/animated/'
SCALE = 0.45
IDLE_FRAMES = 6


def fetch(url):
    with urllib.request.urlopen(url, timeout=30) as r:
        return r.read()


def gif_frames(data):
    im = Image.open(io.BytesIO(data))
    out = []
    for i in range(getattr(im, 'n_frames', 1)):
        im.seek(i)
        out.append(im.convert('RGBA'))
    return out


def palette_of(frames):
    cols = {}
    for f in frames:
        for c, (r, g, b, a) in enumerate([]):
            pass
        for count, px in f.getcolors(1 << 20) or []:
            if px[3] >= 128:
                cols[px[:3]] = cols.get(px[:3], 0) + count
    return list(cols)


def nearest(pal, c):
    return min(pal, key=lambda p: (p[0] - c[0]) ** 2 * 2 + (p[1] - c[1]) ** 2 * 4 + (p[2] - c[2]) ** 2 * 3)


def shrink(frame, box, scale, pal, outline):
    """One battle frame cropped to `box`, scaled, palette-snapped and outlined."""
    f = frame.crop(box)
    w = max(1, round(f.width * scale))
    h = max(1, round(f.height * scale))
    # Premultiplied box filter: colours averaged only over visible pixels.
    small = f.resize((w, h), Image.BOX)
    px = small.load()
    cache = {}
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a < 110:
                px[x, y] = (0, 0, 0, 0)
                continue
            k = (r, g, b)
            if k not in cache:
                cache[k] = nearest(pal, k)
            px[x, y] = (*cache[k], 255)
    # Outline: a transparent pixel beside a visible one becomes the outline colour.
    out = Image.new('RGBA', (w + 2, h + 2), (0, 0, 0, 0))
    out.paste(small, (1, 1))
    o = out.load()
    edge = []
    for y in range(h + 2):
        for x in range(w + 2):
            if o[x, y][3]:
                continue
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                nx, ny = x + dx, y + dy
                if 0 <= nx < w + 2 and 0 <= ny < h + 2 and o[nx, ny][3]:
                    edge.append((x, y))
                    break
    for x, y in edge:
        o[x, y] = (*outline, 255)
    return out


def union_box(frames):
    box = None
    for f in frames:
        b = f.getbbox()
        if not b:
            continue
        box = b if box is None else (min(box[0], b[0]), min(box[1], b[1]), max(box[2], b[2]), max(box[3], b[3]))
    return box


def pick(frames, n):
    return [frames[round(i * len(frames) / n) % len(frames)] for i in range(n)]


# Direction rows (src/core/math.ts DIR_NAMES): which view and whether mirrored.
VIEWS = [('front', False), ('front', True), ('front', True), ('back', False), ('back', False), ('back', True), ('front', False), ('front', False)]
DIRS = [(0, 1), (1, 1), (1, 0), (1, -1), (0, -1), (-1, -1), (-1, 0), (-1, 1)]


def build(dex):
    n = int(dex)
    raw = {k: gif_frames(fetch(BW + p + f'{n}.gif')) for k, p in (('front', ''), ('back', 'back/'), ('front_s', 'shiny/'), ('back_s', 'back/shiny/'))}
    pal = palette_of(raw['front'] + raw['back'])
    outline = min(pal, key=lambda c: sum(c))
    # One scale for both views: the back view is drawn to the front's height.
    fbox = union_box(raw['front'])
    bbox = union_box(raw['back'])
    fh = fbox[3] - fbox[1]
    bh = bbox[3] - bbox[1]
    views = {}
    shiny_pairs = {}
    for view, box, scale in (('front', fbox, SCALE), ('back', bbox, SCALE * fh / bh)):
        frames = pick(raw[view], IDLE_FRAMES)
        shiny = pick(raw[view + '_s'], IDLE_FRAMES)
        views[view] = [shrink(f, box, scale, pal, outline) for f in frames]
        # Shiny colours: the same pixels of the normal and the shiny drawing.
        for a, b in zip(raw[view], raw[view + '_s']):
            pa, pb = a.load(), b.load()
            for y in range(min(a.height, b.height)):
                for x in range(min(a.width, b.width)):
                    if pa[x, y][3] >= 128 and pb[x, y][3] >= 128 and pa[x, y][:3] in pal:
                        shiny_pairs.setdefault(pa[x, y][:3], {}).setdefault(pb[x, y][:3], 0)
                        shiny_pairs[pa[x, y][:3]][pb[x, y][:3]] += 1
        del shiny
    body_w = max(f.width for v in views.values() for f in v)
    body_h = max(f.height for v in views.values() for f in v)
    # Frame size: room for the lunge and the bob, in multiples of 8 as SpriteCollab's are.
    FW = int(math.ceil((body_w + 8) / 8) * 8)
    FH = int(math.ceil((body_h + 10) / 8) * 8)
    foot = FH - 5  # bottom row of the body; the shadow centre sits just above it

    def place(img, dx, dy, mirror):
        if mirror:
            img = img.transpose(Image.FLIP_LEFT_RIGHT)
        x = (FW - img.width) // 2 + dx
        y = foot - img.height + 1 + dy
        return img, x, y

    actions = {}

    def sheet(name, frames, durations, hit=None):
        """frames: per frame (index into the six, dx, dy) with the offset along the facing direction."""
        anim = Image.new('RGBA', (FW * len(frames), FH * 8), (0, 0, 0, 0))
        offs = Image.new('RGBA', anim.size, (0, 0, 0, 0))
        shad = Image.new('RGBA', anim.size, (0, 0, 0, 0))
        for row, (view, mirror) in enumerate(VIEWS):
            ux, uy = DIRS[row]
            for col, (k, fwd, lift) in enumerate(frames):
                img = views[view][k % len(views[view])]
                dx = round(ux * fwd)
                dy = round(uy * fwd * 0.6) - lift
                im, x, y = place(img, dx, dy, mirror)
                ox, oy = col * FW, row * FH
                anim.alpha_composite(im, (ox + x, oy + y))
                bx0, by0, bx1, by1 = x, y, x + im.width, y + im.height
                cx, cy = (bx0 + bx1) // 2, (by0 + by1) // 2
                o = offs.load()
                o[ox + cx, oy + by0 + 1] = (0, 0, 0, 255)                       # head
                o[ox + max(0, bx0 + 1), oy + cy] = (255, 0, 0, 255)            # left hand
                o[ox + min(FW - 1, bx1 - 2), oy + cy] = (0, 255, 0, 255)       # right hand
                o[ox + cx, oy + cy + 1] = (0, 0, 255, 255)                     # centre
                # Shadow rings round the ground point (white centre; red, green, blue rings).
                gx, gy = FW // 2 + dx, foot - 1 + max(0, dy + lift)
                rw = max(4, body_w // 2 - 1)
                s = shad.load()
                for yy in range(-4, 5):
                    for xx in range(-rw - 2, rw + 3):
                        d = (xx / (rw + 2)) ** 2 + (yy / 4) ** 2
                        px_, py_ = ox + gx + xx, oy + gy + yy
                        if d > 1 or not (ox <= px_ < ox + FW and oy <= py_ < oy + FH):
                            continue
                        c = (0, 0, 255, 255) if d > 0.6 else (0, 255, 0, 255) if d > 0.3 else (255, 0, 0, 255)
                        if xx == 0 and yy == 0:
                            c = (255, 255, 255, 255)
                        s[px_, py_] = c
        actions[name] = (anim, offs, shad, durations, hit)

    sheet('Idle', [(k, 0, 0) for k in range(IDLE_FRAMES)], [10] * IDLE_FRAMES)
    sheet('Walk', [(0, 0, 0), (1, 0, 1), (2, 0, 0), (3, 0, 1)], [8, 8, 8, 8])
    sheet('Attack', [(0, 0, 0), (0, -1, 0), (0, 3, 1), (0, 5, 1), (0, 2, 0), (0, 0, 0)], [4, 4, 3, 6, 4, 4], hit=3)
    sheet('Hurt', [(0, -2, 0), (0, -1, 0)], [4, 8])
    sheet('Sleep', [(0, 0, 0), (0, 0, -1)], [30, 35])

    out = os.path.join(SPRITES, dex)
    os.makedirs(out, exist_ok=True)
    xml = ['<?xml version="1.0"?>', '<AnimData>', '  <ShadowSize>1</ShadowSize>', '  <Anims>']
    for i, (name, (anim, offs, shad, durs, hit)) in enumerate(actions.items()):
        anim.save(os.path.join(out, f'{name}-Anim.png'))
        offs.save(os.path.join(out, f'{name}-Offsets.png'))
        shad.save(os.path.join(out, f'{name}-Shadow.png'))
        xml += ['    <Anim>', f'      <Name>{name}</Name>', f'      <Index>{i}</Index>', f'      <FrameWidth>{FW}</FrameWidth>',
                f'      <FrameHeight>{FH}</FrameHeight>']
        if hit is not None:
            xml.append(f'      <HitFrame>{hit}</HitFrame>')
        xml.append('      <Durations>')
        xml += [f'        <Duration>{d}</Duration>' for d in durs]
        xml += ['      </Durations>', '    </Anim>']
    xml += ['  </Anims>', '</AnimData>', '']
    open(os.path.join(out, 'AnimData.xml'), 'w').write('\n'.join(xml))
    open(os.path.join(out, 'credits.txt'), 'w').write(
        'Stand-in built by scripts/standin-sprites.py from the Generation V animated battle sprites '
        '(Pokemon Black and White, (c) Nintendo / Creatures / GAME FREAK) as published in the PokeAPI '
        'sprites repository (https://github.com/PokeAPI/sprites). Replace with SpriteCollab art when it exists.\n')
    open(os.path.join(out, 'STANDIN'), 'w').write('scripts/standin-sprites.py\n')

    # Portraits: SpriteCollab's, normal and (for the shiny colours) its shiny portrait.
    pdir = os.path.join(PORTRAITS, dex)
    os.makedirs(pdir, exist_ok=True)
    def blob(path):
        r = subprocess.run(['git', 'show', f'FETCH_HEAD:{path}'], cwd=WORK, capture_output=True)
        if r.returncode != 0 or not r.stdout:
            r = subprocess.run(['git', 'show', f'HEAD:{path}'], cwd=WORK, capture_output=True)
        return r.stdout if r.returncode == 0 and r.stdout else None
    normal = blob(f'portrait/{dex}/Normal.png')
    credit = blob(f'portrait/{dex}/credits.txt')
    port_pairs = []
    if normal:
        open(os.path.join(pdir, 'Normal.png'), 'wb').write(normal)
        if credit:
            open(os.path.join(pdir, 'credits.txt'), 'wb').write(credit)
        shiny_p = blob(f'portrait/{dex}/0000/0001/Normal.png')
        if shiny_p:
            a = Image.open(io.BytesIO(normal)).convert('RGBA')
            b = Image.open(io.BytesIO(shiny_p)).convert('RGBA')
            pairs = {}
            for (pa, pb) in zip(a.getdata(), b.getdata()):
                if pa[3] >= 128 and pb[3] >= 128 and pa[:3] != pb[:3]:
                    pairs.setdefault(pa[:3], {}).setdefault(pb[:3], 0)
                    pairs[pa[:3]][pb[:3]] += 1
            port_pairs = [[rgb(k), rgb(max(v, key=v.get))] for k, v in sorted(pairs.items())]
    sprite_pairs = [[rgb(k), rgb(max(v, key=v.get))] for k, v in sorted(shiny_pairs.items()) if max(v, key=v.get) != k]
    data = json.load(open(SHINY))
    data[dex] = {'sprite': sprite_pairs, 'portrait': port_pairs}
    json.dump(dict(sorted(data.items())), open(SHINY, 'w'), separators=(',', ':'))
    print(f'{dex}: frame {FW}x{FH}, body {body_w}x{body_h}, {len(pal)} colours, {len(sprite_pairs)} shiny sprite pairs, '
          f'{len(port_pairs)} shiny portrait pairs, portrait {"yes" if normal else "MISSING"}')


def rgb(c):
    return (c[0] << 16) | (c[1] << 8) | c[2]


if __name__ == '__main__':
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    for d in sys.argv[1:]:
        build(d.zfill(4))
