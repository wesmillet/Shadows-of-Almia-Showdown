"""The shape of Almia, third map (The Fan-tasy Tileset), 320 x 224 tiles.

An island in the sea. The Shadow Crystal stands on a terrace in an open plain
at the centre; four lands surround it:
  north-west  snowfields rising to a two-step mountain
  north-east  the autumn wood (red and gold), a ridge along the coast
  south-west  the desert, with mesas and an oasis
  south-east  the green forest, its lake, and the castle in a clearing
The castle is a stepped walled hold (keep, bastion, notched corner) round a
courtyard with the champion's battlefield. Roads cross the plain and run to a
town in each land and to the castle's gates. Every land keeps wide open
ground (meadows, flats, plazas) for battles.

Grids (h, w):
  land    bool   island (beach included)
  beach   bool   sand rim along the coast
  biome   int    BIOME codes below
  level   int    0 lowland, 1 plateau, 2 summit
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
CASTLE_RECTS = [(172, 156, 226, 192), (188, 148, 214, 158), (166, 164, 174, 184)]
CASTLE_CUTS = [(216, 184, 226, 192)]
CASTLE_WALL = 3
CASTLE_CENTER = (199, 172)
CRYSTAL = (160, 112)
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
        # snow mountain: a plateau over the far north-west, a summit on it
        r_snow = ellipse(70, 58, 62, 44) + 0.12 * noise(seed + 6, 8)
        level[(r_snow < 1) & inland & (biome == SNOW)] = 1
        r_peak = ellipse(42, 64, 12, 10) + 0.15 * noise(seed + 7, 6)
        level[(r_peak < 1) & (level == 1)] = 2
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
        paint_roads(self, [r for r in ROADS if (70, 74) not in r[1]], out=roads)
        flat = ndimage.binary_dilation(roads > 0, iterations=5)
        level[flat] = 0
        level = self._clean_levels(level)
        # a straight face where each road climbs a plateau (stairs need one): find where the
        # road's column meets the plateau coming from the south and square the edge off there
        self.stair_rows = {}
        for (sx, y_from) in STAIR_SITES:
            sy = None
            for y in range(y_from, 0, -1):
                if level[y - 1, sx] >= 1 and level[y, sx] == 0: sy = y; break
            if sy is None: continue
            for x in range(sx - 7, sx + 8):
                level[sy:sy + 10, x] = np.minimum(level[sy:sy + 10, x], 0)
                level[sy - 5:sy, x] = np.maximum(level[sy - 5:sy, x], 1)
            self.stair_rows[sx] = sy
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
        for lv in (1, 2):
            m = level >= lv
            m = ndimage.binary_opening(m, structure=np.ones((5, 5)))
            m = ndimage.binary_closing(m, structure=np.ones((5, 5)))
            m = ndimage.binary_fill_holes(m)
            if lv == 2: m &= ndimage.binary_erosion(out >= 1, iterations=6)
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
    'Frostmere': (70, 74, SNOW),
    'Emberwood': (246, 82, AUTUMN),
    'Sunreach': (112, 176, DESERT),
    'Greenhollow': (262, 128, FOREST),
}
# gates in the castle wall: (x, y) of the gap's middle, and whether the gap is in a N/S wall
GATES = {'N': (180, 157, True), 'W': (167, 174, False)}
GATE_W = 5

# (x, y): a road climbing north from row y meets a south-facing plateau edge in column x
STAIR_SITES = [(84, 112)]

ROADS = [
    # the cross over the plain, and on east to the forest town
    ('1', [(120, 112), (262, 112), (262, 128)]),
    ('1', [(160, 84), (160, 166)]),
    # west to the snow town, climbing the plateau (CLIMB: no flattening round this one)
    ('1', [(120, 112), (84, 112)]),
    ('1', [(84, 112), (84, 74), (70, 74)]),
    # north to the coast
    ('1', [(160, 84), (160, 30)]),
    # north-east to the autumn town
    ('1', [(200, 112), (200, 82), (246, 82)]),
    # south-west to the desert town
    ('1', [(160, 166), (136, 166), (136, 179), (124, 179)]),
    # to the castle's north and west gates, brick at the gates
    ('1', [(200, 112), (200, 140), (180, 140), (180, 148)]),
    ('1', [(160, 166), (160, 174), (161, 174)]),
    ('2', [(180, 146), (180, 159)]), ('2', [(160, 174), (169, 174)]),
]


def paint_roads(d, roads=ROADS, w=3, out=None):
    o = (w - 1) // 2
    target = d.paths if out is None else out
    for kind, pts in roads:
        k = int(kind)
        for (ax, ay), (bx, by) in zip(pts, pts[1:]):
            dx, dy = bx - ax, by - ay
            n = max(abs(dx), abs(dy))
            for i in range(n + 1):
                x = ax + (np.sign(dx) * i if dx else 0)
                y = ay + (np.sign(dy) * i if dy else 0)
                target[y - o:y - o + w, x - o:x - o + w] = np.maximum(target[y - o:y - o + w, x - o:x - o + w], k)
    if out is not None: return
    d.paths[~d.land] = 0
    d.paths[d.water] = 0
    d.paths[d.castle & ~ndimage.binary_erosion(d.castle, iterations=CASTLE_WALL)] = 0   # no road over the wall


if __name__ == '__main__':
    d = Design()
    preview(d, '/tmp/claude-0/-home-claude/86dc628d-a991-50f0-a5a3-7c895ed35f84/scratchpad/design3.png')
    print('land', int(d.land.sum()), 'levels', np.bincount(d.level.ravel()))
