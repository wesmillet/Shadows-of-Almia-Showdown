"""Writes a map in format 3 (src/ground/fanGround.ts loads it).

Input is a layer stack the way the artist builds maps in Tiled:
  - tile layers: an (h, w) object array of tile keys (tileset, id, flip flags) or None,
    with an opacity;
  - decal groups: flat pictures on the ground at pixel positions (shadows, grass
    patches), baked into the ground with the layer's opacity;
  - objects: upright pictures (trees, buildings, props) depth-sorted with the
    characters by their bottom edge (or an explicit sort row).

Every tile the map uses (and every frame of an animated one) is packed into one
atlas PNG; objects and decals into object sheets. Layers are run-length encoded
atlas indices (+1, 0 = empty).
"""
import json, os
import numpy as np
from PIL import Image
import tiled

ATLAS_COLS = 64
SHEET_W = 2048


def tile_pixels(key):
    ts, tid, flags = key
    a = tiled.tileset(ts).tile_image(tid)
    if a is None: return None
    return tiled.apply_flips(a, flags)


class Packer:
    """Shelf packer for object pictures into sheets SHEET_W wide."""
    def __init__(self):
        self.sheets = []      # list of (canvas array)
        self.cur = None; self.x = 0; self.y = 0; self.row_h = 0
        self.index = {}

    def add(self, k, a):
        if k in self.index: return self.index[k]
        h, w = a.shape[:2]
        if self.cur is None or self.x + w > SHEET_W:
            self.x = 0; self.y += self.row_h; self.row_h = 0
        if self.cur is None or self.y + h > 4096:
            self.cur = np.zeros((4096, SHEET_W, 4), np.uint8); self.sheets.append(self.cur); self.x = self.y = self.row_h = 0
        self.cur[self.y:self.y + h, self.x:self.x + w] = a
        r = (len(self.sheets) - 1, self.x, self.y, w, h)
        self.x += w + 1; self.row_h = max(self.row_h, h + 1)
        self.index[k] = r
        return r

    def save(self, base):
        paths = []
        for i, s in enumerate(self.sheets):
            used = s[:, :, 3].any(1).nonzero()[0]
            hmax = int(used.max()) + 1 if len(used) else 1
            p = f'{base}_obj{i}.png'
            Image.fromarray(s[:hmax]).save(p, optimize=True)
            paths.append(p)
        return paths


def rle(arr):
    flat = arr.ravel().tolist()
    out = []
    i = 0; n = len(flat)
    while i < n:
        v = flat[i]; j = i
        while j < n and flat[j] == v: j += 1
        out.append(v); out.append(j - i); i = j
    return out


def export(path_base, rel_base, m):
    """m: dict with cols, rows, stack, objects, grids and points. Writes <path_base>.json and images."""
    keys = {}            # tile key -> atlas index
    frames = []          # atlas index -> key
    anims = {}

    def idx(k):
        if k in keys: return keys[k]
        keys[k] = len(frames); frames.append(k)
        t = tiled.tileset(k[0]).tiles.get(k[1])
        if t is not None and t.anim:
            seq = []
            for (fid, ms) in t.anim:
                fk = (k[0], fid, k[2])
                if fk not in keys:
                    keys[fk] = len(frames); frames.append(fk)
                seq.append([keys[fk], ms])
            anims[keys[k]] = seq
        return keys[k]

    packer = Packer()
    out_stack = []
    for item in m['stack']:
        if item['kind'] == 'tiles':
            g = item['tiles']
            a = np.zeros(g.shape, np.int32)
            for (y, x) in zip(*np.nonzero(g != None)):
                a[y, x] = idx(g[y, x]) + 1
            if not a.any(): continue
            out_stack.append({'kind': 'tiles', 'name': item['name'], 'opacity': round(item.get('opacity', 1.0), 3), 'rle': rle(a)})
        else:
            decals = []
            for d in item['decals']:
                img = tile_pixels(d['key'])
                if img is None: continue
                if d.get('w') and (int(d['w']), int(d['h'])) != (img.shape[1], img.shape[0]):
                    img = np.array(Image.fromarray(img).resize((int(d['w']), int(d['h'])), Image.NEAREST))
                s = packer.add((d['key'], img.shape), img)
                decals.append([s[0], s[1], s[2], s[3], s[4], int(round(d['x'])), int(round(d['y'] - s[4]))])
            if decals:
                out_stack.append({'kind': 'decals', 'name': item['name'], 'opacity': round(item.get('opacity', 1.0), 3), 'decals': decals})

    # the tile atlas
    n = len(frames)
    rows = (n + ATLAS_COLS - 1) // ATLAS_COLS
    atlas = np.zeros((max(1, rows) * 16, ATLAS_COLS * 16, 4), np.uint8)
    for i, k in enumerate(frames):
        a = tile_pixels(k)
        if a is None: continue
        y, x = (i // ATLAS_COLS) * 16, (i % ATLAS_COLS) * 16
        atlas[y:y + 16, x:x + 16] = a[:16, :16]
    Image.fromarray(atlas).save(path_base + '_tiles.png', optimize=True)

    objs = []
    for o in m['objects']:
        if 'img' in o:                       # a baked picture (stamps cut from the samples)
            img = o['img']; pk = ('img', o['name'])
        else:
            img = tile_pixels(o['key'])
            if img is None: continue
            if o.get('w') and (int(o['w']), int(o['h'])) != (img.shape[1], img.shape[0]):
                img = np.array(Image.fromarray(img).resize((int(o['w']), int(o['h'])), Image.NEAREST))
            pk = (o['key'], img.shape)
        s = packer.add(pk, img)
        sort = o.get('sort', o['y'] / 16)
        objs.append([s[0], s[1], s[2], s[3], s[4], int(round(o['x'])), int(round(o['y'] - s[4])), round(sort, 3)])
    sheets = packer.save(path_base)

    data = {
        'version': 3, 'name': m['name'], 'cols': m['cols'], 'rows': m['rows'], 'tileSize': 16,
        'atlas': {'src': f'{rel_base}_tiles.png', 'columns': ATLAS_COLS},
        'anims': {str(k): v for k, v in anims.items()},
        'sheets': [f'{rel_base}_obj{i}.png' for i in range(len(sheets))],
        'stack': out_stack,
        'objects': objs,
        'walkable': [''.join('1' if v else '0' for v in r) for r in m['walkable']],
        'reachable': [''.join('1' if v else '0' for v in r) for r in m['reachable']],
        'biome': [''.join(str(int(v)) for v in r) for r in m['biome']],
        'minimap': m['minimap'],
        'stairs': m.get('stairs', []),
        'center': m['center'], 'outposts': m['outposts'], 'spawns': m['spawns'], 'towns': m.get('towns', []),
        'credits': m.get('credits', ''),
    }
    for k in ('npcs', 'shops', 'arena', 'lake'):
        if k in m: data[k] = m[k]
    with open(path_base + '.json', 'w') as f:
        json.dump(data, f, separators=(',', ':'))
    return data, n, len(objs)
