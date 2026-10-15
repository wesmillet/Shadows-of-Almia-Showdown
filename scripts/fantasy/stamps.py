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
