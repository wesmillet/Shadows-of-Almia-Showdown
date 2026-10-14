"""Whole buildings from the demo: seed = building+walls components, grown into
decoration layers only through building-kit tiles."""
import numpy as np, sunny, json
from scipy import ndimage
from cutrect import SMALL, PINES, sheet
LAY = ['decoration_01', 'building', 'walls', 'decoration_02', 'decoration_03']
def kit(t):
    r, c = divmod(int(t), 64)
    return 8 <= r <= 48 and 15 <= c <= 34
def extract(extra_kit=lambda t: False):
    L = sunny.layers(); H = L['land']['h']; W = L['land']['w']
    T = {n: np.array(L[n]['tiles']) for n in LAY}; F = {n: np.array(L[n]['flags']) for n in LAY}
    bad = lambda a: np.isin(a, list(SMALL | PINES | {264}))
    seed = np.zeros((H, W), bool)
    for n in ('building', 'walls'): seed |= (T[n] > 0) & ~bad(T[n])
    lab, k = ndimage.label(seed, structure=np.ones((3, 3)))
    # grow: decoration cells holding kit tiles, adjacent to a component
    growable = np.zeros((H, W), bool)
    for n in LAY:
        v = np.vectorize(lambda t: t > 0 and (kit(t) or t == 1003 or extra_kit(t)))(T[n]); growable |= v
    for _ in range(4):
        d = ndimage.grey_dilation(lab, size=(3, 3))
        add = (lab == 0) & growable & (d > 0); lab[add] = d[add]
    out = []
    for i, sl in enumerate(ndimage.find_objects(lab), 1):
        if sl is None: continue
        y0, y1, x0, x1 = sl[0].start, sl[0].stop, sl[1].start, sl[1].stop
        m = lab[y0:y1, x0:x1] == i
        p = {'w': int(x1 - x0), 'h': int(y1 - y0), 'demo': [int(x0), int(y0)], 'layers': []}
        for n in LAY:
            t = T[n][y0:y1, x0:x1].copy(); f = F[n][y0:y1, x0:x1].copy()
            keep = m & (t > 0) & ~bad(t)
            if n not in ('building', 'walls'):
                keep &= np.vectorize(lambda q: kit(q) or q == 1003 or extra_kit(q))(t)
            t[~keep] = 0; f[~keep] = 0
            if t.any(): p['layers'].append({'layer': n, 'tiles': t.tolist(), 'flags': f.tolist()})
        if m.sum() >= 4: out.append(p)
    return out
if __name__ == '__main__':
    ps = extract(); print(len(ps))
    sheet([(f"b{i}", p) for i, p in enumerate(ps)], 'b2.png', S=2)
    json.dump(ps, open('buildings_raw.json', 'w'))
