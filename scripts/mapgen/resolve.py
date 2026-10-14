"""Tile-by-example resolution against the Sunnyside demo room.

A semantic map (land labels W/G/S/F/R/M, plus a path-type grid) is turned into
tiles by finding demo cells with the same neighbourhood and copying what the
artist placed there. Keys back off from large to small windows; every backoff
is recorded so shapes the demo never shows can be fixed at the source.
"""
import collections, random, numpy as np, sunny, labels

OOB = 'W'

def win(lab, x, y, offs):
    h, w = lab.shape
    return ''.join(lab[y+dy, x+dx] if 0 <= y+dy < h and 0 <= x+dx < w else OOB for dx, dy in offs)

N3 = [(dx, dy) for dy in (-1, 0, 1) for dx in (-1, 0, 1)]
N3V = N3 + [(0, -2), (0, 2), (-1, 2), (1, 2), (-1, -2), (1, -2)]
PLUS = [(0, 0), (-1, 0), (1, 0), (0, -1), (0, 1)]
SH = N3 + [(0, -2), (0, -3), (-1, -2), (1, -2), (-1, -3), (1, -3)]
LAND_KEYS = [('n3v', N3V), ('n3', N3), ('plus', PLUS)]
SHADOW_KEYS = [('sh', SH), ('n3', N3)]

GRASS_FILL = {193}
GRASS_VAR = {129, 130, 131, 132, 133, 134}
SAND_FILL = {69, 71, 72, 73}
FACE_CHECK = {203, 267}


def mirror_flags(f):
    """Flags of a tile after mirroring the whole picture left-right.
    Tiles are mirrored/flipped first, then rotated 90 degrees clockwise."""
    return f ^ (2 if f & 4 else 1)


class Learner:
    def __init__(self):
        L = sunny.layers()
        self.L = L
        self.lab = labels.demo_land_labels()
        self.plab = labels.demo_path_labels()
        h, w = self.lab.shape
        self.tables = {}
        def learn(name, layer, keys, labgrid, extra=None):
            tabs = {}
            mirrored = labgrid[:, ::-1]
            for kname, offs in keys:
                t = collections.defaultdict(collections.Counter)
                for y in range(h):
                    for x in range(w):
                        k = win(labgrid, x, y, offs) + (extra(x, y) if extra else '')
                        t[k][(layer['tiles'][y][x], layer['flags'][y][x])] += 1
                # the artist mirrors terrain freely: learn the mirror image too, at half weight
                for y in range(h):
                    for x in range(w):
                        k = win(mirrored, x, y, offs)
                        tt, ff = layer['tiles'][y][w - 1 - x], layer['flags'][y][w - 1 - x]
                        if tt: t[k][(tt, mirror_flags(ff))] += 0.5
                tabs[kname] = t
            self.tables[name] = tabs
        learn('land', L['land'], LAND_KEYS, self.lab)
        learn('shadows', L['shadows'], SHADOW_KEYS, np.where(self.lab == 'S', 'G', self.lab))
        # paths: per type, binary mask windows
        self.path_tabs = {}
        for ptype in '123':
            m = np.where(self.plab == ptype, 'P', '.')
            t = collections.defaultdict(collections.Counter)
            t2 = collections.defaultdict(collections.Counter)
            mm = m[:, ::-1]
            for y in range(h):
                for x in range(w):
                    if mm[y, x] == 'P':
                        tt, ff = L['paths']['tiles'][y][w - 1 - x], L['paths']['flags'][y][w - 1 - x]
                        if tt:
                            t[win(mm, x, y, N3)][(tt, mirror_flags(ff))] += 0.5
                            t2[win(mm, x, y, PLUS)][(tt, mirror_flags(ff))] += 0.5
            for y in range(h):
                for x in range(w):
                    if m[y, x] != 'P':
                        continue
                    t[win(m, x, y, N3)][(L['paths']['tiles'][y][x], L['paths']['flags'][y][x])] += 1
                    t2[win(m, x, y, PLUS)][(L['paths']['tiles'][y][x], L['paths']['flags'][y][x])] += 1
            self.path_tabs[ptype] = [('n3', t, N3), ('plus', t2, PLUS)]
        # face checkerboard parity: which of 203 / 267 sits on even (x+y)
        par = collections.Counter()
        for y in range(h):
            for x in range(w):
                t = L['land']['tiles'][y][x]
                if t in FACE_CHECK:
                    par[(t, L['land']['flags'][y][x], (x + y) % 2)] += 1
        self.face_parity = par
        # allowed adjacencies
        self.allowed = {}
        for name in ('land', 'paths', 'shadows'):
            l = L[name]; s = set()
            for y in range(h):
                for x in range(w):
                    a = (l['tiles'][y][x], l['flags'][y][x])
                    if x + 1 < w: s.add(('h', a, (l['tiles'][y][x+1], l['flags'][y][x+1])))
                    if y + 1 < h: s.add(('v', a, (l['tiles'][y+1][x], l['flags'][y+1][x])))
            self.allowed[name] = s


def pick(counter, rng, mode):
    items = counter.most_common()
    if mode == 'mode':
        return items[0][0]
    tot = sum(n for _, n in items); r = rng.random() * tot
    for k, n in items:
        r -= n
        if r <= 0:
            return k
    return items[0][0]


DEFAULT = {'G': (193, 0), 'S': (69, 0), 'F': (203, 0), 'R': (470, 0), 'M': (271, 0), 'W': (0, 0)}
KEY_W = {'n3v': 6.0, 'n3': 2.5, 'plus': 1.0, 'sh': 6.0}

def candidates(tables, keyspecs, lab, x, y):
    """Weighted candidate tiles from every key size."""
    c = collections.Counter(); best = None
    for kname, offs in keyspecs:
        t = tables[kname].get(win(lab, x, y, offs))
        if t:
            tot = sum(t.values())
            for k, n in t.items():
                c[k] += KEY_W.get(kname, 1.0) * n / tot
            if best is None: best = kname
    return c, best

def resolve(lab, paths, L, seed=1, sweeps=3, only_paths=False):
    """lab: HxW land labels; paths: HxW of '1','2','3','.'.
    Constraint-aware: candidates come from every key size; each sweep prefers the
    candidate whose pairs with its four neighbours the artist actually used."""
    rng = random.Random(seed)
    h, w = lab.shape
    if not hasattr(L, 'allowed2'): L.allowed2 = build_allowed(L)
    out = {n: (np.zeros((h, w), np.int32), np.zeros((h, w), np.int32)) for n in ('land', 'shadows', 'paths')}
    report = collections.Counter(); misses = []
    cand = {'land': {}, 'shadows': {}, 'paths': {}}
    lab_sh = np.where(lab == 'S', 'G', lab)
    for y in range(h if not only_paths else 0):
        for x in range(w):
            c, best = candidates(L.tables['land'], LAND_KEYS, lab, x, y)
            cand['land'][(x, y)] = c; report['land:' + str(best)] += 1
            if best != 'n3v': misses.append(('land', best or 'none', x, y))
            # terrain shadows only fall from cliffs: require a face above or beside
            if 'F' in win(lab, x, y, SH):
                c, best = candidates(L.tables['shadows'], SHADOW_KEYS, lab_sh, x, y)
                cand['shadows'][(x, y)] = c
            p = paths[y, x]
            if p != '.':
                m = np.where(paths == p, 'P', '.') if not hasattr(resolve, '_pm') else None
    # paths: per-type masks
    for p in '123':
        m = np.where(paths == p, 'P', '.')
        ys, xs = np.where(m == 'P')
        for y, x in zip(ys, xs):
            c = collections.Counter(); best = None
            for kname, tab, offs in L.path_tabs[p]:
                t = tab.get(win(m, x, y, offs))
                if t:
                    tot = sum(t.values())
                    for k, n in t.items(): c[k] += (6.0 if kname == 'n3' else 1.0) * n / tot
                    best = best or kname
            cand['paths'][(x, y)] = c; report['path:' + str(best)] += 1
            if best != 'n3': misses.append(('path', best or 'none', x, y))
    def ok(name, a, b, d):
        return (d, cls(*a), cls(*b)) in L.allowed2[name]
    for name in ('land', 'shadows', 'paths'):
        T, Fl = out[name]; A = cand[name]
        def fits(x, y, t):
            s = 0
            for dx, dy, d, first in ((-1, 0, 'h', False), (1, 0, 'h', True), (0, -1, 'v', False), (0, 1, 'v', True)):
                xx, yy = x + dx, y + dy
                if not (0 <= xx < w and 0 <= yy < h): continue
                nb = (int(T[yy, xx]), int(Fl[yy, xx]))
                if nb == (0, 0) and (xx, yy) not in A and name != 'land': continue
                pair = (t, nb) if first else (nb, t)
                s += 1 if ok(name, pair[0], pair[1], d) else 0
            return s
        for (x, y), c in A.items():
            if 264 in [k[0] for k in c]:
                for k in [k for k in c if k[0] == 264]: del c[k]
            if not c and name == 'land':
                c[DEFAULT.get(lab[y, x], (0, 0))] = 1.0
        for sweep in range(sweeps):
            for (x, y), c in A.items():
                if not c: continue
                if sweep == 0:
                    t = c.most_common(1)[0][0]
                else:
                    t = max(c, key=lambda k: (fits(x, y, k), c[k]))
                T[y, x], Fl[y, x] = t
    # variety on fills, by the demo's own frequencies
    T, Fl = out['land']
    for y in range(h):
        for x in range(w):
            t = int(T[y, x])
            if t in GRASS_FILL or t in GRASS_VAR:
                if rng.random() < 0.13: T[y, x] = rng.choice(sorted(GRASS_VAR)); Fl[y, x] = rng.randrange(8)
                else: T[y, x], Fl[y, x] = 193, 0
            elif t in SAND_FILL:
                T[y, x], Fl[y, x] = (69, 0) if rng.random() < 0.8 else (rng.choice([71, 72, 73]), rng.randrange(8))
            elif t in FACE_CHECK:
                T[y, x], Fl[y, x] = ((267, 4) if (x + y) % 2 == 0 else (203, 0))
    T, Fl = out['shadows']
    T[T == 264] = 0
    T, Fl = out['paths']
    for y in range(h):
        for x in range(w):
            if int(T[y, x]) in (449, 457, 458, 459, 521, 522):
                if rng.random() < 0.25: T[y, x] = rng.choice([457, 458, 459, 521, 522]); Fl[y, x] = rng.choice([0, 1, 2, 3])
                else: T[y, x], Fl[y, x] = 449, 0
    return out, report, misses


ANIM_EQ = {}
for a in sunny.ANIMS:
    for fr in a['frames']:
        ANIM_EQ[fr] = a['frames'][0]
def cls(t, f):
    t = ANIM_EQ.get(t, t)
    if t in GRASS_FILL or t in GRASS_VAR: return ('grass',)
    if t in SAND_FILL: return ('sand',)
    if t in FACE_CHECK: return ('face',)
    if t in (449, 457, 458, 459, 521, 522): return ('dirt1',)
    if t in (460, 468, 469, 532, 533): return ('dirt2',)
    if t in (482, 490, 491, 554, 555): return ('dirt3',)
    if t == 264: return (0, 0)
    return (t, f)

def build_allowed(L):
    out = {}
    for name in ('land', 'paths', 'shadows'):
        l = L.L[name]; s = set(); h = len(l['tiles']); w = len(l['tiles'][0])
        T = l['tiles']; F = l['flags']
        m = lambda t, f: cls(t, mirror_flags(f) if t else f)
        for y in range(h):
            for x in range(w):
                a = cls(T[y][x], F[y][x])
                if x + 1 < w:
                    s.add(('h', a, cls(T[y][x+1], F[y][x+1])))
                    s.add(('h', m(T[y][x+1], F[y][x+1]), m(T[y][x], F[y][x])))
                if y + 1 < h:
                    s.add(('v', a, cls(T[y+1][x], F[y+1][x])))
                    s.add(('v', m(T[y][x], F[y][x]), m(T[y+1][x], F[y+1][x])))
        out[name] = s
    return out

def validate(out, L):
    bad = collections.Counter(); where = []
    for name in ('land', 'paths', 'shadows'):
        T, Fl = out[name]; h, w = T.shape
        if not hasattr(L, 'allowed2'): L.allowed2 = build_allowed(L)
        A = L.allowed2[name]
        for y in range(h):
            for x in range(w):
                a = cls(int(T[y, x]), int(Fl[y, x]))
                if x + 1 < w:
                    b = cls(int(T[y, x+1]), int(Fl[y, x+1]))
                    if a != (0, 0) or b != (0, 0):
                        if ('h', a, b) not in A:
                            bad[(name, 'h', a, b)] += 1; where.append((name, x, y, 'h'))
                if y + 1 < h:
                    b = cls(int(T[y+1, x]), int(Fl[y+1, x]))
                    if a != (0, 0) or b != (0, 0):
                        if ('v', a, b) not in A:
                            bad[(name, 'v', a, b)] += 1; where.append((name, x, y, 'v'))
    return bad, where


def _edge(t, f, side):
    a = sunny.tile(t, f)
    return {'l': a[:, 0], 'r': a[:, -1], 't': a[0, :], 'b': a[-1, :]}[side]

def seam(a, b, d):
    """Mean colour step across the shared edge of two tiles, opaque pixels only."""
    if a == (0, 0) or b == (0, 0): return None
    if d == 'h': ea, eb = _edge(*a, 'r'), _edge(*b, 'l')
    else: ea, eb = _edge(*a, 'b'), _edge(*b, 't')
    m = (ea[:, 3] > 200) & (eb[:, 3] > 200)
    if m.sum() < 4: return None
    return float(np.abs(ea[m, :3].astype(int) - eb[m, :3].astype(int)).mean())

def real_seams(out, L, thresh=38.0):
    """Violations whose shared edge also shows a visible colour break."""
    bad, where = validate(out, L)
    keep = []
    for (name, x, y, d) in where:
        T, F = out[name]
        a = (int(T[y, x]), int(F[y, x]))
        b = (int(T[y, x+1]), int(F[y, x+1])) if d == 'h' else (int(T[y+1, x]), int(F[y+1, x]))
        s = seam(a, b, d)
        if s is None:
            # transparent edge: a hole or a cut-off only matters on the land layer
            if name == 'land' and (a == (0, 0)) != (b == (0, 0)): keep.append((name, x, y, d, a, b, -1))
            continue
        if s > thresh: keep.append((name, x, y, d, a, b, round(s, 1)))
    return keep


def vocab(L, name='land'):
    """Every (tile, flags) the artist used on a layer, with mirror images."""
    l = L.L[name]; s = set()
    for row_t, row_f in zip(l['tiles'], l['flags']):
        for t, f in zip(row_t, row_f):
            if t and t != 264:
                s.add((t, f)); s.add((t, mirror_flags(f)))
    return s


def repair(out, L, lab, rounds=3, name='land'):
    """Local search: at each cell on a disallowed pair, try every tile of the
    same semantic label and keep the one most of whose four neighbour pairs
    the artist used. Only strict improvements are accepted."""
    import labels as _labels
    if not hasattr(L, 'allowed2'): L.allowed2 = build_allowed(L)
    A = L.allowed2[name]
    if not hasattr(L, '_vocab_by_label'):
        byl = collections.defaultdict(list)
        for (t, f) in vocab(L, name):
            byl[_labels.land_label(t)].append((t, f))
        L._vocab_by_label = byl
    T, Fl = out[name]; h, w = T.shape
    def score(x, y, cand):
        s = 0
        for dx, dy, d, first in ((-1, 0, 'h', False), (1, 0, 'h', True), (0, -1, 'v', False), (0, 1, 'v', True)):
            xx, yy = x + dx, y + dy
            if not (0 <= xx < w and 0 <= yy < h): s += 1; continue
            nb = cls(int(T[yy, xx]), int(Fl[yy, xx])); me = cls(*cand)
            if me == (0, 0) and nb == (0, 0): s += 1; continue
            s += ((d, me, nb) if first else (d, nb, me)) in A
        return s
    fixed = 0
    for _ in range(rounds):
        bad, where = validate(out, L)
        cells = set()
        for (n, x, y, d) in where:
            if n != name: continue
            cells.add((x, y)); cells.add((x + 1, y) if d == 'h' else (x, y + 1))
        changed = False
        for (x, y) in sorted(cells):
            cur = (int(T[y, x]), int(Fl[y, x])); s0 = score(x, y, cur)
            if s0 == 4: continue
            best, bs = cur, s0
            for cand in L._vocab_by_label.get(lab[y, x], []):
                sc = score(x, y, cand)
                if sc > bs: best, bs = cand, sc
            if best != cur:
                T[y, x], Fl[y, x] = best; changed = True; fixed += 1
        if not changed: break
    return fixed
