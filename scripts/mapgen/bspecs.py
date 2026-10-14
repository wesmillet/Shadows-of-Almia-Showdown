import numpy as np, sunny, json
from scipy import ndimage
from prefab2 import LAY, kit
from cutrect import SMALL, PINES
DROP = {648, 264}
LEGS = {101, 165, 229, 293}
SPECS = {
 'blue_dormer': (54,0,59,4), 'blue_tower_duo': (43,1,47,6), 'blue_flat': (51,6,56,10),
 'green_small': (53,11,57,16), 'red_tower': (40,14,43,20), 'green_hut': (22,17,25,20),
 'red_house': (32,19,37,24), 'blue_manor': (39,24,46,31), 'green_house': (21,25,25,29),
 'purple_manor': (13,26,19,32), 'red_small': (30,26,34,31), 'green_stall_hut': (71,26,74,29),
 'orange_gable': (55,31,61,35), 'red_long': (17,33,23,38), 'red_gable': (24,33,28,39),
 'green_gable_tall': (40,32,45,38), 'stilt_red_a': (76,39,80,48), 'stilt_red_b': (71,41,75,48),
 'lighthouse': (72,0,76,13), 'green_house_b': (50,25,54,30), 'orange_house': (54,24,60,30),
 'orange_tall': (62,19,66,25),
 'stilt_cluster': (1,21,7,32),
}
def mask_all():
    L = sunny.layers(); H = L['land']['h']; W = L['land']['w']
    T = {n: np.array(L[n]['tiles']) for n in LAY}; F = {n: np.array(L[n]['flags']) for n in LAY}
    ok = np.vectorize(lambda t: t > 0 and t not in DROP and t not in SMALL and t not in PINES)
    okd = np.vectorize(lambda t: t > 0 and t not in DROP and (kit(t) or t == 1003 or t in LEGS))
    keep = {n: (ok(T[n]) if n in ('building', 'walls') else okd(T[n])) for n in LAY}
    return T, F, keep
_C = None
DROPCELLS = {}; EXTRA = {}
def cut(rect):
    global _C
    if _C is None: _C = mask_all()
    T, F, keep = _C; x0, y0, x1, y1 = rect[:4]; extra = EXTRA.get(rect, set())
    p = {'w': x1 - x0, 'h': y1 - y0, 'demo': [x0, y0], 'layers': []}
    for n in LAY:
        t = T[n][y0:y1, x0:x1].copy(); f = F[n][y0:y1, x0:x1].copy(); k = keep[n][y0:y1, x0:x1]
        if extra: k = k | np.isin(t, list(extra))
        for (cx, cy) in DROPCELLS.get(rect, ()): k[cy - y0, cx - x0] = False
        t[~k] = 0; f[~k] = 0
        if t.any(): p['layers'].append({'layer': n, 'tiles': t.tolist(), 'flags': f.tolist()})
    return trim(p)
def trim(p):
    occ = np.zeros((p['h'], p['w']), bool)
    for l in p['layers']: occ |= np.array(l['tiles']) > 0
    ys, xs = np.nonzero(occ); a, b, c, d = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
    for l in p['layers']:
        l['tiles'] = [r[c:d] for r in l['tiles'][a:b]]; l['flags'] = [r[c:d] for r in l['flags'][a:b]]
    p['demo'] = [p['demo'][0] + int(c), p['demo'][1] + int(a)]; p['w'] = int(d - c); p['h'] = int(b - a)
    return p
DROPCELLS[SPECS['blue_manor']] = [(39,30),(40,30)]
DROPCELLS[SPECS['green_gable_tall']] = [(40,32)]
DROPCELLS[SPECS['stilt_cluster']] = [(1,31),(2,31)]
EXTRA[SPECS['stilt_cluster']] = {101,165,229,293,357,744,745,746,808,809,810,872,873,936,650}
if __name__ == '__main__':
    from cutrect import sheet
    import sys
    names = sys.argv[1:] or list(SPECS)
    sheet([(k, cut(SPECS[k])) for k in names], 'b3.png', S=2)
