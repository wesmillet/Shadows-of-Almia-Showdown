"""Reads the Fan-tasy Tileset's Tiled files (.tsx tilesets and .tmx maps).

Tilesets are either one image cut into 16 px tiles, or collections of single
images (objects: trees, buildings, props). Both carry per-tile collision
shapes, animations and probabilities; image tilesets can carry wang sets
(the artist's own terrain transitions).
"""
import os, functools, xml.etree.ElementTree as ET
import numpy as np
from PIL import Image

# The packs unpacked and merged (newest copy of each file wins): Art/ and Tiled/ at the top.
LIB = os.environ.get('FANTASY_DIR', os.path.expanduser('~/fantasy'))
TSX_DIR = os.path.join(LIB, 'Tiled', 'Tilesets')
TMX_DIR = os.path.join(LIB, 'Tiled', 'Tilemaps')
FLIP_H, FLIP_V, FLIP_D = 0x80000000, 0x40000000, 0x20000000
GID_MASK = 0x0FFFFFFF


class Tile:
    __slots__ = ('id', 'image', 'w', 'h', 'shapes', 'anim', 'prob', 'type')

    def __init__(self, id):
        self.id = id; self.image = None; self.w = self.h = 16
        self.shapes = []; self.anim = None; self.prob = 1.0; self.type = None


class Tileset:
    def __init__(self, name):
        self.name = name
        path = os.path.join(TSX_DIR, name + '.tsx')
        r = ET.parse(path).getroot()
        self.tw = int(r.get('tilewidth')); self.th = int(r.get('tileheight'))
        self.count = int(r.get('tilecount')); self.columns = int(r.get('columns') or 0)
        img = r.find('image')
        self.image = os.path.normpath(os.path.join(TSX_DIR, img.get('source'))) if img is not None else None
        self.tiles = {}
        for t in r.findall('tile'):
            tl = Tile(int(t.get('id')))
            tl.prob = float(t.get('probability', 1)); tl.type = t.get('type') or t.get('class')
            im = t.find('image')
            if im is not None:
                tl.image = os.path.normpath(os.path.join(TSX_DIR, im.get('source')))
                tl.w = int(im.get('width')); tl.h = int(im.get('height'))
            og = t.find('objectgroup')
            if og is not None:
                for o in og.findall('object'):
                    x, y = float(o.get('x', 0)), float(o.get('y', 0))
                    w, h = float(o.get('width', 0)), float(o.get('height', 0))
                    poly = o.find('polygon')
                    if poly is not None:
                        pts = [tuple(map(float, p.split(','))) for p in poly.get('points').split()]
                        xs = [x + a for a, _ in pts]; ys = [y + b for _, b in pts]
                        tl.shapes.append(('poly', min(xs), min(ys), max(xs) - min(xs), max(ys) - min(ys), [(x + a, y + b) for a, b in pts]))
                    elif o.find('ellipse') is not None:
                        tl.shapes.append(('ellipse', x, y, w, h, None))
                    elif w and h:
                        tl.shapes.append(('rect', x, y, w, h, None))
            an = t.find('animation')
            if an is not None:
                tl.anim = [(int(f.get('tileid')), int(f.get('duration'))) for f in an.findall('frame')]
            self.tiles[tl.id] = tl
        self.wangsets = []
        for w in r.iter('wangset'):
            colors = [c.get('name') for c in w.findall('wangcolor')]
            tiles = [(int(t.get('tileid')), tuple(int(v) for v in t.get('wangid').split(','))) for t in w.findall('wangtile')]
            self.wangsets.append({'name': w.get('name'), 'type': w.get('type'), 'colors': colors, 'tiles': tiles})

    @functools.cached_property
    def pixels(self):
        return np.array(Image.open(self.image).convert('RGBA')) if self.image else None

    def tile_image(self, tid):
        """RGBA array of one tile (image tilesets) or the object's picture (collections)."""
        if self.image:
            c = self.columns
            x, y = (tid % c) * self.tw, (tid // c) * self.th
            return self.pixels[y:y + self.th, x:x + self.tw]
        t = self.tiles.get(tid)
        return _img(t.image) if t and t.image else None


@functools.lru_cache(maxsize=None)
def _img(path):
    return np.array(Image.open(path).convert('RGBA'))


@functools.lru_cache(maxsize=None)
def tileset(name):
    return Tileset(name)


def apply_flips(a, gid):
    if gid & FLIP_D: a = a.transpose(1, 0, 2)
    if gid & FLIP_H: a = a[:, ::-1]
    if gid & FLIP_V: a = a[::-1]
    return a


class Map:
    """A sample map: layers in draw order (tile layers and object groups)."""
    def __init__(self, name):
        self.name = name
        r = ET.parse(os.path.join(TMX_DIR, name + '.tmx')).getroot()
        self.w = int(r.get('width')); self.h = int(r.get('height'))
        self.sets = []
        for t in r.findall('tileset'):
            src = os.path.basename(t.get('source').replace('\\', '/'))[:-4]
            self.sets.append((int(t.get('firstgid')), src))
        self.sets.sort()
        self.layers = []
        self.meta = {}      # layer name -> {'visible': bool, 'opacity': float}
        def walk(node, prefix='', vis=True, op=1.0):
            for c in node:
                v = vis and c.get('visible', '1') != '0'
                o = op * float(c.get('opacity', 1))
                if c.tag == 'layer':
                    d = c.find('data')
                    vals = [int(x) for x in d.text.replace('\n', '').split(',') if x.strip()]
                    name = prefix + c.get('name')
                    self.layers.append(('tiles', name, np.array(vals, dtype=np.uint32).reshape(self.h, self.w)))
                    self.meta[name] = {'visible': v, 'opacity': o}
                elif c.tag == 'objectgroup':
                    objs = []
                    for ob in c.findall('object'):
                        if ob.get('gid') and ob.get('visible', '1') != '0':
                            objs.append({'gid': int(ob.get('gid')), 'x': float(ob.get('x')), 'y': float(ob.get('y')),
                                         'w': float(ob.get('width', 0)), 'h': float(ob.get('height', 0))})
                    name = prefix + c.get('name')
                    self.layers.append(('objects', name, objs))
                    self.meta[name] = {'visible': v, 'opacity': o}
                elif c.tag == 'group':
                    walk(c, prefix + c.get('name') + '/', v, o)
        walk(r)

    def resolve(self, gid):
        """gid -> (tileset name, local id), or None for empty."""
        g = gid & GID_MASK
        if not g: return None
        name = None; first = 0
        for f, n in self.sets:
            if f <= g: first, name = f, n
            else: break
        return name, g - first

    def layer(self, name):
        for kind, n, data in self.layers:
            if n == name or n.endswith('/' + name): return data
        return None

    def render(self, only=None, objects=True, hidden=False):
        img = np.zeros((self.h * 16, self.w * 16, 4), np.float32)
        for kind, n, data in self.layers:
            if only and not any(s in n for s in only): continue
            m = self.meta.get(n, {'visible': True, 'opacity': 1.0})
            if not m['visible'] and not hidden: continue
            op = m['opacity']
            if kind == 'tiles':
                for y in range(self.h):
                    for x in range(self.w):
                        g = int(data[y, x]); rs = self.resolve(g)
                        if not rs: continue
                        a = tileset(rs[0]).tile_image(rs[1])
                        if a is None: continue
                        blit(img, apply_flips(a, g), x * 16, y * 16, op)
            elif objects:
                for o in data:
                    rs = self.resolve(o['gid'])
                    if not rs: continue
                    a = tileset(rs[0]).tile_image(rs[1])
                    if a is None: continue
                    a = apply_flips(a, o['gid'])
                    if (o['w'] and o['h']) and (int(o['w']), int(o['h'])) != (a.shape[1], a.shape[0]):
                        a = np.array(Image.fromarray(a).resize((int(o['w']), int(o['h'])), Image.NEAREST))
                    blit(img, a, int(round(o['x'])), int(round(o['y'] - a.shape[0])), op)
        return Image.fromarray(img.clip(0, 255).astype(np.uint8))


def blit(dst, a, x, y, opacity=1.0):
    h, w = a.shape[:2]
    x0, y0 = max(0, x), max(0, y); x1, y1 = min(dst.shape[1], x + w), min(dst.shape[0], y + h)
    if x1 <= x0 or y1 <= y0: return
    s = a[y0 - y:y1 - y, x0 - x:x1 - x].astype(np.float32)
    al = s[:, :, 3:4] / 255.0 * opacity
    d = dst[y0:y1, x0:x1]
    d[:, :, :3] = d[:, :, :3] * (1 - al) + s[:, :, :3] * al
    d[:, :, 3:4] = np.maximum(d[:, :, 3:4], s[:, :, 3:4])
