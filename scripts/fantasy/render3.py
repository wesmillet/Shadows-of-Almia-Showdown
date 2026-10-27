"""Renders almia3 from its JSON + atlas + sheets (frame 0 of animations), for previews."""
import json
import numpy as np
from PIL import Image

import os
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

def load(path=f'{ROOT}/assets/maps/almia3.json'):
    return json.load(open(path))

def decode(rle, n):
    out = np.zeros(n, np.int32); i = 0; p = 0
    while i < len(rle):
        v = rle[i]; c = rle[i + 1]; i += 2
        if v: out[p:p + c] = v
        p += c
    return out

def render(m, box=None):
    cols, rows = m['cols'], m['rows']
    atlas = Image.open(f'{ROOT}/assets/maps/almia3_tiles.png').convert('RGBA')
    sheets = [Image.open(f'{ROOT}/{s}'.replace('maps/', 'assets/maps/')).convert('RGBA') for s in m['sheets']]
    AC = m['atlas']['columns']
    x0, y0, x1, y1 = box or (0, 0, cols, rows)
    W, H = (x1 - x0) * 16, (y1 - y0) * 16
    im = Image.new('RGBA', (W, H), (16, 24, 40, 255))
    tile_cache = {}
    def tile(t):
        if t not in tile_cache:
            sx, sy = (t % AC) * 16, (t // AC) * 16
            tile_cache[t] = atlas.crop((sx, sy, sx + 16, sy + 16))
        return tile_cache[t]
    for item in m['stack']:
        if item['kind'] == 'tiles':
            g = decode(item['rle'], cols * rows).reshape(rows, cols)
            op = item.get('opacity', 1)
            for y in range(y0, y1):
                for x in range(x0, x1):
                    v = g[y, x]
                    if not v: continue
                    t = tile(v - 1)
                    if op < 1:
                        t = t.copy(); a = t.split()[3].point(lambda p: int(p * op)); t.putalpha(a)
                    im.alpha_composite(t, ((x - x0) * 16, (y - y0) * 16))
        else:
            op = item.get('opacity', 1)
            for d in item['decals']:
                sh, sx, sy, w, h, px, py = d
                if px + w < x0 * 16 or px > x1 * 16 or py + h < y0 * 16 or py > y1 * 16: continue
                c = sheets[sh].crop((sx, sy, sx + w, sy + h))
                if op < 1:
                    a = c.split()[3].point(lambda p: int(p * op)); c.putalpha(a)
                im.alpha_composite(c, (px - x0 * 16, py - y0 * 16))
    for o in sorted(m['objects'], key=lambda o: o[7]):
        sh, sx, sy, w, h, px, py, z = o
        if px + w < x0 * 16 or px > x1 * 16 or py + h < y0 * 16 or py > y1 * 16: continue
        c = sheets[sh].crop((sx, sy, sx + w, sy + h))
        im.alpha_composite(c, (px - x0 * 16, py - y0 * 16))
    return im

if __name__ == '__main__':
    m = load()
    im = render(m)
    im.resize((im.width // 4, im.height // 4), Image.LANCZOS).convert('RGB').save('before_overview.png')
    for name, box in {'meadow_c': (130, 90, 200, 135), 'snow_nw': (60, 40, 130, 85), 'autumn_ne': (210, 30, 290, 80), 'desert_sw': (30, 140, 110, 190), 'castle_se': (230, 150, 310, 200)}.items():
        c = render(m, box)
        c.convert('RGB').save(f'before_{name}.png')
    print('done')
