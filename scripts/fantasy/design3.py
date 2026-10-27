"""The shape of Almia, third map (The Fan-tasy Tileset), 320 x 224 tiles.

An island in the sea. The Shadow Crystal stands on a terrace in an open plain
at the centre; four lands surround it:
  north-west  snowfields rising to a three-tier mountain: a foothill plateau
              (Frostmere stands on it), a ridge, and a summit, with a trail
              of stairs climbing from the town to the top
  north-east  the autumn wood (red and gold), a ridge along the coast
  south-west  the desert, with mesas and an oasis
  south-east  the green forest, its lake, and the castle in a clearing
The castle is an irregular hold round a courtyard with the champion's
battlefield: the keep stands on a spur that juts out of the north wall (no gate
beside it), a walled gate yard on the west makes a bent entrance (in through its
north gate, then east through the inner gate, never a straight line into the
ward), a garden bastion with the fountain juts out to the north-east, and there
is a gate in the south wall and a postern in the east wall. Towers stand on
every outer corner and either side of every gate. Roads cross the plain and run to a
town in each land and to the castle's gates. Every land keeps wide open
ground (meadows, flats, plazas) for battles.

Grids (h, w):
  land    bool   island (beach included)
  beach   bool   sand rim along the coast
  biome   int    BIOME codes below
  level   int    0 lowland, 1 plateau, 2 ridge, 3 summit
  water   bool   lakes and rivers (on land)
"""
import numpy as np
from scipy import ndimage

W, H = 320, 224
CX, CY = 160, 112
# biome codes shared with the runtime (src/ground/fanGround.ts BIOME_CODES)
WATER, MEADOW, FOREST, SHORE, SNOW, DESERT, AUTUMN, CASTLE = range(8)

# the castle: the union of these rectangles (x0, y0, x1, y1, exclusive ends) minus the cut-outs;
# the outer 3 tiles are the wall walkway, the rest the courtyard
CASTLE_RECTS = [
    (176, 154, 224, 190),   # the main ward
    (189, 144, 210, 158),   # the keep's spur on the north wall
    (153, 159, 178, 190),   # the west gate yard (barbican); its south wall runs on as the ward's
    (221, 144, 235, 165),   # the garden bastion, north-east
]
CASTLE_CUTS = []
# walls inside the castle region (the union has none where the rects meet): the gate yard's inner wall
CASTLE_INNER_WALLS = []
CASTLE_WALL = 3
CASTLE_CENTER = (199, 170)
CRYSTAL = (160, 112)
FINAL_ARENA = (150, 106, 171, 119)   # the last two's battlefield round the crystal (x0, y0, x1, y1, exclusive ends)
PLAIN = (160, 112, 44, 32)          # the open plain round the crystal: centre and radii
TIDE_LAKE = (219, 98, 16, 9)        # Tide Lake (Lugia's): centre and radii


def castle_region(shape=None):
    shape = shape or (H, W)
    R = np.zeros(shape, bool)
    for (x0, y0, x1, y1) in CASTLE_RECTS: R[y0:y1, x0:x1] = True
    for (x0, y0, x1, y1) in CASTLE_CUTS: R[y0:y1, x0:x1] = False
    return R


def noise(seed, scale, shape=(H, W)):
    rng = np.random.default_rng(seed)
    n = ndimage.gaussian_filter(rng.standard_normal(shape), scale, mode='wrap')
    return n / (n.std() + 1e-9)


def ellipse(cx, cy, rx, ry):
    yy, xx = np.mgrid[0:H, 0:W]
    return ((xx - cx) / rx) ** 2 + ((yy - cy) / ry) ** 2


class Design:
    def __init__(self, seed=3):
        self.seed = seed
        yy, xx = np.mgrid[0:H, 0:W]
        self.yy, self.xx = yy, xx
        # ---------------------------------------------------------------- island
        e = ((xx - CX) / 146.0) ** 4 + ((yy - CY) / 98.0) ** 4          # a rounded rectangle
        coast = e ** 0.25 + 0.05 * noise(seed + 1, 9) + 0.025 * noise(seed + 2, 3)
        land = coast < 1.0
        land = ndimage.binary_opening(land, iterations=2)
        lbl, n = ndimage.label(land)
        land = lbl == lbl[CY, CX]
        land = ndimage.binary_fill_holes(land)
        self.land = land
        dist_sea = ndimage.distance_transform_edt(land)
        self.dist_sea = dist_sea
        # ---------------------------------------------------------------- biomes
        ang = np.degrees(np.arctan2((yy - CY) / 98.0, (xx - CX) / 146.0)) % 360   # 0 = east, 90 = south (island proportions)
        ang = (ang + 7 * noise(seed + 3, 10).clip(-2, 2)) % 360
        biome = np.full((H, W), MEADOW)
        biome[(ang >= 180) & (ang < 270)] = SNOW        # north-west
        biome[(ang >= 270) & (ang < 360)] = AUTUMN      # north-east
        biome[(ang >= 90) & (ang < 180)] = DESERT       # south-west
        biome[(ang >= 0) & (ang < 90)] = FOREST         # south-east
        px, py, prx, pry = PLAIN
        green = ellipse(px, py, prx, pry) + 0.08 * noise(seed + 4, 6) < 1
        biome[green] = MEADOW
        self.castle = castle_region()
        biome[self.castle] = CASTLE                             # the courtyard and its walls
        self.beach = land & (dist_sea <= 4 + 1.5 * noise(seed + 5, 6).clip(-1, 1))
        biome[~land] = WATER
        self.biome = biome
        # ---------------------------------------------------------------- levels
        level = np.zeros((H, W), np.int32)
        inland = land & (dist_sea > 9)
        # snow mountain: a foothill plateau over the far north-west (the town's), a ridge on it and
        # a summit on the ridge, each tier set well back from the edge of the one below
        r_snow = ellipse(70, 58, 62, 44) + 0.12 * noise(seed + 6, 8)
        level[(r_snow < 1) & inland & (biome == SNOW)] = 1
        town = ellipse(TOWNS['Frostmere'][0], TOWNS['Frostmere'][1], 27, 17) < 1
        r_ridge = ellipse(54, 68, 30, 24) + 0.13 * noise(seed + 7, 6)
        level[(r_ridge < 1) & (level == 1) & ~town] = 2
        r_peak = ellipse(50, 64, 15, 11) + 0.12 * noise(seed + 16, 5)
        level[(r_peak < 1) & (level == 2)] = 3
        # desert mesas
        for (mx, my, rx, ry, s) in [(48, 150, 18, 12, 8), (140, 198, 10, 6, 9)]:
            r = ellipse(mx, my, rx, ry) + 0.15 * noise(seed + s, 5)
            level[(r < 1) & inland & (biome == DESERT)] = 1
        # autumn ridge along the north-east
        r_ridge = ellipse(262, 40, 46, 24) + 0.12 * noise(seed + 10, 7)
        level[(r_ridge < 1) & inland & (biome == AUTUMN)] = 1
        # forest hill on the east coast
        r_hill = ellipse(292, 152, 14, 10) + 0.12 * noise(seed + 11, 6)
        level[(r_hill < 1) & inland & (biome == FOREST)] = 1
        # the plain, the castle's clearing and a margin round every road stay level
        px, py, prx, pry = PLAIN
        level[ellipse(px, py, prx + 6, pry + 6) < 1] = 0
        level[136:204, 156:238] = 0
        roads = np.zeros((H, W), np.int32)
        paint_roads(self, [r for r in ROADS if not climbs(r[1])], out=roads)
        flat = ndimage.binary_dilation(roads > 0, iterations=5)
        level[flat] = 0
        level = self._clean_levels(level)
        # a straight face where each road climbs a plateau (stairs need one): find where the
        # road's column meets the plateau coming from the south and square the edge off there
        # (every step up the road meets, on a climbing road: the mountain trail meets three)
        self.stair_rows = {}
        for (sx, y_from) in STAIR_SITES:
            y = y_from
            while y > 1:
                if level[y - 1, sx] > level[y, sx]:
                    lo, hi = int(level[y, sx]), int(level[y - 1, sx])
                    for x in range(sx - 7, sx + 8):
                        level[y:y + 8, x] = np.minimum(level[y:y + 8, x], lo)
                        level[y - 5:y, x] = np.maximum(level[y - 5:y, x], hi)
                    self.stair_rows.setdefault(sx, []).append(y)
                    y -= 6
                    continue
                y -= 1
        self.level = level
        # ---------------------------------------------------------------- water
        water = np.zeros((H, W), bool)
        lake = ellipse(262, 186, 16, 8) + 0.15 * noise(seed + 12, 4) < 1
        water |= lake
        oasis = ellipse(64, 182, 7, 5) + 0.15 * noise(seed + 13, 3) < 1
        water |= oasis
        frozen = ellipse(50, 106, 8, 5) + 0.15 * noise(seed + 14, 3) < 1
        water |= frozen
        # Tide Lake: a big lake on the lowland between the plain and the autumn wood, where Lugia sleeps
        tide = ellipse(*TIDE_LAKE) + 0.12 * noise(seed + 15, 5) < 1
        level[ellipse(TIDE_LAKE[0], TIDE_LAKE[1], TIDE_LAKE[2] + 5, TIDE_LAKE[3] + 5) < 1] = 0
        water |= tide
        self.lake, self.oasis, self.frozen, self.tide = lake, oasis, frozen, tide
        self.water = water & land & (self.level == 0) & ~self.beach
        self.paths = np.zeros((H, W), np.int32)       # filled by the road network (1 road, 2 brick, 3 dark brick)
        self.stairs = []                              # (x, y, width, kind)

    def _clean_levels(self, level):
        """Plateaus are compact: no slivers, no holes, each level inside the one below."""
        out = np.zeros_like(level)
        for lv in (1, 2, 3):
            m = level >= lv
            m = ndimage.binary_opening(m, structure=np.ones((5, 5)))
            m = ndimage.binary_closing(m, structure=np.ones((5, 5)))
            m = ndimage.binary_fill_holes(m)
            if lv >= 2: m &= ndimage.binary_erosion(out >= lv - 1, iterations=4)
            lbl, n = ndimage.label(m)
            for i in range(1, n + 1):
                if (lbl == i).sum() < 120: m[lbl == i] = False
            out[m] = lv
        return out


def preview(d, path):
    from PIL import Image
    col = {WATER: (40, 100, 190), MEADOW: (110, 190, 90), FOREST: (40, 130, 60), SHORE: (230, 210, 140),
           SNOW: (235, 240, 245), DESERT: (225, 190, 120), AUTUMN: (210, 120, 50), CASTLE: (150, 200, 120)}
    img = np.zeros((H, W, 3), np.uint8)
    for k, c in col.items(): img[d.biome == k] = c
    img[d.beach & d.land] = (240, 225, 160)
    img = img.astype(int) - (d.level[..., None] * 28)
    img[d.water] = (70, 150, 220)
    img[d.castle] = (img[d.castle] * 0.6 + np.array([180, 180, 180]) * 0.4)
    Image.fromarray(img.clip(0, 255).astype(np.uint8)).resize((W * 3, H * 3), Image.NEAREST).save(path)


# towns: (name, centre x, centre y, biome)
TOWNS = {
    'Frostmere': (104, 72, SNOW),
    'Emberwood': (246, 82, AUTUMN),
    'Sunreach': (100, 154, DESERT),     # moved north from (112, 176): closer to the other healers
    'Greenhollow': (262, 128, FOREST),
}
# gates in the castle wall: (x, y) of the gap's middle, and whether the gap is in a N/S wall
GATES = {
    'W': (165, 160, True),       # the gate yard's outer gate, in its north wall
    'S': (199, 188, True),
    'E': (222, 172, False),      # the postern towards Greenhollow, on the plaza's east-west axis
}
GATE_W = 5

# (x, y): a road climbing north from row y meets south-facing plateau edges in column x
STAIR_SITES = [(104, 112), (56, 97), (122, 100)]
# the mountain trail's top: the summit lookout
SUMMIT = (56, 64)

ROADS = [
    # Roads follow the land rather than a grid: diagonal legs between waypoints, then a gentle
    # wind and rounded corners (road_path). Each still ends square on its town, gate or stairs.
    # east-west across the plain, on east to the forest town
    # (each road meets the crystal arena square on, in the middle of its west, east, north or south side)
    ('1', [(84, 112), (118, 109), (136, 112), (142, 112), (160, 112), (178, 112), (184, 112), (203, 115), (238, 119), (262, 128)]),
    # north-south through the crystal, from the north coast to the south of the plain
    ('1', [(160, 30), (165, 58), (160, 88), (160, 95), (160, 101), (160, 112), (160, 124), (160, 130), (157, 140), (160, 160)]),
    # climbing the plateau to the snow town (CLIMB: straight, no flattening round this one)
    ('1', [(84, 112), (104, 112), (104, 72)]),
    # the mountain trail: off Frostmere's road just south of the town, west along the foothills, then
    # straight up the ridge's and the summit's south faces (a flight of stairs at each)
    ('1', [(104, 97), (90, 103), (72, 104), (56, 98), (56, 64)]),   # bows south, clear of the cliff
    # north-east to the autumn town
    ('1', [(194, 114), (196, 99), (205, 85), (226, 79), (246, 82)]),   # round the west and north of Tide Lake
    # south-west to the desert town
    ('1', [(157, 140), (138, 147), (112, 156)]),
    # another way off the snow plateau: south-east down to the plain road
    ('1', [(118, 109), (122, 100), (122, 77)]),
    # to the castle: the gate yard's north gate, the south gate and the east postern
    # (the castle paves its own approaches with the courtyard's slabs: build3.py)
    ('1', [(186, 115), (182, 128), (168, 142), (165, 155)]),
    ('1', [(158, 134), (168, 142)]),
    ('1', [(229, 172), (243, 166), (252, 150), (262, 128)]),
    ('1', [(199, 196), (199, 202), (214, 205), (232, 198), (246, 190)]),      # south gate to the forest lake
]


def climbs(pts):
    """A road that climbs plateaus (its stairs squared off, no flattening round it)."""
    return TOWNS['Frostmere'][:2] in pts or SUMMIT in pts or any(p in STAIR_SITES for p in pts)


def stair_waypoints(pts, stair_rows):
    """A climbing road with a straight run through each flight of stairs: extra waypoints a few
    rows either side of every face it climbs, so the winding legs between still meet the stairs
    head on (road_path winds only legs longer than 14 tiles, and never at a leg's ends)."""
    out = [pts[0]]
    for (ax, ay), (bx, by) in zip(pts, pts[1:]):
        if ax == bx and ax in stair_rows:
            lo, hi = min(ay, by), max(ay, by)
            rows = [y for y in stair_rows[ax] if lo < y < hi]
            extra = []
            for y in rows: extra += [(ax, y + 5), (ax, y - 6)]
            extra.sort(key=lambda p: p[1], reverse=by < ay)
            out += [p for p in extra if lo <= p[1] <= hi]
        out.append((bx, by))
    return out


def road_path(pts, seed, wind=True, ok=None, eager=False):
    """The centre line of a road through its waypoints, as dense float points.

    Long dirt-road legs wind: each bends sideways by a sum of two slow waves whose envelope is
    zero at both ends, so roads still meet towns, gates and stairs head on. Corners are then
    rounded (Chaikin), keeping the first and last point exactly.
    """
    rng = np.random.default_rng(seed)
    out = [(float(pts[0][0]), float(pts[0][1]))]
    for (ax, ay), (bx, by) in zip(pts, pts[1:]):
        dx, dy = bx - ax, by - ay
        L = float(np.hypot(dx, dy))
        if L < 1e-6: continue
        nx, ny = -dy / L, dx / L
        n = max(2, int(L * 2))
        # eager (the snow's climbing roads): short legs between flights bend too
        amp = (min(5.0, L / 4.5) if (wind and L > 12) else 0.0) if eager else (min(6.0, L / 7) if (wind and L > 14) else 0.0)
        k1, k2 = max(1, round(L / 34)), max(2, round(L / 15))
        p1, p2 = rng.uniform(0, 2 * np.pi, 2)
        def leg(a, q1=p1, q2=p2):
            pts_ = []
            for i in range(1, n + 1):
                t = i / n
                env = np.sin(np.pi * t) ** 1.2
                off = a * env * (0.7 * np.sin(2 * np.pi * k1 * t / 2 + q1) + 0.3 * np.sin(2 * np.pi * k2 * t / 2 + q2))
                pts_.append((ax + dx * t + nx * off, ay + dy * t + ny * off))
            return pts_
        pts_ = leg(amp)
        # a winding leg keeps clear of cliffs: other bends are tried (one may curve away from the
        # cliff), then smaller ones, until the whole leg stays on ground of one level
        if ok is not None and amp > 0 and not all(ok(x, y, ax, ay) for (x, y) in pts_):
            found = None
            for f in (1.0, 0.75, 0.5, 0.3):
                for q in range(12):
                    c = leg(amp * f, p1 + q * np.pi / 6, p2 + q * np.pi / 4)
                    if all(ok(x, y, ax, ay) for (x, y) in c): found = c; break
                if found: break
            pts_ = found or leg(0.0)
        out += pts_
    # round the corners: two Chaikin passes on the interior
    for _ in range(2 if wind else 1):
        if len(out) < 3: break
        sm = [out[0]]
        for (x0, y0), (x1, y1) in zip(out, out[1:]):
            sm.append((0.75 * x0 + 0.25 * x1, 0.75 * y0 + 0.25 * y1))
            sm.append((0.25 * x0 + 0.75 * x1, 0.25 * y0 + 0.75 * y1))
        sm.append(out[-1])
        out = sm
    return out


def paint_roads(d, roads=ROADS, w=3, out=None):
    """Roads as a brush of radius ~w/2 swept along each road's winding centre line.
    Brick ('2') approaches stay straight; climbing roads run straight through their stairs."""
    target = d.paths if out is None else out
    H_, W_ = target.shape
    ok = None
    if getattr(d, 'level', None) is not None:
        lv = d.level
        flat = ndimage.minimum_filter(lv, 5) == ndimage.maximum_filter(lv, 5)    # 2 tiles clear of any level change
        def ok(x, y, ax, ay):
            xi, yi, ai, bi = int(round(x)), int(round(y)), int(round(ax)), int(round(ay))
            if not (0 <= xi < W_ and 0 <= yi < H_): return False
            return bool(flat[yi, xi]) and lv[yi, xi] == lv[min(H_ - 1, bi), min(W_ - 1, ai)]
    for idx, (kind, pts) in enumerate(roads):
        k = int(kind)
        wind = k == 1
        if climbs(pts):
            # climbing roads wind too, straight only through their flights of stairs
            pts = stair_waypoints(pts, getattr(d, 'stair_rows', {}))
        line = road_path(pts, 500 + idx, wind, ok, eager=climbs(pts))
        rng = np.random.default_rng(900 + idx)
        ph = rng.uniform(0, 2 * np.pi)
        for j, (x, y) in enumerate(line):
            # a little width variation along dirt roads
            # brick gate approaches are as wide as the gates (5); dirt roads vary a little
            r = 2.5 if k == 2 else (w / 2) + (0.28 * np.sin(j * 0.045 + ph) if wind else 0.0)
            x0, x1 = int(np.floor(x - r)), int(np.ceil(x + r))
            y0, y1 = int(np.floor(y - r)), int(np.ceil(y + r))
            for yy in range(max(0, y0), min(H_, y1 + 1)):
                for xx in range(max(0, x0), min(W_, x1 + 1)):
                    if (xx + 0.5 - x - 0.5) ** 2 + (yy + 0.5 - y - 0.5) ** 2 <= r * r:
                        target[yy, xx] = max(target[yy, xx], k)
    if out is not None: return
    d.paths[~d.land] = 0
    d.paths[d.water] = 0
    d.paths[d.castle & ~ndimage.binary_erosion(d.castle, iterations=CASTLE_WALL)] = 0   # no road over the wall

if __name__ == '__main__':
    d = Design()
    preview(d, '/tmp/claude-0/-home-claude/86dc628d-a991-50f0-a5a3-7c895ed35f84/scratchpad/design3.png')
    print('land', int(d.land.sum()), 'levels', np.bincount(d.level.ravel()))
