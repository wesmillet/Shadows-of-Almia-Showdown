"""Whole structures cut from the pack's sample maps (the palace, towers), baked
into single pictures that stand on the map as depth-sorted objects.

A stamp is the composite of the sample's building layers inside a tile
rectangle. Its footprint (blocked tiles) is every tile of its bottom
`foot` rows that the picture covers.
"""
import functools
import numpy as np
import tiled

LAYER_WORDS = ('Castle', 'Floor', 'Wall', 'Detail', 'Animation', 'Building')

STAMPS = {
    # name: (sample, x0, y0, x1, y1 (exclusive), foot rows, include floor layers)
    'palace': ('Forest Castle', 18, 4, 63, 37, 12, True),
    'keep_red': ('Bosk Barracks', 25, 3, 35, 14, 3, True),
    'tower_cone': ('Bosk Barracks', 33, 19, 37, 33, 4, False),
}


# Stamps cut from a busy sample: keep only the structure itself (the tower's rectangle also
# catches the rims of the walkways beside it and a lamp above, which stuck up like fence posts).
ISOLATE = {'tower_cone'}


def isolate(img):
    """Per row, keeps only the run of solid pixels through the picture's centre column, so
    neighbouring bits of the sample that share the rectangle are dropped."""
    out = img.copy()
    h, w = img.shape[:2]
    cx = w // 2
    solid = img[:, :, 3] > 40
    for y in range(h):
        row = solid[y]
        if not row[cx]:
            out[y, :, 3] = 0
            continue
        x0 = cx
        while x0 > 0 and row[x0 - 1]: x0 -= 1
        x1 = cx
        while x1 < w - 1 and row[x1 + 1]: x1 += 1
        # a pixel or two of soft edge either side stays
        out[y, :max(0, x0 - 1), 3] = 0
        out[y, min(w, x1 + 2):, 3] = 0
    return out


@functools.lru_cache(maxsize=None)
def stamp(name):
    sample, x0, y0, x1, y1, foot, floors = STAMPS[name]
    m = tiled.Map(sample)
    img = np.zeros(((y1 - y0) * 16, (x1 - x0) * 16, 4), np.float32)
    for kind, n, data in m.layers:
        if kind != 'tiles' or not m.meta[n]['visible']: continue
        if not any(w in n for w in LAYER_WORDS): continue
        if not floors and 'Floor' in n: continue
        op = m.meta[n]['opacity']
        for y in range(y0, y1):
            for x in range(x0, x1):
                g = int(data[y, x]); rs = m.resolve(g)
                if not rs: continue
                a = tiled.tileset(rs[0]).tile_image(rs[1])
                if a is None: continue
                tiled.blit(img, tiled.apply_flips(a, g), (x - x0) * 16, (y - y0) * 16, op)
    img = img.clip(0, 255).astype(np.uint8)
    if name in ISOLATE:
        img = isolate(img)
    al = img[:, :, 3] > 40
    tiles = al.reshape(y1 - y0, 16, x1 - x0, 16).mean(axis=(1, 3)) > 0.3
    block = np.zeros_like(tiles)
    block[-foot:] = tiles[-foot:]
    return img, block


def tile_stamp(sample, x0, y0, x1, y1, layers):
    """Tile keys of some of a sample's layers in a rectangle (animated tiles stay animated):
    a list of (h, w) object arrays, bottom layer first."""
    import automap
    m = tiled.Map(sample)
    out = []
    for kind, n, data in m.layers:
        if kind != 'tiles' or n not in layers: continue
        out.append(automap.keys(m, data[y0:y1, x0:x1]))
    return out
