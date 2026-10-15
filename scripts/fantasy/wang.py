"""Terrain painting with the artist's wang sets (Tiled terrain sets).

A wang tile's id lists the terrain at its 8 sides and corners in the order
top, top-right, right, bottom-right, bottom, bottom-left, left, top-left.
Neighbouring tiles share those points, so a painting is a lattice V of size
(2h+1, 2w+1): tile (y, x) reads V[2y + dy, 2x + dx] around its centre
(2y+1, 2x+1).

`paint(cells)` follows Tiled's terrain brush: a painted cell sets its edges and
corners to its colour; points where painted colours disagree keep the colour
with the higher priority; a corner keeps a colour only if all four edges
around it have it (the 47-blob convention these sets are drawn for). Each
tile then takes a random tile with exactly its pattern (weighted by the tile
probabilities), or the nearest pattern the set has.
"""
import random
import numpy as np
import tiled

ORDER = [(-1, 0), (-1, 1), (0, 1), (1, 1), (1, 0), (1, -1), (0, -1), (-1, -1)]   # (dy, dx) per wangid slot


class WangSet:
    def __init__(self, tileset_name, index=0, seed=0):
        self.ts = tiled.tileset(tileset_name)
        self.name = tileset_name
        w = self.ts.wangsets[index]
        self.colors = w['colors']
        self.by = {}
        for tid, wid in w['tiles']:
            p = self.ts.tiles.get(tid).prob if tid in self.ts.tiles else 1.0
            self.by.setdefault(tuple(wid), []).append((tid, p))
        self.patterns = list(self.by)
        self.rng = random.Random(seed)
        self.misses = 0
        # For two-colour patterns: which colour fills a corner whose two edges are the other one
        # (the background of that pair; the foreground needs both edges to reach a corner).
        bg = {}
        for pat in self.patterns:
            for i in (1, 3, 5, 7):
                a, b = pat[i - 1], pat[(i + 1) % 8]
                c = pat[i]
                if a and a == b and c and c != a:
                    key = frozenset((a, c))
                    bg.setdefault(key, {}).setdefault(c, 0)
                    bg[key][c] += 1
        self.pair_bg = {k: max(v, key=v.get) for k, v in bg.items()}

    def color(self, name):
        return self.colors.index(name) + 1

    def pick(self, pat):
        c = self.by.get(pat)
        if c is None:
            self.misses += 1
            best = None; bd = 1e9
            for q in self.patterns:
                d = sum((2 if i % 2 == 0 else 1) for i in range(8) if q[i] != pat[i])
                if d < bd: bd, best = d, q
            if best is None or bd > 6: return None
            c = self.by[best]
        tot = sum(p for _, p in c)
        r = self.rng.random() * tot
        for tid, p in c:
            r -= p
            if r <= 0: return tid
        return c[-1][0]

    def lattice(self, cells, priority=None, background=0):
        """cells: (h, w) int colours (0 = unpainted). Returns V. Corners whose four edges disagree
        take `background` (the colour the foreground is drawn over in two-colour sets)."""
        h, w = cells.shape
        # pad by repeating the border so points on the map edge follow the cell inside
        P = np.pad(cells, 1, mode='edge')
        V = np.full((2 * h + 1, 2 * w + 1), background, np.int32)
        V[1::2, 1::2] = cells
        def mix(*cs):
            """The value of a point shared by cells of colours cs."""
            s = set(int(c) for c in cs)
            if len(s) == 1: return s.pop()
            if 0 in s: return background
            if len(s) == 2:
                b = self.pair_bg.get(frozenset(s))
                if b is not None: return b
            return background if background else min(s, key=lambda c: (priority or {}).get(c, c))
        L = P[1:-1, :-1]; Rr = P[1:-1, 1:]
        V[1::2, 0::2] = np.where(L == Rr, L, background)
        T = P[:-1, 1:-1]; B = P[1:, 1:-1]
        V[0::2, 1::2] = np.where(T == B, T, background)
        a, b, c, d = P[:-1, :-1], P[:-1, 1:], P[1:, :-1], P[1:, 1:]
        V[0::2, 0::2] = np.where((a == b) & (a == c) & (a == d), a, background)
        # points between different colours: the pair's background (needs the pair to exist)
        for (y, x) in zip(*np.nonzero(L != Rr)): V[2 * y + 1, 2 * x] = mix(L[y, x], Rr[y, x])
        for (y, x) in zip(*np.nonzero(T != B)): V[2 * y, 2 * x + 1] = mix(T[y, x], B[y, x])
        ne = ~((a == b) & (a == c) & (a == d))
        for (y, x) in zip(*np.nonzero(ne)): V[2 * y, 2 * x] = mix(a[y, x], b[y, x], c[y, x], d[y, x])
        return V

    def tiles_from(self, V, mask=None, fill=0):
        """Tile keys for every cell from lattice V; `fill` replaces 0 (sets with an explicit 'Empty' colour)."""
        h, w = (V.shape[0] - 1) // 2, (V.shape[1] - 1) // 2
        out = np.full((h, w), None, dtype=object)
        for y in range(h):
            for x in range(w):
                if mask is not None and not mask[y, x]: continue
                cy, cx = 2 * y + 1, 2 * x + 1
                pat = tuple(int(V[cy + dy, cx + dx]) or fill for dy, dx in ORDER)
                if not any(v and v != fill for v in pat) and fill == 0: continue
                if all(v == fill for v in pat): continue
                tid = self.pick(pat)
                if tid is not None: out[y, x] = (self.name, tid, 0)
        return out

    def paint(self, cells, priority=None, fill=0, background=0):
        return self.tiles_from(self.lattice(cells, priority, background), fill=fill)
