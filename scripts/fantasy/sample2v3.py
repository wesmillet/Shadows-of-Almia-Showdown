"""Converts one of the pack's sample maps to format 3 (a test of the pipeline and the renderer).

  python3 scripts/fantasy/sample2v3.py "Desert Town" sample
"""
import os, sys
import numpy as np
from scipy import ndimage
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import tiled, automap, collide, export3

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
FLAT = ('Objects_Shadows', 'Objects_Grass', 'Objects_Grass_Desert', 'Objects_Grass_Snow')


def convert(name, out_name):
    m = tiled.Map(name)
    stack, objects = [], []
    ras = collide.Raster(m.w, m.h)
    for kind, lname, data in m.layers:
        meta = m.meta[lname]
        if not meta['visible']: continue
        if kind == 'tiles':
            k = automap.keys(m, data)
            stack.append({'kind': 'tiles', 'name': lname, 'opacity': meta['opacity'], 'tiles': k})
            for (y, x) in zip(*np.nonzero(k != None)): ras.tile(k[y, x], x, y)
        else:
            decals = []
            for o in data:
                key = automap.key(m, o['gid'])
                if key is None: continue
                if key[0] in FLAT:
                    decals.append({'key': key, 'x': o['x'], 'y': o['y'], 'w': o['w'], 'h': o['h']})
                else:
                    objects.append({'key': key, 'x': o['x'], 'y': o['y'], 'w': o['w'], 'h': o['h']})
                    ras.picture(key, o['x'], o['y'], o['w'] or None, o['h'] or None)
            if decals: stack.append({'kind': 'decals', 'name': lname, 'opacity': meta['opacity'], 'decals': decals})
    blocked = ras.blocked()
    walk = ~blocked
    cy, cx = m.h // 2, m.w // 2
    lbl, _ = ndimage.label(walk)
    # reachable: the largest walkable region
    sizes = np.bincount(lbl.ravel()); sizes[0] = 0
    reach = lbl == sizes.argmax()
    ys, xs = np.nonzero(reach)
    i = np.argmin((ys - cy) ** 2 + (xs - cx) ** 2)
    center = {'x': float(xs[i]) + 0.5, 'y': float(ys[i]) + 0.5}
    pts = list(zip(xs, ys))
    rng = np.random.default_rng(1)
    pick = lambda n: [{'x': float(pts[j][0]) + 0.5, 'y': float(pts[j][1]) + 0.5} for j in rng.choice(len(pts), n, replace=False)]
    mm = [''.join('g' if walk[y, x] else 'f' for x in range(m.w)) for y in range(m.h)]
    data = {'name': out_name, 'cols': m.w, 'rows': m.h, 'stack': stack, 'objects': objects,
            'walkable': walk, 'reachable': reach, 'biome': np.ones((m.h, m.w), int), 'minimap': mm,
            'center': center, 'outposts': pick(3), 'spawns': pick(6),
            'credits': 'The Fan-tasy Tileset (Premium) and its expansions'}
    base = os.path.join(ROOT, 'assets', 'maps', out_name)
    d, ntiles, nobj = export3.export(base, f'maps/{out_name}', data)
    print(out_name, m.w, 'x', m.h, '| atlas tiles', ntiles, '| objects', nobj, '| walkable', int(walk.sum()), 'reachable', int(reach.sum()))


if __name__ == '__main__':
    convert(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else 'sample')
