#!/usr/bin/env python3
"""
Authors a match map for Shadows of Almia Showdown from the Sunnyside World
tileset and writes it to data/maps/<name>.json plus a preview PNG.

The builder only produces shapes the tileset can draw: every land, water,
river, path, beach and forest region is "2x2 clean" (no 1-wide spurs,
corridors or notches), every plateau bottom edge has three clear rows of water
under it for the two cliff-face rows and the foam base, and all point of
interest are connected on foot. Tiles are then resolved with the GameMaker
16-tile autotile template that assets/tiles/sunnyside/sunnyside.json records:

  slot 0 fill, 1/2/4/8 inner corners (BR/BL/TR/TL diagonal missing),
  3 top edge, 5 left edge, 10 right edge, 12 bottom edge,
  7 top-left, 11 top-right, 13 bottom-left, 14 bottom-right corner.

Usage: python3 scripts/build_map.py [--seed N] [--cols 160] [--rows 112] [--name almia]
"""
import argparse, json, math, os, random, sys
import numpy as np
from scipy import ndimage

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TS_JSON = os.path.join(ROOT, 'assets/tiles/sunnyside/sunnyside.json')

# --- tile vocabulary (16 px sheet, 64 columns) ---------------------------------
GRASS_FILL = 193
GRASS_VARIANTS = [129, 130, 133, 134]        # subtle grass detail, used sparingly
CLIFF_FACE = [203, 267]                      # two face variants
CLIFF_LEFT, CLIFF_RIGHT = 266, 268
CLIFF_BASE_L, CLIFF_BASE_M, CLIFF_BASE_R = 147, 148, 149
WATER_SHADOW_M, WATER_SHADOW_L, WATER_SHADOW_R = 76, 77, 78
SEA_PATTERN = {  # (x%4, y%4) -> tile, read from the pack's demo room
    (0, 0): 1294, (0, 1): 1358, (0, 2): 1166, (0, 3): 1230,
    (1, 0): 1291, (1, 1): 1355, (1, 2): 1163, (1, 3): 1227,
    (2, 0): 1292, (2, 1): 1356, (2, 2): 1164, (2, 3): 1228,
    (3, 0): 1293, (3, 1): 1357, (3, 2): 1165, (3, 3): 1229,
}
RIVER_FILL_FRAMES = [542, 543, 544, 545]
# Whole single-tile decor (checked against the sheet: nothing here is a crop of a bigger sprite).
BUSHES = [91, 92, 93, 94, 155, 156, 157, 158, 219, 220, 221, 222, 283, 284, 285, 286, 307]
FLOWERS = [95, 96, 97, 98, 99, 159, 160, 161, 162, 163, 223, 224, 225, 226, 227]
ROCKS = [287, 288, 289, 290, 1975]
STUMPS = [351, 352]
# Multi-tile stamps: (top-left index, w, h). Pines are whole 1x3 / 1x2 columns; the
# round trees in the sheet only exist as an overlapping cluster, so round trees come
# from the animated plant strips instead.
TREE_STAMPS = [(436, 1, 3), (308, 1, 2)]
BERRY_BUSHES = [(241, 2, 2), (369, 2, 2)]
BOULDERS = [(1905, 2, 2), (1907, 2, 2), (1909, 2, 2)]
PLANT_STRIPS = ['spr_deco_tree_01_strip4.png', 'spr_deco_tree_02_strip4.png']
MUSHROOMS = ['spr_deco_mushroom_blue_01_strip4.png', 'spr_deco_mushroom_blue_02_strip4.png', 'spr_deco_mushroom_red_01_strip4.png']

# mask bits: L=1 T=2 R=4 B=8 ; diag bits: TL=1 TR=2 BL=4 BR=8
EDGE_SLOT = {15: 0, 13: 3, 14: 5, 11: 10, 7: 12, 12: 7, 9: 11, 6: 13, 3: 14}
INNER_SLOT = {8: 1, 4: 2, 2: 4, 1: 8}   # missing diagonal bit -> slot


def autotile(tiles, mask, diag):
    """Tile for a cell given its 4-neighbour mask and 4-diagonal mask."""
    if mask == 15:
        missing = (~diag) & 15
        if missing and (missing & (missing - 1)) == 0:   # exactly one diagonal missing
            t = tiles[INNER_SLOT[missing]]
            if t:
                return t
        return tiles[0]
    slot = EDGE_SLOT.get(mask)
    if slot is None:
        return tiles[0]
    return tiles[slot] or tiles[0]


def masks(grid, x, y):
    h, w = grid.shape
    def g(a, b):
        return 0 <= a < w and 0 <= b < h and grid[b, a]
    m = (g(x-1, y) << 0) | (g(x, y-1) << 1) | (g(x+1, y) << 2) | (g(x, y+1) << 3)
    d = (g(x-1, y-1) << 0) | (g(x+1, y-1) << 1) | (g(x-1, y+1) << 2) | (g(x+1, y+1) << 3)
    return m, d


# --- noise ---------------------------------------------------------------------
class Noise:
    def __init__(self, seed):
        rng = np.random.default_rng(seed)
        self.perm = rng.permutation(256)
        self.perm = np.concatenate([self.perm, self.perm])
        angles = rng.uniform(0, 2*math.pi, 256)
        self.grad = np.stack([np.cos(angles), np.sin(angles)], 1)

    def perlin(self, x, y):
        xi = np.floor(x).astype(int) & 255; yi = np.floor(y).astype(int) & 255
        xf = x - np.floor(x); yf = y - np.floor(y)
        def fade(t): return t*t*t*(t*(t*6-15)+10)
        u = fade(xf); v = fade(yf)
        def g(ix, iy, dx, dy):
            h = self.perm[self.perm[ix] + iy] & 255
            return self.grad[h, 0]*dx + self.grad[h, 1]*dy
        n00 = g(xi, yi, xf, yf); n10 = g(xi+1, yi, xf-1, yf)
        n01 = g(xi, yi+1, xf, yf-1); n11 = g(xi+1, yi+1, xf-1, yf-1)
        return (n00*(1-u)+n10*u)*(1-v) + (n01*(1-u)+n11*u)*v

    def fbm(self, x, y, octaves=4, lac=2.0, gain=0.5):
        out = np.zeros_like(x, dtype=float); amp = 1.0; freq = 1.0; norm = 0
        for _ in range(octaves):
            out += amp * self.perlin(x*freq, y*freq); norm += amp; amp *= gain; freq *= lac
        return out / norm


# --- shape hygiene ---------------------------------------------------------------
K22 = np.ones((2, 2), bool)


def open22(mask):
    """Keeps only cells covered by a fully set 2x2 window."""
    return ndimage.binary_opening(mask, structure=K22)


def clean(mask, iters=12):
    """Both the mask and its complement become 2x2 clean."""
    m = mask.copy()
    for _ in range(iters):
        before = m.copy()
        m = open22(m)
        m = ~open22(~m)
        if np.array_equal(m, before):
            break
    return m


def cliff_clearance(land, rows_needed=4, iters=60):
    """Every bottom land edge needs `rows_needed` rows of water below it, and no
    land in the columns beside that drop. Water runs shorter than that between
    land are filled; land beside a drop is removed."""
    land = land.copy(); h, w = land.shape
    for _ in range(iters):
        changed = False
        # fill short vertical water runs
        for x in range(w):
            col = land[:, x]; y = 0
            while y < h:
                if col[y]:
                    y += 1; continue
                y0 = y
                while y < h and not col[y]:
                    y += 1
                if y0 > 0 and y < h and (y - y0) < rows_needed:
                    land[y0:y, x] = True; changed = True
        # land beside a drop (diagonally below a bottom edge) breaks the cliff art
        bottom = land & ~np.roll(land, -1, axis=0); bottom[-1, :] = False
        ys, xs = np.where(bottom)
        for y, x in zip(ys, xs):
            for dx in (-1, 1):
                nx = x + dx
                if 0 <= nx < w:
                    for dy in range(1, rows_needed):
                        if y + dy < h and land[y+dy, nx] and not land[y+dy-1, nx]:
                            # a land cell starts in the drop zone: remove that run
                            land[y+dy:y+dy+rows_needed, nx] = False; changed = True
        land = clean(land)
        land[0, :] = land[-1, :] = land[:, 0] = land[:, -1] = False
        land[1, :] = land[-5:, :] = land[:, 1] = land[:, -2] = False
        if not changed:
            break
    return land


def largest_component(mask, min_hole=0):
    lab, n = ndimage.label(mask)
    if n == 0:
        return mask
    sizes = ndimage.sum(mask, lab, range(1, n+1))
    keep = lab == (1 + int(np.argmax(sizes)))
    if min_hole:
        holes = ~keep
        hl, hn = ndimage.label(holes)
        hs = ndimage.sum(holes, hl, range(1, hn+1))
        for i, s in enumerate(hs, 1):
            region = hl == i
            if s < min_hole and not (region[0, :].any() or region[-1, :].any() or region[:, 0].any() or region[:, -1].any()):
                keep |= region
    return keep


# --- builder -----------------------------------------------------------------------
class MapBuilder:
    def __init__(self, cols, rows, seed):
        self.cols, self.rows, self.seed = cols, rows, seed
        self.rng = random.Random(seed)
        self.noise = Noise(seed)
        self.ts = json.load(open(TS_JSON))
        self.auto = self.ts['tilesets']['tileset_sunnysideworld']['autotiles']
        self.forest_auto = self.ts['tilesets']['tileset_forest']['autotiles']['forest_01']['tiles']

    # -- terrain masks --
    def build_land(self):
        h, w = self.rows, self.cols
        yy, xx = np.mgrid[0:h, 0:w].astype(float)
        nx, ny = xx / w, yy / h
        e = self.noise.fbm(xx / 26 + 7.3, yy / 26 + 2.1, 5, 2.0, 0.5)
        e += 0.5 * self.noise.fbm(xx / 9 + 40, yy / 9 + 11, 3)
        # radial falloff -> one continent with a ragged coast
        dx = (nx - 0.5) * 2; dy = (ny - 0.5) * 2
        r = np.sqrt(dx*dx*1.05 + dy*dy*1.45)
        e = e * 0.55 + (0.80 - r) * 0.9
        land = e > 0.10
        land = clean(land)
        land = largest_component(land, min_hole=14)
        land = cliff_clearance(land)
        land = largest_component(land, min_hole=14)
        # make sure the centre is land (the Shadow Crystal stands there)
        cy, cx = h // 2, w // 2
        if not land[cy-3:cy+4, cx-3:cx+4].all():
            land[cy-6:cy+7, cx-8:cx+9] = True
            land = cliff_clearance(clean(land))
            land = largest_component(land, min_hole=14)
        self.land = land
        self.bottom = land & ~np.roll(land, -1, axis=0); self.bottom[-1, :] = False
        # cliff zone: the 3 rows under each bottom edge (water, drawn with cliff tiles)
        cz = np.zeros_like(land)
        for dy in (1, 2, 3):
            cz |= np.roll(self.bottom, dy, axis=0)
        self.cliff = cz & ~land
        # a 4th row carries the water shadow
        self.shadow = np.roll(self.bottom, 4, axis=0) & ~land & ~self.cliff

    def dist_to_water(self):
        return ndimage.distance_transform_cdt(self.land, metric='taxicab')

    def build_rivers(self):
        h, w = self.rows, self.cols
        land = self.land; river = np.zeros_like(land)
        dist = self.dist_to_water()
        elev = self.noise.fbm(np.mgrid[0:h, 0:w][1] / 18 + 3, np.mgrid[0:h, 0:w][0] / 18 + 9, 3)
        tries = 0; made = 0
        while made < 5 and tries < 120:
            tries += 1
            # source: well inland
            ys, xs = np.where(dist >= 11)
            if len(ys) == 0:
                break
            k = self.rng.randrange(len(ys)); y, x = int(ys[k]), int(xs[k])
            path = [(x, y)]
            cur = (x, y); seen = {cur}; last = (0, 1)
            for _ in range(160):
                cx, cy = cur
                best = None; bv = 1e9
                for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    nx, ny = cx + dx, cy + dy
                    if not (0 <= nx < w and 0 <= ny < h) or (nx, ny) in seen:
                        continue
                    v = dist[ny, nx] * 0.9 + elev[ny, nx] * 5 + self.rng.random() * 2.2 - (0.5 if (dx, dy) == last else 0) + (3 if (dx, dy) == (-last[0], -last[1]) else 0)
                    if not land[ny, nx]:
                        v = -100
                    if v < bv:
                        bv = v; best = (nx, ny)
                if best is None:
                    break
                last = (best[0]-cx, best[1]-cy); cur = best; seen.add(cur); path.append(cur)
                if not land[cur[1], cur[0]]:
                    break
            if len(path) < 16 or land[path[-1][1], path[-1][0]]:
                continue
            cand = np.zeros_like(land)
            for (px, py) in path:
                cand[max(0, py-1):py+2, max(0, px-1):px+2] = True
            cand &= land
            cand = clean(cand) & land
            # keep away from cliff drops and existing rivers
            drop = self.bottom | np.roll(self.bottom, -1, axis=0) | np.roll(self.bottom, -2, axis=0)
            cand &= ~drop
            cand = clean(cand)
            if cand.sum() < 40:
                continue
            # connectivity: the river must not split the land
            walk = land & ~river & ~cand
            lab, n = ndimage.label(walk)
            if n == 0:
                continue
            sizes = ndimage.sum(walk, lab, range(1, n+1))
            if sizes.max() < (land & ~river).sum() * 0.97:
                continue
            river |= cand; made += 1
        self.river = river

    def build_pois(self):
        h, w = self.rows, self.cols
        land = self.land & ~self.river
        dist = ndimage.distance_transform_cdt(land, metric='taxicab')
        cx, cy = w // 2, h // 2
        self.center = (cx, cy)
        def open_at(x, y, r):
            return 0 < x-r and x+r < w and 0 < y-r and y+r < h and land[y-r:y+r+1, x-r:x+r+1].all()
        # outposts: four, one per quadrant, well inland
        outposts = []
        for qx, qy in ((-1, -1), (1, -1), (-1, 1), (1, 1)):
            best = None; bd = -1
            for y in range(4, h-4):
                for x in range(4, w-4):
                    if (x - cx) * qx <= 0 or (y - cy) * qy <= 0 or dist[y, x] < 4 or not open_at(x, y, 2):
                        continue
                    d = math.hypot(x - cx, y - cy)
                    target = min(w, h) * 0.34
                    score = -abs(d - target) + dist[y, x] * 0.3
                    if any(math.hypot(x - o[0], y - o[1]) < min(w, h) * 0.3 for o in outposts):
                        continue
                    if score > bd:
                        bd = score; best = (x, y)
            if best is None:
                best = max(((x, y) for y in range(4, h-4) for x in range(4, w-4) if open_at(x, y, 2) and dist[y, x] >= 4),
                           key=lambda p: min([math.hypot(p[0]-o[0], p[1]-o[1]) for o in outposts] + [math.hypot(p[0]-cx, p[1]-cy)]))
            outposts.append(best)
        # spawns: six coast-side open spots far apart
        cands = [(x, y) for y in range(3, h-3) for x in range(3, w-3) if open_at(x, y, 1) and 2 <= dist[y, x] <= 6]
        self.rng.shuffle(cands)
        cands.sort(key=lambda p: -math.hypot(p[0]-cx, p[1]-cy))
        spawns = []
        for p in cands:
            if len(spawns) >= 6:
                break
            if all(math.hypot(p[0]-s[0], p[1]-s[1]) > min(w, h) * 0.3 for s in spawns) and all(math.hypot(p[0]-o[0], p[1]-o[1]) > 8 for o in outposts):
                spawns.append(p)
        self.outposts, self.spawns = outposts, spawns

    def build_paths(self):
        h, w = self.rows, self.cols
        land = self.land
        wob = self.noise.fbm(np.mgrid[0:h, 0:w][1] / 5 + 99, np.mgrid[0:h, 0:w][0] / 5 + 17, 3)
        cost = np.where(land, 1.0 + np.clip(wob + 0.5, 0, 1.5) * 4.0, 1e6)
        cost[self.river] = 40.0
        cost[self.beach] = 3.0
        edge = ~ndimage.binary_erosion(land, iterations=2)
        cost[edge & land] += 6
        path = np.zeros_like(land)
        def route(a, b):
            # Dijkstra on the grid
            import heapq
            dist = np.full((h, w), np.inf); dist[a[1], a[0]] = 0
            prev = {}
            pq = [(0.0, a)]
            while pq:
                d, (x, y) = heapq.heappop(pq)
                if (x, y) == b:
                    break
                if d > dist[y, x]:
                    continue
                for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    nx, ny = x+dx, y+dy
                    if not (0 <= nx < w and 0 <= ny < h):
                        continue
                    c = cost[ny, nx] * (0.35 if path[ny, nx] else 1.0)
                    nd = d + c
                    if nd < dist[ny, nx]:
                        dist[ny, nx] = nd; prev[(nx, ny)] = (x, y); heapq.heappush(pq, (nd, (nx, ny)))
            out = []; cur = b
            while cur != a:
                out.append(cur); cur = prev.get(cur)
                if cur is None:
                    return []
            out.append(a); return out
        nodes = [self.center] + self.outposts
        links = [(self.center, o) for o in self.outposts]
        # ring between neighbouring outposts and spurs to spawns
        for i in range(len(self.outposts)):
            links.append((self.outposts[i], self.outposts[(i + 1) % len(self.outposts)]))
        for s in self.spawns:
            nearest = min(nodes, key=lambda n: math.hypot(n[0]-s[0], n[1]-s[1]))
            links.append((s, nearest))
        for a, b in links:
            for (x, y) in route(a, b):
                path[max(0, y-1):y+2, max(0, x-1):x+2] = True
        for (x, y) in nodes:
            path[max(0, y-2):y+4, max(0, x-2):x+4] = True
        path &= land
        path = clean(path) & land
        # don't let the trail run through the cliff-top edge row (it would be cut by the drop)
        path &= ~self.bottom
        path = clean(path) & land
        self.path = path
        # bridges: river cells the trail crosses become fords (walkable, drawn as path over river)
        self.ford = path & self.river

    def build_beaches(self):
        h, w = self.rows, self.cols
        land = self.land
        coast = land & ~ndimage.binary_erosion(land, iterations=4)
        coast &= ~self.bottom
        for dy in (1, 2):
            coast &= ~np.roll(self.bottom, -dy, axis=0)
        n = self.noise.fbm(np.mgrid[0:h, 0:w][1] / 7 + 21, np.mgrid[0:h, 0:w][0] / 7 + 5, 2)
        beach = coast & (n > -0.05) & ~self.river
        beach = clean(beach) & land & ~self.river
        beach = clean(beach)
        self.beach = beach

    def build_forest(self):
        h, w = self.rows, self.cols
        land = self.land
        inner = ndimage.binary_erosion(land, iterations=3)
        n = self.noise.fbm(np.mgrid[0:h, 0:w][1] / 14 + 77, np.mgrid[0:h, 0:w][0] / 14 + 31, 3)
        f = inner & (n > 0.02) & ~self.path & ~self.river & ~self.beach
        f = ~ndimage.binary_dilation(self.path | self.river, iterations=2) & f
        # keep POIs clear
        for (x, y) in [self.center] + self.outposts + self.spawns:
            f[max(0, y-5):y+6, max(0, x-5):x+6] = False
        # forest lives on the 2x2 block grid
        bh, bw = h // 2, w // 2
        blocks = f[:bh*2, :bw*2].reshape(bh, 2, bw, 2).all(axis=(1, 3))
        blocks = clean(blocks)
        lab, n = ndimage.label(blocks)
        if n:
            sizes = ndimage.sum(blocks, lab, range(1, n+1))
            for i, s in enumerate(sizes, 1):
                if s < 4:
                    blocks[lab == i] = False
        self.forest_blocks = blocks
        f2 = np.zeros_like(land)
        f2[:bh*2, :bw*2] = np.kron(blocks, np.ones((2, 2), bool))
        self.forest = f2

    def build_decor(self):
        h, w = self.rows, self.cols
        land = self.land; rng = self.rng
        busy = self.path | self.river | self.beach | self.forest | ~land
        busy |= self.bottom | np.roll(self.bottom, -1, axis=0)
        for (x, y) in [self.center] + self.outposts + self.spawns:
            busy[max(0, y-3):y+4, max(0, x-3):x+4] = True
        self.block = np.zeros_like(land)
        decor = []
        forest_edge = ndimage.binary_dilation(self.forest, iterations=2) & ~self.forest
        grass_variant = np.zeros((h, w), np.int32)
        for y in range(1, h-2):
            for x in range(1, w-2):
                if busy[y, x]:
                    continue
                r = rng.random()
                p_tree = 0.16 if forest_edge[y, x] else 0.035
                if r < p_tree:
                    if rng.random() < 0.35:
                        tl, tw, th = rng.choice(TREE_STAMPS)
                        decor.append({'kind': 'tree', 'x': x + 0.5, 'y': y + 0.95, 'stamp': [tl, tw, th]})
                        self.block[y, x] = True
                    else:
                        decor.append({'kind': 'tree', 'x': x + 0.5, 'y': y + 0.95, 'strip': rng.choice(PLANT_STRIPS)})
                        self.block[y, x] = True
                    busy[max(0, y-1):y+2, max(0, x-1):x+3] = True
                elif r < p_tree + 0.05:
                    decor.append({'kind': 'bush', 'x': x + 0.5, 'y': y + 0.9, 'tile': rng.choice(BUSHES)})
                elif r < p_tree + 0.06 and not busy[y, x+1]:
                    tl, tw, th = rng.choice(BERRY_BUSHES)
                    decor.append({'kind': 'bush', 'x': x + 1.0, 'y': y + 0.95, 'stamp': [tl, tw, th]})
                    self.block[y, x:x+2] = True; busy[y, x:x+2] = True
                elif r < p_tree + 0.12:
                    decor.append({'kind': 'flower', 'x': x + 0.5, 'y': y + 0.9, 'tile': rng.choice(FLOWERS)})
                elif r < p_tree + 0.135:
                    decor.append({'kind': 'rock', 'x': x + 0.5, 'y': y + 0.9, 'tile': rng.choice(ROCKS)})
                    self.block[y, x] = True
                elif r < p_tree + 0.142 and not busy[y, x+1] and not busy[y+1, x] and not busy[y+1, x+1]:
                    tl, tw, th = rng.choice(BOULDERS)
                    decor.append({'kind': 'rock', 'x': x + 1.0, 'y': y + 1.95, 'stamp': [tl, tw, th]})
                    self.block[y:y+2, x:x+2] = True; busy[y:y+2, x:x+2] = True
                elif r < p_tree + 0.15:
                    decor.append({'kind': 'rock', 'x': x + 0.5, 'y': y + 0.9, 'tile': rng.choice(STUMPS)})
                    self.block[y, x] = True
                elif r < p_tree + 0.17 and forest_edge[y, x]:
                    decor.append({'kind': 'mushroom', 'x': x + 0.5, 'y': y + 0.9, 'strip': rng.choice(MUSHROOMS)})
                elif r < p_tree + 0.30:
                    grass_variant[y, x] = rng.choice(GRASS_VARIANTS)
        self.decor = decor
        self.grass_variant = grass_variant

    # -- tile resolution --
    def resolve(self):
        h, w = self.rows, self.cols
        rng = self.rng
        land, river, path, beach = self.land, self.river, self.path, self.beach
        L = self.auto['Land']['tiles']; R = self.auto['River']['tiles']
        P1 = self.auto['Path 01']['tiles']; P2 = self.auto['Path 02']['tiles']
        sea = np.zeros((h, w), np.int32); ground = np.zeros((h, w), np.int32)
        shadow = np.zeros((h, w), np.int32); riverL = np.zeros((h, w), np.int32)
        beachL = np.zeros((h, w), np.int32); pathL = np.zeros((h, w), np.int32)
        # sea: static 4x4 pattern everywhere (land covers it)
        for y in range(h):
            for x in range(w):
                sea[y, x] = SEA_PATTERN[(x % 4, y % 4)]
        # cliff rows
        face1 = np.roll(self.bottom, 1, axis=0) & ~land
        face2 = np.roll(self.bottom, 2, axis=0) & ~land
        base = np.roll(self.bottom, 3, axis=0) & ~land
        faces = face1 | face2
        for y in range(h):
            for x in range(w):
                if land[y, x]:
                    m, d = masks(land, x, y)
                    t = autotile(L, m, d)
                    if t == GRASS_FILL and self.grass_variant[y, x]:
                        t = self.grass_variant[y, x]
                    ground[y, x] = t
                elif faces[y, x]:
                    left = x > 0 and faces[y, x-1]; right = x < w-1 and faces[y, x+1]
                    ground[y, x] = CLIFF_LEFT if not left else CLIFF_RIGHT if not right else rng.choice(CLIFF_FACE)
                elif base[y, x]:
                    left = x > 0 and base[y, x-1]; right = x < w-1 and base[y, x+1]
                    ground[y, x] = CLIFF_BASE_L if not left else CLIFF_BASE_R if not right else CLIFF_BASE_M
                if self.shadow[y, x]:
                    left = x > 0 and self.shadow[y, x-1]; right = x < w-1 and self.shadow[y, x+1]
                    shadow[y, x] = WATER_SHADOW_L if not left else WATER_SHADOW_R if not right else WATER_SHADOW_M
                if river[y, x]:
                    m, d = masks(river, x, y)
                    riverL[y, x] = autotile(R, m, d)
                if beach[y, x]:
                    m, d = masks(beach, x, y)
                    beachL[y, x] = autotile(P2, m, d)
                if path[y, x]:
                    m, d = masks(path, x, y)
                    pathL[y, x] = autotile(P1, m, d)
        # canopy on the block grid
        bh, bw = self.forest_blocks.shape
        canopy = np.zeros((bh, bw), np.int32)
        F = self.forest_auto
        for by in range(bh):
            for bx in range(bw):
                if self.forest_blocks[by, bx]:
                    m, d = masks(self.forest_blocks, bx, by)
                    canopy[by, bx] = autotile(F, m, d)
        self.layers = {'sea': sea, 'ground': ground, 'shadow': shadow, 'river': riverL, 'beach': beachL, 'path': pathL}
        self.canopy = canopy

    def walkable(self):
        wk = self.land & ~self.river & ~self.block
        wk |= self.ford
        return wk

    def biome(self):
        b = np.full((self.rows, self.cols), 'water', dtype=object)
        b[self.land] = 'meadow'
        b[self.beach] = 'shore'
        b[self.river] = 'shore'
        b[self.forest] = 'forest'
        return b

    def export(self, name):
        wk = self.walkable()
        # reachability from the centre
        lab, n = ndimage.label(wk)
        cx, cy = self.center
        main = lab[cy, cx]
        if main == 0:
            ys, xs = np.where(wk); k = int(np.argmin((xs-cx)**2 + (ys-cy)**2)); main = lab[ys[k], xs[k]]
        reach = lab == main
        biome = self.biome()
        bio_code = {'water': 0, 'meadow': 1, 'forest': 2, 'shore': 3}
        out = {
            'name': name, 'seed': self.seed, 'cols': self.cols, 'rows': self.rows, 'tileSize': 16,
            'tileset': 'tiles/sunnyside/spr_tileset_sunnysideworld_16px.png', 'tilesetColumns': 64,
            'forestTileset': 'tiles/sunnyside/spr_tileset_sunnysideworld_forest_32px.png', 'forestColumns': 10,
            'layers': [{'name': k, 'tiles': v.tolist()} for k, v in self.layers.items()],
            'canopy': self.canopy.tolist(),
            'riverFillFrames': RIVER_FILL_FRAMES,
            'walkable': wk.astype(int).tolist(), 'reachable': reach.astype(int).tolist(),
            'biome': np.vectorize(bio_code.get)(biome).tolist(),
            'center': {'x': cx, 'y': cy},
            'outposts': [{'x': x, 'y': y} for x, y in self.outposts],
            'spawns': [{'x': x, 'y': y} for x, y in self.spawns],
            'decor': self.decor,
        }
        os.makedirs(os.path.join(ROOT, 'assets/maps'), exist_ok=True)
        p = os.path.join(ROOT, f'assets/maps/{name}.json')
        json.dump(out, open(p, 'w'), separators=(',', ':'))
        return p, reach

    def preview(self, name, reach):
        from PIL import Image, ImageDraw
        sheet = Image.open(os.path.join(ROOT, 'assets/tiles/sunnyside/spr_tileset_sunnysideworld_16px.png')).convert('RGBA')
        fsheet = Image.open(os.path.join(ROOT, 'assets/tiles/sunnyside/spr_tileset_sunnysideworld_forest_32px.png')).convert('RGBA')
        h, w = self.rows, self.cols
        img = Image.new('RGBA', (w*16, h*16), (0, 0, 0, 255))
        cache = {}
        def tile(idx, sh=sheet, cols=64, size=16):
            key = (idx, size)
            if key not in cache:
                r, c = divmod(idx, cols); cache[key] = sh.crop((c*size, r*size, c*size+size, r*size+size))
            return cache[key]
        for lname in ('sea', 'ground', 'shadow', 'river', 'beach', 'path'):
            layer = self.layers[lname]
            for y in range(h):
                for x in range(w):
                    t = int(layer[y, x])
                    if t:
                        img.alpha_composite(tile(t), (x*16, y*16))
        # decor
        strips = {}
        for d in sorted(self.decor, key=lambda d: d['y']):
            if 'tile' in d:
                img.alpha_composite(tile(d['tile']), (int(d['x']*16-8), int(d['y']*16-15)))
            elif 'stamp' in d:
                tl, tw, th = d['stamp']
                for yy in range(th):
                    for xx in range(tw):
                        img.alpha_composite(tile(tl + yy*64 + xx), (int(d['x']*16 - tw*8 + xx*16), int(d['y']*16 - th*16 + 1 + yy*16)))
            elif 'strip' in d:
                if d['strip'] not in strips:
                    s = Image.open(os.path.join(ROOT, 'assets/tiles/sunnyside/plants', d['strip'])).convert('RGBA')
                    strips[d['strip']] = s.crop((0, 0, s.width // 4, s.height))
                s = strips[d['strip']]
                img.alpha_composite(s, (int(d['x']*16 - s.width/2), int(d['y']*16 - s.height + 2)))
        bh, bw = self.canopy.shape
        for by in range(bh):
            for bx in range(bw):
                t = int(self.canopy[by, bx])
                if t:
                    img.alpha_composite(tile(t, fsheet, 10, 32), (bx*32, by*32))
        dr = ImageDraw.Draw(img)
        for (x, y) in self.outposts:
            dr.rectangle((x*16-6, y*16-6, x*16+22, y*16+22), outline=(255, 80, 80), width=2)
        for (x, y) in self.spawns:
            dr.rectangle((x*16-4, y*16-4, x*16+20, y*16+20), outline=(80, 200, 255), width=2)
        cx, cy = self.center
        dr.rectangle((cx*16-8, cy*16-8, cx*16+24, cy*16+24), outline=(230, 120, 255), width=3)
        p = os.path.join(ROOT, f'assets/maps/{name}_preview.png')
        img.save(p)
        return p


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--seed', type=int, default=7)
    ap.add_argument('--cols', type=int, default=160)
    ap.add_argument('--rows', type=int, default=112)
    ap.add_argument('--name', default='almia')
    ap.add_argument('--no-preview', action='store_true')
    a = ap.parse_args()
    b = MapBuilder(a.cols, a.rows, a.seed)
    b.build_land(); b.build_rivers(); b.build_pois(); b.build_beaches(); b.build_paths(); b.build_forest(); b.build_decor(); b.resolve()
    p, reach = b.export(a.name)
    wk = b.walkable()
    print(f'{a.name}: {a.cols}x{a.rows} land {int(b.land.sum())} walkable {int(wk.sum())} reachable {int(reach.sum())} '
          f'rivers {int(b.river.sum())} path {int(b.path.sum())} beach {int(b.beach.sum())} forest {int(b.forest.sum())} decor {len(b.decor)}')
    print('outposts', b.outposts, 'spawns', b.spawns)
    unreachable = [p for p in b.outposts + b.spawns if not reach[p[1], p[0]]]
    if unreachable:
        print('WARNING unreachable POIs:', unreachable, file=sys.stderr)
    if not a.no_preview:
        print('preview', b.preview(a.name, reach))


if __name__ == '__main__':
    main()
