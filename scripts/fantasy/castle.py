"""Castle walls by example.

The pack's castle samples build a wall as a raised walkway (castle floor
slabs) with crenellations along every edge and a brick face hanging under
each south-facing edge. The wall tiles come from Atlas_Castle_Building; its
terrain set is empty, so the tiles are learned from the samples instead:
each building tile is filed under its context relative to the walkway mask

  ('in',  8 neighbours)            a walkway cell (rims, corners)
  ('out', 8 neighbours)            a cell next to the walkway (crenels above the north rim)
  ('face', row, left, right)       row 1..4 under a south edge; left/right: the face continues

and a new wall takes, per context, the artist's tiles in proportion.
"""
import collections, random
import numpy as np
import tiled, automap

SAMPLES = [('Farmer Hold', ['Floor'], ['Castle Building 1']),
           ('Bosk Barracks', ['Castle Floor 2'], ['Castle Walls'])]
FACE_ROWS = 4
OFFS = [(-1, 0), (-1, 1), (0, 1), (1, 1), (1, 0), (1, -1), (0, -1), (-1, -1)]
BUILD = 'Atlas_Castle_Building'


def nb(Wp, y, x):
    return tuple(int(Wp[y + 1 + dy, x + 1 + dx]) for dy, dx in OFFS)


def contexts(W):
    """Context key per cell of a walkway mask W (None for cells nothing is drawn on)."""
    h, w = W.shape
    Wp = np.pad(W, 1)
    face = np.zeros((h, w), np.int32)     # face row number (1..FACE_ROWS) under south edges
    for x in range(w):
        for y in range(h):
            if W[y, x] and (y + 1 >= h or not W[y + 1, x]):
                for r in range(1, FACE_ROWS + 1):
                    if y + r < h and not W[y + r, x]: face[y + r, x] = r
                    else: break
    keys = np.full((h, w), None, dtype=object)
    for y in range(h):
        for x in range(w):
            if W[y, x]:
                keys[y, x] = ('in', nb(Wp, y, x))
            elif face[y, x]:
                r = face[y, x]
                left = x > 0 and face[y, x - 1] == r
                right = x + 1 < w and face[y, x + 1] == r
                keys[y, x] = ('face', int(r), bool(left), bool(right))
            else:
                n = nb(Wp, y, x)
                if any(n): keys[y, x] = ('out', n)
    return keys, face


class Walls:
    def __init__(self, seed=5):
        self.table = collections.defaultdict(collections.Counter)
        for name, floors, builds in SAMPLES:
            m = tiled.Map(name)
            W = np.zeros((m.h, m.w), bool)
            for f in floors: W |= m.layer(f) > 0
            B = None
            for b in builds:
                k = automap.keys(m, m.layer(b))
                B = k if B is None else np.where(k != None, k, B)
            keys, _ = contexts(W)
            for (y, x), key in np.ndenumerate(keys):
                if key is None: continue
                t = B[y, x]
                t = None if (t is None or t[0] != BUILD or t[1] == 0) else (t[1], t[2])
                self.table[key][t] += 1
        self.rng = random.Random(seed)
        self.unknown = collections.Counter()

    def pick(self, key):
        c = self.table.get(key)
        if not c:
            self.unknown[key] += 1
            return None
        # the commonest tile; other tiles only when the artist used them often in this context
        # (the samples' wall layers also hold towers, roofs and arches, which must not leak in)
        top = max(c.values())
        items = [(t, n) for t, n in c.items() if n == top or (t is not None and n >= 0.2 * top and n >= 4)]
        tot = sum(n for _, n in items)
        r = self.rng.random() * tot
        for t, n in items:
            r -= n
            if r <= 0: return t
        return items[-1][0]

    def paint(self, W):
        keys, face = contexts(W)
        out = np.full(W.shape, None, dtype=object)
        for (y, x), key in np.ndenumerate(keys):
            if key is None: continue
            t = self.pick(key)
            if t is not None: out[y, x] = (BUILD, t[0], t[1])
        return out, face
