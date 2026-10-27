"""Finishing touches on the island: things a traveller notices along the way.

- signposts where roads leave a junction, pointing the way the road goes
- lamp posts every so often along the roads, alternating sides
- flowers, mushrooms and logs along the verges
- lily pads, lotus flowers and cattails on the lakes
- the crystal's arena dressed with ruined pillars, magic crystals and purple banners

Everything goes through the same Placer as the woods (so nothing lands on a road,
a cliff or another object), except the water plants, which float on water no one
walks on.
"""
import math
import random

import numpy as np

import design3 as D
import content3
from content3 import catalogue

DIRS = ['East', 'SouthEast', 'South', 'SouthWest', 'West', 'NorthWest', 'North', 'NorthEast']


def _one(tileset, pattern):
    c = catalogue(tileset, pattern)
    return c[0] if c else None


def sign_for(dx, dy):
    """The Sign_1_<dir> prop for a heading (screen y grows downwards)."""
    a = (math.degrees(math.atan2(dy, dx)) + 360 + 22.5) % 360
    return _one('Objects_Props', rf'Sign_1_{DIRS[int(a // 45)]}')


def roads(d, placer, seed=21):
    rng = random.Random(seed)
    lamp = _one('Objects_Props', r'LampPost(_\d+)?') or _one('Objects_Props_Castle', r'LampPost(_\d+)?')
    snow_lamp = _one('Objects_Props_Snow', r'LampPost_1_Snow')
    flowers = (catalogue('Objects_Props', r'Plant_RoseBush(_\d+)?') + catalogue('Objects_Props', r'Plant_Sunflower')
               + catalogue('Objects_Props', r'Plant_SaffronFlower') + catalogue('Objects_Props', r'Crate_Small_Flowers'))
    forest_bits = (catalogue('Objects_Props', r'Plant_Mushroom(_\w+)?') + catalogue('Objects_Props', r'TreeLog')
                   + catalogue('Objects_Props', r'TreeStump_(Small|Big|Lantern|Small_Lantern)'))
    blight = D.blight()
    n_sign = n_lamp = n_flower = 0
    for idx, (kind, pts) in enumerate(D.ROADS):
        if kind != '1':
            continue
        line = D.road_path(pts, 500 + idx, not D.climbs(pts))
        # a signpost a few tiles along from the road's first waypoint, on the right-hand verge
        if len(line) > 20:
            (x0, y0), (x1, y1) = line[10], line[16]
            hx, hy = x1 - x0, y1 - y0
            n = math.hypot(hx, hy) or 1
            ex, ey = pts[-1][0] - line[10][0], pts[-1][1] - line[10][1]
            key = sign_for(ex, ey)
            for side in (1, -1):
                sx = int(round(x0 - hy / n * 2.6 * side))
                sy = int(round(y0 + hx / n * 2.6 * side))
                if key and placer.put(key, sx, sy, clear=0, shadow=False):
                    n_sign += 1
                    break
        # lamps every ~16 tiles, alternating sides; flowers and forest bits here and there
        side = 1
        for j in range(40, len(line) - 30, 56):
            x, y = line[j]
            xa, ya = line[j + 2]
            hx, hy = xa - x, ya - y
            n = math.hypot(hx, hy) or 1
            lx = int(round(x - hy / n * 2.4 * side))
            ly = int(round(y + hx / n * 2.4 * side))
            inb = 0 <= ly < d.biome.shape[0] and 0 <= lx < d.biome.shape[1]
            here = d.biome[ly, lx] if inb else None
            key = lamp if here in (D.MEADOW, D.CASTLE, D.AUTUMN, D.FOREST) else snow_lamp if here == D.SNOW else None
            if key and placer.put(key, lx, ly, clear=0, shadow=False):
                n_lamp += 1
            side = -side
        for j in range(0, len(line), 5):
            if rng.random() > 0.22:
                continue
            x, y = line[j]
            s = rng.choice((1, -1))
            off = rng.uniform(2.2, 3.6)
            j2 = min(len(line) - 1, j + 2)
            hx, hy = line[j2][0] - x, line[j2][1] - y
            n = math.hypot(hx, hy) or 1
            fx = int(round(x - hy / n * off * s))
            fy = int(round(y + hx / n * off * s))
            if not (0 <= fy < d.biome.shape[0] and 0 <= fx < d.biome.shape[1]):
                continue
            b = d.biome[fy, fx]
            pool = flowers if b in (D.MEADOW, D.CASTLE) else forest_bits if b in (D.FOREST, D.AUTUMN) else None
            if blight[fy, fx]: pool = content3.DEAD_BITS       # nothing blooms on the blighted plain
            if pool and placer.put(rng.choice(pool), fx, fy, clear=0, shadow=False):
                n_flower += 1
    return n_sign, n_lamp, n_flower


def lakes(d, seed=22):
    """Floating plants on still water near the shore (not the sea)."""
    from scipy import ndimage
    rng = random.Random(seed)
    pads = catalogue('Objects_Props', r'LilyPad_\d') + catalogue('Objects_Props', r'LotusFlower')
    cattail = catalogue('Objects_Props', r'Cattail(_\d+)?')
    lake = d.water & d.land
    if not lake.any():
        return []
    near_shore = lake & ndimage.binary_dilation(~lake & d.land, iterations=3)
    edge = lake & ndimage.binary_dilation(~lake & d.land, iterations=1)
    out = []
    taken = np.zeros_like(lake)
    for (y, x) in zip(*np.nonzero(near_shore)):
        if taken[max(0, y - 1):y + 2, max(0, x - 1):x + 2].any():
            continue
        r = rng.random()
        if edge[y, x] and cattail and r < 0.10:
            key = rng.choice(cattail)
        elif pads and r < 0.07:
            key = rng.choice(pads)
        else:
            continue
        taken[y, x] = True
        out.append({'key': (key[0], key[1], 0), 'x': x * 16 + 2, 'y': y * 16 + 14})
    return out


def arena(placer):
    """The crystal's arena: ruined pillars at the corners, crystal clusters and banners round it."""
    x0, y0, x1, y1 = D.FINAL_ARENA
    pillar = _one('Objects_Props', r'Ruins_Pillar(_\d+)?')
    crystals = catalogue('Objects_Props', r'MagicCrystal_\d')
    banner = _one('Objects_Props', r'Banner_Stick_1_Purple')
    n = 0
    # The terrace is paved (not free for the woods), so the arena dressing claims its own tiles.
    spots = [(x0 - 2, y0 - 2), (x1 + 1, y0 - 2), (x0 - 2, y1 + 1), (x1 + 1, y1 + 1)]
    for (x, y) in spots:
        placer.free[y, x] = True
        if pillar and placer.put(pillar, x, y, clear=0, shadow=False): n += 1
    cy = (y0 + y1) // 2
    for (x, y) in [(x0 - 2, cy - 3), (x0 - 2, cy + 3), (x1 + 1, cy - 3), (x1 + 1, cy + 3)]:
        placer.free[y, x] = True
        if banner and placer.put(banner, x, y, clear=0, shadow=False): n += 1
    rng = random.Random(23)
    for (x, y) in [(x0 + 3, y0 - 3), (x1 - 4, y0 - 3), (x0 + 3, y1 + 2), (x1 - 4, y1 + 2), ((x0 + x1) // 2 - 6, y0 - 3), ((x0 + x1) // 2 + 6, y1 + 2)]:
        if 0 <= y < placer.free.shape[0]:
            placer.free[y, x] = True
            if crystals and placer.put(rng.choice(crystals), x, y, clear=0, shadow=False): n += 1
    return n


def summit(placer):
    """The top of the snow mountain, where the trail ends: blue banners either side of the path,
    rune-carved ice rocks round the lookout."""
    sx, sy = D.SUMMIT
    banner = _one('Objects_Props_Snow', r'Banner_Stick_1_Blue_Snow')
    runes = catalogue('Objects_Rocks_Snow', r'Rock_Ice_Rune_\d+')
    rng = random.Random(24)
    n = 0
    for (dx, dy, key) in [(-3, -2, banner), (3, -2, banner), (-3, 3, banner), (3, 3, banner)]:
        if key and placer.put(key, sx + dx, sy + dy, clear=0, shadow=False): n += 1
    for (dx, dy) in [(-7, -1), (7, -1), (-6, 4), (6, 4), (0, -6)]:
        if runes and placer.put(rng.choice(runes), sx + dx, sy + dy, clear=0, shadow=False): n += 1
    return n
