"""Content for the map: roads, ladders, bridges, piers, buildings, farms,
forests and props, placed by hand per district on the designer2 terrain.

Only whole pictures are placed: buildings and stamps from lib.PREFABS,
sprites from props.json (trees, animals, barrels...) and crop sprites.
"""
import math, random, numpy as np
from scipy import ndimage
import designer2, lib
from designer2 import W, H

ENC = lib.ENC


class Builder:
    def __init__(self, d, seed=11):
        self.d = d
        self.lab = d.lab
        self.lev = d.lev
        self.rng = random.Random(seed)
        from noise import Noise
        self.d_noise = Noise(seed)
        self.paths = np.full((H, W), '.')
        self.ptile = {}          # (x, y) -> enc, drawn on the paths layer (bridges, piers)
        self.gdeco = {}          # (x, y) -> [enc], flat ground decoration
        self.objs = []           # y-sorted objects
        self.occ = np.zeros((H, W), bool)      # claimed by an object or a road
        self.block = np.zeros((H, W), bool)    # objects that stop walking
        self.walk_extra = np.zeros((H, W), bool)  # ladders, bridges, piers
        self.ladders = []
        self.pois = {}
        self.no_path = np.zeros((H, W), bool)
        self.forest = np.zeros((H, W), bool)
        self.bridge_path = np.zeros((H, W), bool)
        self.dark = np.zeros((H, W), bool)          # dark-dirt overlay (Path 02) on top of light paths   # bridge decks the road runs across

    # ---------------------------------------------------------------- helpers
    def grass(self, x, y):
        return 0 <= x < W and 0 <= y < H and self.lab[y, x] == 'G'

    def edge_row(self, x, y):
        """A grass cell with a cliff face directly below (the band lip)."""
        return self.grass(x, y) and y + 1 < H and self.lab[y + 1, x] == 'F'

    def free(self, x0, y0, w, h, margin=0, allow_path=False, terrain='G'):
        for y in range(y0 - margin, y0 + h + margin):
            for x in range(x0 - margin, x0 + w + margin):
                if not (0 <= x < W and 0 <= y < H) or self.lab[y, x] not in terrain or self.occ[y, x]: return False
                if not allow_path and self.paths[y, x] != '.': return False
        lv = {int(self.lev[y, x]) for y in range(y0, y0 + h) for x in range(x0, x0 + w)}
        return len(lv) == 1

    # ---------------------------------------------------------------- roads
    def road(self, pts, w=3, kind='1'):
        """Octilinear polyline, `w` cells wide (the run's cells and the w-1
        to its right/below)."""
        o = (w - 1) // 2
        for (ax, ay), (bx, by) in zip(pts, pts[1:]):
            dx, dy = bx - ax, by - ay
            assert dx == 0 or dy == 0 or abs(dx) == abs(dy), ((ax, ay), (bx, by))
            n = max(abs(dx), abs(dy))
            for i in range(n + 1):
                x = ax + (dx > 0) * i - (dx < 0) * i
                y = ay + (dy > 0) * i - (dy < 0) * i
                self.paths[y - o:y - o + w, x - o:x - o + w] = kind
                if dx and dy:   # fill the diagonal's corners so the run stays w wide
                    self.paths[y - o:y - o + w, x - o + (1 if dx > 0 else -1):x - o + w + (1 if dx > 0 else -1)] = kind

    def plaza(self, x0, y0, x1, y1, kind='1', cut=2):
        """A clearing with 45 degree corners cut `cut` cells deep, kept on
        the level of its centre (a clearing never spills over a cliff)."""
        lv = self.lev[(y0 + y1) // 2, (x0 + x1) // 2]
        for y in range(y0, y1 + 1):
            for x in range(x0, x1 + 1):
                dx = min(x - x0, x1 - x); dy = min(y - y0, y1 - y)
                if dx + dy >= cut and self.lev[y, x] == lv:
                    if kind == '2': self.paths[y, x] = '1'; self.dark[y, x] = True
                    else: self.paths[y, x] = kind

    # ---------------------------------------------------------------- stamps
    def ladder(self, x, b):
        """b: the band's lip row (last row of the upper level)."""
        for y, t in ((b, 746), (b + 1, 810), (b + 2, 810), (b + 3, 811)):
            self.gdeco.setdefault((x, y), []).append(ENC(t))
            self.walk_extra[y, x] = True
            self.occ[y, x] = True
        self.ladders.append((x, b))

    def plank_bridge(self, x, y):
        """Across a one-water vertical river whose water column is x."""
        for dx in (-1, 0, 1):
            self.ptile[(x + dx, y)] = ENC(358); self.walk_extra[y, x + dx] = True
            self.bridge_path[y - 1:y + 2, x + dx] = True
        for dx in (-1, 1):
            self.ptile[(x + dx, y - 1)] = ENC(294); self.ptile[(x + dx, y + 1)] = ENC(422)
            self.walk_extra[y - 1, x + dx] = True; self.walk_extra[y + 1, x + dx] = True

    def railed_bridge(self, x, y):
        """Two rows of planks across a vertical river (water column x), rails
        above and below, as the artist bridges the main road."""
        for dy in (0, 1):
            for dx in (-1, 0, 1):
                self.ptile[(x + dx, y + dy)] = ENC(808); self.walk_extra[y + dy, x + dx] = True
                self.bridge_path[y - 1:y + 3, x + dx] = True
        for dx, t in zip(range(-2, 3), [(980, 0), (919, 0), (920, 0), (919, 1), (980, 1)]):
            self.gdeco.setdefault((x + dx, y - 1), []).append(ENC(*t))
        for dx, t in zip(range(-2, 3), [(400, 0), (919, 0), (920, 0), (919, 1), (400, 1)]):
            self.gdeco.setdefault((x + dx, y + 1), []).append(ENC(*t))

    def pier(self, x, y0, y1, posts=True):
        """A three-wide pier running south from row y0 to y1 at columns x..x+2."""
        for y in range(y0, y1 + 1):
            for dx, t in enumerate((359, 360, 361)):
                self.ptile[(x + dx, y)] = ENC(t); self.walk_extra[y, x + dx] = True
        if posts:
            for dx in (0, 2):
                self.gdeco.setdefault((x + dx, y1 + 1), []).append(ENC(422))

    def vbridge(self, x, y0, y1):
        """A long three-wide bridge with posts, running south over open water
        from row y0 to y1 (columns x..x+2)."""
        for y in range(y0, y1 + 1):
            if y == y0: row = [(743, 0), (744, 0), (745, 0)]
            elif y == y1: row = [(745, 3), (744, 3), (743, 3)]
            else: row = [(807, 0), (808, 4), (809, 0)]
            for dx, t in enumerate(row):
                self.ptile[(x + dx, y)] = ENC(*t); self.walk_extra[y, x + dx] = True
        for dx in (-1, 3):
            for y in range(y0, y1 + 1):
                t = 104 if y == y0 else (296 if y == y1 else 232)
                self.objs.append({'kind': 'prefab', 'name': None, 'tiles': [[ENC(t)]], 'x': x + dx, 'y': y, 'w': 1, 'h': 1})

    # ---------------------------------------------------------------- objects
    def put(self, name, x, y, check=True, margin=0, allow_path=False, terrain='G'):
        p = lib.PREFABS[name]
        if check and not self.free(x, y, p['w'], p['h'], margin, allow_path, terrain):
            return False
        occ = lib.occupancy(p['layers'], p['h'], p['w'])
        for yy in range(p['h']):
            for xx in range(p['w']):
                if occ[yy, xx] and 0 <= y + yy < H and 0 <= x + xx < W: self.occ[y + yy, x + xx] = True
        for (bx, by) in p['block']:
            if 0 <= y + by < H and 0 <= x + bx < W: self.block[y + by, x + bx] = True
        self.objs.append({'kind': 'prefab', 'name': name, 'x': x, 'y': y, 'w': p['w'], 'h': p['h']})
        return True

    def sprite(self, name, tx, ty, flip=False, frame=0, block=True, check=True):
        """Place a props.json sprite so its foot sits at the centre-bottom of
        tile (tx, ty). Returns False when the tile is taken."""
        if check and (not (self.grass(tx, ty) or self.lab[ty, tx] == 'S') or self.occ[ty, tx]):
            return False
        self.objs.append({'kind': 'sprite', 'name': name, 'tx': tx, 'ty': ty, 'flip': flip, 'frame': frame})
        self.occ[ty, tx] = True
        if block: self.block[ty, tx] = True
        return True

    def ground(self, x, y, t, f=0):
        self.gdeco.setdefault((x, y), []).append(ENC(t, f))


def finish_paths(b):
    """Roads only on grass, never on a band lip except at a ladder, no spurs."""
    d = b.d; lab = b.lab
    ok = ((lab == 'G') & ~b.no_path) | b.bridge_path
    edge = np.zeros((H, W), bool)
    edge[:-1] = (lab[1:] == 'F') & (lab[:-1] == 'G')
    for kind in '123':
        m = (b.paths == kind) & ok & ~edge
        m = (ndimage.binary_opening(m, structure=np.ones((2, 2), bool)) | (m & b.bridge_path)) & ok & ~edge
        b.paths[(b.paths == kind)] = '.'
        b.paths[m] = kind
    dk = ndimage.binary_erosion(b.dark & (b.paths == '1'), structure=np.ones((3, 3), bool))
    b.dark = ndimage.binary_opening(dk, structure=np.ones((2, 2), bool))


def ladder_spurs(b, reach=10):
    """Run a road from every ladder's top and foot to the nearest road in line."""
    for (x, lip) in b.ladders:
        for y0, step in ((lip - 1, -1), (lip + 3, 1)):
            y = y0
            for k in range(reach):
                if not (0 <= y < H) or (b.lab[y, x] != 'G' and y != lip + 3): break
                if (b.paths[y, x - 1:x + 2] != '.').any() and k > 0: break
                y += step
            else:
                continue
            if 0 <= y < H and (b.paths[y, x - 1:x + 2] != '.').any():
                lo, hi = sorted((y0, y))
                b.paths[lo:hi + 1, x - 1:x + 2] = '1'


DOORS = {'blue_dormer': 2, 'blue_tower_duo': 1, 'blue_flat': 2, 'green_small': 2, 'red_tower': 1,
         'green_hut': 1, 'red_house': 1, 'blue_manor': 3, 'green_house': 2, 'purple_manor': 3,
         'red_small': 2, 'green_stall_hut': 1, 'lighthouse': 2, 'green_house_b': 1, 'orange_house': 1,
         'orange_tall': 1, 'orange_gable': 3, 'red_long': 3, 'red_gable': 2, 'green_gable_tall': 2}


def door_path(b, name, x, y, reach=8, w=1):
    """A short footpath from the door straight down to the nearest road."""
    p = lib.PREFABS[name]; dx = DOORS.get(name, p['w'] // 2)
    cx = x + dx; y0 = y + p['h']
    for k in range(reach):
        yy = y0 + k
        if yy >= H or b.lab[yy, cx] != 'G': return False
        if (b.paths[yy, cx - 1:cx + 2] != '.').any() and k > 0:
            b.paths[y0:yy + 1, cx - 1:cx + 2] = '1'
            # the artist's doorstep: a worn dirt patch right under the door
            for dx, t in ((-1, (398, 5)), (0, (334, 6)), (1, (398, 6))):
                b.ground(cx + dx, y0, *t)
            return True
    return False


def forest(b, mask, pine_share=0.18, keep_clear=1):
    """Fill `mask` with trees on the artist's staggered lattice: one tree per
    two cells, alternate rows offset by one, the same packing as the 32 px
    forest tiles. Cells near roads, objects and cliff lips stay clear."""
    m = mask.copy() & (b.lab == 'G')
    clear = (b.paths != '.') | b.occ
    if keep_clear: clear = ndimage.binary_dilation(clear, iterations=keep_clear)
    lip = np.zeros((H, W), bool); lip[:-1] = (b.lab[1:] == 'F') | (b.lab[1:] == 'R') | (b.lab[1:] == 'W')
    m &= ~clear & ~lip
    n = 0
    for y in range(H):
        for x in range(W):
            if m[y, x] and (x + y) % 2 == 0:
                name = 'spr_deco_tree_02' if b.rng.random() < pine_share else 'spr_deco_tree_01'
                b.objs.append({'kind': 'sprite', 'name': name, 'tx': x, 'ty': y, 'flip': b.rng.random() < 0.5, 'frame': b.rng.randrange(4)})
                b.occ[y, x] = True; b.block[y, x] = True; n += 1
    b.forest |= m
    # the cells between trunks are under the canopy: no walking through
    b.block |= m
    b.occ |= m
    return n


def scatter(b, mask, items, density, avoid_paths=True):
    """Small whole objects (flowers, bushes, rocks) on free grass."""
    ok = mask & (b.lab == 'G') & ~b.occ
    if avoid_paths: ok &= (b.paths == '.')
    ys, xs = np.nonzero(ok)
    n = 0
    for y, x in zip(ys, xs):
        if b.rng.random() > density or b.occ[y, x]: continue
        name = b.rng.choice(items)
        if name.startswith('flower'):
            b.ground(x, y, int(name.split('_')[1])); n += 1
        elif name in lib.PREFABS:
            p = lib.PREFABS[name]
            if b.free(x, y, p['w'], p['h'], allow_path=not avoid_paths): b.put(name, x, y); n += 1
        else:
            b.sprite(name, x, y, flip=b.rng.random() < 0.5, frame=b.rng.randrange(4), block=False); n += 1
    return n


CROP_NAMES = ['cabbage_05', 'cauliflower_05', 'kale_05', 'pumpkin_05', 'beetroot_05', 'carrot_05', 'parsnip_05', 'radish_05', 'potato_05', 'wheat_05', 'sunflower_05']
SOIL = [818, 818, 818, 882, 1010, 1138]


def field(b, x0, y0, x1, y1, crops, fill=0.85):
    """Tilled plot: a light-dirt patch (Path 01) with soil mounds and crops,
    rows of one crop each like the demo's farm."""
    b.plaza(x0, y0, x1, y1, cut=0)
    for y in range(y0 + 1, y1):
        crop = crops[(y - y0 - 1) % len(crops)]
        for x in range(x0 + 1, x1):
            b.ground(x, y, b.rng.choice(SOIL))
            b.occ[y, x] = True
            if b.rng.random() < fill:
                b.objs.append({'kind': 'crop', 'name': crop, 'tx': x, 'ty': y})


FENCE_H = (167, 0)


def fence_rect(b, x0, y0, x1, y1, gates=()):
    """A wooden fence around the cells x0..x1, y0..y1 (posts on the ring).
    Corners and run ends use the kit's own pieces: 106 / 105 / 103 / 102 for
    the corners, 167 along the top and bottom, 232 down the sides, 170 / 166
    where a run stops at a gate."""
    gates = set(gates)
    def put(x, y, t, f=0):
        if (x, y) in gates or b.lab[y, x] != 'G' or b.paths[y, x] != '.': return
        b.objs.append({'kind': 'prefab', 'name': None, 'tiles': [[lib.ENC(t, f)]], 'x': x, 'y': y, 'w': 1, 'h': 1})
        b.occ[y, x] = True; b.block[y, x] = True
    for yy in (y0, y1):
        for x in range(x0 + 1, x1):
            if (x + 1, yy) in gates: put(x, yy, 170)
            elif (x - 1, yy) in gates: put(x, yy, 166)
            else: put(x, yy, 167)
    for y in range(y0 + 1, y1):
        put(x0, y, 232); put(x1, y, 232)
    put(x0, y0, 106); put(x1, y0, 105)
    put(x0, y1, 103); put(x1, y1, 102)


def fence_line(b, x0, x1, y):
    """A free-standing horizontal fence run."""
    for x in range(x0, x1 + 1):
        t, f = (166, 0) if x == x0 else ((170, 0) if x == x1 else (167, 0))
        if b.lab[y, x] != 'G' or b.occ[y, x]: continue
        b.objs.append({'kind': 'prefab', 'name': None, 'tiles': [[lib.ENC(t, f)]], 'x': x, 'y': y, 'w': 1, 'h': 1})
        b.occ[y, x] = True; b.block[y, x] = True


def rail_h(b, x0, x1, y):
    """A straight minecart track with buffers at both ends (ground decoration)."""
    for x in range(x0, x1 + 1):
        t = (557, 0) if x == x0 else ((557, 1) if x == x1 else (495, 0))
        b.ground(x, y, *t)


def rail_v(b, x, y0, y1):
    for y in range(y0, y1 + 1):
        t = (557, 4) if y == y0 else ((557, 6) if y == y1 else (495, 4))
        b.ground(x, y, *t)


def hpier(b, x0, x1, y):
    """A one-plank pier running east over open water, posts above and below."""
    for x in range(x0, x1 + 1):
        b.ptile[(x, y)] = ENC(358); b.walk_extra[y, x] = True
        if (x - x0) % 2 == 1 or x == x1:
            b.ptile[(x, y - 1)] = ENC(294); b.ptile[(x, y + 1)] = ENC(422)


def blob(b, x0, y0, x1, y1, rough=0.35, seed=0):
    """An organic region inside the box: an ellipse with a noisy rim."""
    yy, xx = np.mgrid[0:H, 0:W]
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    rx, ry = max(1, (x1 - x0) / 2), max(1, (y1 - y0) / 2)
    e = ((xx - cx) / rx) ** 2 + ((yy - cy) / ry) ** 2
    n = b.d_noise.fbm(xx / 5.0 + seed * 13.1, yy / 5.0 + seed * 7.7, 3) if hasattr(b, 'd_noise') else 0
    return (e + rough * n < 1.0) & (xx >= x0) & (xx <= x1) & (yy >= y0) & (yy <= y1)


def forest_rim(b, mask, density=0.35):
    """Berry bushes, small pines and bushes along a forest's outer edge."""
    rim = ndimage.binary_dilation(mask, iterations=1) & ~mask & (b.lab == 'G') & ~b.occ & (b.paths == '.')
    ys, xs = np.nonzero(rim)
    for y, x in zip(ys, xs):
        if b.rng.random() > density: continue
        c = b.rng.random()
        if c < 0.25 and b.free(x, y, 2, 2): b.put(b.rng.choice(['berry_red', 'berry_orange', 'round_bush']), x, y)
        elif c < 0.45 and b.free(x, y, 1, 2): b.put('pine_small', x, y)
        elif c < 0.85: b.put(b.rng.choice(['bush_91', 'bush_155', 'bush_219', 'bush_283']), x, y)
        else: b.sprite(b.rng.choice(['spr_deco_mushroom_red_01', 'spr_deco_mushroom_blue_01', 'spr_deco_mushroom_blue_02']), x, y, frame=b.rng.randrange(4), block=False)


def cave(b, x0, x1, lip):
    """A cave mouth in a band face: tiles 135 / 136 / 137 on the lower face row."""
    y = lip + 2
    for x in range(x0, x1 + 1):
        assert b.lab[y, x] == 'F', (x, y, b.lab[y, x])
        b.ptile[(x, y)] = ENC(135 if x == x0 else (137 if x == x1 else 136))


def stone_wall(b, x0, x1, y):
    for x in range(x0, x1 + 1):
        t = 108 if x == x0 else (111 if x == x1 else (109 if (x - x0) % 2 else 110))
        b.objs.append({'kind': 'prefab', 'name': None, 'tiles': [[ENC(t)]], 'x': x, 'y': y, 'w': 1, 'h': 1})
        b.occ[y, x] = True; b.block[y, x] = True


def npier(b, x, y0, y1):
    """A three-wide pier running north from row y1 (the shore) to y0 over water."""
    for y in range(y0, y1 + 1):
        for dx, t in enumerate((359, 360, 361)):
            b.ptile[(x + dx, y)] = ENC(t); b.walk_extra[y, x + dx] = True
    for dx in (0, 2):
        b.ptile[(x + dx, y0 - 1)] = ENC(294)


def wild_forests(b, cover=0.5, reserve=None, seed=21, min_cells=14, road_gap=3):
    """Grow woods over the land nobody uses: grass at least three cells from
    any road and two from any object, shaped by noise."""
    from scipy import ndimage as nd
    free = (b.lab == 'G') & ~b.occ
    far_road = nd.distance_transform_edt(b.paths == '.') >= road_gap
    far_obj = nd.distance_transform_edt(~b.occ) >= 2
    near_edge = nd.binary_dilation((b.lab == 'F') | (b.lab == 'R') | (b.lab == 'W') | (b.lab == 'S'), iterations=1)
    wild = free & far_road & far_obj & ~near_edge
    if reserve is not None: wild &= ~reserve
    yy, xx = np.mgrid[0:H, 0:W]
    n = b.d_noise.fbm(xx / 9.0 + seed, yy / 9.0 - seed, 4)
    vals = n[wild]
    if not len(vals): return np.zeros((H, W), bool)
    t = np.quantile(vals, 1 - cover)
    m = wild & (n >= t)
    m = nd.binary_opening(m, structure=np.ones((2, 2), bool))
    lbl, k = nd.label(m)
    sizes = nd.sum(m, lbl, range(1, k + 1))
    for i, sz in enumerate(sizes, 1):
        if sz < min_cells: m[lbl == i] = False
    return m
