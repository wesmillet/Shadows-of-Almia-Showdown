"""The castle as an *area*: everything the island needs to know about one hand-made place, in one
dict, whichever way it was made.

Two makers produce the same shape of dict: `generated(d)` below builds the castle from the pack's
Atlas_Castle_Building kit (castlekit.py) with a garden courtyard, and areas.load() reads one drawn in
Tiled (scripts/fantasy/areas/<name>.tmx). build3 applies the dict to the map and, with
--export-castle, writes the generated one out as a Tiled map to start editing from.

An area (all masks are full-map, tile units, (rows, cols)):
    rect      (x0, y0, x1, y1) tiles the area covers, exclusive ends
    layers    [(stack layer name, object array of tile keys, opacity)]: raw tile layers, drawn
              over the ground in this order
    solid     tiles nobody walks (walls, towers, the fountain's basin); also fixed for the paving
    pave      [(kind, ...)] paving shapes in tile units, painted with the castle floor set and
              smoothed at pixel level by scripts/mapgen/pave_smooth.py:
              ('rect', x0, y0, x1, y1, cls)  tiles [x0, x1) x [y0, y1)
              ('ellipse', cx, cy, rx, ry, cls)  tile centres inside the ellipse (cx, cy in tile
              units, so a centre of 198.5 sits on the middle of tile 198)
              cls 1 = slab, 2 = light (mid) slab
    objects   [{'key': (tileset, id, flags), 'x', 'y'} | {'img': rgba, 'name', 'x', 'y'}]:
              props and baked pictures, x the left edge and y the bottom edge in map pixels
    blocked   tiles under the baked pictures' footprints (never walked)
    claimed   tiles nothing else may be planted on (the pictures and a margin round them)
    npcs      [{'role', 'x', 'y', 'town'}]
    arena     {'x0', 'y0', 'x1', 'y1'} the battlefield's box (tiles, exclusive ends) or None
"""
import random
import numpy as np
import design3 as D
import stamps, content3


def generated(d):
    """The castle composed from the Atlas_Castle_Building kit (castlekit.py): a walled ward with
    round towers on the corners, the gatehouse in the south wall, red-roofed towers either side
    of the side gates, the keep on the north wall; inside, a garden courtyard round a paved
    plaza and the battlefield's light oval."""
    import castlekit
    (ox0, oy0, ox1, oy1) = D.CASTLE_RECTS[0]
    cw, ch = ox1 - ox0, oy1 - oy0
    shape = d.land.shape
    half = D.GATE_W // 2
    side_gates = []
    for (gx, gy, horiz) in D.GATES.values():
        if horiz: continue
        side_gates.append(('W' if gx < (ox0 + ox1) / 2 else 'E', gy - half - oy0, gy + half + 1 - oy0))
    c_layers, c_hall, c_gate, c_stairs, c_solid, T, (kx, kw, kh) = castlekit.compose(cw, ch, gate_x=D.GATES['S'][0] - 2 - ox0, side_gates=side_gates)
    hx0, hy0, hx1, hy1 = c_hall
    gx0, gy0, gx1, gy1 = c_gate
    hall = np.zeros((ch, cw), bool)
    hall[hy0:hy1, hx0:hx1] = True
    side_gaps = [(y0, y1, 0, 4) if side == 'W' else (y0, y1, cw - 4, cw) for (side, y0, y1) in side_gates]
    W = np.zeros(shape, bool)                                 # the castle's solid parts (walls, towers, walkways)
    W[oy0:oy1, ox0:ox1] = c_solid
    hall_full = np.zeros(shape, bool)
    hall_full[oy0:oy1, ox0:ox1] = hall
    ocx = ox0 + (gx0 + gx1) / 2
    ocy = oy0 + (hy0 + hy1) / 2 + 1
    # The courtyard is a garden, as the sample's castle sits in greenery: lawns inside the walls,
    # a paved plaza round the battlefield in the middle, and slab walks from each gate (and the
    # keep's stairs) to the plaza. The fountain stands on its own pad on the north-west lawn.
    icx, icy = int(ocx), int(ocy)
    px0, py0, px1, py1 = icx - 19, icy - 11, icx + 19, icy + 11                   # the plaza's box (inclusive)
    pave = [('rect', px0, py0, px1 + 1, py1 + 1, 1)]
    for (r0, r1, c0, c1) in side_gaps:
        c_lo, c_hi = (0, px0 - ox0) if c0 == 0 else (px1 + 1 - ox0, cw)      # the gap's rows, wall to plaza
        pave.append(('rect', ox0 + c_lo, oy0 + r0, ox0 + c_hi, oy0 + r1, 1))
    pave.append(('rect', ox0 + gx0, py1 + 1, ox0 + gx1, oy0 + hy1 + 1, 1))                # south gate (through the gatehouse)
    pave.append(('rect', ox0 + c_stairs[0], oy0 + hy0, ox0 + c_stairs[2], py0, 1))      # the keep's stairs
    pave.append(('ellipse', ocx + 0.5, ocy + 0.5, 15.5, 8.5, 2))
    # the fountain on the north-west lawn, its pad touching the west walk, with the Celebi statue in its basin
    fountains = [(ox0 + 8, int(ocy) - 11)]
    for (fx, fy) in fountains:
        pave.append(('rect', fx - 1, fy - 1, fx + 7, fy + 7, 1))
        W[fy + 1:fy + 6, fx:fx + 6] = True                     # the basin
    layers = []
    # the lawns, as the pack's Forest Castle has them: grass with a stone kerb (Tileset_Castle_Grass)
    import wang
    pav0 = rasterize(pave, shape)
    Cg = wang.WangSet('Tileset_Castle_Grass', seed=5)
    lawn_cells = np.where(hall_full & (pav0 == 0), Cg.color('Emerald Grass'), np.where(hall_full, Cg.color('Empty'), 0)).astype(np.int32)
    layers.append(('Castle Grass', Cg.paint(lawn_cells, fill=Cg.color('Empty')), 1.0))
    for n, arr in c_layers:
        full = np.full(shape, None, dtype=object)
        full[oy0 - T:oy1, ox0:ox1] = arr
        layers.append((n, full, 1.0))
    fountain_layer = np.full(shape, None, dtype=object)
    for (fx, fy) in fountains:
        for L in stamps.tile_stamp('Forest Castle', 37, 54, 43, 60, ['Animations']):
            sub = fountain_layer[fy:fy + 6, fx:fx + 6]
            fountain_layer[fy:fy + 6, fx:fx + 6] = np.where(L != None, L, sub)
    layers.append(('Fountains', fountain_layer, 1.0))
    objects = []
    blocked = np.zeros(shape, bool)
    claimed = np.zeros(shape, bool)
    # the keep's footprint on the wall's top edge (its rows above the wall are drawn as tiles, so
    # nothing is planted before it) and the ground outside the gates
    claimed[oy0 - kh:oy0 + 2, ox0 + kx - 1:ox0 + kx + kw + 1] = True
    W[oy0 - kh + 1:oy0, ox0 + kx:ox0 + kx + kw] = True
    # a stone Celebi on a plinth in the middle of the fountain's basin
    statues = [('0251', fx + 3, fy + 3) for (fx, fy) in fountains]
    c_rows_hall = hy0
    # ---- the garden and the hall's life
    yy_, xx_ = np.mgrid[0:shape[0], 0:shape[1]]
    pav = rasterize(pave, shape)
    lawn = hall_full & (pav == 0) & ~blocked & ~W
    plaza = hall_full & (np.abs(xx_ - ocx) <= 19) & (np.abs(yy_ - ocy) <= 11)
    oval = ((xx_ - ocx) / 17) ** 2 + ((yy_ - ocy) / 10) ** 2 < 1
    yard = content3.Placer(np.ones(shape, bool))
    yard.free = (plaza & ~oval) | lawn
    for (fx, fy) in fountains: yard.free[fy - 2:fy + 8, fx - 2:fx + 8] = False
    # The garden, laid out the way a castle's gardener would: one kind of round tree, cypresses
    # in pairs along the walks, a pine in each corner, low hedges along the plaza's north and
    # south edges, flower beds on the lawns. Then the hall's own life, as in the sample: red
    # banners on the walls, lamps and benches round the battlefield, the training yard on the
    # south-east lawn, stores by the north-east wall, a camp on the south-west lawn.
    P = lambda rx: content3.catalogue('Objects_Props_Castle', rx)
    T = lambda rx: content3.catalogue('Objects_Trees', rx)
    G = lambda rx: content3.catalogue('Objects_Props', rx)
    banner, bench, lamp = P(r'Banner_Large_Red'), P(r'Bench_[1-3]'), P(r'LampPost_1')
    round_tree, cypress, pine = T(r'Tree_Emerald_3'), T(r'Tree_Emerald_1[01]'), T(r'Tree_Emerald_1')
    hedge, topiary = T(r'Bush_Emerald_1[01]'), T(r'Bush_Emerald_[56]')
    flowers = G(r'Plant_RoseBush_1_Red') + G(r'Plant_SaffronFlower_[123]') + G(r'Plant_Madder_1_Yellow') + G(r'Plant_Sunflower_[12]')
    rr = random.Random(3)
    hx0_, hy0_, hx1_, hy1_ = ox0 + hx0, oy0 + hy0, ox0 + hx1, oy0 + hy1
    lx0, ly0, lx1, ly1 = ox0 + hx0, oy0 + hy0, ox0 + hx1 - 1, oy0 + hy1 - 1     # the lawn's outer box (inclusive)
    def tree(pool, x, y, shadow=True):
        # a tree wants a free tile each side (the castle's walls count as room: they stand behind it)
        if not pool or not lawn[y, x] or not (yard.free | W)[y - 1:y + 2, x - 1:x + 2].all(): return
        if yard.put(rr.choice(pool), x, y, clear=0, shadow=shadow): yard.free[y - 1:y + 2, x - 1:x + 2] = False
    for (x, y) in [(lx0 + 1, ly0 + 3), (lx1 - 1, ly0 + 2), (lx0 + 1, ly1), (lx1 - 1, ly1)]: tree(pine, x, y)
    for (x, y) in [(px0 - 2, py0 - 3), (px1 + 2, py0 - 3), (px0 - 8, ly1), (px1 + 8, ly1), (px0 - 13, ly1 - 6)]: tree(round_tree, x, y)
    wr0, wr1 = oy0 + side_gaps[0][0], oy0 + side_gaps[0][1] - 1                   # the side walks' rows
    for x in (px0 - 2, px0 - 7, px1 + 2, px1 + 7):
        for y in (wr0 - 2, wr1 + 2): tree(cypress, x, y, shadow=False)
    for x in (ox0 + gx0 - 3, ox0 + gx1 + 2): tree(cypress, x, ly1, shadow=False)
    for x in range(px0 + 3, px1 - 2, 4):
        for y in (py0 - 1, py1 + 1):
            if hedge and lawn[y, x] and yard.free[y, x - 1] and yard.free[y, x + 1]: yard.put(rr.choice(hedge), x, y, clear=0, shadow=False)
    for (x, y) in [(px0 - 1, py0 - 1), (px1 + 1, py0 - 1), (px0 - 1, py1 + 1), (px1 + 1, py1 + 1)]:
        if topiary and lawn[y, x]: yard.put(rr.choice(topiary), x, y, clear=0, shadow=False)
    for x in range(hx0_ + 6, hx1_ - 4, 12):
        if banner: yard.put(banner[0], x, hy0_ - 1, clear=0, shadow=False)
    for x in range(icx - 10, icx + 11, 10):
        if bench: yard.put(bench[0], x, icy + 11, clear=0, shadow=False)
        if bench: yard.put(bench[1 % len(bench)], x, icy - 10, clear=0, shadow=False)
    for (x, y) in [(px0, py0 + 1), (px1, py0 + 1), (px0, py1), (px1, py1)]:
        if lamp: yard.put(lamp[0], x, y, clear=0, shadow=False)
    east = [(P(r'Hay_Dummy_1'), (lx1 - 10, wr1 + 5)), (P(r'Hay_Dummy_1'), (lx1 - 6, wr1 + 8)), (P(r'ArcheryTarget_Red'), (lx1 - 2, wr1 + 6)),
            (P(r'WeaponsStand_1'), (lx1 - 2, wr1 + 11)), (P(r'WeaponsStand_4_Red'), (lx1 - 9, wr1 + 12)), (P(r'Anvil'), (lx1 - 5, wr1 + 13))]
    for pool, (x, y) in east:
        if pool and lawn[y, x]: yard.put(pool[0], x, y, clear=0, shadow=False)
    north = [P(r'Barrel_Medium_Swords'), P(r'Barrel_Small_Arrows'), P(r'Crate_Large_Closed'), P(r'Sack_2'), P(r'Barrel_Medium_Covered'), P(r'Crate_Wide_Hay_1')]
    for i, pool in enumerate(north):
        x, y = lx1 - 12 + i * 2, ly0 + 2 if i % 2 == 0 else ly0 + 4
        if pool and lawn[y, x]: yard.put(pool[0], x, y, clear=0, shadow=False)
    sw = [(P(r'Table_Large_Red'), (lx0 + 7, wr1 + 8)), (P(r'Chair_Left_1'), (lx0 + 5, wr1 + 8)), (P(r'Chair_Right_1'), (lx0 + 11, wr1 + 8)),
          (P(r'Fireplace_2_Pot_Soup_1'), (lx0 + 4, wr1 + 12)), (P(r'WoodStack_1'), (lx0 + 8, wr1 + 13)), (P(r'WoodCart_Flowers'), (lx1 - 12, wr0 - 3))]
    for pool, (x, y) in sw:
        if pool and lawn[y, x]: yard.put(pool[0], x, y, clear=0, shadow=False)
    # flower beds: drifts on the lawns, thicker round the fountain
    for (y, x) in sorted(zip(*np.nonzero(lawn & yard.free))):
        near_f = any(abs(x - fx - 3) <= 6 and abs(y - fy - 3) <= 6 for (fx, fy) in fountains)
        if flowers and rr.random() < (0.12 if near_f else 0.04): yard.put(rr.choice(flowers), x, y, clear=0, shadow=False)
    objects += yard.objects
    bx0, bx1, by0, by1 = int(ocx - 15.5), int(ocx + 15.5), int(ocy - 8.5), int(ocy + 8.5)   # the battlefield's box
    npcs = [{'role': 'healer', 'x': bx0 - 2.5, 'y': by0 + 1.5, 'town': 'Castle'},
            {'role': 'challenger', 'x': (bx0 + bx1 + 1) / 2, 'y': by0 + 1.5, 'town': 'Castle'}]
    return {
        'name': 'castle', 'rect': (ox0 - 4, oy0 - 12, ox1 + 4, oy1 + 4),
        'layers': [(n, a, op) for (n, a, op) in layers], 'solid': W, 'pave': pave, 'objects': objects,
        'statues': statues, 'blocked': blocked, 'claimed': claimed, 'npcs': npcs,
        'arena': {'x0': bx0, 'y0': by0, 'x1': bx1 + 1, 'y1': by1 + 1},
    }


def rasterize(pave, shape):
    """The paving classes per tile from the shapes (later shapes paint over earlier ones)."""
    pav = np.zeros(shape, np.int32)
    yy, xx = np.mgrid[0:shape[0], 0:shape[1]]
    for sh in pave:
        if sh[0] == 'rect':
            _, x0, y0, x1, y1, cls = sh
            pav[max(0, y0):y1, max(0, x0):x1] = cls
        else:
            _, cx, cy, rx, ry, cls = sh
            pav[((xx + 0.5 - cx) / rx) ** 2 + ((yy + 0.5 - cy) / ry) ** 2 < 1] = cls
    return pav


def ovals(pave):
    """The true ellipses among the paving shapes, for pave_smooth: (cx, cy, rx, ry, cls)."""
    return [(cx, cy, rx, ry, cls) for (kind, cx, cy, rx, ry, cls) in pave if kind == 'ellipse']
