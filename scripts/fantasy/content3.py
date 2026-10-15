"""Objects for the third map: trees, rocks, bushes per land, each with the
pack's collision shapes, placed where nothing else stands.

Objects are dicts {key, x, y} with x the left edge and y the bottom edge in
map pixels (Tiled's convention for tile objects).
"""
import os, re, random
import numpy as np
from scipy import ndimage
import tiled
from design3 import WATER, MEADOW, FOREST, SHORE, SNOW, DESERT, AUTUMN, CASTLE, noise


def catalogue(tileset, pattern):
    ts = tiled.tileset(tileset)
    rx = re.compile(pattern)
    out = []
    for tid, t in sorted(ts.tiles.items()):
        if t.image and rx.fullmatch(os.path.splitext(os.path.basename(t.image))[0]):
            out.append((tileset, tid))
    return out


TREES = {
    FOREST: catalogue('Objects_Trees', r'(Tree_(Emerald|Dark)_\d+|Birch_(Emerald|Dark)_\d+)'),
    MEADOW: catalogue('Objects_Trees', r'(Tree_(Light|Emerald)_\d+|Birch_Light_\d+)'),
    CASTLE: catalogue('Objects_Trees', r'(Tree_(Light|Emerald)_\d+)'),
    AUTUMN: catalogue('Objects_Trees_Seasons', r'(Tree_(Red|Yellow)_\d+|Birch_(Red|Yellow)_\d+)'),
    SNOW: catalogue('Objects_Trees_Snow', r'(Tree_(Snow|Winter)_\d+|Birch_(Snow|Dead_Snow)_\d+|Tree_Dead_\d_Snow)'),
    DESERT: catalogue('Objects_Trees_Desert', r'(Palm_(Emerald|Light|Dark|Yellow)_\d+|Cactus_Emerald_\d+|Tree_Dead_\d+)'),
}
CHERRY = catalogue('Objects_Trees_Seasons', r'Tree_Pink_\d+|Birch_Pink_\d+')
BUSHES = {
    FOREST: catalogue('Objects_Trees', r'Bush_(Emerald|Dark)_\d+|LeavyBush_(Emerald|Dark)_\d+'),
    MEADOW: catalogue('Objects_Trees', r'Bush_(Light|Emerald)_\d+'),
    CASTLE: catalogue('Objects_Trees', r'Bush_(Light|Emerald)_\d+'),
    AUTUMN: catalogue('Objects_Trees_Seasons', r'Bush_(Red|Yellow)_\d+|LeavyBush_(Red|Yellow)_\d+'),
    SNOW: catalogue('Objects_Trees_Snow', r'Bush_(Snow|Winter)_\d+'),
    DESERT: catalogue('Objects_Trees_Desert', r'Cactus_Emerald_\d+_Flower|Plant_Agave|LeavyBush_(Yellow|Light)_\d+'),
}
ROCKS = {
    FOREST: catalogue('Objects_Rocks', r'Rock_Gray_Grass_\d+|Rock_Brown_EmeraldGrass_\d+'),
    MEADOW: catalogue('Objects_Rocks', r'Rock_Gray_Grass_\d+'),
    CASTLE: catalogue('Objects_Rocks', r'Rock_Gray_Grass_\d+'),
    AUTUMN: catalogue('Objects_Rocks_Seasons', r'Rock_.*'),
    SNOW: catalogue('Objects_Rocks_Snow', r'Rock_(Ice|Brown_Snow)_\d+'),
    DESERT: catalogue('Objects_Rocks_Desert', r'Rock_Brown_Desert_\d+'),
}


def size(key):
    t = tiled.tileset(key[0]).tiles[key[1]]
    return t.w, t.h


class Placer:
    """Keeps track of claimed tiles; places a picture with its base centred on a tile."""
    def __init__(self, free, seed=9):
        self.free = free.copy()            # tiles an object may stand on
        self.objects = []
        self.decals = []
        self.rng = random.Random(seed)

    def put(self, key, tx, ty, clear=1, shadow=True):
        w, h = size(key)
        r = clear
        y0, y1, x0, x1 = ty - r, ty + r + 1, tx - r, tx + r + 1
        if y0 < 0 or x0 < 0 or y1 > self.free.shape[0] or x1 > self.free.shape[1]: return False
        if not self.free[y0:y1, x0:x1].all(): return False
        self.free[y0:y1, x0:x1] = False
        px = tx * 16 + 8 - w // 2
        py = ty * 16 + 14
        self.objects.append({'key': (key[0], key[1], 0), 'x': px, 'y': py})
        if shadow and w >= 40:
            sw = 48 if w >= 64 else 40
            self.decals.append(shadow_decal(sw, tx * 16 + 8, py + 2))
        return True


_SH = {}


def shadow_decal(w, cx, bottom):
    name = f'Shadow_Round_{w}x{w // 2 if w == 48 else w}_Flat'
    if name not in _SH:
        cat = catalogue('Objects_Shadows', re.escape(name) + r'_Black')
        _SH[name] = cat[0] if cat else None
    k = _SH[name]
    if k is None: return None
    t = tiled.tileset(k[0]).tiles[k[1]]
    return {'key': (k[0], k[1], 0), 'x': cx - t.w // 2, 'y': bottom + t.h // 3}


def woods(d, placer, open_mask, seed=11):
    """Woods per land: dense where the noise says forest, scattered elsewhere, never on open ground."""
    rng = random.Random(seed)
    dens = noise(seed + 80, 6)
    order = list(zip(*np.nonzero(placer.free & ~open_mask)))
    rng.shuffle(order)
    n = 0
    for (y, x) in order:
        b = int(d.biome[y, x])
        trees = TREES.get(b)
        if not trees: continue
        forest_here = dens[y, x] > {FOREST: -0.2, AUTUMN: 0.1, SNOW: 0.4, MEADOW: 0.9, CASTLE: 1.4, DESERT: 1.0}[b]
        p = 0.22 if forest_here else 0.012
        if rng.random() > p: continue
        pool = trees
        if b == AUTUMN and rng.random() < 0.12: pool = CHERRY
        k = rng.choice(pool)
        if placer.put(k, x, y, clear=1 if forest_here else 2): n += 1
    return n


def scatter(d, placer, table, rate, seed, clear=1, shadow=False):
    rng = random.Random(seed)
    order = list(zip(*np.nonzero(placer.free)))
    rng.shuffle(order)
    n = 0
    for (y, x) in order:
        pool = table.get(int(d.biome[y, x]))
        if not pool or rng.random() > rate: continue
        if placer.put(rng.choice(pool), x, y, clear=clear, shadow=shadow): n += 1
    return n
