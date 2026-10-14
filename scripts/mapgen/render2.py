"""Preview renderer for terrain + content (mirrors what the game draws)."""
import numpy as np, sunny, lib
from PIL import Image

CROPS = sunny.ROOT + '/assets/tiles/sunnyside/crops'
_crop = {}
def crop_img(name):
    if name not in _crop:
        _crop[name] = np.array(Image.open(f'{CROPS}/{name}.png').convert('RGBA'))
    return _crop[name]

SEA = {(0,0):1294,(0,1):1358,(0,2):1166,(0,3):1230,(1,0):1291,(1,1):1355,(1,2):1163,(1,3):1227,(2,0):1292,(2,1):1356,(2,2):1164,(2,3):1228,(3,0):1293,(3,1):1357,(3,2):1165,(3,3):1229}

def dec(e):
    return e & 4095, e >> 12

def sprite_foot(name):
    m = sunny.PROPS[name]; b = m['bbox']
    return (b[0] + b[2]) / 2, b[3] + 1

def obj_sort_key(o):
    if o['kind'] == 'prefab': return o['y'] + o['h'] - 0.01
    if 'z' in o: return o['z']
    if 'py' in o: return o['py'] / 16
    return o['ty'] + 0.99

def draw_obj(img, o, x0=0, y0=0):
    if o['kind'] == 'prefab':
        layers = o.get('tiles') and [o['tiles']] or lib.PREFABS[o['name']]['layers']
        for l in layers:
            for yy, row in enumerate(l):
                for xx, e in enumerate(row):
                    if e:
                        t, f = dec(e)
                        sunny.composite(img, sunny.tile(t, f), (o['x'] + xx - x0) * 16, (o['y'] + yy - y0) * 16)
    elif o['kind'] == 'crop':
        a = crop_img(o['name']); h, w = a.shape[:2]
        sunny.composite(img, a, int(o['tx'] * 16 + 8 - w / 2 - x0 * 16), int(o['ty'] * 16 + 14 - h - y0 * 16))
    else:
        fr = sunny.prop_frame(o['name'], o.get('frame', 0))
        if o.get('flip'): fr = fr[:, ::-1]
        if 'px' in o:
            m = sunny.PROPS[o['name']]
            ox = m['w'] - m['originX'] if o.get('flip') else m['originX']
            sunny.composite(img, fr, int(o['px'] - ox - x0 * 16), int(o['py'] - m['originY'] - y0 * 16))
        else:
            fx, fy = sprite_foot(o['name'])
            if o.get('flip'): fx = fr.shape[1] - fx
            sunny.composite(img, fr, int(o['tx'] * 16 + 8 - fx - x0 * 16), int(o['ty'] * 16 + 15 - fy - y0 * 16 + o.get('dy', 0)))

def render(out, b, x0=0, y0=0, x1=None, y1=None, objects=True):
    T, Fl = out['land']; h, w = T.shape
    x1 = x1 or w; y1 = y1 or h
    img = np.zeros(((y1 - y0) * 16, (x1 - x0) * 16, 4)); img[:, :, 3] = 255
    for y in range(y0, y1):
        for x in range(x0, x1):
            sunny.composite(img, sunny.tile(SEA[(x % 4, y % 4)]), (x - x0) * 16, (y - y0) * 16)
    def lay(name):
        T, Fl = out[name]
        for y in range(y0, y1):
            for x in range(x0, x1):
                if T[y, x]: sunny.composite(img, sunny.tile(int(T[y, x]), int(Fl[y, x])), (x - x0) * 16, (y - y0) * 16)
    lay('land'); lay('paths')
    if 'dark' in out: lay('dark')
    for (x, y), e in b.ptile.items():
        if x0 <= x < x1 and y0 <= y < y1:
            sunny.composite(img, sunny.tile(*dec(e)), (x - x0) * 16, (y - y0) * 16)
    lay('shadows')
    for (x, y), es in b.gdeco.items():
        if x0 <= x < x1 and y0 <= y < y1:
            for e in es: sunny.composite(img, sunny.tile(*dec(e)), (x - x0) * 16, (y - y0) * 16)
    if objects:
        for o in sorted(b.objs, key=obj_sort_key):
            draw_obj(img, o, x0, y0)
    return Image.fromarray(img.astype(np.uint8))
