"""Terrain of the Shadows of Almia Showdown map, second design.

A terraced amphitheatre opening to the south. Every cliff band runs from
coast to coast (the artist never ends a band in open grass):

  L4  two highland corners (north-west haunted wood, north-east quarry)
  L3  the summit: the lake, and the Shadow Crystal on the prow at the centre
  L2  a terrace ten rows below the summit edge
  L1  the lowlands down to the south coast cliffs

Bands are two rows of cliff face below every drop, horizontal or at 45
degrees inland; the south coast drops one row per two columns. Two rivers
cascade over the bands: one from the summit lake in the west, one from a
spring in the east.
"""
import numpy as np
from scipy import ndimage

W, H = 160, 112
CX, CY = 80, 56


def poly(vs, slope=1):
    """Column -> row along a polyline of flat runs and diagonals that rise or
    fall one row per `slope` columns. Vertices must be compatible."""
    out = {}
    for (xa, ya), (xb, yb) in zip(vs, vs[1:]):
        dx = xb - xa
        assert dx > 0, (xa, xb)
        dy = yb - ya
        assert dy == 0 or abs(dy) * slope == dx, ((xa, ya), (xb, yb), slope)
        for i in range(dx + 1):
            out[xa + i] = ya + (0 if dy == 0 else (1 if dy > 0 else -1) * (i // slope))
    return out


class Design:
    def __init__(self, seed=7):
        self.lev = np.zeros((H, W), np.int8)
        self.river = np.zeros((H, W), bool)
        self.sand = np.zeros((H, W), bool)
        self.lowsand = np.zeros((H, W), bool)   # beach at sea level, below the coast cliffs
        self.falls = []           # (x, lip_row)
        self.ramps = []
        self.bands = {}

    # ------------------------------------------------------------------ coast
    def island(self):
        x0, x1 = 10, 149
        self.x0, self.x1 = x0, x1
        # south coast: last land row; the cliff face sits in the two rows below
        S = poly([(10, 72), (14, 74), (30, 82), (36, 85), (46, 85), (52, 88), (64, 88),
                  (72, 92), (92, 92), (98, 89), (116, 89), (122, 86), (138, 86)], slope=2)
        S.update(poly([(138, 86), (141, 86), (149, 78)]))
        # north coast: first land row. The middle is a cove whose sides are
        # vertical where the highland bands run into it.
        N = poly([(10, 18), (16, 12), (48, 12)])
        N.update(poly([(49, 20), (111, 20)]))
        N.update(poly([(112, 12), (138, 12), (149, 23)]))
        for x in range(x0, x1 + 1):
            self.lev[N[x]:S[x] + 1, x] = 1
        self.N, self.S = N, S

    # ------------------------------------------------------------------ bands
    def terraces(self):
        x0, x1 = self.x0, self.x1
        B4W = poly([(x0, 30), (26, 30), (40, 16), (48, 16)])
        B4E = poly([(112, 16), (120, 16), (134, 30), (x1, 30)])
        B3 = poly([(x0, 42), (26, 42), (30, 46), (38, 46), (42, 42), (54, 42), (70, 58), (90, 58), (106, 42), (110, 42), (114, 46), (120, 46), (124, 42), (x1, 42)])
        B2 = poly([(x0, 52), (50, 52), (66, 68), (94, 68), (110, 52), (136, 52), (147, 63), (x1, 63)])
        for B, lv in ((B2, 2), (B3, 3)):
            for x, b in B.items():
                col = self.lev[:, x]
                m = (col >= 1); m[b + 1:] = False
                col[m] = np.maximum(col[m], lv)
        for B in (B4W, B4E):
            for x, b in B.items():
                col = self.lev[:, x]
                m = (col >= 1); m[b + 1:] = False
                col[m] = 4
        self.bands = dict(B2=B2, B3=B3, B4W=B4W, B4E=B4E)

    # ------------------------------------------------------------------ water
    def course(self, pts):
        """Cells of a river centre line: vertical and horizontal runs only,
        the way the artist draws rivers (the autotile rounds the corners)."""
        cells = [pts[0]]
        for (ax, ay), (bx, by) in zip(pts, pts[1:]):
            assert ax == bx or ay == by, ((ax, ay), (bx, by))
            x, y = ax, ay
            while (x, y) != (bx, by):
                x += (bx > x) - (bx < x); y += (by > y) - (by < y)
                cells.append((x, y))
        return cells

    def paint_river(self, pts, water=1):
        for (x, y) in self.course(pts):
            self.river[y - 1:y + water + 1, x - 1:x + water + 1] = True

    def waters(self):
        B2, B3, B4E = self.bands['B2'], self.bands['B3'], self.bands['B4E']
        yy, xx = np.mgrid[0:H, 0:W]
        # summit lake
        lake = np.zeros((H, W), bool)
        for y, (l, r) in zip(range(26, 37), [(53, 63), (51, 65), (50, 66), (50, 67), (50, 68), (50, 69),
                                             (51, 70), (51, 70), (52, 70), (54, 69), (56, 67)]):
            lake[y, l:r + 1] = True
        self.river |= lake
        # west river: lake -> falls over B3 at x=46 -> falls over B2 at x=40 -> south coast at x=56
        fw3 = (46, B3[46]); fw2 = (46, B2[46]); fws = (58, self.S[58])
        self.paint_river([(52, 34), (52, 37), (46, 37), (46, fw3[1])])
        self.paint_river([(46, fw3[1] + 3), (46, fw2[1])])
        self.paint_river([(46, fw2[1] + 3), (46, 62), (40, 62), (40, 70), (58, 70), (58, fws[1])])
        # east river: spring pond on the summit -> B3 at x=128 -> B2 at x=122 -> south coast at x=126
        pond = np.zeros((H, W), bool)
        for y, (l, r) in zip(range(33, 38), [(126, 132), (124, 135), (124, 135), (124, 135), (126, 133)]):
            pond[y, l:r + 1] = True
        self.river |= pond
        fe3 = (128, B3[128]); fe2 = (128, B2[128]); fes = (126, self.S[126])
        self.paint_river([(128, 37), (128, fe3[1])])
        self.paint_river([(128, fe3[1] + 3), (128, fe2[1])])
        self.paint_river([(128, fe2[1] + 3), (128, 62), (118, 62), (118, 74), (126, 74), (126, fes[1])])
        self.falls = [fw3, fw2, fws, fe3, fe2, fes]
        for (x, lip) in self.falls:
            self.river[lip + 1:lip + 3, x - 4:x + 5] = False  # the face rows
            self.river[lip + 3, x + 1] = False   # the right bank starts a row below the fall

    def beaches(self):
        yy, xx = np.mgrid[0:H, 0:W]
        B2 = self.bands['B2']
        top = np.array([B2.get(x, 0) + 3 for x in range(W)])[None, :]
        b = (self.lev == 1) & (xx >= 138) & (yy >= top)
        self.sand |= b
        # the beach runs on below the south coast cliffs and round to a 45 degree shore
        for x in range(132, 150):
            y1 = 90 - max(0, x - 141) - (1 if x < 133 else 0)
            y0 = (self.S[x] + 3) if x < 138 else self.S[x] + 1
            if x < 132: y0 = max(y0, 90)
            if x < 132: y0 = max(y0, 89)
            self.lowsand[y0:y1 + 1, x] = True

    def north_beach(self):
        for i, y in enumerate(range(20, 23)):
            self.sand[y, 49 + i:111 - i] = True

    def islets(self):
        # grass islets: rectangles with a cliff face below (as the artist draws them)
        for (x, y, w, h) in [(14, 95, 6, 4), (150, 92, 5, 3)]:
            self.lev[y:y + h, x:x + w] = 1
        # sand islets: clipped diamonds with stair-step edges
        for (cx, cy, r) in [(24, 6, 3), (142, 4, 3), (4, 60, 2), (154, 50, 3)]:
            for y in range(cy - r, cy + r + 1):
                for x in range(cx - r - 1, cx + r + 2):
                    if abs(x - cx) * 0.8 + abs(y - cy) <= r and 0 <= y < H and 0 <= x < W:
                        self.lev[y, x] = 1; self.sand[y, x] = True

    # ------------------------------------------------------------------ labels
    def to_labels(self):
        lev = self.lev
        lab = np.where(lev > 0, 'G', 'W').astype('<U1')
        lab[self.sand & (lev > 0)] = 'S'
        lab[self.river & (lev > 0)] = 'R'
        F = np.zeros((H, W), bool)
        self.band_top = np.zeros((H, W), bool)
        for x in range(W):
            for y in range(H - 2):
                if lev[y, x] > 0 and lev[y, x] > lev[y + 1, x] and not self.sand[y, x]:
                    F[y + 1, x] = F[y + 2, x] = True
                    self.band_top[y + 1, x] = True
        lab[F] = 'F'
        lab[self.lowsand & ~F] = 'S'
        for (x0, x1, r1) in self.ramps:
            lab[r1, x0:x1 + 1] = 'M'; lab[r1 + 1, x0:x1 + 1] = 'G'
        for (x, lip) in self.falls:
            lab[lip, x] = 'R'
            lab[lip + 1, x] = 'W'; lab[lip + 2, x] = 'R'
            lab[lip + 1:lip + 3, x - 1] = 'F'; lab[lip + 1:lip + 3, x + 1] = 'F'
        self.F = F
        self.lab = lab
        return lab


def build(seed=7):
    d = Design(seed)
    d.island(); d.terraces(); d.waters(); d.beaches(); d.islets()
    d.to_labels()
    return d


if __name__ == '__main__':
    d = build()
    from PIL import Image
    col = {'W': (40, 110, 200), 'G': (90, 180, 80), 'S': (230, 210, 130), 'F': (160, 90, 60), 'R': (90, 220, 230), 'M': (200, 200, 0)}
    img = np.array([[col[c] for c in row] for row in d.lab], np.uint8)
    shade = (d.lev * 18).astype(np.uint8)
    img = np.clip(img.astype(int) - (4 - d.lev[..., None]) * 10 * (d.lev[..., None] > 0), 0, 255).astype(np.uint8)
    Image.fromarray(img).resize((W * 5, H * 5), Image.NEAREST).save('terrain_labels.png')
