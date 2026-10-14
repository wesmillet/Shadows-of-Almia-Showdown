#!/usr/bin/env python3
"""Builds assets/maps/almia.json and almia_preview.png.

  python3 scripts/mapgen/build.py [--preview-only]

Pipeline:
  designer2.py  terrain as semantic labels: sea, grass, sand, cliff face, river, ramp
  almia.py      roads, ladders, bridges, piers, buildings, farms, forests, props
  resolve.py    tiles chosen by example from the Sunnyside demo room (the pack's own
                hand-made map): every 3x3 neighbourhood is matched against what the
                artist drew, then a local repair pass keeps only tile pairs the artist used
  export.py     the map file the game loads (src/ground/staticGround.ts)

Needs numpy, scipy and Pillow.
"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np
import resolve, render2, export, almia


def main():
    L = resolve.Learner()
    d, b = almia.build()
    out, rep, miss = resolve.resolve(d.lab, d.paths, L)
    resolve.repair(out, L, d.lab)
    dark = np.where(b.dark & (d.paths == '1'), '2', '.')
    out['dark'] = resolve.resolve(d.lab, dark, L, only_paths=True)[0]['paths']
    for (y, x) in zip(*np.nonzero(b.bridge_path)):
        out['paths'][0][y, x] = 0; out['paths'][1][y, x] = 0
    T, Fl = out['shadows']
    H, W = T.shape
    # shadows over open sea only directly under a cliff face
    for y in range(H):
        for x in range(W):
            if T[y, x] and d.lab[y, x] == 'W' and not (d.lab[max(0, y - 1), x] == 'F' or d.lab[max(0, y - 2), x] == 'F'):
                T[y, x] = 0; Fl[y, x] = 0
    # close short gaps in the two-row shadow under straight cliff runs (river banks confuse the learner)
    for y in range(H):
        x = 0
        while x < W:
            if T[y, x] == 76:
                x2 = x + 1
                while x2 < W and T[y, x2] == 0 and x2 - x <= 4: x2 += 1
                if x2 < W and T[y, x2] == 76 and x2 - x > 1:
                    T[y, x + 1:x2] = 76; Fl[y, x + 1:x2] = 0
                x = x2
            else:
                x += 1
    rs = resolve.real_seams(out, L)
    print('tile pairs the artist never drew, with a visible seam:', len(rs))
    im = render2.render(out, b)
    preview = os.path.join(export.ROOT, 'assets/maps/almia_preview.png')
    im.resize((im.width // 2, im.height // 2)).convert('RGB').save(preview)
    print('preview', preview)
    if '--preview-only' not in sys.argv:
        path, data, walk, reach = export.export(d, b, out)
        print('map', path, os.path.getsize(path) // 1024, 'KB;', int(walk.sum()), 'walkable cells,', int(reach.sum()), 'reachable')


if __name__ == '__main__':
    main()
