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
import paint3, cliffs, castle, stamps, content3, towns3, collide, export3, wang, tiled

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
            if not runs:
                # no road climbs this plateau: one flight in the middle of its longest straight south face
                best = None
                bottom = {}
                for (y, x) in zip(*np.nonzero(comp)):
                    bottom[x] = max(bottom.get(x, -1), y)
                xs = sorted(bottom)
                run = []
                for x in xs + [None]:
                    if x is not None and run and x == run[-1] + 1 and bottom[x] == bottom[run[-1]]:
                        run.append(x); continue
                    if len(run) >= 6 and all(south[bottom[c] + 1, c] and south[bottom[c] + 2, c] for c in run if bottom[c] + 2 < H):
                        if best is None or len(run) > len(best): best = run
                    run = [x] if x is not None else []
                if best:
                    x0 = best[len(best) // 2 - 1]
                    cliffs.add_stairs_h(g, x0, 3)
                else:
                    log(f'  level {lv} plateau {i}: no straight south face for stairs')
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


def castle_ring(d):
    c = D.CASTLE_RING
    W = np.zeros(d.land.shape, bool)
    t = c['wall']
    W[c['y0']:c['y1'], c['x0']:c['x1']] = True
    W[c['y0'] + t:c['y1'] - t, c['x0'] + t:c['x1'] - t] = False
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
    W = castle_ring(d)
    walls = castle.Walls()
    F = wang.WangSet('Atlas_Castle_Floor', seed=8)
    c = D.CASTLE_RING; t = c['wall']
    court = np.zeros_like(W)
    court[c['y0'] + t:c['y1'] - t, c['x0'] + t:c['x1'] - t] = True
    # the courtyard: slab paving round a battlefield of lighter slabs
    pav = np.zeros(W.shape, np.int32)
    bx0, bx1, by0, by1 = 140, 181, 117, 137
    pav[by0 - 3:by1 + 4, bx0 - 4:bx1 + 5] = F.color('Slab Floor')
    pav[by0:by1 + 1, bx0:bx1 + 1] = F.color('Mid Slab Floor')
    pav[106:118, 150:171] = F.color('Slab Floor')              # the crystal's terrace
    for (gx, gy, horiz) in D.GATES.values():                    # paved gateways
        if horiz: pav[gy - 3:gy + 4, gx - 3:gx + 4] = F.color('Slab Floor')
        else: pav[gy - 3:gy + 4, gx - 3:gx + 4] = F.color('Slab Floor')
    # two fountains on paved pads either side of the battlefield
    fountains = [(121, 120), (193, 120)]
    for (fx, fy) in fountains:
        pav[fy - 1:fy + 7, fx - 1:fx + 7] = F.color('Slab Floor')
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
    # the palace on the courtyard's north side, the crystal terrace in front of it
    img, foot = stamps.stamp('palace')
    ph, pw = img.shape[0] // 16, img.shape[1] // 16
    px0, py1 = 160 - pw // 2, 105
    objects.append({'img': img, 'name': 'palace', 'x': px0 * 16, 'y': py1 * 16 + 16})
    blocked_stamps = np.zeros(W.shape, bool)
    blocked_stamps[py1 + 1 - ph:py1 + 1, px0:px0 + pw] |= foot
    placer.free[py1 + 1 - ph:py1 + 3, px0 - 1:px0 + pw + 1] = False
    # towers at the corners and beside each gate
    timg, tfoot = stamps.stamp('tower_cone')
    th, tw = timg.shape[0] // 16, timg.shape[1] // 16
    spots = [(c['x0'] - 1, c['y0'] + 2), (c['x1'] - tw + 1, c['y0'] + 2), (c['x0'] - 1, c['y1'] + 1), (c['x1'] - tw + 1, c['y1'] + 1)]
    half = D.GATE_W // 2
    for (gx, gy, horiz) in D.GATES.values():
        if horiz:
            yb = gy + 4 if gy > D.CY else gy + 4
            spots += [(gx - half - tw, yb), (gx + half + 1, yb)]
        else:
            spots += [(gx - tw // 2, gy - half - 1), (gx - tw // 2, gy + half + 5)]
    for (tx, yb) in spots:
        objects.append({'img': timg, 'name': 'tower_cone', 'x': tx * 16, 'y': yb * 16})
        blocked_stamps[yb - th:yb, tx:tx + tw] |= tfoot
        placer.free[max(0, yb - th):yb + 1, max(0, tx - 1):tx + tw + 1] = False
    log('courtyard')
    yard = content3.Placer(np.ones(W.shape, bool))
    yard.free = placer.free.copy()
    trees = content3.catalogue('Objects_Trees_Castle', r'Tree_(Light|Emerald)_[1-6]')
    import random as _r; rr = _r.Random(3)
    for y in range(80, 142, 7):
        if abs(y - 108) < 6: continue
        for x in (117, 202):
            yard.put(rr.choice(trees), x, y, clear=1)
    for x in list(range(120, 136, 6)) + list(range(186, 202, 6)):
        yard.put(rr.choice(trees), x, 79, clear=1)
    banner = content3.catalogue('Objects_Props_Castle', r'Banner_Large(_\d+)?')
    bench = content3.catalogue('Objects_Props_Castle', r'Bench(_\d+)?')
    lamp = content3.catalogue('Objects_Props_Castle', r'LampPost(_\d+)?')
    for (x, y) in [(bx0 - 3, by0 - 1), (bx1 + 3, by0 - 1), (bx0 - 3, by1 + 1), (bx1 + 3, by1 + 1)]:
        if banner: yard.put(rr.choice(banner), x, y, clear=0, shadow=False)
    for x in range(bx0 + 4, bx1 - 2, 8):
        if bench: yard.put(bench[0], x, by1 + 5, clear=0, shadow=False)
    for (x, y) in [(148, 109), (172, 109), (148, 116), (172, 116)]:
        if lamp: yard.put(lamp[0], x, y, clear=0, shadow=False)
    objects += yard.objects; placer.decals += yard.decals
    placer.free &= yard.free
    log('woods')
    clearing = (D.noise(91, 9) > 0.8) & np.isin(d.biome, [D.MEADOW, D.FOREST, D.AUTUMN, D.SNOW])
    open_mask = clearing | (d.biome == D.CASTLE)
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
    npcs.append({'role': 'healer', 'x': 148.5, 'y': 114.5, 'town': 'Castle'})
    npcs.append({'role': 'challenger', 'x': (bx0 + bx1 + 1) / 2, 'y': by0 + 1.5, 'town': 'Castle'})
    outposts = [{'x': n['x'], 'y': n['y']} for n in npcs if n['role'] == 'healer']
    # trainer starts (tile coordinates): the reachable road tile nearest each planned point
    # (on open reachable ground, at least 30 tiles from each other)
    open_ground = reach & ~ndimage.binary_dilation(~walk, iterations=1)
    ry, rx = np.nonzero(open_ground)
    spawns = []
    for (x, y) in [(71, 88), (246, 96), (112, 190), (262, 142), (160, 32), (226, 170), (40, 120), (292, 62)]:
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
