"""Ground layers for the third map, painted with the pack's terrain sets in the
order the artist stacks them: sea and sand, ground (grass of every land),
ground patches, snow, fallen leaves, water, roads, tall grass.
"""
import numpy as np
from scipy import ndimage
import wang
from design3 import WATER, MEADOW, FOREST, SHORE, SNOW, DESERT, AUTUMN, CASTLE, noise


def sea_and_sand(d, seed=1):
    S = wang.WangSet('Tileset_Sand', seed=seed)
    sand, sea, dsand, mid, dark = (S.color(c) for c in ('Sand', 'Sea', 'Dark Sand', 'Mid Sea', 'Dark Sea'))
    out_dist = ndimage.distance_transform_edt(~d.land)
    cells = np.full(d.land.shape, sand)
    cells[~d.land] = sea
    cells[out_dist > 5 + 1.5 * noise(seed + 30, 5).clip(-1, 1)] = mid
    cells[out_dist > 11 + 2 * noise(seed + 31, 6).clip(-1, 1)] = dark
    # darker sand dunes in the desert
    dunes = (d.biome == DESERT) & (noise(seed + 32, 4) > 0.9) & (d.dist_sea > 6)
    dunes = ndimage.binary_opening(dunes, structure=np.ones((3, 3)))
    cells[dunes] = dsand
    return S.paint(cells), cells


def ground(d, seed=2):
    """Green grass under every land but the desert and the beaches; the snowfield's winter grass
    and the autumn wood's grass on top from their own sets (Tileset_Ground_Snow / _Seasons),
    so their edges blend into green rather than sand."""
    G = wang.WangSet('Tileset_Ground', seed=seed)
    land = d.land & ~d.beach
    green = land & (d.biome != DESERT)
    oasis_green = ndimage.binary_dilation(d.oasis, iterations=6) & land
    green |= oasis_green
    cells = np.where(green, G.color('Grass'), 0)
    darkf = (d.biome == FOREST) & (noise(seed + 40, 7) > 0.35) & green
    cells[darkf] = G.color('Dark Grass')
    cells = clean(cells)
    base = G.paint(cells)
    # dirt and light grass patches in the green lands
    patch = np.zeros_like(cells)
    # a few small, rounded dirt clearings (big stepped ones read as blotches)
    dirt = (ndimage.gaussian_filter(noise(seed + 41, 4), 1.5) > 1.15) & np.isin(d.biome, [MEADOW, FOREST]) & green
    dirt = ndimage.binary_opening(dirt, structure=ndimage.generate_binary_structure(2, 1), iterations=2)
    lbl, n = ndimage.label(dirt)
    sizes = ndimage.sum(dirt, lbl, range(1, n + 1))
    for i, sz in enumerate(sizes, 1):
        if sz > 60: dirt[lbl == i] = False
    patch[dirt] = G.color('Dirt')
    light = (noise(seed + 42, 5) > 1.0) & np.isin(d.biome, [MEADOW, CASTLE]) & green & (patch == 0)
    patch[ndimage.binary_opening(light, structure=np.ones((3, 3)))] = G.color('Light Grass')
    patch = clean(patch)
    layers = [('Ground', base), ('Ground patches', G.paint(patch))]
    # the snowfield
    Gs = wang.WangSet('Tileset_Ground_Snow', seed=seed + 1)
    snow = land & (d.biome == SNOW)
    layers.append(('Ground snow', Gs.paint(clean(np.where(snow, Gs.color('Winter Grass'), 0)))))
    # the autumn wood: gold grass, darker and cherry glades
    Ga = wang.WangSet('Tileset_Ground_Seasons', seed=seed + 2)
    empty = Ga.color('Empty')
    au = land & (d.biome == AUTUMN)
    ac = np.where(au, Ga.color('Autumn Grass'), empty)
    ac[au & (noise(seed + 43, 5) > 0.7)] = Ga.color('Dark Autumn Grass')
    ac[au & (noise(seed + 44, 4) > 1.5)] = Ga.color('Cherry Grass')
    ac = clean_keep(ac, empty)
    layers.append(('Ground autumn', Ga.paint(ac, fill=empty, background=empty)))
    return layers, cells


def clean_keep(cells, empty):
    """clean() for a layer whose blank colour is `empty` rather than 0."""
    z = np.where(cells == empty, 0, cells)
    z = clean(z)
    return np.where(z == 0, empty, z)


def clean(cells, size=3):
    """Drop specks narrower than `size` so every boundary has room for its transition tiles."""
    out = cells.copy()
    for c in np.unique(cells):
        if c == 0: continue
        m = cells == c
        keep = ndimage.binary_opening(m, structure=np.ones((size, size)))
        lost = m & ~keep
        out[lost] = 0
    # fill dropped cells from the nearest kept colour
    if (out == 0).any() and (cells != 0).any():
        holes = (out == 0) & (cells != 0)
        if holes.any():
            idx = ndimage.distance_transform_edt(out == 0, return_distances=False, return_indices=True)
            fill = out[idx[0], idx[1]]
            out[holes] = fill[holes]
    return out


def snow(d, seed=3):
    S = wang.WangSet('Tileset_Snow', seed=seed)
    m = (d.biome == SNOW) & d.land & ~d.beach
    bare = noise(seed + 50, 5) > 0.75          # winter grass shows through here and there
    m &= ~bare
    m = ndimage.binary_opening(m, structure=np.ones((3, 3)))
    return S.paint(m.astype(np.int32)), m


def leaves(d, seed=4):
    L = wang.WangSet('Tileset_Leaves_Seasons', seed=seed)
    cells = np.full(d.land.shape, L.color('Empty'))
    a = (d.biome == AUTUMN) & d.land & ~d.beach
    red = a & (noise(seed + 60, 4) > 1.1)
    yel = a & (noise(seed + 61, 4) > 1.3) & ~red
    cells[ndimage.binary_opening(red, structure=np.ones((3, 3)))] = L.color('Red Leaves')
    cells[ndimage.binary_opening(yel, structure=np.ones((3, 3)))] = L.color('Yellow Leaves')
    return L.paint(cells, fill=L.color('Empty'), background=L.color('Empty'))


def water(d, seed=5):
    Wt = wang.WangSet('Tileset_Water', seed=seed)
    return Wt.paint(d.water.astype(np.int32))


def roads(d, seed=6):
    R = wang.WangSet('Tileset_Road', seed=seed)
    return R.paint(d.paths)


TALL = {MEADOW: 'Tall Grass', CASTLE: 'Flower Grass', FOREST: 'Tall Grass', SNOW: 'Snow Grass', AUTUMN: 'Autumn Grass', DESERT: 'Hay'}


def tall_grass(d, free, seed=7):
    T = wang.WangSet('Tileset_TallGrass', seed=seed)
    cells = np.zeros(d.land.shape, np.int32)
    n = noise(seed + 70, 3)
    for b, name in TALL.items():
        m = (d.biome == b) & free & (n > 1.15)
        m = ndimage.binary_opening(m, structure=np.ones((3, 3)))
        cells[m] = T.color(name)
    return T.paint(cells), cells > 0
