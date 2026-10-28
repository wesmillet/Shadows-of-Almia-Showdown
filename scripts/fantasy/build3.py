#!/usr/bin/env python3
"""Builds the third map (The Fan-tasy Tileset): assets/maps/almia3.json and its images.

  python3 scripts/fantasy/build3.py

Needs the Fan-tasy packs unpacked and merged (FANTASY_DIR, see tiled.py),
numpy, scipy and Pillow.
"""
import os, re, sys, time, json
import numpy as np
from scipy import ndimage
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import design3 as D
import paint3, cliffs, castle, castle2, stamps, content3, towns3, collide, export3, wang, tiled, decor3, shadows3

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
NAME = 'almia3'
CLIFF_SETS = {
    D.SNOW: ('Tileset_RockSlope_2_Ice', 'RockSlopes_2_Ice_Rules'),       # the whole mountain is ice, as the pack's Frost Peak
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
    for lv in range(1, int(d.level.max()) + 1):
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


def bridge_front_posts(art, rows=11):
    """The south posts of a stone bridge picture (its bottom `rows` rows, only the post columns: the
    ones still opaque in its last three rows), as a picture of their own to draw in front of crossers."""
    cut = art[-rows:].copy()
    cols = (art[-3:, :, 3] > 0).any(axis=0)
    cols = cols | np.roll(cols, 1) | np.roll(cols, -1)
    cut[:, ~cols, 3] = 0
    return cut


SOFT = re.compile(r'Grass_|Cattail|Plant_|Hay_Dummy|Flower|Mushroom|Bridge|Shadow')


def settle(objects, placer):
    """Each placer keeps its own objects apart, but towns, farms, the castle area, road decor, the
    woods and the shores are placed by different placers, so a cactus could stand inside a house,
    a lamp inside a rune rock or a palm inside a palm. Where one solid object's base stands in the
    base of another (the bottom 20 px, its middle 70%), the narrower one goes, with its shadow.
    Soft things (grass, reeds, plants, flowers) may stand among others as they do in the samples."""
    def nm(o): return content3.picture_name(o['key']) if 'key' in o else o.get('name', '')
    solid = [o for o in objects if 'key' in o and not SOFT.search(nm(o))]
    gone = set()
    removed = []
    # The one with the wider base stays (its footprint is the thing on the ground: a rune rock over
    # a lamp post, a log over a skull); ties go to the bigger picture.
    by_size = sorted(solid, key=lambda o: (-content3.size(o['key'])[0], -content3.size(o['key'])[0] * content3.size(o['key'])[1]))
    def inside(a, b):
        aw, _ = content3.size(a['key']); bw, _ = content3.size(b['key'])
        ax = a['x'] + aw / 2
        return bw >= 20 and b['x'] + bw * 0.15 < ax < b['x'] + bw * 0.85 and b['y'] - 20 < a['y'] <= b['y'] + 2
    for i, b in enumerate(by_size):
        if id(b) in gone: continue
        for a in by_size[i + 1:]:
            if id(a) in gone: continue
            if abs(a['y'] - b['y']) > 22 or abs(a['x'] - b['x']) > 200: continue
            if inside(a, b) or inside(b, a):
                gone.add(id(a))
                aw, _ = content3.size(a['key'])
                removed.append({'name': nm(a), 'in': nm(b), 'x': round((a['x'] + aw / 2) / 16, 1), 'y': round(a['y'] / 16, 1)})
    out = [o for o in objects if id(o) not in gone]
    drop = [content3.shadow_decal(o['key'], o['x'], o['y']) for o in objects if id(o) in gone]
    placer.decals = [x for x in placer.decals if x not in drop]
    log(f'  settled: {len(gone)} objects standing inside others removed')
    # what went, for review (scripts/fantasy/out/<map>_settled.json)
    json.dump(removed, open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'out', 'almia3_settled.json'), 'w'), indent=1)
    return out


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
    # The castle is an "area" (castle3.py): generated from the pack's Bosk Barracks, or, when
    # areas/castle.tmx exists, read from that Tiled map (areas.py), which anyone can edit.
    import castle3, areas
    export_castle = '--export-castle' in sys.argv
    if areas.exists('castle') and not export_castle and '--regen-castle' not in sys.argv:
        A = areas.load('castle', d.land.shape)
        log('  from areas/castle.tmx')
    else:
        A = castle3.generated(d)
        if export_castle:
            base = [(n, L, 1.0) for (n, L) in stack if n in ('Sand', 'Ground', 'Ground patches', 'Road', 'Tall grass')]
            log('  exported', areas.write(A, preview_layers=base))
    F = wang.WangSet('Atlas_Castle_Floor', seed=8)
    W = A['solid'].copy()                                     # the castle's solid parts (walls, towers, walkways)
    face = np.zeros(d.land.shape, np.int32)
    ax0, ay0, ax1, ay1 = A['rect']
    court = np.zeros(d.land.shape, bool)
    court[ay0:ay1, ax0:ax1] = True
    court &= ~W
    pav = castle3.rasterize(A['pave'], d.land.shape)
    walks = court.copy()
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
    stack.append(('Courtyard', F.paint(pav)))
    if areas.exists('castle'):
        areas.refresh_previews('castle', [(n, L, 1.0) for (n, L) in stack if n in ('Sand', 'Ground', 'Ground patches', 'Road', 'Courtyard')])
    for n, arr, op in A['layers']:
        stack.append((n, arr))                                 # (opacity by name: a 'Shadows' layer draws at 0.25)
    # for scripts/mapgen/pave_smooth.py: the paving per tile (0 none, 1 slab, 2 light slab) and
    # where it may be reshaped (court and approaches, not the walls or faces)
    os.makedirs(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'out'), exist_ok=True)
    # true ovals (tile units: cx, cy, rx, ry, class) that the stepped tiles stand for
    # never redrawn by the smoothing overlay: the castle's solid parts and every tile of its own art
    # (the open gate's arch and the walkway over it are not solid, but the overlay drew over them)
    _fixed = W.copy()
    for (_n, _arr, _op) in A['layers']:
        if 'Grass' in _n: continue          # (the lawns meet the paving softly, as before)
        _fixed |= np.vectorize(lambda t: t is not None, otypes=[bool])(_arr)
    _ovals = np.array(castle3.ovals(A['pave']) + [(cx + 0.5, cy + 0.5, 17.5, 12, 1), (cx + 0.5, cy + 0.5, 14.5, 9.5, 2)], np.float32)
    np.savez_compressed(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'out', f'{NAME}_pave.npz'), pav=pav, fixed=_fixed, ovals=_ovals, rounded=np.array(A.get('rounded', []), np.float32).reshape(-1, 5), walks=walks & d.land)
    arena_box = A['arena']
    log('cliffs')
    cl_layers, cliff_block, stair_cells = build_cliffs(d)
    for i, L in enumerate(cl_layers): stack.append((f'Cliffs {i + 1}', L))
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
    # animated props (torches, fires, banners, flowers...) live in a tile layer the game animates
    anim = np.full(W.shape, None, dtype=object)
    anim_block = np.zeros(W.shape, bool)
    # torches burning at the corners of every town plaza
    import animprops
    for name, (tx, ty, b) in D.TOWNS.items():
        px0, px1, py0, py1 = tx - 11, tx + 11, ty - 4, ty + 7
        for (x, y) in [(px0 - 1, py0 - 1), (px1 + 1, py0 - 1), (px0 - 1, py1 + 1), (px1 + 1, py1 + 1)]:
            if placer.free[y - 1:y + 1, x].all() and anim[y - 1, x] is None and anim[y, x] is None:
                animprops.place(anim, 'Animation_Torch_1', 32, x, y)
                placer.free[y - 1:y + 1, x] = False
    log('bridges')
    # a stone bridge wherever a road reaches both banks of a river
    bridge_deck = np.zeros(W.shape, bool)
    bridge = content3.catalogue('Objects_Buildings', r'Bridge_Stone_4')
    n_bridges = 0
    # design3.river_crossings chose each crossing (deck middle x, y) and ran its road straight
    # through it, three tiles wide, centred on the deck
    for (xi, yi) in getattr(d, 'crossings', []):
            if bridge:
                # The bridge is walked on, so it is drawn under whoever crosses it (sorted at its top
                # row); only its south posts, cut out as their own picture, stand in front of a
                # crosser's feet. Sorted as one picture at its bottom row, it used to hide anyone on
                # the deck (seen in the game: a trainer crossing vanished under the stone).
                # The picture (80 px) covers exactly the deck's five tiles (it used to sit half a
                # tile west of them).
                bx, by = (xi - 2) * 16, (yi + 2) * 16
                art = tiled.tileset(bridge[0][0]).tile_image(bridge[0][1])
                front = bridge_front_posts(art)
                town_objects = list(town_objects) + [
                    {'key': bridge[0] + (0,), 'x': bx, 'y': by, 'sort': (by - art.shape[0]) / 16},
                    {'img': front, 'name': 'bridge_front_posts', 'x': bx, 'y': by, 'sort': by / 16}]
                bridge_deck[yi - 1:yi + 2, xi - 2:xi + 3] = True
                n_bridges += 1
                # nothing tall beside the straight approaches (a broad tree's crown hid the east one)
                h_ = D.CROSS_HALF
                placer.free[max(0, yi - 5):yi + 7, max(0, xi - h_ - 4):xi + h_ + 5] = False
    log(f'  bridges {n_bridges}')
    d.bridge_deck = bridge_deck          # decor3.life keeps its reeds off it
    log('farms')
    import farm3
    farm_fence = np.full(W.shape, None, dtype=object)
    farm_field = np.full(W.shape, None, dtype=object)
    farm_block = np.zeros(W.shape, bool)
    # Every town has its grounds (towns3.grounds: the rectangle round it on its own level). They
    # used to be fenced in, which read as raised plots; now nothing marks their edge, so the woods
    # and meadow run straight on into them. Fences are kept for farms (farm3).
    rings = np.zeros(W.shape, bool)
    import random as _rnd
    for name, (tx, ty, b) in D.TOWNS.items():
        ring = towns3.grounds(d, tx, ty)
        rings |= ring                     # (farms still keep two tiles clear of a town's grounds)
        # within the grounds: the town's own trees, a watchtower by a corner, props about the yards
        rr = _rnd.Random(sum(map(ord, name)))
        inside = ndimage.binary_fill_holes(ring) & ~ring & placer.free & ~town_foot & (d.paths == 0)
        inside &= ~ndimage.binary_dilation(d.paths > 0, iterations=1) & ~ndimage.binary_dilation(town_foot, iterations=1)
        kit = towns3.KITS[b]
        tower = content3.catalogue(kit['build'], r'Watchtower_1_.*(Blue|Red|Green)')
        cells = list(zip(*np.nonzero(inside)))
        rr.shuffle(cells)
        placed = 0
        for (y, x) in cells:
            if tower and placed == 0 and y > ty + 9 and decor3._big(placer, rr.choice(tower), x, y, farm_block): placed += 1; continue
            if placed >= 1: break
        trees = content3.TREES.get(b, [])
        n_t = 0
        for (y, x) in cells:
            if n_t >= 7: break
            if trees and placer.free[y, x] and placer.put(rr.choice(trees), x, y, clear=1): n_t += 1
        props = [content3.catalogue(kit['propset'], pat) for pat in kit['props']]
        props = [p for p in props if p]
        n_p = 0
        for (y, x) in cells:
            if n_p >= 8: break
            if props and placer.free[y, x] and placer.put(rr.choice(rr.choice(props)), x, y, clear=0, shadow=False): n_p += 1
    for (town, near, seed) in [('Greenhollow', (284, 142), 7), ('Emberwood', (268, 70), 8)]:
        tx, ty, _ = D.TOWNS[town]
        ok = d.land & ~d.water & ~d.beach & (d.level == d.level[near[1], near[0]]) & (d.paths == 0) & ~town_area & ~d.castle & ~cliff_block & ~stair_cells
        ok &= ~ndimage.binary_dilation(d.paths > 0, iterations=2)
        ok &= ~ndimage.binary_dilation(rings, iterations=2)
        f = farm3.build(d, placer, ok, (tx, ty), near, seed=seed)
        if f is None: log(f'  no room for a farm by {town}'); continue
        farm_fence = np.where(f['fence'] != None, f['fence'], farm_fence)
        farm_field = np.where(f['field'] != None, f['field'], farm_field)
        farm_block |= f['blocked']
        placer.free &= ~f['claimed']
        objects_farm = f['objects']
        town_objects = list(town_objects) + objects_farm
        log(f'  farm by {town} at {f["rect"]}, {len(objects_farm)} things')
    stack.append(('Farm field', farm_field))
    stack.append(('Fences', farm_fence))
    objects = list(town_objects)
    blocked_stamps = A['blocked'].copy()
    placer.free &= ~A['claimed']
    objects += A['objects']
    # stone Pokémon on plinths (the Celebi in the fountain's basin)
    import statue as _statue
    for (dex, sx, sy) in A.get('statues', []):
        st = _statue.statue(dex)
        bcx, bcy = sx * 16 - 1, sy * 16 + 10
        objects.append({'img': st, 'name': f'statue_{dex}', 'x': int(bcx - (st.shape[1] - 6) / 2), 'y': int(bcy) + 4})   # (+6 wide, +4 tall: its shadow)
    # the area's trees (and stumps, rocks) cast the same shadows the island's do
    for o in A['objects']:
        if 'key' in o:
            dcl = content3.shadow_decal(o['key'], o['x'], o['y'])
            if dcl: placer.decals.append(dcl)
    placer.free &= ~d.castle          # inside the walls nothing wild
    log('decor')
    n_arena = decor3.arena(placer)
    n_mountain = decor3.mountain(d, placer, anim, anim_block)
    n_ruins = decor3.ruins(d, placer, anim)
    log(f'  mountain {n_mountain}, ruins {n_ruins}')
    n_sign, n_lamp, n_flower = decor3.roads(d, placer)
    water_plants = decor3.lakes(d)
    # no reeds against a bridge (they stood over its posts)
    near_bridge = ndimage.binary_dilation(bridge_deck, iterations=2)
    water_plants = [o for o in water_plants if not near_bridge[min(H - 1, int(o['y'] // 16)), min(Wd - 1, int((o['x'] + 8) // 16))]]
    objects += water_plants
    log(f'  arena {n_arena}, signs {n_sign}, lamps {n_lamp}, verge plants {n_flower}, water plants {len(water_plants)}')
    log('woods')
    clearing = (D.noise(91, 9) > 0.8) & np.isin(d.biome, [D.MEADOW, D.FOREST, D.AUTUMN, D.SNOW])
    px, py, prx, pry = D.PLAIN
    open_mask = clearing | (d.biome == D.CASTLE) | (D.ellipse(px, py, prx - 10, pry - 8) < 1)
    open_mask |= D.ellipse(D.CASTLE_CENTER[0], D.CASTLE_CENTER[1], 40, 30) < 1   # the castle's clearing
    n_summit = decor3.summit(placer)
    # The blighted plain round the crystal: bare trees, stumps, bones and grey rocks, nothing green.
    # It is kept from the woods below (its grass stays free for the tall grass, so wilds still spawn).
    blight = D.blight() & (d.biome == D.MEADOW)
    dead = {D.MEADOW: content3.DEAD_TREES}
    n_dead = content3.scatter(d, placer, dead, 0.035, seed=15, clear=2, where=blight)
    n_dead += content3.scatter(d, placer, {D.MEADOW: content3.DEAD_ROCKS}, 0.02, seed=16, clear=1, where=blight)
    n_dead += content3.scatter(d, placer, {D.MEADOW: content3.DEAD_BITS}, 0.03, seed=17, clear=0, where=blight)
    blight_free = placer.free & blight
    placer.free &= ~blight
    n_trees = content3.woods(d, placer, open_mask)
    n_bush = content3.scatter(d, placer, content3.BUSHES, 0.014, seed=12)
    n_rock = content3.scatter(d, placer, content3.ROCKS, 0.006, seed=13, clear=1)
    placer.free |= blight_free
    # boulders and ice up the mountain, where the trees give out
    n_rock += content3.scatter(d, placer, content3.ROCKS, 0.012, seed=14, clear=2, where=d.level >= 2)
    shore_placer = content3.Placer(d.beach & d.land & ~d.water & (d.paths == 0) & ~town_area & ~ndimage.binary_dilation(d.paths > 0, iterations=1))
    n_shore = decor3.shores(d, shore_placer)
    objects += shore_placer.objects
    log(f'  shores {n_shore}')
    n_life = decor3.life(d, placer, anim)
    n_falls = decor3.waterfalls(d, anim, anim_block)
    log(f'  life {n_life}, waterfalls {n_falls}')
    log(f'  summit {n_summit}, blight {n_dead}, trees {n_trees}, bushes {n_bush}, rocks {n_rock}')
    objects += placer.objects
    placer.decals += shore_placer.decals          # the beach palms' shadows (they were dropped before)
    objects = settle(objects, placer)
    tg, tall = paint3.tall_grass(d, placer.free & ~occupied & ~(d.biome == D.CASTLE))
    stack.insert([n for n, _ in stack].index('Road') + 1, ('Tall grass', tg))
    stack.append(('Animations', anim))

    log('collisions')
    ras = collide.Raster(Wd, H)
    # Small things you walk past rather than round: bushes, verge plants, signs and small rocks
    # are scenery (no collision), so walkways never get plugged by a shrub or a pebble.
    see_through = set()
    for pool in list(content3.BUSHES.values()):
        see_through |= {(k[0], k[1]) for k in pool}
    see_through |= {(k[0], k[1]) for k in content3.catalogue('Objects_Props', r'Plant_.*|Crate_Small_Flowers|TreeLog|TreeStump_.*|Sign_.*')}
    see_through |= {(k[0], k[1]) for k in content3.DEAD_BITS}
    see_through |= {(k[0], k[1]) for k in content3.DEAD_ROCKS if max(content3.size(k)) <= 32}
    see_through |= {(k[0], k[1]) for k in content3.catalogue('Objects_Props_Snow', r'Sign_.*')}
    see_through |= {(k[0], k[1]) for k in content3.catalogue('Objects_Buildings', r'Bridge_Stone_\d')}    # the deck is walked; the water either side is not
    for ts in ('Objects_Grass', 'Objects_Grass_Snow', 'Objects_Grass_Desert'):
        see_through |= {(k[0], k[1]) for k in content3.catalogue(ts, r'.*')}
    see_through |= {(k[0], k[1]) for k in content3.catalogue('Objects_Props', r'Plant_(Corn|Cabbage|Pumpkin|Tomato|Carrot|Eggplant|Potatoe|Radish|Cotton).*')}
    for pool in content3.ROCKS.values():
        see_through |= {(k[0], k[1]) for k in pool if max(content3.size(k)) <= 32}
    for o in objects:
        if 'key' in o and (o['key'][0], o['key'][1]) not in see_through: ras.picture(o['key'], o['x'], o['y'])
    blocked = ras.blocked() | blocked_stamps | anim_block | farm_block
    walk = d.land & (~d.water | bridge_deck) & ~cliff_block & ~W & ~(face > 0) & ~blocked
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
    npcs += A['npcs']
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
    st = [{'kind': 'tiles', 'name': n, 'opacity': 0.25 if n.endswith('Shadows') else 1.0, 'tiles': L} for n, L in stack]
    decals = [x for x in placer.decals if x]
    st.insert(len(st) - 2, {'kind': 'decals', 'name': 'Shadows', 'opacity': 0.25, 'decals': decals})
    # every size of the shadow disc, so polish3 can give its trees the right one
    pack = [k for k in (content3.shadow_key(s_) for s_ in shadows3.SIZES) if k]
    data = {'name': NAME, 'cols': Wd, 'rows': H, 'stack': st, 'objects': objects, 'pack': [(k[0], k[1], 0) for k in pack],
            'walkable': walk, 'reachable': reach, 'biome': biome, 'minimap': minimap,
            'stairs': [[int(x), int(y)] for (y, x) in zip(*np.nonzero(stair_cells))],
            'center': {'x': D.CRYSTAL[0] + 0.5, 'y': D.CRYSTAL[1] + 0.5}, 'outposts': outposts, 'spawns': spawns,
            'towns': towns, 'npcs': npcs,
            'arena': arena_box,
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
