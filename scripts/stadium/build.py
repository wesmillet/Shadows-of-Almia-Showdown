"""Builds the stadium pocket arena where Steven is battled: data/stadium.json (layout, walk mask,
spots) and one picture per look (assets/maps/stadium_<look>.png), all on the same layout.

Art: The Fan-tasy Tileset (Premium) and its Castles and Fortresses expansion (FANTASY_DIR: a folder holding
both packs unpacked), plus the game's own Ranger NPC sheets for the crowd. The animated pieces (torches,
crystals, braziers) are written to assets/maps/stadium_fx.png and placed by the game as decor.

  FANTASY_DIR=/path/to/packs python3 scripts/stadium/build.py
"""
import json, os, random, sys
from PIL import Image, ImageDraw

R = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
F = os.environ.get('FANTASY_DIR', '')
CA = f'{F}/castles/The Fan-tasy Tileset - Castles and Fortresses/Art/'
PA = f'{F}/premium/The Fan-tasy Tileset (Premium)/Art/'
T = 16
# Layout (tiles). The field is the battle area; walls ring it; stands ring the walls.
W, H = 46, 36
FIELD = (8, 9, 38, 27)          # x0, y0, x1, y1 (end exclusive): 30 x 18
WALL = 1
STEVEN = (23, 10.6)             # where Steven stands (north end of the field)
PLAYER = (23, 25.2)             # where the challenger stands (south end)
GATE = (21, 27, 25, 29)         # the south tunnel the challenger walks in through


def img(p):
    return Image.open(p).convert('RGBA')


def manifest():
    return json.load(open(f'{R}/assets/rangers/manifest.json'))


def crowd_frames():
    """Each townsperson sheet's idle frames: down, up, left (right = left mirrored)."""
    m = manifest()
    out = []
    for k, c in m['characters'].items():
        if not (k.startswith('civ_') or k.startswith('union_')):
            continue
        sheet = img(f"{R}/assets/rangers/{c['file']}")
        an = c.get('animations') or m['animations']
        fw, fh = c['frame_w'], c['frame_h']
        def fr(name):
            i = an[name][0]
            return sheet.crop((i * fw, 0, i * fw + fw, fh))
        out.append({'down': fr('idle_down'), 'up': fr('idle_up'), 'left': fr('idle_left')})
    return out


def shade(c, k):
    return tuple(max(0, min(255, int(v * k))) for v in c[:3]) + (255,)


LOOKS = {
    # name: floor, field lines, wall stone, stand stone, accent (banners), crowd, extra
    'colosseum': dict(floor=(236, 229, 210), floor2=(226, 218, 197), line=(196, 186, 160), wall=(214, 207, 188), stand=(200, 192, 172),
                      outside=(88, 152, 72), banner='Indigo', crowd=True, crystals='Purple', grass=False),
    'cavern': dict(floor=(92, 88, 104), floor2=(84, 80, 96), line=(150, 132, 196), wall=(70, 66, 82), stand=(58, 54, 70),
                   outside=(30, 28, 40), banner='Purple', crowd=False, crystals='Blue', grass=False, rocks=True, towers=False, rockTint=True),
    'league': dict(floor=(98, 168, 82), floor2=(90, 158, 76), line=(244, 244, 236), wall=(222, 214, 196), stand=(206, 196, 176),
                   outside=(70, 132, 60), banner='Red', crowd=True, crystals='Yellow', grass=True),
}


def draw_look(name, L, crowd):
    rnd = random.Random(7)
    im = Image.new('RGBA', (W * T, H * T), L['outside'] + (255,))
    d = ImageDraw.Draw(im)
    fx0, fy0, fx1, fy1 = [v * T for v in FIELD]
    # Stands: seat rows (a light ledge, a dark riser below it) stepping down to the wall.
    st = L['stand']
    d.rounded_rectangle((T // 2, T // 2, W * T - T // 2, H * T - T // 2), radius=2 * T, fill=shade(st, 0.8), outline=shade(st, 0.55), width=2)
    for i, (y0, y1) in enumerate(((1, 3), (3, 5), (5, 7))):
        k = 0.86 + 0.07 * i
        d.rectangle((T, y0 * T, W * T - T, y1 * T - 1), fill=shade(st, k))
        d.rectangle((T, y1 * T - 5, W * T - T, y1 * T - 1), fill=shade(st, k * 0.72))
        d.line((T, y0 * T, W * T - T, y0 * T), fill=shade(st, k * 1.15))
        yy0, yy1 = H - y1, H - y0
        d.rectangle((T, yy0 * T, W * T - T, yy1 * T - 1), fill=shade(st, k))
        d.rectangle((T, yy0 * T, W * T - T, yy0 * T + 4), fill=shade(st, k * 0.72))
        d.line((T, yy1 * T - 1, W * T - T, yy1 * T - 1), fill=shade(st, k * 1.15))
    for i, (x0, x1) in enumerate(((1, 3), (3, 5), (5, 7))):
        k = 0.86 + 0.07 * i
        d.rectangle((x0 * T, 7 * T, x1 * T - 1, (H - 7) * T - 1), fill=shade(st, k))
        d.rectangle((x1 * T - 5, 7 * T, x1 * T - 1, (H - 7) * T - 1), fill=shade(st, k * 0.72))
        xx0, xx1 = W - x1, W - x0
        d.rectangle((xx0 * T, 7 * T, xx1 * T - 1, (H - 7) * T - 1), fill=shade(st, k))
        d.rectangle((xx0 * T, 7 * T, xx0 * T + 4, (H - 7) * T - 1), fill=shade(st, k * 0.72))
    # Stairs (aisles) cutting the stands at the corners and the middles of the long sides.
    for ax in (12, 34):
        for (yy0, yy1) in ((0, FIELD[1] - 1), (FIELD[3] + 1, H)):
            d.rectangle((ax * T, yy0 * T + 8, ax * T + T, yy1 * T - 8), fill=shade(L['stand'], 0.7))
            for y in range(yy0 * T + 8, yy1 * T - 8, 4):
                d.line((ax * T, y, ax * T + T - 1, y), fill=shade(L['stand'], 0.86))
    # The wall round the field: a stone face with a coping on top.
    wx0, wy0, wx1, wy1 = fx0 - WALL * T, fy0 - WALL * T, fx1 + WALL * T, fy1 + WALL * T
    d.rectangle((wx0, wy0, wx1 - 1, wy1 - 1), fill=shade(L['wall'], 0.9))
    for y in range(wy0, wy1, 8):
        off = 0 if (y // 8) % 2 == 0 else 8
        for x in range(wx0 + off, wx1, 16):
            d.rectangle((x, y, x + 15, y + 7), outline=shade(L['wall'], 0.74))
    d.rectangle((wx0, wy0, wx1 - 1, wy1 - 1), outline=shade(L['wall'], 0.6), width=2)
    # The field floor.
    if L['grass']:
        for x in range(fx0, fx1, 2 * T):
            d.rectangle((x, fy0, x + T - 1, fy1 - 1), fill=L['floor'] + (255,))
            d.rectangle((x + T, fy0, x + 2 * T - 1, fy1 - 1), fill=L['floor2'] + (255,))
    else:
        d.rectangle((fx0, fy0, fx1 - 1, fy1 - 1), fill=L['floor'] + (255,))
        for y in range(fy0, fy1, T):
            for x in range(fx0, fx1, T):
                if ((x // T) + (y // T)) % 2:
                    d.rectangle((x, y, x + T - 1, y + T - 1), fill=L['floor2'] + (255,))
                d.line((x, y, x + T - 1, y), fill=shade(L['floor'], 0.93))
                d.line((x, y, x, y + T - 1), fill=shade(L['floor'], 0.95))
    # Field markings: the boundary, the halfway line, the centre circle, the two trainer boxes.
    ln = L['line'] + (255,)
    m = 10
    d.rectangle((fx0 + m, fy0 + m, fx1 - m - 1, fy1 - m - 1), outline=ln, width=2)
    cy = (fy0 + fy1) // 2
    d.line((fx0 + m, cy, fx1 - m - 1, cy), fill=ln, width=2)
    cx = (fx0 + fx1) // 2
    d.ellipse((cx - 3 * T, cy - 3 * T, cx + 3 * T, cy + 3 * T), outline=ln, width=2)
    d.ellipse((cx - 6, cy - 6, cx + 6, cy + 6), fill=ln)
    for (by, sgn) in ((fy0 + m, 1), (fy1 - m - 1, -1)):
        d.rectangle((cx - 3 * T, min(by, by + sgn * 3 * T), cx + 3 * T, max(by, by + sgn * 3 * T)), outline=ln, width=2)
    # The south tunnel.
    gx0, gy0, gx1, gy1 = [v * T for v in GATE]
    d.rectangle((gx0 - 4, gy0, gx1 + 3, H * T - 1), fill=shade(L['wall'], 0.5))
    d.rectangle((gx0, gy0, gx1 - 1, H * T - 1), fill=shade(L['wall'], 0.72))
    for y in range(gy0, H * T, T):
        d.line((gx0, y, gx1 - 1, y), fill=shade(L['wall'], 0.6))
    # North: Steven's raised box, two steps up from the field.
    d.rectangle((cx - 2 * T, wy0 - 2 * T, cx + 2 * T - 1, wy0 + T // 2), fill=shade(L['wall'], 1.02), outline=shade(L['wall'], 0.6), width=2)
    for i in range(3):
        d.line((cx - 2 * T + 4, wy0 - 2 * T + 6 + i * 8, cx + 2 * T - 5, wy0 - 2 * T + 6 + i * 8), fill=shade(L['wall'], 0.85))
    # Banners along the north and south walls.
    try:
        ban = img(f"{CA}Props/Banner_Large_{L['banner']}_Stripe.png")
    except FileNotFoundError:
        ban = img(f"{CA}Props/Banner_Large_{L['banner']}.png")
    for x in range(FIELD[0] + 2, FIELD[2] - 1, 5):
        if abs(x + 0.5 - cx / T) < 4:
            continue
        im.alpha_composite(ban, (x * T - ban.width // 2 + T // 2, wy0 - ban.height + T))
    # The crowd: a person in about two of every three seats, facing the field.
    if L['crowd']:
        people = crowd
        def seat(px, py, face):
            p = rnd.choice(people)
            fr = p['left'] if face in ('left', 'right') else p[face]
            if face == 'right':
                fr = fr.transpose(Image.FLIP_LEFT_RIGHT)
            fr = fr.crop((0, 0, fr.width, 24))   # seated: from the waist up
            im.alpha_composite(fr, (int(px - fr.width / 2), int(py - fr.height)))
        aisle = lambda x: any(abs(x - (ax * T + 8)) < 12 for ax in (12, 34))
        for (y0, y1) in ((1, 3), (3, 5), (5, 7)):
            for x in range(2 * T, W * T - 2 * T, 13):
                if aisle(x) or abs(x - cx) < 3 * T:
                    continue
                if rnd.random() < L.get('density', 0.62):
                    seat(x + rnd.randint(-1, 1), y1 * T - 6, 'down')
            for x in range(2 * T, W * T - 2 * T, 13):
                if aisle(x) or (GATE[0] * T - 10 < x < GATE[2] * T + 10):
                    continue
                if rnd.random() < L.get('density', 0.62):
                    seat(x + rnd.randint(-1, 1), (H - y0) * T - 2, 'up')
        for (x0, x1) in ((1, 3), (3, 5), (5, 7)):
            for y in range(8 * T, (H - 7) * T, 15):
                if rnd.random() < L.get('density', 0.62):
                    seat(x1 * T - 9, y + 14, 'right')
                if rnd.random() < L.get('density', 0.62):
                    seat((W - x1) * T + 9, y + 14, 'left')
    # Steven's crystals: a cluster each side of his box, in the look's colour.
    for side in (-1, 1):
        for (dx, dy, size) in ((3.2, -0.9, 3), (4.4, -0.2, 2), (2.6, 0.1, 1), (5.2, -1.1, 1)):
            try:
                c = img(f"{PA}Props/MagicCrystal_{size}_{L['crystals']}.png")
            except FileNotFoundError:
                continue
            x = int(cx + side * dx * T - c.width / 2)
            y = int(wy0 + dy * T - c.height + T // 2)
            im.alpha_composite(c, (x, y))
    if L.get('rocks'):
        # The cavern: boulders and crystal clusters across the stands instead of a crowd.
        rocks = [img(f'{PA}Rocks/Rock_Brown_{i}.png') for i in (1, 2, 3, 4, 5, 6, 7, 8) if os.path.exists(f'{PA}Rocks/Rock_Brown_{i}.png')]
        crys = [img(f"{PA}Props/MagicCrystal_{k}_{c}.png") for k in (1, 2, 3) for c in (L['crystals'], 'Purple', 'Indigo') if os.path.exists(f"{PA}Props/MagicCrystal_{k}_{c}.png")]
        for _ in range(70):
            x = rnd.randint(T, W * T - T)
            y = rnd.randint(T, H * T - T)
            if wx0 - T < x < wx1 + T and wy0 - 2 * T < y < wy1 + T:
                continue
            pick = rnd.choice(crys) if rnd.random() < 0.45 else rnd.choice(rocks)
            pick = pick.copy()
            if pick in rocks or True:
                px = pick.load()
                for yy in range(pick.height):
                    for xx in range(pick.width):
                        r, g, b, a = px[xx, yy]
                        if a and L.get('rockTint') and pick.width > 0 and (r > g + 10):
                            px[xx, yy] = (int(r * 0.55), int(g * 0.55), int(b * 0.7), a)
            im.alpha_composite(pick, (x - pick.width // 2, y - pick.height))
        # Braziers at the field's corners.
        try:
            br = img(f'{PA}Props/Animations/Animation_Ruins_Brazier.png').crop((0, 0, 32, 56))
            for (bx, by) in ((wx0 - T, wy0), (wx1 - T, wy0), (wx0 - T, wy1 + T // 2), (wx1 - T, wy1 + T // 2)):
                im.alpha_composite(br, (bx, by - br.height + T))
        except FileNotFoundError:
            pass
    if L.get('towers', True):
        pass
    # Corner towers (the castle pack's round tower) and torches at the field's corners.
    atlas = img(f'{CA}Buildings/Atlas/Atlas_Castle_Building.png')
    tower = atlas.crop((496, 160, 544, 240))
    for (tx, ty) in (() if not L.get('towers', True) else ((wx0 - tower.width // 2, wy0 - tower.height + 2 * T), (wx1 - tower.width // 2, wy0 - tower.height + 2 * T),
                     (wx0 - tower.width // 2, wy1 - tower.height + T), (wx1 - tower.width // 2, wy1 - tower.height + T))):
        im.alpha_composite(tower, (tx, ty))
    return im


def fx_sheet(L):
    """The animated pieces for the game: crystal (Steven's colour) and torch strips, one row each."""
    cr = img(f'{CA}Props/Animations/Animation_MagicCrystal.png')
    return cr


def main():
    if not F:
        sys.exit('Set FANTASY_DIR to the folder with the unpacked Fan-tasy packs (castles/, premium/)')
    crowd = crowd_frames()
    walk = []
    for y in range(H):
        row = ''
        for x in range(W):
            inside = FIELD[0] <= x < FIELD[2] and FIELD[1] <= y < FIELD[3]
            tunnel = GATE[0] <= x < GATE[2] and FIELD[3] <= y < H
            row += '1' if inside or tunnel else '0'
        walk.append(row)
    out = {'cols': W, 'rows': H, 'tileSize': T, 'field': {'x0': FIELD[0], 'y0': FIELD[1], 'x1': FIELD[2], 'y1': FIELD[3]},
           'steven': {'x': STEVEN[0], 'y': STEVEN[1]}, 'player': {'x': PLAYER[0], 'y': PLAYER[1]},
           'gate': {'x': (GATE[0] + GATE[2]) / 2, 'y': H - 1.5}, 'walkable': walk, 'looks': list(LOOKS),
           'credits': 'The Fan-tasy Tileset (Premium, Castles and Fortresses); Pokemon Ranger 2 NPC sheets'}
    os.makedirs(f'{R}/assets/maps', exist_ok=True)
    for name, L in LOOKS.items():
        draw_look(name, L, crowd).save(f'{R}/assets/maps/stadium_{name}.png', optimize=True)
    json.dump(out, open(f'{R}/data/stadium.json', 'w'), separators=(',', ':'))
    print('stadium:', W, 'x', H, 'looks', list(LOOKS))


if __name__ == '__main__':
    main()
