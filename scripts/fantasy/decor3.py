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


# ---------------------------------------------------------------------------- the snow mountain

def _big(placer, key, x, y, blocked=None):
    """A building or big prop with its base centred on tile (x, y): the whole footprint is taken
    from the placer (nothing planted over it) and its bottom rows are blocked."""
    w, h = content3.size(key)
    tw, th = (w + 15) // 16, (h + 15) // 16
    x0, y0 = x - tw // 2, y - th + 1
    H, W = placer.free.shape
    if x0 < 0 or y0 < 0 or x0 + tw > W or y > H - 1: return False
    # its base (the bottom three rows) must stand on free ground; the picture above may rise
    # over whatever lies behind (a tower on a tier stands against the tiers above it)
    if not placer.free[max(y0, y - 2):y + 1, x0:x0 + tw].all(): return False
    placer.put(key, x, y, clear=0, shadow=False)
    placer.free[max(0, y0 - 1):y + 2, max(0, x0 - 1):x0 + tw + 1] = False
    if blocked is not None: blocked[max(y0, y - 2):y + 1, x0:x0 + tw] = True
    return True


def mountain(d, placer, anim, blocked):
    """The snow mountain the way Frost Peak dresses one: torches at the top of every flight of the
    trail, the tower on the summit with braziers and banners before it and rune ice round it, a
    rangers' camp (shelters, a fire, a watchtower) on the tiers, lanterns here and there."""
    import animprops
    rng = random.Random(27)
    sx = D.STAIR_SITES[1][0]
    rows = sorted(d.stair_rows.get(sx, []))
    n = 0
    TORCH = ('Animation_Torch_1', 32)
    BRAZIER = ('Animation_Ruins_Brazier', 24)
    FIRE = ('Animation_Campfire', 0)
    BANNER = ('Animation_Banner_1_Snow', 0)            # the blue one
    FLAG = ('Animation_Banner_3_Snow', 1)
    free_anim = lambda cells: all(0 <= y < anim.shape[0] and 0 <= x < anim.shape[1] and placer.free[y, x] and anim[y, x] is None for (y, x) in cells)
    def put_anim(key, x, yb, block=False):
        w, h, cells = animprops.block(*key)
        want = [(yb - h + 1 + dy, x + dx) for dx, dy, _ in cells]
        if not free_anim(want): return False
        animprops.place(anim, key[0], key[1], x, yb)
        for (y, xx) in want: placer.free[y, xx] = False
        if block:
            for (y, xx) in want:
                if y == yb: blocked[y, xx] = True
        return True
    # torches either side of the top of each flight (the flight's face starts on row y)
    for y in rows:
        for x in (sx - 4, sx + 4):
            if put_anim(TORCH, x, y - 1): n += 1
    # the summit: the tower above the lookout, braziers and banners where the trail arrives
    tx, ty = D.SUMMIT
    tower = _one('Objects_Buildings_Snow', r'Tower_Snow_1_1')
    if tower:
        for dy in (-6, -7, -5, -8, -4, -9):
            if _big(placer, tower, tx, ty + dy, blocked): n += 1; break
        else: print('  no room for the summit tower')
    for x in (tx - 3, tx + 3):
        if put_anim(BRAZIER, x, ty + 1, block=True): n += 1
    for x in (tx - 6, tx + 5):
        if put_anim(BANNER, x, ty - 2): n += 1
    runes = catalogue('Objects_Rocks_Snow', r'Rock_Ice_Rune_\d+')
    for (dx, dy) in [(-8, 0), (8, 0), (-7, 4), (7, 4), (-3, -8), (3, -8)]:
        if runes and placer.put(rng.choice(runes), tx + dx, ty + dy, clear=0, shadow=False): n += 1
    # camps on the tiers: a spot well inside each tier, away from the trail
    from scipy import ndimage
    shelters = catalogue('Objects_Buildings_Snow', r'Shelter_Logs_(Cloth_)?Snow_\d')
    watch = _one('Objects_Buildings_Snow', r'Watchtower_1_Snow_Blue')
    crates = catalogue('Objects_Props_Snow', r'(Crate_Medium_Closed|Barrel_Medium_Covered|WoodStack_1|Crate_Wide_Hay_1|Barrel_Small_Covered)_Snow')
    lantern = catalogue('Objects_Props_Snow', r'LampPost_[12]_Snow')
    for lv in range(2, int(d.level.max()) + 1):
        tier = ndimage.binary_erosion(d.level == lv, iterations=4) & placer.free & (np.abs(np.arange(d.level.shape[1])[None, :] - sx) > 6)
        ys, xs = np.nonzero(tier)
        if not len(ys): continue
        order = rng.sample(range(len(ys)), min(len(ys), 40))
        placed = 0
        for i in order:
            y, x = int(ys[i]), int(xs[i])
            if lv == 3 and watch and placed == 0 and _big(placer, watch, x, y, blocked): placed += 1; n += 1; continue
            if placed < (2 if lv < 5 else 1) and shelters and _big(placer, rng.choice(shelters), x, y, blocked):
                placed += 1; n += 1
                if put_anim(FIRE, x + 4, y + 1, block=True): n += 1
                for j in range(2):
                    if crates and placer.put(rng.choice(crates), x - 3 + j, y + 1 + j, clear=0, shadow=False): n += 1
                continue
            if placed >= 2: break
        # a lantern or two along the tier's edge
        for i in order[-3:]:
            y, x = int(ys[i]), int(xs[i])
            if lantern and placer.free[y, x] and placer.put(rng.choice(lantern), x, y, clear=0, shadow=False): n += 1
    # flags on the lower tiers' edges, as the pack flies them
    for lv in (2, 4):
        edge = (d.level == lv) & ~ndimage.binary_erosion(d.level == lv, iterations=2) & ndimage.binary_erosion(d.level == lv, iterations=1) & placer.free
        ys, xs = np.nonzero(edge)
        for i in rng.sample(range(len(ys)), min(len(ys), 60)):
            y, x = int(ys[i]), int(xs[i])
            if abs(x - sx) < 8: continue
            if put_anim(FLAG, x, y): n += 1; break
    return n


# ---------------------------------------------------------------------------- life everywhere

GRASS = {
    D.MEADOW: ('Objects_Grass', r'Grass_Light_.*'), D.CASTLE: ('Objects_Grass', r'Grass_Emerald_.*'),
    D.FOREST: ('Objects_Grass', r'Grass_(Emerald|Dark)_.*'), D.AUTUMN: ('Objects_Grass', r'Grass_Light_.*'),
    D.SNOW: ('Objects_Grass_Snow', r'.*'), D.DESERT: ('Objects_Grass_Desert', r'.*'),
}
FLOWER_SETS = {D.MEADOW: [0, 96, 384, 480], D.FOREST: [0, 384], D.AUTUMN: [96, 192, 768], D.CASTLE: [0, 384, 480, 672]}


def life(d, placer, anim, seed=31):
    """Grass clumps on every land, patches of animated flowers on the green ones, reeds and
    lily pads swaying on the lakes, floating logs, rune rocks glowing round the crystal."""
    import animprops
    rng = random.Random(seed)
    n = 0
    pools = {}
    for b, (ts, rx) in GRASS.items():
        try: pools[b] = catalogue(ts, rx)
        except Exception: pools[b] = []
    blight = D.blight()
    order = list(zip(*np.nonzero(placer.free & d.land & ~d.water & ~d.beach)))
    rng.shuffle(order)
    for (y, x) in order:
        b = int(d.biome[y, x])
        pool = pools.get(b)
        if not pool or blight[y, x]: continue
        if rng.random() < 0.025 and placer.put(rng.choice(pool), x, y, clear=0, shadow=False): n += 1
    # flower patches (6 x 2 tiles of small animated flowers)
    free_anim = lambda cells: all(0 <= y < anim.shape[0] and 0 <= x < anim.shape[1] and placer.free[y, x] and anim[y, x] is None and d.land[y, x] and not d.water[y, x] and d.paths[y, x] == 0 for (y, x) in cells)
    def put_anim(ts, tid, x, yb):
        w, h, cells = animprops.block(ts, tid)
        want = [(yb - h + 1 + dy, x + dx) for dx, dy, _ in cells]
        if not free_anim(want): return False
        animprops.place(anim, ts, tid, x, yb)
        for (y, xx) in want: placer.free[y, xx] = False
        return True
    for (y, x) in order[:6000]:
        b = int(d.biome[y, x])
        if b not in FLOWER_SETS or blight[y, x] or rng.random() > 0.012: continue
        if put_anim('Animation_Flowers', rng.choice(FLOWER_SETS[b]), x, y): n += 1
    # on the water: reeds along the banks, lily pads out on the lakes, a floating log or two
    from scipy import ndimage
    bank = d.water & ndimage.binary_dilation(~d.water & d.land, iterations=1)
    deep = d.water & ~ndimage.binary_dilation(~d.water, iterations=2)
    for (ts, where, p) in [('Animation_WaterPlants_Emerald', bank, 0.10), ('Animation_WaterPlants_Emerald', deep, 0.03), ('Animation_WaterProps', deep, 0.006)]:
        bl = animprops.blocks(ts)
        keys = list(bl)
        if ts.endswith('Emerald'):
            keys = [k for k in keys if bl[k][0] == 1 and bl[k][1] == 1] if where is bank else [k for k in keys if bl[k][0] == 2]
        cells = list(zip(*np.nonzero(where)))
        rng.shuffle(cells)
        for (y, x) in cells:
            if rng.random() > p: continue
            k = rng.choice(keys)
            w, h, cc = bl[k]
            want = [(y - h + 1 + dy, x + dx) for dx, dy, _ in cc]
            if all(0 <= yy < anim.shape[0] and 0 <= xx < anim.shape[1] and anim[yy, xx] is None and d.water[yy, xx] for (yy, xx) in want):
                # the winter lake gets the winter plants
                use = 'Animation_WaterPlants_Winter' if (ts.endswith('Emerald') and d.biome[y, x] == D.SNOW) else ts
                animprops.place(anim, use, k, x, y); n += 1
    # rune rocks that glow, among the dead things round the crystal
    runes = [k for k, (w, h, c) in animprops.blocks('Animation_Rock_Gray').items() if w <= 2]
    cells = list(zip(*np.nonzero(blight & placer.free & ~d.water & (d.paths == 0))))
    rng.shuffle(cells)
    placed = 0
    for (y, x) in cells:
        if placed >= 7: break
        if put_anim('Animation_Rock_Gray', rng.choice(runes), x, y): placed += 1; n += 1
    # braziers burning on the arena's terrace
    cx, cy = D.CRYSTAL
    x0, y0, x1, y1 = D.FINAL_ARENA
    for (x, y) in [(cx - 9, y0 - 4), (cx + 8, y0 - 4), (cx - 9, y1 + 3), (cx + 8, y1 + 3)]:
        placer.free[y - 2:y + 1, x:x + 2] = True
        if put_anim('Animation_Ruins_Brazier', 24, x, y): n += 1
    return n


def waterfalls(d, anim, blocked):
    """A waterfall wherever a stream on a plateau reaches the plateau's south face (design3 lays
    the streams): the pack's animated fall, lip on the edge, foot splashing into the water below."""
    import animprops
    n = 0
    for (x, y_lip) in getattr(d, 'falls', []):
        animprops.place(anim, 'Animation_Waterfall', 0, x - 1, y_lip + 3)
        blocked[y_lip:y_lip + 4, x - 1:x + 2] = True
        n += 1
    return n
