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
    D.SNOW: ('Tileset_RockSlope_2_Ice', 'RockSlopes_2_Ice_Rules'),
    D.DESERT: ('Tileset_RockSlope_2_Gray_Sand', 'RockSlopes_2_Gray_Sand_Rules'),
    D.AUTUMN: ('Tileset_RockSlope_2_Brown', 'RockSlopes_2_Brown_Rules'),
    D.FOREST: ('Tileset_RockSlope_2_Gray', 'RockSlopes_2_Gray_Rules'),
    D.MEADOW: ('Tileset_RockSlope_2_Gray', 'RockSlopes_2_Gray_Rules'),
}


def log(*a):
    print(f'[{time.strftime("%H:%M:%S")}]', *a, flush=True)


def build_cliffs(d):
    """One automapped layer per level; returns the layers, the blocked body and the stair cells."""
    layers, blocked, stairs = [], np.zeros(d.land.shape, bool), np.zeros(d.land.shape, bool)
    H = d.land.shape[0]
    sets = {}
    for lv in (1, 2):
        up_all = d.level >= lv
        lbl, n = ndimage.label(up_all)
        out = np.full(d.land.shape, None, dtype=object)
        for i in range(1, n + 1):
            comp = lbl == i
            b = int(np.bincount(d.biome[comp]).argmax())
            ts, rules = CLIFF_SETS.get(b, CLIFF_SETS[D.MEADOW])
            if rules not in sets: sets[rules] = cliffs.CliffSet(ts, rules)
            C = sets[rules]
            g, body = cliffs.markers(comp)
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
    half = D.GATE_W // 2
    for (gx, gy, horiz) in D.GATES.values():
        if horiz: W[gy - 3:gy + 4, gx - half:gx + half + 1] = False
        else: W[gy - half:gy + half + 1, gx - 3:gx + 4] = False
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
    bx0, bx1, by0, by1 = 186, 211, 166, 179
    pav[by0 - 3:by1 + 4, bx0 - 4:bx1 + 4] = F.color('Slab Floor')
    pav[by0:by1 + 1, bx0:bx1 + 1] = F.color('Mid Slab Floor')
    pav[157:162, 192:207] = F.color('Slab Floor')               # the keep's forecourt
    half = D.GATE_W // 2
    for (gx, gy, horiz) in D.GATES.values():                    # paved gate passages (wall and face rows)
        pav[gy - 1:gy + 6, gx - half - 1:gx + half + 2] = F.color('Slab Floor')
    # the crystal's arena in the middle of the plain: the last two trainers fight it out here,
    # a paved field with the crystal in its centre circle, on a terrace of darker slabs
    cx, cy = D.CRYSTAL
    fx0, fy0, fx1, fy1 = D.FINAL_ARENA
    terrace = (D.ellipse(cx + 0.5, cy + 0.5, 14, 9.5) < 1)
    terrace[fy0 - 2:fy1 + 2, fx0 - 2:fx1 + 2] = True
    pav[terrace] = F.color('Slab Floor')
    pav[fy0:fy1, fx0:fx1] = F.color('Mid Slab Floor')
    d.paths[terrace] = 0
    # one fountain on a paved pad east of the battlefield
    fountains = [(216, 158)]
    for (fx, fy) in fountains:
        pav[fy - 1:fy + 7, fx - 1:fx + 7] = F.color('Slab Floor')
    pav[W] = 0
    stack.append(('Courtyard', F.paint(pav)))
    fountain_layer = np.full(W.shape, None, dtype=object)
    for (fx, fy) in fountains:
        for L in stamps.tile_stamp('Forest Castle', 37, 54, 43, 60, ['Animations']):
            sub = fountain_layer[fy:fy + 6, fx:fx + 6]
            fountain_layer[fy:fy + 6, fx:fx + 6] = np.where(L != None, L, sub)
    stack.append(('Fountains', fountain_layer))
    log('cliffs')
    cl_layers, cliff_block, stair_cells = build_cliffs(d)
    for i, L in enumerate(cl_layers): stack.append((f'Cliffs {i + 1}', L))
    stack.append(('Castle walk', F.paint(W.astype(np.int32) * F.color('Slab Floor'))))
    wl, face = walls.paint(W)
    if walls.unknown: log('  castle contexts without a learned tile:', sum(walls.unknown.values()))
    stack.append(('Castle walls', wl))

    log('objects')
    # where objects may stand: dry land off roads, cliffs, castle and plazas
    occupied = (~d.land) | d.water | (d.paths > 0) | cliff_block | stair_cells | W | (face > 0) | (pav > 0) | d.beach
    occupied |= ndimage.binary_dilation(d.paths > 0, iterations=1)
    occupied |= ndimage.binary_dilation(stair_cells, iterations=2)
    occupied |= town_area
    placer = content3.Placer(~occupied)
    objects = list(town_objects)
    blocked_stamps = np.zeros(W.shape, bool)
    # the keep in the castle's north wing, its door on the forecourt
    img, foot = stamps.stamp('keep_red')
    kh, kw = img.shape[0] // 16, img.shape[1] // 16
    kx0, ky1 = D.CASTLE_CENTER[0] - kw // 2, 157
    objects.append({'img': img, 'name': 'keep', 'x': kx0 * 16, 'y': ky1 * 16 + 16})
    blocked_stamps[ky1 + 1 - kh:ky1 + 1, kx0:kx0 + kw] |= foot
    placer.free[ky1 + 1 - kh:ky1 + 3, kx0 - 1:kx0 + kw + 1] = False
    # towers on the four corners, halfway down the long sides, and either side of each gate.
    # A tower's base lines up with the bottom of the brick face beside it, so no stray face
    # pokes out under it; corner and gate towers cover the wall ends completely.
    timg, tfoot = stamps.stamp('tower_cone')
    th, tw = timg.shape[0] // 16, timg.shape[1] // 16
    (cx0, cy0, cx1, cy1) = D.CASTLE_RECTS[0]
    wl_ = D.CASTLE_WALL
    north_base = cy0 + wl_ + castle.FACE_ROWS          # under the north wall's inner face
    south_base = cy1 + castle.FACE_ROWS                # under the south wall's outer face
    spots = [(cx0 - 1, north_base), (cx1 - tw + 1, north_base), (cx0 - 1, south_base), (cx1 - tw + 1, south_base),
             (cx0 - 1, (cy0 + cy1) // 2 + 3), (cx1 - tw + 1, (cy0 + cy1) // 2 + 3)]
    half = D.GATE_W // 2
    for (gx, gy, horiz) in D.GATES.values():
        if horiz:
            base = gy + 2 + castle.FACE_ROWS
            spots += [(gx - half - tw, base), (gx + half + 1, base)]
    for (tx, yb) in spots:
        objects.append({'img': timg, 'name': 'tower_cone', 'x': tx * 16, 'y': yb * 16})
        blocked_stamps[yb - th:yb, tx:tx + tw] |= tfoot
        placer.free[max(0, yb - th):yb + 1, max(0, tx - 1):tx + tw + 1] = False
    log('courtyard')
    yard = content3.Placer(np.ones(W.shape, bool))
    yard.free = placer.free.copy() | (court & (pav == 0) & (face == 0))
    yard.free &= ~blocked_stamps
    trees = content3.catalogue('Objects_Trees_Castle', r'Tree_(Light|Emerald)_[1-6]')
    import random as _r; rr = _r.Random(3)
    for (x, y) in [(178, 162), (177, 172), (178, 185), (190, 185), (208, 185), (220, 185), (220, 174)]:
        yard.put(rr.choice(trees), x, y, clear=1)
    banner = content3.catalogue('Objects_Props_Castle', r'Banner_Large(_\d+)?')
    bench = content3.catalogue('Objects_Props_Castle', r'Bench(_\d+)?')
    lamp = content3.catalogue('Objects_Props_Castle', r'LampPost(_\d+)?')
    for (x, y) in [(bx0 - 3, by0 - 1), (bx1 + 3, by0 - 1), (bx0 - 3, by1 + 1), (bx1 + 3, by1 + 1)]:
        if banner: yard.put(rr.choice(banner), x, y, clear=0, shadow=False)
    for x in range(bx0 + 3, bx1 - 2, 7):
        if bench: yard.put(bench[0], x, by1 + 3, clear=0, shadow=False)
    for (x, y) in [(191, 161), (207, 161)]:
        if lamp: yard.put(lamp[0], x, y, clear=0, shadow=False)
    objects += yard.objects; placer.decals += yard.decals
    placer.free &= yard.free
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
    n_trees = content3.woods(d, placer, open_mask)
    n_bush = content3.scatter(d, placer, content3.BUSHES, 0.02, seed=12)
    n_rock = content3.scatter(d, placer, content3.ROCKS, 0.006, seed=13, clear=1)
    log(f'  trees {n_trees}, bushes {n_bush}, rocks {n_rock}')
    objects += placer.objects
    tg, tall = paint3.tall_grass(d, placer.free & ~occupied & ~(d.biome == D.CASTLE))
    stack.insert([n for n, _ in stack].index('Road') + 1, ('Tall grass', tg))

    log('collisions')
    ras = collide.Raster(Wd, H)
    for o in objects:
        if 'key' in o: ras.picture(o['key'], o['x'], o['y'])
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


if __name__ == '__main__':
    main()
