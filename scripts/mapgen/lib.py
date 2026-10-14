"""Library of whole objects for the map: buildings cut from the demo room and
multi-tile stamps read straight off the tileset sheet. Every entry is a
complete picture (nothing cropped), with the cells it blocks.

A prefab: {'w', 'h', 'layers': [[[enc]]], 'block': [(dx, dy)], 'kind'}
where enc = tile | flags << 12 (0 = empty).
"""
import numpy as np
import bspecs

ENC = lambda t, f=0: (t | (f << 12)) if t else 0


def _from_cut(p):
    layers = []
    for l in p['layers']:
        layers.append([[ENC(t, f) for t, f in zip(rt, rf)] for rt, rf in zip(l['tiles'], l['flags'])])
    return layers


def occupancy(layers, h, w):
    occ = np.zeros((h, w), bool)
    for l in layers:
        occ |= np.array(l) > 0
    return occ


def stamp(rows, kind='prop', block='base'):
    """rows: list of rows of tile ids (or (tile, flags)); 0 = empty."""
    layer = [[ENC(*c) if isinstance(c, tuple) else ENC(c) for c in r] for r in rows]
    h, w = len(layer), len(layer[0])
    p = {'w': w, 'h': h, 'layers': [layer], 'kind': kind}
    occ = occupancy(p['layers'], h, w)
    if block == 'base':      # the bottom row of the picture
        p['block'] = [(x, h - 1) for x in range(w) if occ[h - 1, x]]
    elif block == 'all':
        p['block'] = [(x, y) for y in range(h) for x in range(w) if occ[y, x]]
    else:
        p['block'] = list(block)
    return p


PREFABS = {}

# --- buildings: everything below the roof line blocks; the top row is roof overhang
STILTS = {'stilt_red_a', 'stilt_red_b', 'stilt_cluster'}
for name, rect in bspecs.SPECS.items():
    if name in ('green_stall_hut', 'green_hut'):
        pass
    p = bspecs.cut(rect)
    layers = _from_cut(p)
    occ = occupancy(layers, p['h'], p['w'])
    block = [(x, y) for y in range(1, p['h']) for x in range(p['w']) if occ[y, x]]
    PREFABS[name] = {'w': p['w'], 'h': p['h'], 'layers': layers, 'kind': 'building', 'block': block}

# --- trees and plants (whole sprites only)
PREFABS['pine_tall'] = stamp([[435, 436], [499, 500], [563, 564]], 'tree', block=[(0, 2), (1, 2)])
PREFABS['pine_small'] = stamp([[308], [372]], 'tree')
PREFABS['berry_red'] = stamp([[241, 242], [305, 306]], 'bush')
PREFABS['berry_orange'] = stamp([[369, 370], [433, 434]], 'bush')
PREFABS['round_bush'] = stamp([[113, 114], [177, 178]], 'bush')
for t in (91, 155, 219, 283, 307):
    PREFABS[f'bush_{t}'] = stamp([[t]], 'bush', block=[] if t in (155, 219) else 'base')
for t in (287, 288, 289, 290, 1975, 1463):
    PREFABS[f'rock_{t}'] = stamp([[t]], 'rock', block=[] if t in (288, 289) else 'base')
for t in (351, 352):
    PREFABS[f'stump_{t}'] = stamp([[t]], 'rock')
# ore and boulders: 2x2, five kinds by sheet row, three sizes by column
ORE_ROWS = {'silver': 21, 'stone': 23, 'crystal': 25, 'gold': 27, 'boulder': 29}
for kind, r in ORE_ROWS.items():
    for i, c in enumerate((49, 51, 53)):
        PREFABS[f'ore_{kind}_{i}'] = stamp([[r * 64 + c, r * 64 + c + 1], [(r + 1) * 64 + c, (r + 1) * 64 + c + 1]], 'rock', block='base')
    PREFABS[f'ore_{kind}_s'] = stamp([[(r + 1) * 64 + 55]], 'rock')
# monuments, graves, market
PREFABS['statue'] = stamp([[1196, 1197], [1260, 1261], [1324, 1325]], 'prop', block=[(0, 2), (1, 2), (0, 1), (1, 1)])
PREFABS['statue_b'] = stamp([[1198, 1199], [1262, 1263], [1326, 1327]], 'prop', block=[(0, 2), (1, 2), (0, 1), (1, 1)])
for t in (1003, 1004, 1005, 1006, 1007):
    PREFABS[f'grave_{t}'] = stamp([[t]], 'prop')
for t in (1067, 1068, 1069, 1070, 1071):
    PREFABS[f'grave_{t}'] = stamp([[t]], 'prop')
PREFABS['stall_white'] = stamp([[2405, 2406, 2407], [2469, 2470, 2471]], 'prop', block=[(0, 1), (1, 1), (2, 1)])
PREFABS['stall_white_b'] = stamp([[2661, 2662, 2663], [2725, 2726, 2727]], 'prop', block=[(0, 1), (1, 1), (2, 1)])
PREFABS['bench'] = stamp([[2472, 2473, 2474]], 'prop', block=[])
PREFABS['pots'] = stamp([[2095, 2096]], 'prop')
PREFABS['sunflower'] = stamp([[2099]], 'prop', block=[])

if __name__ == '__main__':
    import sunny
    from PIL import Image, ImageDraw
    items = list(PREFABS.items())
    S = 2; pad = 8; maxw = 1600; x = y = 0; rowh = 0; placed = []
    for k, p in items:
        pw, ph = p['w'] * 16 * S + pad * 2, p['h'] * 16 * S + pad * 2 + 12
        pw = max(pw, 90)
        if x + pw > maxw: x = 0; y += rowh; rowh = 0
        placed.append((k, p, x, y)); x += pw; rowh = max(rowh, ph)
    sh = Image.new('RGBA', (maxw, y + rowh), (90, 170, 80, 255)); dr = ImageDraw.Draw(sh)
    for k, p, px, py in placed:
        img = np.zeros((p['h'] * 16, p['w'] * 16, 4))
        for l in p['layers']:
            for yy, row in enumerate(l):
                for xx, e in enumerate(row):
                    if e: sunny.composite(img, sunny.tile(e & 4095, e >> 12), xx * 16, yy * 16)
        im = Image.fromarray(img.astype(np.uint8)).resize((p['w'] * 16 * S, p['h'] * 16 * S), Image.NEAREST)
        sh.alpha_composite(im, (px + pad, py + pad + 12))
        for (bx, by) in p['block']:
            dr.rectangle((px + pad + bx * 16 * S, py + pad + 12 + by * 16 * S, px + pad + (bx + 1) * 16 * S - 1, py + pad + 12 + (by + 1) * 16 * S - 1), outline=(255, 0, 0, 120))
        dr.text((px + pad, py + 1), k, fill='white', stroke_width=2, stroke_fill='black')
    sh.save('prefab_library.png')
