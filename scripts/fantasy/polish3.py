"""The landscaper pass over almia3.json.

1. Gray patch tiles 746..749 in 'Ground patches' become the green fills they were meant to be.
2. Decor: groves, road-side flower drifts, beach life, open-field singles; every piece drawn from
   the object sheet rects the artist already used, in the biome where the artist used them.
   Large flora blocks its base tile (with a local articulation check so nothing gets sealed off)
   and gets a shadow decal like its neighbours; small flora is decorative.
Writes a new almia3.json (walkable/reachable updated) and after-previews. Run with --write to save.
"""
import json, sys, math, collections, random
import numpy as np
from render3 import load, decode

import os
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
BN = ['water', 'meadow', 'forest', 'shore', 'snow', 'desert', 'autumn', 'castle']  # BIOME_CODES (fanGround.ts)
GRAY_FIX = {746: 745, 747: 744, 748: 745, 749: 744}
# Object pictures by their sheet rect (sheet, x, y, w, h), so the pass keeps choosing the same art when
# the map changes (they were first picked by rank in the map's own object counts).
BLOCKLIST = set([(0, 440, 366, 30, 62), (0, 1807, 141, 64, 224), (0, 338, 366, 20, 60), (0, 359, 366, 24, 59), (0, 678, 366, 14, 11), (0, 778, 366, 24, 59), (0, 693, 366, 7, 23)])   # lamp post, tower, pillar, banners, sign scrap, stake
REEDS = set([(0, 296, 366, 16, 28), (0, 313, 366, 24, 28)])   # cattails: only at water edges
rng = random.Random(20261027)

m = load()
cols, rows = m['cols'], m['rows']
N = cols * rows
biome = np.array([[int(c) for c in r] for r in m['biome']], np.int8)
walk = np.array([[c == '1' for c in r] for r in m['walkable']], bool)

layers = {}
for item in m['stack']:
    if item['kind'] == 'tiles':
        layers[item['name']] = decode(item['rle'], N).reshape(rows, cols)

road = (layers['Road'] > 0) | (layers.get('Courtyard', np.zeros((rows, cols))) > 0) | (layers.get('Castle walk', np.zeros((rows, cols))) > 0)
tall = layers['Tall grass'] > 0
water = biome == 0

# ---- 1. the gray patches
gp = layers['Ground patches']
fixed = 0
for bad, good in GRAY_FIX.items():
    n = int((gp == bad).sum()); fixed += n
    gp[gp == bad] = good
print('gray patch tiles fixed:', fixed)

sand_layer = layers['Sand'] > 0
# ---- palettes from the artist's own placements
objs = m['objects']
by_rect = collections.defaultdict(list)
for o in objs:
    by_rect[tuple(o[:5])].append(o)
rect_ids = sorted(by_rect, key=lambda r: -len(by_rect[r]))
town_pts = [(t['x'], t['y']) for t in m['towns']]
def in_town(px, py):
    tx, ty = px / 16, py / 16
    return any(math.hypot(tx - a, ty - b) < 14 for a, b in town_pts)

pal = {b: {'large': [], 'huge': [], 'med': [], 'small': [], 'reeds': []} for b in range(8)}
for i, r in enumerate(rect_ids):
    if r in BLOCKLIST: continue
    sh, sx, sy, w, h = r
    uses = by_rect[r]
    n = len(uses)
    if n < 2: continue
    town_frac = sum(1 for o in uses if in_town(o[5] + w / 2, o[6] + h)) / n
    if town_frac > 0.4: continue          # stalls, wells, signs, benches live in towns
    bs = collections.Counter()
    for o in uses:
        tx, ty = int((o[5] + w / 2) // 16), int((o[6] + h - 2) // 16)
        if 0 <= ty < rows and 0 <= tx < cols: bs[int(biome[ty, tx])] += 1
    if not bs: continue
    b, bn = bs.most_common(1)[0]
    if r in REEDS:
        pal[b if b not in (0, 7) else 1]['reeds'].append(((sh, sx, sy, w, h), n))
        continue
    if bn / n < 0.6 or b in (0, 7): continue
    if h >= 48 and w <= 52: cls = 'large'
    elif h >= 48: cls = 'huge'
    elif h >= 28: cls = 'med'
    else: cls = 'small'
    pal[b][cls].append((r, n))
# shore flora may stand on meadow too (coast trees), and meadow's on shore grass
for cls in ('large', 'huge', 'med', 'small'):
    merged = pal[1][cls] + pal[2][cls]                 # meadow and forest share their greens
    pal[1][cls] = pal[2][cls] = merged
REED_PAL = [(r, n) for b in range(8) for r, n in pal[b]['reeds']]
BEACH_SMALL = [(0, 1903, 856, 11, 12), (0, 1974, 856, 15, 12), (0, 2007, 856, 15, 15), (0, 2023, 856, 14, 12), (0, 219, 925, 14, 11), (0, 249, 925, 16, 12), (0, 297, 925, 15, 12), (0, 907, 925, 15, 15), (0, 69, 925, 12, 12)]
BEACH_MED = [(0, 44, 925, 24, 23)]
BEACH_PALM = [(0, 220, 495, 64, 77), (0, 1016, 495, 47, 63), (0, 764, 620, 47, 63)]
pal[3]['small'] = [(r, 2) for r in BEACH_SMALL]
pal[3]['med'] = [(r, 2) for r in BEACH_MED]
pal[3]['large'] = [(r, 2) for r in BEACH_PALM]
pal[3]['huge'] = []
for b in range(8):
    print(BN[b], {k: len(v) for k, v in pal[b].items()})

def pick(b, cls):
    opts = pal[b][cls]
    if not opts: return None
    tot = sum(n for _, n in opts)
    x = rng.random() * tot
    for r, n in opts:
        x -= n
        if x <= 0: return r
    return opts[-1][0]

# ---- the shadow decal most trees pair with
shadow_layer = next(s for s in m['stack'] if s['kind'] == 'decals' and s['name'] == 'Shadows')
sh_count = collections.Counter(tuple(d[:5]) for d in shadow_layer['decals'])
SHADOW = sh_count.most_common(1)[0][0]
# learn the usual offset shadow-vs-tree from existing pairs of the most common large tree
def shadow_offset():
    offs = []
    dec = [d for d in shadow_layer['decals'] if tuple(d[:5]) == SHADOW]
    for r, n in sorted(((r, n) for b in range(8) for r, n in pal[b]['large']), key=lambda t: -t[1])[:6]:
        for o in by_rect[r]:
            bx, by = o[5] + r[3] / 2, o[6] + r[4]
            best = min(dec, key=lambda d: (d[5] + d[3] / 2 - bx) ** 2 + (d[6] + d[4] - by) ** 2, default=None)
            if best is None: continue
            dx, dy = best[5] + best[3] / 2 - bx, best[6] + best[4] - by
            if abs(dx) <= 10 and abs(dy) <= 10: offs.append((dx, dy))
    if not offs: return (0, 2)
    return (float(np.median([o[0] for o in offs])), float(np.median([o[1] for o in offs])))
SH_OFF = shadow_offset()
print('shadow decal', SHADOW, 'offset', SH_OFF)

# ---- placement machinery
keep_out = np.zeros((rows, cols), bool)
def clear(cx, cy, r):
    x0, x1 = max(0, int(cx - r)), min(cols, int(cx + r + 1))
    y0, y1 = max(0, int(cy - r)), min(rows, int(cy + r + 1))
    yy, xx = np.mgrid[y0:y1, x0:x1]
    keep_out[y0:y1, x0:x1] |= (xx - cx) ** 2 + (yy - cy) ** 2 <= r * r
for t in m['towns']: clear(t['x'], t['y'], 13)
for p in m['outposts']: clear(p['x'], p['y'], 5)
for p in m['spawns']: clear(p['x'], p['y'], 4)
for p in m.get('npcs', []): clear(p['x'], p['y'], 3)
for sx_, sy_ in m['stairs']: clear(sx_, sy_, 2)
for key in ('arena', 'finalArena'):
    a = m[key]
    keep_out[max(0, a['y0'] - 3):a['y1'] + 4, max(0, a['x0'] - 3):a['x1'] + 4] = True
lk = m['lake']
yy, xx = np.mgrid[0:rows, 0:cols]
keep_out |= ((xx - lk['x']) / (lk['rx'] + 2.5)) ** 2 + ((yy - lk['y']) / (lk['ry'] + 2.5)) ** 2 <= 1
# the castle stands in its own clearing: nothing planted against its walls or before its gates
from scipy import ndimage as _nd
keep_out |= _nd.binary_dilation(biome == 7, iterations=8)
# and the blighted plain round the crystal grows nothing (build3 plants the dead things there)
_c = m['center']
keep_out |= ((xx - _c['x']) / 32) ** 2 + ((yy - _c['y']) / 25) ** 2 <= 1
keep_out[:2, :] = keep_out[-2:, :] = True
keep_out[:, :2] = keep_out[:, -2:] = True

# existing object anchors, for spacing
anchors = [(o[5] + o[3] / 2, o[6] + o[4], max(o[3], o[4])) for o in objs]
grid_anchor = collections.defaultdict(list)
for ax, ay, sz in anchors:
    grid_anchor[(int(ax // 64), int(ay // 64))].append((ax, ay, sz))
def near_object(px, py, mind):
    gx, gy = int(px // 64), int(py // 64)
    for dx in (-1, 0, 1):
        for dy in (-1, 0, 1):
            for ax, ay, sz in grid_anchor[(gx + dx, gy + dy)]:
                if (ax - px) ** 2 + (ay - py) ** 2 < mind * mind: return True
    return False

def can_block(tx, ty):
    """Blocking (tx,ty) must not disconnect its walkable neighbours (local articulation check)."""
    ring = [(-1, -1), (0, -1), (1, -1), (1, 0), (1, 1), (0, 1), (-1, 1), (-1, 0)]
    cells = []
    for dx, dy in ring:
        x, y = tx + dx, ty + dy
        cells.append(0 <= x < cols and 0 <= y < rows and walk[y, x] and not (x == tx and y == ty))
    # walkable neighbours must form one arc in the ring (4-connectivity through diagonal needs both sides)
    segs = 0
    for k in range(8):
        if cells[k] and not cells[k - 1]: segs += 1
    if segs > 1:
        # allow when the ring is split only by diagonals (still connected around outside); be conservative:
        return False
    return True

added_objs, added_decals, blocked_tiles = [], [], []
def place(r, tx, ty, block):
    sh, sx, sy, w, h = r
    px = int(tx * 16 + 8 - w / 2)
    py = int(ty * 16 + 13 - h)
    if near_object(px + w / 2, py + h, max(10, w * 0.45)): return False
    if block:
        if not can_block(tx, ty) or road[ty, tx] or tall[ty, tx]: return False
        walk[ty, tx] = False
        blocked_tiles.append((tx, ty))
    added_objs.append([sh, sx, sy, w, h, px, py, round((py + h) / 16, 3)])
    # a round canopy shadow under leafy trees only: a bare desert tree or a thin palm has no
    # canopy to cast one, so it gets none (the blob looked wrong under them)
    if h >= 28 and int(biome[min(rows - 1, int((py + h - 2) // 16)), min(cols - 1, int((px + w / 2) // 16))]) not in (3, 5):
        dsh, dsx, dsy, dw, dh = SHADOW
        dpx = int(px + w / 2 + SH_OFF[0] - dw / 2)
        dpy = int(py + h + SH_OFF[1] - dh)
        added_decals.append([dsh, dsx, dsy, dw, dh, dpx, dpy])
    grid_anchor[(int((px + w / 2) // 64), int((py + h) // 64))].append((px + w / 2, py + h, max(w, h)))
    return True

def open_cell(tx, ty, need_walk=True):
    if not (0 <= tx < cols and 0 <= ty < rows): return False
    if keep_out[ty, tx] or road[ty, tx]: return False
    if need_walk and not walk[ty, tx]: return False
    return True

# noise for clustering
def fbm(x, y, s=0.09, seed=7):
    v = 0.0; a = 1.0; f = s
    for o in range(3):
        v += a * math.sin((x * 1.7 + y * 0.9 + seed * 13.7) * f + o * 2.1) * math.cos((y * 1.3 - x * 0.6 + seed * 7.3) * f + o * 1.3)
        a *= 0.5; f *= 2.1
    return v

# density of existing decor per cell (to find barren places)
dens = np.zeros((rows, cols))
for ax, ay, sz in anchors:
    tx, ty = int(ax // 16), int(ay // 16)
    if 0 <= ty < rows and 0 <= tx < cols: dens[ty, tx] += 1
from scipy import ndimage
dens = ndimage.gaussian_filter(dens, 6)

# ---- groves
grove_counts = {1: 15, 2: 6, 6: 9, 4: 7, 5: 6, 3: 4}
stats = collections.Counter()
for b, want in grove_counts.items():
    cand = [(dens[ty, tx] + rng.random() * 0.02, tx, ty)
            for ty in range(4, rows - 4, 3) for tx in range(4, cols - 4, 3)
            if biome[ty, tx] == b and open_cell(tx, ty) and dens[ty, tx] < 0.05]
    cand.sort()
    centers = []
    for _, tx, ty in cand:
        if len(centers) >= want: break
        if all(math.hypot(tx - a, ty - c) > 24 for a, c in centers):
            centers.append((tx, ty))
    for cx, cy in centers:
        nlarge = rng.randint(3, 7)
        placed = 0
        for _ in range(40):
            if placed >= nlarge: break
            tx = cx + rng.randint(-5, 5); ty = cy + rng.randint(-4, 4)
            if not open_cell(tx, ty) or biome[ty, tx] != b: continue
            r = pick(b, 'large')
            if r and place(r, tx, ty, block=True): placed += 1; stats[(BN[b], 'large')] += 1
        if rng.random() < 0.6:
            for _ in range(20):
                tx = cx + rng.randint(-6, 6); ty = cy + rng.randint(-5, 5)
                if open_cell(tx, ty) and biome[ty, tx] == b:
                    r = pick(b, 'huge')
                    if r and place(r, tx, ty, block=True): stats[(BN[b], 'huge')] += 1; break
        for _ in range(rng.randint(4, 8)):
            tx = cx + rng.randint(-7, 7); ty = cy + rng.randint(-6, 6)
            if open_cell(tx, ty) and biome[ty, tx] == b:
                cls = 'med' if rng.random() < 0.45 else 'small'
                r = pick(b, cls)
                if r and place(r, tx, ty, block=False): stats[(BN[b], cls)] += 1

# ---- flower drifts along roads
road_adj = ndimage.binary_dilation(layers['Road'] > 0, iterations=1) & ~road
ys, xs = np.nonzero(road_adj)
for ty, tx in zip(ys.tolist(), xs.tolist()):
    b = int(biome[ty, tx])
    if b in (0, 7) or not open_cell(tx, ty): continue
    if fbm(tx, ty, 0.13, 3) > 0.55 and rng.random() < 0.5:
        r = pick(b, 'small')
        if r and place(r, tx, ty, block=False): stats[(BN[b], 'drift')] += 1

# ---- beach life on sand near water
beach = (biome == 3) & walk & ~road
ys, xs = np.nonzero(beach)
for ty, tx in zip(ys.tolist(), xs.tolist()):
    if not open_cell(tx, ty) or rng.random() > 0.02: continue
    roll = rng.random()
    cls = 'small' if roll < 0.82 else 'med' if roll < 0.92 else 'large'
    r = pick(3, cls)
    if r and place(r, tx, ty, block=cls == 'large'): stats[('shore', 'beach-' + cls)] += 1

# ---- reeds at the water's edge (lake and river banks)
wet = ~(layers['Water'] == 0)
bank = ndimage.binary_dilation(wet, iterations=1) & walk & ~road
ys, xs = np.nonzero(bank)
for ty, tx in zip(ys.tolist(), xs.tolist()):
    if not open_cell(tx, ty) or not REED_PAL: continue
    if fbm(tx, ty, 0.21, 5) > 0.35 and rng.random() < 0.3:
        tot = sum(n for _, n in REED_PAL)
        x = rng.random() * tot
        for r, n in REED_PAL:
            x -= n
            if x <= 0: break
        if place(r, tx, ty, block=False): stats[('bank', 'reeds')] += 1

# ---- open-field singles where it is barren
for ty in range(3, rows - 3):
    for tx in range(3, cols - 3):
        b = int(biome[ty, tx])
        if b in (0, 7) or not open_cell(tx, ty) or dens[ty, tx] > 0.035: continue
        n = fbm(tx, ty, 0.07, 11)
        if n < 0.62: continue
        roll = rng.random()
        if roll < 0.012:
            r = pick(b, 'large')
            if r and place(r, tx, ty, block=True): stats[(BN[b], 'single')] += 1
        elif roll < 0.05:
            r = pick(b, 'med' if rng.random() < 0.4 else 'small')
            if r and place(r, tx, ty, block=False): stats[(BN[b], 'single')] += 1

print('added objects:', len(added_objs), 'blocked tiles:', len(blocked_tiles))
print(dict(stats))

# ---- reachability check
start = (int(m['center']['x']), int(m['center']['y']))
seen = np.zeros((rows, cols), bool)
from collections import deque
q = deque()
sx0, sy0 = start
if not walk[sy0, sx0]:
    ys, xs = np.nonzero(walk)
    k = np.argmin((xs - sx0) ** 2 + (ys - sy0) ** 2)
    sx0, sy0 = int(xs[k]), int(ys[k])
q.append((sx0, sy0)); seen[sy0, sx0] = True
while q:
    x, y = q.popleft()
    for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        nx, ny = x + dx, y + dy
        if 0 <= nx < cols and 0 <= ny < rows and walk[ny, nx] and not seen[ny, nx]:
            seen[ny, nx] = True; q.append((nx, ny))
old_reach = np.array([[c == '1' for c in r] for r in m['reachable']], bool)
lost = old_reach & ~seen
lost_beyond = int(lost.sum()) - len([t for t in blocked_tiles if old_reach[t[1], t[0]]])
print('reachable now', int(seen.sum()), 'was', int(old_reach.sum()), 'lost beyond blocked tiles:', lost_beyond)
assert lost_beyond <= 0 or lost_beyond < 3, 'blocking disconnected an area'

# every outpost/spawn/town/npc still reachable?
for p in [*m['outposts'], *m['spawns'], *[{'x': t['x'], 'y': t['y']} for t in m['towns']]]:
    tx, ty = int(p['x']), int(p['y'])
    box = seen[max(0, ty - 2):ty + 3, max(0, tx - 2):tx + 3]
    assert box.any(), f'POI unreachable at {tx},{ty}'
print('all POIs reachable')

# ---- write back
if '--write' in sys.argv:
    import copy
    out = m
    # re-encode the patched layer
    def rle(arr):
        flat = arr.ravel().tolist(); res = []; i = 0; n = len(flat)
        while i < n:
            v = flat[i]; j = i
            while j < n and flat[j] == v: j += 1
            res.append(v); res.append(j - i); i = j
        return res
    for item in out['stack']:
        if item['kind'] == 'tiles' and item['name'] == 'Ground patches':
            item['rle'] = rle(gp.astype(int))
        if item['kind'] == 'decals' and item['name'] == 'Shadows':
            item['decals'] = item['decals'] + added_decals
    out['objects'] = objs + added_objs
    out['walkable'] = [''.join('1' if walk[y, x] else '0' for x in range(cols)) for y in range(rows)]
    out['reachable'] = [''.join('1' if seen[y, x] else '0' for x in range(cols)) for y in range(rows)]
    with open(f'{ROOT}/assets/maps/almia3.json', 'w') as f:
        json.dump(out, f, separators=(',', ':'))
    print('WROTE', f'{ROOT}/assets/maps/almia3.json')
