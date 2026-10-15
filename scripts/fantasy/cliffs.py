"""Cliffs (rock slopes) the way the artist builds them: paint marker tiles on an
input layer, then run the pack's automapping rules to get the rock art.

Markers (first tiles of every Tileset_RockSlope_2_* set):
  0  E      empty ground (both levels away from the edge)
  1  body   the slope itself: lower-level cells along the plateau edge,
            two rows deep under a south-facing edge, one cell elsewhere
  2  UP     upper-level cells touching the body
  3  stairs a flight of stairs set into the body

One pass per level: the plateau of level n over everything below it.
"""
import numpy as np
from scipy import ndimage
import automap

E, BODY, UP, STAIRS = 0, 1, 2, 3
N8 = np.ones((3, 3), bool)


def markers(upper, south_rows=2):
    """upper: bool grid of the plateau. Returns the marker grid (int) and the body mask."""
    h, w = upper.shape
    lower = ~upper
    body = lower & ndimage.binary_dilation(upper, structure=N8)
    # south faces: the lower cells directly under the plateau's bottom edge, `south_rows` deep
    south = np.zeros_like(upper)
    for k in range(1, south_rows + 1):
        sh = np.zeros_like(upper); sh[k:] = upper[:-k]
        south |= sh & lower
    # only keep the deeper rows where the row above is already part of the face
    face = np.zeros_like(upper)
    sh1 = np.zeros_like(upper); sh1[1:] = upper[:-1]
    face |= sh1 & lower
    for k in range(2, south_rows + 1):
        prev = np.zeros_like(upper); prev[1:] = face[:-1]
        face |= prev & lower & south
    body |= face
    up = upper & ndimage.binary_dilation(body, structure=N8)
    g = np.full((h, w), E, np.int32)
    g[body] = BODY
    g[up] = UP
    return g, body


class CliffSet:
    def __init__(self, tileset, rules):
        self.tileset = tileset
        self.rules = automap.RuleSet(rules)
        self.in_layer = next(iter(self.rules.rules[0].inputs))
        self.out_layer = next(iter(self.rules.rules[0].outputs))

    def run(self, marker_grid):
        h, w = marker_grid.shape
        L = np.full((h, w), None, dtype=object)
        for (y, x), v in np.ndenumerate(marker_grid):
            L[y, x] = (self.tileset, int(v), 0)
        layers = {self.in_layer: L}
        self.rules.apply(layers, w, h)
        out = layers.get(self.out_layer)
        if out is None: out = np.full((h, w), None, dtype=object)
        return out

    def coverage(self, marker_grid, out):
        body = (marker_grid == BODY) | (marker_grid == STAIRS)
        miss = body & (out == None)
        return int(body.sum()), int(miss.sum()), miss


def add_stairs_h(g, x0, width):
    """A flight of stairs through the south face at columns x0..x0+width-1: every body row of
    those columns becomes stairs, and the lower ground just below gets UP (the rules want UP at
    both ends of a flight)."""
    ok = True
    bottoms = []
    for x in range(x0, x0 + width):
        ys = [y for y in range(g.shape[0]) if g[y, x] == BODY]
        if not ys: ok = False; continue
        # the face rows: the lowest run of body cells in this column
        y1 = max(ys); y0 = y1
        while y0 - 1 >= 0 and g[y0 - 1, x] == BODY: y0 -= 1
        for y in range(y0, y1 + 1): g[y, x] = STAIRS
        bottoms.append(y1)
    if bottoms:
        yb = max(bottoms) + 1
        if yb < g.shape[0]:
            for x in range(x0 - 1, x0 + width + 1):
                if g[yb, x] == E: g[yb, x] = UP
    return ok
