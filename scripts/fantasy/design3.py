"""The shape of Almia, third map (The Fan-tasy Tileset), 320 x 224 tiles.

An island in the sea. The Shadow Crystal's castle stands at the centre; four
lands surround it:
  north-west  snowfields rising to a two-step mountain
  north-east  the autumn wood (red and gold), a ridge along the coast
  south-west  the desert, with mesas and an oasis
  south-east  the green forest and its lake
Roads leave the castle's four gates for a town in each land. Every land keeps
wide open ground (meadows, flats, plazas) for battles.

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

# the castle ring (outer edge of the wall walkway), courtyard inside
CASTLE_RING = dict(x0=110, y0=68, x1=210, y1=148, wall=3)
CRYSTAL = (160, 112)


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
        c = CASTLE_RING
        green = ellipse(CX, CY, (c['x1'] - c['x0']) / 2 + 20, (c['y1'] - c['y0']) / 2 + 16) + 0.08 * noise(seed + 4, 6) < 1
        biome[green] = MEADOW
        biome[c['y0']:c['y1'], c['x0']:c['x1']] = CASTLE        # the courtyard and its walls
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
        # forest hill
        r_hill = ellipse(270, 168, 22, 14) + 0.12 * noise(seed + 11, 6)
        level[(r_hill < 1) & inland & (biome == FOREST)] = 1
        # the castle green stays level, with room for the ring road
        c = CASTLE_RING
        keep_flat = ellipse(CX, CY, (c['x1'] - c['x0']) / 2 + 22, (c['y1'] - c['y0']) / 2 + 20) < 1
        level[keep_flat] = 0
        level[52:165, 93:228] = 0          # the ring road and a margin outside it
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
        lake = ellipse(226, 170, 18, 11) + 0.15 * noise(seed + 12, 4) < 1
        water |= lake
        oasis = ellipse(64, 182, 7, 5) + 0.15 * noise(seed + 13, 3) < 1
        water |= oasis
        frozen = ellipse(50, 106, 8, 5) + 0.15 * noise(seed + 14, 3) < 1
        water |= frozen
        self.lake, self.oasis, self.frozen = lake, oasis, frozen
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
    c = CASTLE_RING
    img[c['y0']:c['y1'], c['x0']:c['x1']] = (img[c['y0']:c['y1'], c['x0']:c['x1']] * 0.6 + np.array([180, 180, 180]) * 0.4)
    Image.fromarray(img.clip(0, 255).astype(np.uint8)).resize((W * 3, H * 3), Image.NEAREST).save(path)


if __name__ == '__main__':
    d = Design()
    preview(d, '/tmp/claude-0/-home-claude/86dc628d-a991-50f0-a5a3-7c895ed35f84/scratchpad/design3.png')
    print('land', int(d.land.sum()), 'levels', np.bincount(d.level.ravel()))


# towns: (name, centre x, centre y, biome)
TOWNS = {
    'Frostmere': (70, 74, SNOW),
    'Emberwood': (246, 82, AUTUMN),
    'Sunreach': (112, 176, DESERT),
    'Greenhollow': (262, 128, FOREST),
}
# gates in the castle ring: (x, y) of the gap's middle, and whether the gap is in a N/S wall
GATES = {'N': (160, 69, True), 'S': (160, 146, True), 'W': (111, 108, False), 'E': (208, 108, False)}
GATE_W = 5

# (x, y): a road climbing north from row y meets a south-facing plateau edge in column x
STAIR_SITES = [(84, 108)]

ROADS = [
    # the ring road round the castle green
    ('1', [(100, 58), (220, 58), (220, 158), (100, 158), (100, 58)]),
    # west to the snow town, climbing the plateau
    ('1', [(100, 108), (84, 108), (84, 74), (70, 74)]),
    # north to the coast; the autumn town off the ring's north-east
    ('1', [(160, 58), (160, 30)]),
    ('1', [(220, 82), (246, 82)]),
    # east to the forest town
    ('1', [(220, 108), (262, 108), (262, 128)]),
    # south to the desert town and the lake
    ('1', [(160, 158), (160, 166), (136, 166), (136, 179), (124, 179)]),
    ('1', [(160, 166), (226, 166)]),
    # gate approaches in brick
    ('2', [(160, 58), (160, 69)]), ('2', [(160, 146), (160, 158)]),
    ('2', [(100, 108), (111, 108)]), ('2', [(208, 108), (220, 108)]),
]


def paint_roads(d, roads=ROADS, w=3):
    o = (w - 1) // 2
    for kind, pts in roads:
        k = int(kind)
        for (ax, ay), (bx, by) in zip(pts, pts[1:]):
            dx, dy = bx - ax, by - ay
            n = max(abs(dx), abs(dy))
            for i in range(n + 1):
                x = ax + (np.sign(dx) * i if dx else 0)
                y = ay + (np.sign(dy) * i if dy else 0)
                d.paths[y - o:y - o + w, x - o:x - o + w] = np.maximum(d.paths[y - o:y - o + w, x - o:x - o + w], k)
    d.paths[~d.land] = 0
    d.paths[d.water] = 0
