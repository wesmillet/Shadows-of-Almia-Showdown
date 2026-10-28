"""Towns: a brick plaza, houses facing it, market stands with a vendor each, a
well, lamps, benches and crates, and a healer. One per land, built from that
land's own buildings and props.
"""
import os, re, random
import numpy as np
import tiled
from design3 import SNOW, DESERT, AUTUMN, FOREST

KITS = {
    SNOW: dict(build='Objects_Buildings_Snow', propset='Objects_Props_Snow',
               houses=['House_Snow_1_1', 'House_Snow_2_1', 'House_Snow_3_1', 'House_Snow_6_1', 'House_Snow_8_1', 'House_Snow_5_1_Blue', 'House_Snow_7_1_Red'],
               stands=['MarketStand_1_Red', 'MarketStand_2_Blue', 'MarketStand_1_Green'],
               well='Well_Snow_1',
               props=[r'Barrel_Medium_Covered_Snow', r'Crate_Medium_Closed_\d+_Snow|Crate_Medium_Closed_Snow', r'Bench_1_Snow', r'Banner_Stick_1_Snow', r'Barrel_Small_Fish_Snow']),
    AUTUMN: dict(build='Objects_Buildings_Seasons', propset='Objects_Props_Seasons',
                 houses=['House_Hay_1_1', 'House_Hay_2_1', 'House_Hay_3_1', 'House_Hay_6_1', 'House_Hay_8_1', 'House_Hay_4_1'],
                 stands=['MarketStand_1_Orange', 'MarketStand_2_Red', 'MarketStand_1_Yellow'],
                 well=None,
                 props=[r'Basket_Apples(_\d+)?', r'HayStack(_\d+)?', r'Bench(_\d+)?', r'Crate_Small_Potatoes(_\d+)?', r'LampPost(_\d+)?', r'Barrel_Medium_Covered(_\d+)?']),
    DESERT: dict(build='Objects_Buildings_Desert', propset='Objects_Props_Desert',
                 houses=['House_Desert_BlueWood_1_1', 'House_Desert_BlueWood_2_1', 'House_Desert_BlueWood_3_1', 'House_Desert_BlueWood_6_1', 'House_Desert_BlueWood_8_1', 'House_Desert_BlueWood_4_1'],
                 stands=['Marketstand_Desert_1_Red', 'Marketstand_Desert_2_Blue', 'Marketstand_Desert_1_Yellow'],
                 well='Well_BlueWood_1',
                 props=[r'Barrel_Medium_Water_Desert', r'Bench_1_Desert', r'Banner_Stick_1_Desert', r'Crate_Medium_Closed_Desert|Crate_Medium_Closed_\d+_Desert', r'Barrel_Small_Covered_Desert']),
    FOREST: dict(build='Objects_Buildings', propset='Objects_Props',
                 houses=['House_BlueWood_1_1', 'House_BlueWood_2_1', 'House_BlueWood_3_1', 'House_BlueWood_6_1', 'House_BlueWood_8_1', 'House_BlueWood_4_1'],
                 stands=['MarketStand_1_Blue', 'MarketStand_2_Green', 'MarketStand_1_Purple'],
                 well='Well_BlueWood_1',
                 props=[r'Barrel_Medium_Covered(_\d+)?', r'Bench(_\d+)?', r'Crate_Medium_Closed(_\d+)?', r'LampPost(_\d+)?', r'Basket_Bread(_\d+)?']),
}


def find(tileset, name_or_rx, rng=None):
    ts = tiled.tileset(tileset)
    rx = re.compile(name_or_rx)
    hits = [(tileset, tid) for tid, t in sorted(ts.tiles.items()) if t.image and rx.fullmatch(os.path.splitext(os.path.basename(t.image))[0])]
    if not hits: return None
    return (rng or random).choice(hits) if len(hits) > 1 else hits[0]


def wh(key):
    t = tiled.tileset(key[0]).tiles[key[1]]
    return t.w, t.h


def build_town(name, cx, cy, biome, d, seed, ok=None):
    """Returns (plaza mask, objects, npc spots) for one town centred on (cx, cy)."""
    rng = random.Random(seed)
    kit = KITS[biome]
    H, W = d.land.shape
    plaza = np.zeros((H, W), bool)
    px0, px1, py0, py1 = cx - 11, cx + 11, cy - 4, cy + 7
    plaza[py0:py1 + 1, px0:px1 + 1] = True
    objects, npcs, foot = [], [], np.zeros((H, W), bool)

    def place(key, left_tile, bottom_tile, block=True):
        w, h = wh(key)
        x = left_tile * 16
        y = (bottom_tile + 1) * 16
        objects.append({'key': (key[0], key[1], 0), 'x': x, 'y': y})
        wt, ht = (w + 15) // 16, (h + 15) // 16
        foot[max(0, bottom_tile - 2):bottom_tile + 1, left_tile:left_tile + wt] = True
        return wt, ht

    # houses along the plaza's north side, fronts facing it
    houses = list(kit['houses']); rng.shuffle(houses)
    x = px0 - 4
    for hn in houses:
        k = find(kit['build'], re.escape(hn), rng)
        if not k: continue
        w, h = wh(k); wt = (w + 15) // 16
        if x + wt > px1 + 5: break
        place(k, x, py0 - 2)
        x += wt + 1
    # two more houses below the plaza, where there is room
    for (hx, hn) in [(px0 - 2, houses[-1]), (px1 - 8, houses[-2])]:
        k = find(kit['build'], re.escape(hn), rng)
        if not k: continue
        w, h = wh(k); wt, ht = (w + 15) // 16, (h + 15) // 16
        yb = py1 + 9
        area = (slice(yb - ht + 1, yb + 2), slice(hx, hx + wt))
        if ok is None or ok[area].all(): place(k, hx, yb)
    # market stands on the plaza's west half, a vendor in front of each
    stands = kit['stands']
    for i, sn in enumerate(stands):
        k = find(kit['build'], re.escape(sn), rng)
        if not k: continue
        sx = px0 + 1 + i * 6
        wt, ht = place(k, sx, py0 + 4)
        # the vendor stands behind the counter, facing the plaza; standX/standY is the stand's base point
        cxs = sx + wh(k)[0] / 32
        npcs.append({'role': 'vendor', 'x': cxs, 'y': py0 + 5 - 0.6, 'town': name, 'stand': i, 'standX': cxs, 'standY': py0 + 5})
    # the well on the east half, lamps and props round the edge
    beside_well = px1 - 3
    if kit['well']:
        k = find(kit['build'], re.escape(kit['well']), rng)
        if k:
            wt, _ = place(k, px1 - 5, py0 + 4)
            beside_well = px1 - 5 + wt
    # props in small purposeful spots: the north-east corner, one beside the well (a lamp where the
    # kit has one), a pair in the south-west corner, one by the healer. The fourth spot used to be
    # (cx + 2, py0 + 1), which is inside the third market stand: its lamp stood on the awning.
    spots = [(px1 - 1, py0 + 1), (min(beside_well, px1), py0 + 4), (px0, py1 - 1), (px0 + 1, py1 - 1), (px1 - 1, py1 - 1)]
    order = [0, 3, 1, 2, 4]
    taken = {}
    for j, (tx, ty) in zip(order, spots):
        pat = kit['props'][j % len(kit['props'])]
        k = find(kit['propset'], pat, rng)
        if not k: continue
        tx = max(tx, taken.get(ty, tx))          # side by side, never on top of each other
        wt = (wh(k)[0] + 15) // 16
        if tx + wt - 1 > px1: continue
        place(k, tx, ty)
        taken[ty] = tx + wt
    # the healer stands by the east side of the plaza
    npcs.append({'role': 'healer', 'x': px1 - 3 + 0.5, 'y': py1 - 2 + 0.5, 'town': name})
    return plaza, objects, npcs, foot


ENCLOSURE = {SNOW: 'Tileset_Fence_1_Snow', AUTUMN: 'Tileset_Fence_2', DESERT: 'Tileset_Wall_1', FOREST: 'Tileset_Wall_1'}


def enclosure(d, cx, cy, biome, seed=3):
    """A fence or low stone wall round the town (the pack's corner terrains: posts and rails turn
    the corners themselves), open wherever a road passes. Returns (layer, blocked cells)."""
    import wang
    from scipy import ndimage
    H, W = d.land.shape
    x0, y0, x1, y1 = cx - 22, cy - 15, cx + 23, cy + 20
    cells = np.zeros((H, W), np.int32)
    cells[y0:y1, x0:x1] = 1
    cells &= (d.land & ~d.water & ~d.beach & (d.level == d.level[cy, cx])).astype(np.int32)
    Fe = wang.WangSet(ENCLOSURE[biome], seed=seed)
    layer = Fe.paint(cells)
    ring = cells.astype(bool) & ~ndimage.binary_erosion(cells.astype(bool))
    gap = ring & ndimage.binary_dilation(d.paths > 0, iterations=1)
    for (y, x) in zip(*np.nonzero(gap)): layer[y, x] = None
    return layer, ring & ~gap
