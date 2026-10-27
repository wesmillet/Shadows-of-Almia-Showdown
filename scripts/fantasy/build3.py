#!/usr/bin/env python3
"""Builds the third map (The Fan-tasy Tileset): assets/maps/almia3.json and its images.

  python3 scripts/fantasy/build3.py

Needs the Fan-tasy packs unpacked and merged (FANTASY_DIR, see tiled.py),
numpy, scipy and Pillow.
"""
import os, sys, time, json
import numpy as np
from scipy import ndimage
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import design3 as D
import paint3, cliffs, castle, stamps, content3, towns3, collide, export3, wang, tiled, decor3

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
NAME = 'almia3'
CLIFF_SETS = {
    D.SNOW: ('Tileset_RockSlope_2_Brown_Snow', 'RockSlopes_2_Brown_Snow_Rules'),
    D.DESERT: ('Tileset_RockSlope_2_Gray_Sand', 'RockSlopes_2_Gray_Sand_Rules'),
    D.AUTUMN: ('Tileset_RockSlope_2_Brown', 'RockSlopes_2_Brown_Rules'),
    D.FOREST: ('Tileset_RockSlope_2_Gray', 'RockSlopes_2_Gray_Rules'),
    D.MEADOW: ('Tileset_RockSlope_2_Gray', 'RockSlopes_2_Gray_Rules'),
}


# rows of rock under a south-facing edge, per land (the pack's rules draw 2- and 3-row faces)
SOUTH_ROWS: dict = {}


def log(*a):
    print(f'[{time.strftime("%H:%M:%S")}]', *a, flush=True)


def build_cliffs(d):
    """One automapped layer per level; returns the layers, the blocked body and the stair cells."""
    layers, blocked, stairs = [], np.zeros(d.land.shape, bool), np.zeros(d.land.shape, bool)
    H, Wd_ = d.land.shape
    sets = {}
    for lv in (1, 2, 3):
        up_all = d.level >= lv
        lbl, n = ndimage.label(up_all)
        out = np.full(d.land.shape, None, dtype=object)
        for i in range(1, n + 1):
            comp = lbl == i
            b = int(np.bincount(d.biome[comp]).argmax())
            ts, rules = CLIFF_SETS.get(b, CLIFF_SETS[D.MEADOW])
            if rules not in sets: sets[rules] = cliffs.CliffSet(ts, rules)
            C = sets[rules]
            # The snow mountain's faces are a row taller: big rock walls, tier on tier.
            g, body = cliffs.markers(comp, south_rows=SOUTH_ROWS.get(b, 2))
            # stairs wherever a road runs through the south face (three columns, the road's width)
            road = d.paths > 0
            # only through south faces (the body cells under the plateau's bottom edge)
            under = np.zeros_like(comp); under[1:] |= comp[:-1]; under[2:] |= comp[:-2]
            south = body & under
            if (body & road & ~south).any():
                ys, xs = np.nonzero(body & road & ~south)
                log(f'  level {lv} plateau {i}: a road meets a side or north edge at {list(zip(xs[:3], ys[:3]))}')
            cols = sorted(set(x for (y, x) in zip(*np.nonzero(south & road))))
            runs, cur = [], []
            for x in cols:
                if cur and x != cur[-1] + 1: runs.append(cur); cur = []
                cur.append(x)
            if cur: runs.append(cur)
            for r in runs:
                w = min(3, len(r)); x0 = r[0] + (len(r) - w) // 2
                cliffs.add_stairs_h(g, x0, w)
            # More ways down: a flight in the middle of every straight south face at least six
            # columns long (several along long faces, ~22 columns apart), clear of the road stairs.
            used = [x for r in runs for x in r]
            bottom = {}
            for (y, x) in zip(*np.nonzero(comp)):
                bottom[x] = max(bottom.get(x, -1), y)
            xs = sorted(bottom)
            faces, run = [], []
            for x in xs + [None]:
                if x is not None and run and x == run[-1] + 1 and bottom[x] == bottom[run[-1]]:
                    run.append(x); continue
                if len(run) >= 6 and all(bottom[c] + 2 < H and south[bottom[c] + 1, c] and south[bottom[c] + 2, c] for c in run):
                    faces.append(run)
                run = [x] if x is not None else []
            added = 0
            for f in sorted(faces, key=len, reverse=True):
                k = max(1, (len(f) + 6) // 22)
                for j in range(k):
                    mid = f[0] + (j + 1) * len(f) // (k + 1) - 1
                    mid = max(f[0], min(f[-1] - 2, mid))
                    if any(abs(mid - u) < 10 for u in used): continue
                    cliffs.add_stairs_h(g, mid, 3)
                    used += [mid, mid + 1, mid + 2]
                    added += 1
            # The snow mountain's tiers also get flights through their west, east and north faces
            # (the pack draws side and north stairs too): one in the middle of every straight
            # stretch at least eight cells long, so no tier is a fortress with one way out.
            if b == D.SNOW:
                side = 0
                land_ok = d.land & ~d.water
                for (dx, dy) in ((1, 0), (-1, 0), (0, -1)):
                    # body cells with the plateau on one side and open lower ground on the other
                    plat = np.roll(comp, (dy, dx), (0, 1))                      # the plateau behind the cell
                    out_ = np.roll(land_ok & ~up_all, (-dy, -dx), (0, 1))        # open lower ground ahead
                    cand = (g == cliffs.BODY) & plat & out_
                    # straight runs along the face (vertical for east/west faces, horizontal for north)
                    lbl_, n_ = ndimage.label(cand, structure=np.array([[0, 1, 0], [0, 1, 0], [0, 1, 0]]) if dx else np.array([[0, 0, 0], [1, 1, 1], [0, 0, 0]]))
                    for j in range(1, n_ + 1):
                        ys, xs = np.nonzero(lbl_ == j)
                        L = len(ys)
                        if L < 8: continue
                        k = max(1, (L + 8) // 24)
                        order = np.argsort(ys if dx else xs)
                        for q in range(k):
                            mid = (q + 1) * L // (k + 1)
                            for t in (-1, 0, 1):
                                yy, xx = ys[order[mid + t]], xs[order[mid + t]]
                                g[yy, xx] = cliffs.STAIRS
                        side += k
                if side: log(f'  level {lv} plateau {i}: {side} side flights')
            if not runs and not added:
                log(f'  level {lv} plateau {i}: no straight south face for stairs')
            elif added:
                log(f'  level {lv} plateau {i}: {added} extra flights')
            o = C.run(g)
            nb, miss, mm = C.coverage(g, o)
            if miss: log(f'  level {lv} plateau {i}: {miss} of {nb} slope cells without art')
            out = np.where(o != None, o, out)
            blocked |= (g == cliffs.BODY) & (o != None)        # a slope cell the rules gave no art stays walkable (no invisible walls)
            stairs |= (g == cliffs.STAIRS)
        layers.append(out)
    return layers, blocked, stairs


def flat_spot(d, cx, cy, r=14):
    """The point nearest (cx, cy) whose whole town footprint is one level of dry land."""
    best = None
    for dy in range(-r, r + 1):
        for dx in range(-r, r + 1):
            x, y = cx + dx, cy + dy
            box = (slice(y - 13, y + 11), slice(x - 19, x + 20))
            lv = d.level[box]; land = d.land[box] & ~d.water[box] & ~d.beach[box]
            if lv.size and land.all() and (lv == lv.flat[0]).all():
                dist = dx * dx + dy * dy
                if best is None or dist < best[0]: best = (dist, x, y)
    if best is None:
        log(f'  no flat spot near {cx},{cy}')
        return cx, cy
    return best[1], best[2]


def castle_walls(d):
    """The wall walkway: the castle region's outer CASTLE_WALL tiles, open at the gates."""
    R = d.castle
    W = R & ~ndimage.binary_erosion(R, iterations=D.CASTLE_WALL)
    for (x0, y0, x1, y1) in getattr(D, 'CASTLE_INNER_WALLS', []):
        W[y0:y1, x0:x1] = True
    half = D.GATE_W // 2
    for (gx, gy, horiz) in D.GATES.values():
        if horiz: W[gy - 3:gy + 4, gx - half:gx + half + 1] = False
        # a side gate: the wall above the gap hangs its brick face (FACE_ROWS) down into it, so
        # the gap is cut that much taller and a tower stands on the face (see the towers)
        else: W[gy - half - castle.FACE_ROWS:gy + half + 1, gx - 3:gx + 4] = False
    return W


def main():
    log('design')
    d = D.Design()
    D.paint_roads(d)
    H, Wd = d.land.shape
    log('towns')
    town_objects, npcs, town_foot = [], [], np.zeros(d.land.shape, bool)
    town_area = np.zeros(d.land.shape, bool)
    for i, (name, (tx, ty, b)) in enumerate(D.TOWNS.items()):
        tx, ty = flat_spot(d, tx, ty)
        D.TOWNS[name] = (tx, ty, b)
        plaza, objs, tn, foot = towns3.build_town(name, tx, ty, b, d, seed=40 + i, ok=d.land & ~d.water & ~d.beach & (d.level == d.level[ty, tx]) & (d.paths == 0))
        d.paths[plaza & d.land] = 2
        town_objects += objs; npcs += tn; town_foot |= foot
        town_area |= D.ellipse(tx, ty, 20, 15) < 1
    stack = []
    log('sea, sand, ground')
    sea, sea_cells = paint3.sea_and_sand(d)
    stack.append(('Sand', sea))
    glayers, gcells = paint3.ground(d)
    stack += glayers
    snow, snow_mask = paint3.snow(d)
    stack.append(('Snow', snow))
    stack.append(('Leaves', paint3.leaves(d)))
    stack.append(('Water', paint3.water(d)))
    stack.append(('Road', paint3.roads(d)))

    log('castle')
    W = castle_walls(d)
    walls = castle.Walls()
    F = wang.WangSet('Atlas_Castle_Floor', seed=8)
    court = ndimage.binary_erosion(d.castle, iterations=D.CASTLE_WALL)
    # the courtyard: slab paving round a battlefield of lighter slabs
    pav = np.zeros(W.shape, np.int32)
    bx0, bx1, by0, by1 = 186, 212, 166, 178    # centred on the south gate (x 199) and the east gate (y 172)
    # A planned court: lawn, with an oval plaza round the battlefield (light slabs inside a ring of
    # slabs), and walks of one width (the gates' passages, 7 tiles) running straight from every
    # gate and from the keep's door into the ring. The west wing, the gate yard, is all stone.
    yy_, xx_ = np.mgrid[0:W.shape[0], 0:W.shape[1]]
    ocx, ocy = (bx0 + bx1) / 2, (by0 + by1) / 2
    def oval(rx, ry): return ((xx_ - ocx) / rx) ** 2 + ((yy_ - ocy) / ry) ** 2 < 1
    ring = oval(19, 11)
    pav[ring & court] = F.color('Slab Floor')
    pav[oval(15.5, 8.5)] = F.color('Mid Slab Floor')
    WALK = D.GATE_W + 2
    wh = WALK // 2
    walks = np.zeros(W.shape, bool)
    kx = D.GATES['S'][0]
    walks[146:int(ocy), kx - wh:kx + wh + 1] = True                     # keep door -> plaza
    walks[int(ocy):D.GATES['S'][1] + 6, kx - wh:kx + wh + 1] = True     # plaza -> south gate
    ex, ey, _ = D.GATES['E']
    walks[ey - wh:ey + wh + 1, int(ocx):ex + 5] = True                  # plaza -> east postern
    walks[ey - wh:ey + wh + 1, 156:int(ocx)] = True                      # across the west wing to the plaza (same axis)
    # outside every gate, the same slabs run out to meet the road (no brick stubs of another stone)
    for (gx, gy, horiz) in D.GATES.values():
        if horiz:
            out_up = not d.castle[gy - 4, gx]          # the gap opens to the north (gate yard) or south
            if out_up:
                walks[gy - 6:gy + 1, gx - wh:gx + wh + 1] = True
                walks[gy:ey, gx - wh:gx + wh + 1] = True     # the gate yard's walk down to the cross walk
            else: walks[gy:gy + 10, gx - wh:gx + wh + 1] = True
        else:
            walks[gy - wh:gy + wh + 1, gx:gx + 9] = True
    yard_x1 = 179
    west_wing = court & (xx_ < yard_x1)
    # the west wing: lawns either side of its two walks (no longer all stone)
    pav[walks & d.land] = F.color('Slab Floor')
    pav[oval(15.5, 8.5)] = F.color('Mid Slab Floor')
    half = D.GATE_W // 2
    for (gx, gy, horiz) in D.GATES.values():                    # paved gate passages (wall and face rows)
        if horiz: pav[gy - 1:gy + 6, gx - wh:gx + wh + 1] = F.color('Slab Floor')
        else: pav[gy - wh:gy + wh + 1, gx - 4:gx + 5] = F.color('Slab Floor')   # side gates: the walk's own width
    # the crystal's arena in the middle of the plain: the last two trainers fight it out here,
    # a paved field with the crystal in its centre circle, on a terrace of darker slabs
    cx, cy = D.CRYSTAL
    fx0, fy0, fx1, fy1 = D.FINAL_ARENA
    # an oval: a ring of slabs round a light oval that holds the whole battlefield (its pillars
    # stand on the light oval's rim)
    terrace = (D.ellipse(cx, cy, 17.5, 12) < 1)             # centred on the crystal's tile
    pav[terrace] = F.color('Slab Floor')
    pav[D.ellipse(cx, cy, 14.5, 9.5) < 1] = F.color('Mid Slab Floor')
    d.paths[terrace] = 0
    # one fountain on the lawn of the garden bastion (no paving round it)
    fountains = [(214, 148)]   # centred in the garden wing, clear of its north wall's face
    # under the walls' walkway edges, stone where the court beside them is paved (their edge pixels
    # are see-through, and grass showed through in a thin line)
    under = W & ndimage.binary_dilation(pav > 0, structure=np.ones((3, 3)))
    pav_wall = np.where(under, F.color('Slab Floor'), 0)
    pav[W] = 0
    pav_draw = np.where(under, pav_wall, pav)
    stack.append(('Courtyard', F.paint(pav_draw)))
    # for scripts/mapgen/pave_smooth.py: the paving per tile (0 none, 1 slab, 2 light slab) and
    # where it may be reshaped (court and approaches, not the walls, faces or fountain)
    _fixed = W.copy()
    for (fx, fy) in fountains: _fixed[fy - 1:fy + 7, fx - 1:fx + 7] = True
    os.makedirs(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'out'), exist_ok=True)
    # true ovals (tile units: cx, cy, rx, ry, class) that the stepped tiles stand for
    _ovals = np.array([(ocx + 0.5, ocy + 0.5, 19, 11, 1), (ocx + 0.5, ocy + 0.5, 15.5, 8.5, 2),
                       (cx + 0.5, cy + 0.5, 17.5, 12, 1), (cx + 0.5, cy + 0.5, 14.5, 9.5, 2)], np.float32)
    np.savez_compressed(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'out', f'{NAME}_pave.npz'), pav=pav, fixed=_fixed, ovals=_ovals, walks=walks & d.land)
    fountain_layer = np.full(W.shape, None, dtype=object)
    for (fx, fy) in fountains:
        for L in stamps.tile_stamp('Forest Castle', 37, 54, 43, 60, ['Animations']):
            sub = fountain_layer[fy:fy + 6, fx:fx + 6]
            fountain_layer[fy:fy + 6, fx:fx + 6] = np.where(L != None, L, sub)
    stack.append(('Fountains', fountain_layer))
    log('cliffs')
    cl_layers, cliff_block, stair_cells = build_cliffs(d)
    for i, L in enumerate(cl_layers): stack.append((f'Cliffs {i + 1}', L))
    wl, face = walls.paint(W)
    # The walkway on top of the walls is planked (the pack's barracks do the same), so a wall never
    # reads as one more paved path beside the courtyard's slabs.
    stack.append(('Castle walk', F.paint(W.astype(np.int32) * F.color('Wood Floor'))))
    if walls.unknown: log('  castle contexts without a learned tile:', sum(walls.unknown.values()))
    stack.append(('Castle walls', wl))

    log('objects')
    # where objects may stand: dry land off roads, cliffs, castle and plazas
    occupied = (~d.land) | d.water | (d.paths > 0) | cliff_block | stair_cells | W | (face > 0) | (pav > 0) | d.beach
    occupied |= ndimage.binary_dilation(d.paths > 0, iterations=1)
    occupied |= ndimage.binary_dilation(stair_cells, iterations=2)
    occupied |= town_area
    occupied |= ndimage.binary_dilation(d.castle, iterations=8)    # the castle stands in its own clearing
    # keep the ground before every castle gate clear (no trees or cacti crowding an entrance)
    for (gx, gy, horiz) in D.GATES.values():
        r0, r1 = (gy - 9, gy + 10) if horiz else (gy - 9, gy + 6)
        c0, c1 = (gx - 7, gx + 8) if horiz else (gx - 9, gx + 10)
        occupied[max(0, r0):r1, max(0, c0):c1] = True
    placer = content3.Placer(~occupied)
    objects = list(town_objects)
    blocked_stamps = np.zeros(W.shape, bool)
    # the keep in the castle's north wing, its door on the forecourt
    img, foot = stamps.stamp('keep_red')
    kh, kw = img.shape[0] // 16, img.shape[1] // 16
    kx0, ky1 = D.CASTLE_CENTER[0] - kw // 2 + 1, 151   # on the spur's north wall, its door on the walk's axis (x 199)
    objects.append({'img': img, 'name': 'keep', 'x': kx0 * 16, 'y': ky1 * 16 + 16})
    # a stone Celebi on a plinth in the middle of the fountain's basin
    import statue as _statue
    st = _statue.statue('0251')
    for (fx, fy) in fountains:
        bcx, bcy = (fx + 2.9) * 16, (fy + 3.0) * 16 + 10      # the basin's centre (the stamp is 6x6 tiles)
        objects.append({'img': st, 'name': 'statue_celebi', 'x': int(bcx - (st.shape[1] - 6) / 2), 'y': int(bcy) + 4})   # (+6 wide, +4 tall: its shadow)
    blocked_stamps[ky1 + 1 - kh:ky1 + 1, kx0:kx0 + kw] |= foot
    placer.free[ky1 + 1 - kh:ky1 + 3, kx0 - 1:kx0 + kw + 1] = False
    # towers on the four corners, halfway down the long sides, and either side of each gate.
    # A tower's base lines up with the bottom of the brick face beside it, so no stray face
    # pokes out under it; corner and gate towers cover the wall ends completely.
    timg, tfoot = stamps.stamp('tower_cone')
    th, tw = timg.shape[0] // 16, timg.shape[1] // 16
    # A tower on every outer corner of the castle, squared to the walls the way the first hold's
    # were: left corners overhang one column out, top corners stand on the north wall's inner
    # face, bottom corners on the outer face. Then either side of every gate.
    wl_ = D.CASTLE_WALL
    R = d.castle
    Rp = np.pad(R, 1)
    spots = []
    for (y, x) in zip(*np.nonzero(R)):
        up, dn, lf, rt = not Rp[y, x + 1], not Rp[y + 2, x + 1], not Rp[y + 1, x], not Rp[y + 1, x + 2]
        if (up or dn) and (lf or rt):
            tx = x - 1 if lf else x - tw + 2
            yb = y + wl_ + castle.FACE_ROWS if up else y + 1 + castle.FACE_ROWS
            spots.append((tx, yb))
    half = D.GATE_W // 2
    gate_spots = []
    for (gx, gy, horiz) in D.GATES.values():
        if horiz:
            base = gy + 2 + castle.FACE_ROWS
            gate_spots += [(gx - half - tw, base), (gx + half + 1, base)]
        else:
            # a side gate: one tower, standing on the wall end's face just north of the gap (a
            # tower south of the gap would be drawn over the doorway, towers being tall)
            gate_spots += [(gx - 2, gy - half)]
    # Where two walls meet on the inside of a bend (a concave corner of the outline: three of the
    # four cells round a lattice point are castle), a tower stands on the join, as on a real
    # curtain wall; the wall tiles have no clean picture for that corner.
    for Y in range(1, R.shape[0]):
        for X in range(1, R.shape[1]):
            q = R[Y - 1:Y + 1, X - 1:X + 1]
            if q.sum() != 3: continue
            oy, ox = np.argwhere(~q)[0]                 # the outside quadrant
            tx = X - 1 if ox == 0 else X - tw + 1
            yb = Y + wl_ + castle.FACE_ROWS if oy == 0 else Y + castle.FACE_ROWS
            spots.insert(0, (tx, yb))
    # gate towers win over a corner tower crowding them; no two towers on top of each other
    kept = list(gate_spots)
    for sp in spots:
        if all(abs(sp[0] - k[0]) >= tw or abs(sp[1] - k[1]) >= 9 for k in kept): kept.append(sp)
    spots = kept
    for (tx, yb) in spots:
        objects.append({'img': timg, 'name': 'tower_cone', 'x': tx * 16, 'y': yb * 16})
        blocked_stamps[yb - th:yb, tx:tx + tw] |= tfoot
        placer.free[max(0, yb - th):yb + 1, max(0, tx - 1):tx + tw + 1] = False
    log('courtyard')
    yard = content3.Placer(np.ones(W.shape, bool))
    yard.free = placer.free.copy() | (court & (pav == 0) & (face == 0))
    yard.free &= ~blocked_stamps
    # One kind of tree, planted the way a castle garden is: mirrored pairs about the south gate's
    # axis (x 199): two along the south wall either side of the gate, and a pair framing the
    # fountain in the garden bastion.
    formal = content3.catalogue('Objects_Trees_Castle', r'Tree_Emerald_4')
    import random as _r; rr = _r.Random(3)
    if formal:
        # pairs mirrored about the south walk (x 199): by the south wall, and by the north wall
        for (x, y) in [(188, 185), (210, 185), (183, 162), (214, 162), (160, 182), (171, 182)]:
            if not yard.put(formal[0], x, y, clear=1): log(f'  no room for the courtyard tree at {x},{y}')
    banner = content3.catalogue('Objects_Props_Castle', r'Banner_Large(_\d+)?')
    bench = content3.catalogue('Objects_Props_Castle', r'Bench(_\d+)?')
    lamp = content3.catalogue('Objects_Props_Castle', r'LampPost(_\d+)?')
    for (x, y) in [(bx0 - 3, by0 - 1), (bx1 + 3, by0 - 1), (bx0 - 3, by1 + 1), (bx1 + 3, by1 + 1)]:
        if banner: yard.put(rr.choice(banner), x, y, clear=0, shadow=False)
    for x in range(bx0 + 3, bx1 - 2, 7):
        if bench: yard.put(bench[0], x, by1 + 3, clear=0, shadow=False)
    for (x, y) in [(191, 155), (207, 155), (158, 166), (172, 166)]:
        if lamp: yard.put(lamp[0], x, y, clear=0, shadow=False)
    objects += yard.objects; placer.decals += yard.decals
    placer.free &= yard.free
    placer.free &= ~d.castle          # inside the walls only the planted garden: no wild bushes or rocks
    log('decor')
    n_arena = decor3.arena(placer)
    n_sign, n_lamp, n_flower = decor3.roads(d, placer)
    water_plants = decor3.lakes(d)
    objects += water_plants
    log(f'  arena {n_arena}, signs {n_sign}, lamps {n_lamp}, verge plants {n_flower}, water plants {len(water_plants)}')
    log('woods')
    clearing = (D.noise(91, 9) > 0.8) & np.isin(d.biome, [D.MEADOW, D.FOREST, D.AUTUMN, D.SNOW])
    px, py, prx, pry = D.PLAIN
    open_mask = clearing | (d.biome == D.CASTLE) | (D.ellipse(px, py, prx - 10, pry - 8) < 1)
    open_mask |= D.ellipse(D.CASTLE_CENTER[0], D.CASTLE_CENTER[1], 40, 30) < 1   # the castle's clearing
    n_summit = decor3.summit(placer)
    n_trees = content3.woods(d, placer, open_mask)
    n_bush = content3.scatter(d, placer, content3.BUSHES, 0.014, seed=12)
    n_rock = content3.scatter(d, placer, content3.ROCKS, 0.006, seed=13, clear=1)
    # boulders and ice up the mountain, where the trees give out
    n_rock += content3.scatter(d, placer, content3.ROCKS, 0.012, seed=14, clear=2, where=d.level >= 2)
    log(f'  summit {n_summit}, trees {n_trees}, bushes {n_bush}, rocks {n_rock}')
    objects += placer.objects
    tg, tall = paint3.tall_grass(d, placer.free & ~occupied & ~(d.biome == D.CASTLE))
    stack.insert([n for n, _ in stack].index('Road') + 1, ('Tall grass', tg))

    log('collisions')
    ras = collide.Raster(Wd, H)
    # Small things you walk past rather than round: bushes, verge plants, signs and small rocks
    # are scenery (no collision), so walkways never get plugged by a shrub or a pebble.
    see_through = set()
    for pool in list(content3.BUSHES.values()):
        see_through |= {(k[0], k[1]) for k in pool}
    see_through |= {(k[0], k[1]) for k in content3.catalogue('Objects_Props', r'Plant_.*|Crate_Small_Flowers|TreeLog|TreeStump_.*|Sign_.*')}
    see_through |= {(k[0], k[1]) for k in content3.catalogue('Objects_Props_Snow', r'Sign_.*')}
    for pool in content3.ROCKS.values():
        see_through |= {(k[0], k[1]) for k in pool if max(content3.size(k)) <= 32}
    for o in objects:
        if 'key' in o and (o['key'][0], o['key'][1]) not in see_through: ras.picture(o['key'], o['x'], o['y'])
    blocked = ras.blocked() | blocked_stamps
    for (fx, fy) in fountains:
        blocked[fy + 1:fy + 6, fx:fx + 6] = True
    walk = d.land & ~d.water & ~cliff_block & ~W & ~(face > 0) & ~blocked
    walk |= stair_cells
    lbl, n = ndimage.label(walk)
    reach = lbl == lbl[D.CRYSTAL[1] + 6, D.CRYSTAL[0]]
    log(f'  walkable {int(walk.sum())}, reachable {int(reach.sum())}')

    biome = d.biome.copy()
    biome[d.beach] = D.SHORE
    biome[d.water | ~d.land] = D.WATER
    mm_code = {D.WATER: 'w', D.MEADOW: 'g', D.FOREST: 'f', D.SHORE: 's', D.SNOW: 'n', D.DESERT: 's', D.AUTUMN: 'a', D.CASTLE: 'g'}
    mini = np.vectorize(lambda b: mm_code[int(b)])(biome)
    mini[d.paths > 0] = 'p'
    mini[cliff_block] = 'c'
    mini[W | (face > 0)] = 'k'
    mini[blocked & d.land] = np.where(np.isin(biome[blocked & d.land], [D.SNOW]), 'n', 'f')
    minimap = [''.join(r) for r in mini]

    towns = [{'name': n, 'x': x + 0.5, 'y': y + 0.5} for n, (x, y, b) in D.TOWNS.items()]
    # healers: one per town and one in the castle courtyard; the challenger at the battlefield's north edge
    npcs.append({'role': 'healer', 'x': bx0 - 2.5, 'y': by0 + 1.5, 'town': 'Castle'})
    npcs.append({'role': 'challenger', 'x': (bx0 + bx1 + 1) / 2, 'y': by0 + 1.5, 'town': 'Castle'})
    outposts = [{'x': n['x'], 'y': n['y']} for n in npcs if n['role'] == 'healer']
    # trainer starts (tile coordinates): the reachable road tile nearest each planned point
    # (on open reachable ground, at least 30 tiles from each other)
    open_ground = reach & ~ndimage.binary_dilation(~walk, iterations=1)
    ry, rx = np.nonzero(open_ground)
    spawns = []
    open_ground &= d.biome != D.CASTLE
    ry, rx = np.nonzero(open_ground)
    for (x, y) in [(71, 88), (246, 96), (112, 190), (262, 145), (160, 32), (296, 176), (40, 120), (292, 62)]:
        order = np.argsort((rx - x) ** 2 + (ry - y) ** 2)
        for i in order:
            px, py = int(rx[i]), int(ry[i])
            if all((px - s_['x']) ** 2 + (py - s_['y']) ** 2 >= 30 ** 2 for s_ in spawns):
                spawns.append({'x': px, 'y': py}); break
    log('  starts', [(s_['x'], s_['y']) for s_ in spawns])
    for o in outposts:
        if not reach[int(o['y']), int(o['x'])]: log('  healer off the reachable ground:', o)

    log('export')
    st = [{'kind': 'tiles', 'name': n, 'opacity': 1.0, 'tiles': L} for n, L in stack]
    decals = [x for x in placer.decals if x]
    st.insert(len(st) - 2, {'kind': 'decals', 'name': 'Shadows', 'opacity': 0.25, 'decals': decals})
    data = {'name': NAME, 'cols': Wd, 'rows': H, 'stack': st, 'objects': objects,
            'walkable': walk, 'reachable': reach, 'biome': biome, 'minimap': minimap,
            'stairs': [[int(x), int(y)] for (y, x) in zip(*np.nonzero(stair_cells))],
            'center': {'x': D.CRYSTAL[0] + 0.5, 'y': D.CRYSTAL[1] + 0.5}, 'outposts': outposts, 'spawns': spawns,
            'towns': towns, 'npcs': npcs,
            'arena': {'x0': bx0, 'y0': by0, 'x1': bx1 + 1, 'y1': by1 + 1},
            'finalArena': {'x0': D.FINAL_ARENA[0], 'y0': D.FINAL_ARENA[1], 'x1': D.FINAL_ARENA[2], 'y1': D.FINAL_ARENA[3]},
            'lake': {'x': D.TIDE_LAKE[0] + 0.5, 'y': D.TIDE_LAKE[1] + 0.5, 'rx': D.TIDE_LAKE[2], 'ry': D.TIDE_LAKE[3]},
            'credits': 'The Fan-tasy Tileset (Premium) and its expansions'}
    base = os.path.join(ROOT, 'assets', 'maps', NAME)
    out, ntiles, nobj = export3.export(base, f'maps/{NAME}', data)
    log(f'  atlas tiles {ntiles}, objects {nobj}, json {os.path.getsize(base + ".json") // 1024} KB')
    preview(base, out)


def preview(base, data):
    from PIL import Image
    atlas = np.array(Image.open(base + '_tiles.png').convert('RGBA')).astype(np.float32)
    cols, rows = data['cols'], data['rows']
    img = np.zeros((rows * 16, cols * 16, 4), np.float32)
    ac = data['atlas']['columns']
    sheets = [np.array(Image.open(os.path.join(ROOT, 'assets', s)).convert('RGBA')).astype(np.float32) for s in data['sheets']]
    def blit(a, x, y, op=1.0):
        h, w = a.shape[:2]
        x0, y0 = max(0, x), max(0, y); x1, y1 = min(img.shape[1], x + w), min(img.shape[0], y + h)
        if x1 <= x0 or y1 <= y0: return
        s = a[y0 - y:y1 - y, x0 - x:x1 - x]; al = s[:, :, 3:4] / 255 * op
        img[y0:y1, x0:x1, :3] = img[y0:y1, x0:x1, :3] * (1 - al) + s[:, :, :3] * al
        img[y0:y1, x0:x1, 3:4] = np.maximum(img[y0:y1, x0:x1, 3:4], s[:, :, 3:4])
    for item in data['stack']:
        if item['kind'] == 'tiles':
            flat = []
            r = item['rle']
            for i in range(0, len(r), 2): flat += [r[i]] * r[i + 1]
            a = np.array(flat).reshape(rows, cols)
            for (y, x) in zip(*np.nonzero(a)):
                v = a[y, x] - 1
                blit(atlas[(v // ac) * 16:(v // ac) * 16 + 16, (v % ac) * 16:(v % ac) * 16 + 16], x * 16, y * 16, item['opacity'])
        else:
            for s, sx, sy, w, h, x, y in item['decals']:
                blit(sheets[s][sy:sy + h, sx:sx + w], x, y, item['opacity'])
    for s, sx, sy, w, h, x, y, sort in sorted(data['objects'], key=lambda o: o[7]):
        blit(sheets[s][sy:sy + h, sx:sx + w], x, y)
    im = Image.fromarray(img.clip(0, 255).astype(np.uint8))
    im.resize((cols * 4, rows * 4), Image.LANCZOS).convert('RGB').save(base + '_preview.png')
    log('preview', base + '_preview.png')
    # The in-game minimap's picture (2 px a tile; the HUD draws it smaller, smoothed).
    im.resize((cols * 2, rows * 2), Image.LANCZOS).convert('RGB').save(base + '_minimap.png', optimize=True)
    log('minimap', base + '_minimap.png')


if __name__ == '__main__':
    main()
