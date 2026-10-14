"""The authored content of Almia: districts placed by hand on designer2.

Levels: L4 highland corners, L3 summit, L2 terrace, L1 lowlands.
The Shadow Crystal stands at (80, 56), on the summit's prow above the grand
stair; the darkness closes on it.

Districts
  Crystal Shrine      summit prow: statues, flower beds, the grand stair
  Lakeside            summit lake: a stilt house on the water, north-cove pier
  Old Stone Mill      summit, east grove
  Spring Outpost      summit east: the spring pond, Ranger house, orchard
  Hollow Graveyard    north-west highland: graveyard, old manor, haunted wood
  Quarry              north-east highland: ore, minecart track, miners' camp
  Windmill Fields     west summit strip: the windmill and its fields
  Terraces            orchards along both terrace flats, the stair landing
  Westbrook Village   west lowland: village green, houses, farm, river meadow
  Almia Town          central lowland: the market square, manor, ranch
  Fisher's Cove       east lowland and the beach: stilt houses, piers, boats
"""
import numpy as np
import designer2, content2, lib
from content2 import (Builder, finish_paths, door_path, forest, forest_rim, scatter, field, fence_rect,
                      fence_line, rail_h, hpier, npier, blob, cave, stone_wall)
from designer2 import W, H

LADDERS = [
    (76, 58), (84, 58), (22, 42), (36, 42), (114, 42), (140, 42),   # B3: grand stair, west, east
    (80, 68), (14, 52), (34, 52), (116, 52), (132, 52),             # B2
    (24, 30), (44, 16), (116, 16), (142, 30),                      # highland corners
]
FLOWERS = ['flower_95', 'flower_96', 'flower_97', 'flower_98', 'flower_159', 'flower_160', 'flower_161', 'flower_162',
           'flower_223', 'flower_224', 'flower_225', 'flower_226', 'flower_227']
BUSHES = ['bush_91', 'bush_155', 'bush_219', 'bush_283', 'bush_307']
ROCKS = ['rock_287', 'rock_288', 'rock_289', 'rock_290']


def rect(x0, y0, x1, y1):
    m = np.zeros((H, W), bool); m[y0:y1 + 1, x0:x1 + 1] = True; return m


def houses(b, items, tag):
    for (n, x, y) in items:
        if b.put(n, x, y): door_path(b, n, x, y)
        else: print(f'{tag}: no room for', n, x, y)


def flower_bed(b, x0, x1, y, kinds=(95, 159, 223, 97, 161, 225)):
    for x in range(x0, x1 + 1):
        if not b.occ[y, x]: b.ground(x, y, kinds[(x * 3 + y) % len(kinds)])


def network(b):
    for (x, y) in LADDERS:
        b.ladder(x, y)
    r = b.road
    # summit
    b.plaza(72, 46, 88, 57, cut=3)                          # the crystal plaza
    r([(80, 46), (80, 35)])
    b.plaza(76, 29, 84, 35, cut=2)                          # crossroads
    r([(77, 33), (73, 37), (73, 40), (12, 40)])             # west, along the lake's south shore
    r([(83, 33), (87, 37), (87, 40), (147, 40)])            # east, past the mill and the spring
    r([(24, 40), (24, 34)]); r([(142, 40), (142, 34)])
    r([(59, 40), (59, 38)])                                 # up to the lake pier
    r([(80, 29), (80, 24), (50, 24), (45, 19)])             # lakeside promenade to the NW highland
    r([(80, 24), (111, 24), (116, 19)])                     # and to the NE one
    r([(67, 24), (67, 21)])                                 # down to the cove pier
    r([(40, 40), (40, 30), (44, 26), (50, 26)])             # a trail through the west wood
    # highland corners
    r([(18, 27), (18, 25)])
    r([(18, 27), (25, 27), (31, 21)])
    r([(24, 27), (24, 28)])
    r([(44, 14), (41, 14), (35, 20), (31, 20)])
    r([(116, 14), (128, 14)]); r([(142, 27), (136, 21), (130, 21)])
    # terraces
    b.plaza(71, 61, 89, 66, cut=2)
    r([(72, 63), (60, 51), (57, 48), (12, 48)])
    r([(88, 63), (100, 51), (103, 48), (136, 48)])
    # lowlands
    b.plaza(70, 73, 90, 84, cut=3)                          # Almia Town square
    r([(70, 80), (60, 80)])
    r([(56, 80), (44, 80), (37, 73), (33, 69)])
    b.plaza(19, 62, 33, 70, cut=2)                          # Westbrook green
    r([(12, 66), (19, 66)])
    r([(14, 56), (14, 66)])
    r([(42, 66), (54, 66)]); r([(36, 66), (38, 66)])
    r([(90, 80), (118, 80)])
    r([(90, 87), (116, 87)]); r([(90, 81), (90, 87)]); r([(116, 81), (116, 87)])    # the south lane
    r([(128, 79), (133, 79), (133, 58), (119, 58)])
    r([(120, 71), (133, 71)])
    # bridges
    b.plank_bridge(46, 40); b.plank_bridge(128, 40)
    b.plank_bridge(46, 48); b.plank_bridge(128, 48)
    b.railed_bridge(58, 79); b.railed_bridge(126, 78)
    b.plank_bridge(40, 66); b.plank_bridge(128, 58)


def shrine(b):
    b.put('statue', 74, 49, allow_path=True); b.put('statue', 85, 49, allow_path=True)
    for (x, y) in [(69, 44), (90, 44), (67, 50), (92, 50), (70, 54), (89, 54)]:
        b.put('pine_tall', x, y)
    for x in (73, 74, 75, 76, 84, 85, 86, 87):
        b.ground(x, 53, [95, 159, 223, 97][x % 4])
    b.put('bench', 77, 47, allow_path=True); b.put('bench', 81, 47, allow_path=True)
    for x in (72, 87):
        b.put('pine_small', x, 61)
    flower_bed(b, 74, 78, 66); flower_bed(b, 82, 86, 66)


def lakeside(b):
    b.put('stilt_red_b', 58, 28, check=False)
    b.pier(58, 34, 37, posts=False)
    for (x, y) in [(53, 30), (55, 32), (66, 28), (68, 31), (62, 34)]:
        b.objs.append({'kind': 'sprite', 'name': 'spr_deco_duck_01', 'tx': x, 'ty': y, 'frame': b.rng.randrange(4), 'flip': x > 60})
    b.objs.append({'kind': 'sprite', 'name': 'spr_deco_coracle', 'tx': 64, 'ty': 31, 'frame': 0})
    # the north cove: a pier, boats
    npier(b, 66, 14, 20)
    b.objs.append({'kind': 'sprite', 'name': 'spr_deco_coracle', 'tx': 70, 'ty': 16, 'frame': 2, 'flip': True})
    b.objs.append({'kind': 'sprite', 'name': 'spr_deco_coracle', 'tx': 63, 'ty': 15, 'frame': 1})
    for x in (61, 62): b.sprite('spr_deco_crate_01', x, 21)
    b.sprite('spr_deco_barrel_water', 71, 21)
    b.put('bench', 74, 21)
    # the old stone mill in the east grove
    if b.put('lighthouse', 92, 26):
        door_path(b, 'lighthouse', 92, 26)
        b.objs.append({'kind': 'sprite', 'name': 'spr_deco_windmill', 'px': 94 * 16, 'py': (26 + 3.625) * 16, 'z': 38.05})
    else:
        print('no room for the stone mill')


def spring(b):
    houses(b, [('blue_dormer', 144, 34)], 'spring')
    for y in (33, 36):
        for x in range(112, 121, 3):
            b.put(b.rng.choice(['berry_red', 'berry_orange']), x, y)
    b.sprite('spr_deco_well_covered', 138, 37)
    flower_bed(b, 126, 136, 38)


def ruins(b):
    # the old ruins on the summit meadow north of the crossroads
    stone_wall(b, 86, 89, 27); stone_wall(b, 86, 87, 31)
    b.put('statue_b', 90, 28)
    for (n, x, y) in [('ore_boulder_0', 84, 25), ('ore_boulder_2', 88, 32), ('rock_287', 92, 31), ('rock_290', 85, 29)]:
        b.put(n, x, y)


def graveyard(b):
    fence_rect(b, 14, 13, 26, 24, gates=[(17, 24), (18, 24), (19, 24)])
    graves = [1003, 1004, 1005, 1006, 1007, 1067, 1068, 1069, 1070, 1071]
    for y in (15, 18, 21):
        for x in range(16, 25, 2):
            if (x, y) != (18, 21): b.put(f'grave_{b.rng.choice(graves)}', x + (y % 2) * (1 if x < 24 else 0), y)
    for (x, y) in [(15, 14), (24, 14), (15, 21)]:
        b.put('pine_small', x, y)
    for (x, y) in [(16, 23), (22, 23)]:
        b.sprite('spr_deco_mushroom_blue_01', x, y, frame=x % 4, block=False)
    b.occ[14:24, 15:26] = True       # nothing else grows inside the graveyard
    houses(b, [('purple_manor', 28, 13)], 'graveyard')
    b.sprite('spr_deco_firepit', 36, 18)
    b.objs.append({'kind': 'sprite', 'name': 'spr_deco_fire_01', 'tx': 36, 'ty': 18, 'dy': -4, 'frame': 1, 'z': 18.995})


def quarry(b):
    b.plaza(118, 13, 147, 27, kind='2', cut=4)
    b.put('blue_tower_duo', 135, 12, allow_path=True)
    rail_h(b, 131, 146, 25)
    for x in (134, 135, 143):
        b.sprite('spr_deco_minecart', x, 25, check=False)
    ores = ['ore_silver_0', 'ore_silver_1', 'ore_gold_0', 'ore_gold_1', 'ore_crystal_0', 'ore_crystal_1',
            'ore_stone_0', 'ore_stone_1', 'ore_boulder_0', 'ore_boulder_1']
    for (x, y) in [(124, 15), (128, 14), (141, 15), (144, 18), (122, 19), (126, 20), (131, 19), (139, 20),
                   (143, 22), (134, 21), (121, 15)]:
        b.put(b.rng.choice(ores), x, y, allow_path=True)
    for (x, y) in [(130, 16), (137, 18), (142, 25), (124, 22), (146, 21)]:
        b.put(b.rng.choice(['ore_silver_s', 'ore_gold_s', 'ore_crystal_s', 'ore_stone_s']), x, y, allow_path=True)
    b.sprite('spr_deco_campfire', 133, 17)
    b.objs.append({'kind': 'sprite', 'name': 'spr_deco_fire_02', 'tx': 133, 'ty': 17, 'dy': -3, 'frame': 0, 'z': 17.995})
    b.sprite('spr_deco_anvil', 140, 17)
    for (x, y) in [(132, 13), (133, 14)]:
        b.sprite('spr_deco_crate_02', x, y)
    b.sprite('spr_deco_barrel_closed', 140, 13)
    b.sprite('spr_deco_barrel_open', 141, 13)
    b.sprite('spr_deco_chest_02_closed', 129, 18)
    for (x, y) in [(127, 23), (145, 15), (120, 21), (138, 26)]:
        b.put(b.rng.choice(['ore_boulder_1', 'ore_boulder_2', 'ore_stone_2', 'ore_silver_2']), x, y, allow_path=True)
    for (x, y) in [(136, 23), (139, 23)]:
        b.sprite('spr_deco_crate_01', x, y)


def windmill_fields(b):
    if b.put('red_tower', 28, 33):
        b.objs.append({'kind': 'sprite', 'name': 'spr_deco_windmill', 'px': 29.5 * 16, 'py': 35.4375 * 16, 'z': 39.05})
    field(b, 12, 33, 22, 37, ['wheat_05', 'kale_05'])
    field(b, 32, 32, 38, 37, ['carrot_05', 'parsnip_05', 'radish_05'])


def terraces(b):
    # orchards in loose clumps under the summit cliffs, a few fence runs
    for (x, y) in [(107, 45), (110, 45), (118, 45), (121, 46), (131, 45), (134, 45), (106, 50), (124, 50)]:
        b.put(b.rng.choice(['berry_red', 'berry_orange']), x, y)
    for (x, y) in [(16, 45), (19, 45), (27, 50), (30, 50), (40, 45), (43, 50), (24, 45)]:
        b.put(b.rng.choice(['berry_red', 'berry_orange', 'round_bush']), x, y)
    fence_line(b, 110, 115, 51); fence_line(b, 36, 41, 51); fence_line(b, 18, 22, 51)
    for (x, y) in [(12, 45), (46, 51), (126, 45), (129, 51)]:
        b.sprite('spr_deco_tree_01', x, y, frame=x % 4)
    houses(b, [('green_gable_tall', 141, 50)], 'terrace')
    b.put('bench', 138, 46)


def westbrook(b):
    houses(b, [('purple_manor', 17, 55), ('green_house', 24, 57), ('red_small', 28, 57), ('red_house', 37, 56),
               ('green_house_b', 15, 61), ('green_small', 48, 59)], 'westbrook')
    b.sprite('spr_deco_well', 27, 66, check=False)
    b.put('statue', 21, 63, allow_path=True)
    flower_bed(b, 23, 31, 62)
    b.put('bench', 29, 68, allow_path=True)
    field(b, 19, 72, 31, 76, ['cabbage_05', 'pumpkin_05', 'cauliflower_05'])
    fence_line(b, 19, 31, 71)
    for k in range(4):
        b.sprite('spr_deco_chicken_01', b.rng.randrange(49, 56), b.rng.randrange(62, 65), flip=k % 2 == 0, frame=k)
    houses(b, [('blue_flat', 48, 73)], 'westbrook')
    field(b, 44, 82, 56, 85, ['beetroot_05', 'potato_05'])
    for (x, y) in [(53, 56), (56, 58), (53, 61), (56, 62)]:
        b.put(b.rng.choice(['berry_red', 'berry_orange']), x, y)
    for (x, y) in [(46, 58), (46, 60)]:
        b.objs.append({'kind': 'sprite', 'name': 'spr_deco_duck_01', 'tx': x, 'ty': y, 'frame': y % 4})


def almia_town(b):
    houses(b, [('blue_manor', 61, 72), ('red_gable', 92, 72), ('green_gable_tall', 97, 71)], 'town')
    for (n, x, y) in [('red_small', 93, 82), ('red_long', 98, 82), ('blue_dormer', 105, 82), ('green_house', 111, 82)]:
        if b.put(n, x, y):
            p = lib.PREFABS[n]; dx = content2.DOORS.get(n, p['w'] // 2)
            b.road([(x + dx, y + p['h']), (x + dx, 86)])
        else: print('town: no room for', n, x, y)
    b.put('statue', 79, 77, allow_path=True)
    for (n, x, y) in [('stall_white', 72, 75), ('stall_white_b', 86, 75), ('stall_white_b', 72, 81), ('stall_white', 86, 81)]:
        b.put(n, x, y, allow_path=True)
    for (x, y) in [(71, 78), (89, 78)]:
        b.sprite('spr_deco_barrel_closed', x, y, check=False)
    b.sprite('spr_deco_well', 83, 79, check=False)
    for (x, y) in [(75, 77), (76, 77)]:
        b.sprite('spr_deco_crate_01', x, y, check=False)
    flower_bed(b, 74, 77, 73); flower_bed(b, 83, 86, 73)
    for x in (66, 68): b.put('pine_small', x, 70)
    fence_rect(b, 104, 64, 116, 77, gates=[(110, 77)])
    b.road([(110, 77), (110, 79)])
    houses(b, [('orange_gable', 107, 58)], 'ranch')
    b.sprite('spr_deco_trough', 106, 66, check=False)
    rng = b.rng
    spots = []
    for (name, n) in [('spr_deco_cow', 3), ('spr_deco_sheep_01', 4), ('spr_deco_pig_01', 2)]:
        k = 0; tries = 0
        while k < n and tries < 400:
            tries += 1
            x, y = rng.randrange(106, 115), rng.randrange(67, 76)
            if any(abs(x - a) < 3 and abs(y - c) < 2 for a, c in spots): continue
            if b.sprite(name, x, y, flip=rng.random() < 0.5, frame=rng.randrange(4)): k += 1; spots.append((x, y))
    for k in range(5):
        x, y = rng.randrange(99, 103), rng.randrange(73, 78)
        b.sprite('spr_deco_chicken_01', x, y, flip=rng.random() < 0.5, frame=rng.randrange(4))


def fishers_cove(b):
    houses(b, [('orange_tall', 120, 64), ('green_house_b', 125, 66)], 'cove')
    b.put('stilt_red_b', 143, 83, check=False)
    b.put('stilt_red_a', 147, 79, check=False)
    hpier(b, 150, 156, 68)
    b.pier(133, 91, 97)
    b.objs.append({'kind': 'sprite', 'name': 'spr_deco_coracle', 'tx': 153, 'ty': 70, 'frame': 1})
    b.objs.append({'kind': 'sprite', 'name': 'spr_deco_coracle', 'tx': 137, 'ty': 95, 'frame': 2, 'flip': True})
    b.put('green_stall_hut', 140, 64, terrain='S')
    for (x, y) in [(144, 66), (145, 66), (144, 73)]:
        b.sprite('spr_deco_crate_01', x, y)
    for (x, y) in [(139, 70), (147, 72)]:
        b.sprite('spr_deco_barrel_water', x, y)
    # a beach bonfire and the shore's small life: starfish, shells, crabs
    b.sprite('spr_deco_firepit', 140, 74)
    b.objs.append({'kind': 'sprite', 'name': 'spr_deco_fire_01', 'tx': 140, 'ty': 74, 'dy': -4, 'frame': 2, 'z': 74.995})
    for (x, y) in [(139, 75), (141, 75)]:
        b.sprite('spr_deco_chair_01', x, y)
    ys, xs = np.nonzero((b.lab == 'S') & ~b.occ)
    for y, x in zip(ys, xs):
        r = b.rng.random()
        if r < 0.012: b.ground(x, y, b.rng.choice([1273, 1274])); b.occ[y, x] = True
        elif r < 0.02: b.ground(x, y, 1272); b.occ[y, x] = True
        elif r < 0.026: b.ground(x, y, 1276, b.rng.choice([0, 1])); b.occ[y, x] = True
    b.sprite('spr_deco_coracle_land', 142, 76)
    for (x, y) in [(147, 74), (139, 81)]:
        b.sprite('spr_deco_barrel_closed', x, y)
    b.sprite('spr_deco_chair_01', 141, 69); b.sprite('spr_deco_oar', 143, 78, block=False)
    for (x, y) in [(147, 70), (148, 66)]:
        b.objs.append({'kind': 'sprite', 'name': 'spr_deco_duck_01', 'tx': x + 4, 'ty': y + 4, 'frame': x % 4})


def islets(b):
    b.put('green_hut', 15, 95, check=False)
    b.put('pine_small', 19, 95, check=False)
    b.put('rock_290', 18, 97, check=False)
    # rocks standing in the sea a little way off the cliffs
    from scipy import ndimage as nd
    sea = b.lab == 'W'
    band = nd.binary_dilation(~sea, iterations=6) & ~nd.binary_dilation(~sea, iterations=3) & sea
    ys, xs = np.nonzero(band)
    for y, x in zip(ys, xs):
        if b.rng.random() < 0.012: b.ground(x, y, b.rng.choice([287, 290, 288]))
    b.put('pine_tall', 151, 91, check=False)
    b.put('rock_287', 153, 93, check=False)
    for (x, y) in [(24, 6), (142, 4), (154, 50), (4, 60)]:
        b.put(b.rng.choice(['rock_288', 'rock_290', 'rock_289']), x, y, check=False)


def caves(b):
    B = b.d.bands
    cave(b, 145, 147, B['B4E'][146])
    cave(b, 12, 14, B['B4W'][13])
    cave(b, 26, 28, B['B3'][27])
    cave(b, 122, 124, B['B2'][123])


def greenery(b):
    woods = [
        blob(b, 10, 22, 17, 29, seed=1) | blob(b, 34, 11, 42, 18, seed=2) | blob(b, 10, 12, 14, 24, seed=13),   # haunted wood
        blob(b, 30, 19, 50, 33, seed=3) & ~rect(42, 24, 52, 28),             # west wood
        blob(b, 96, 25, 113, 37, seed=4),                                    # east grove beside the mill
        blob(b, 55, 42, 71, 55, seed=5), blob(b, 89, 42, 105, 55, seed=6),  # inside the V, beside the shrine
        blob(b, 11, 70, 20, 84, seed=7),                                     # south-west coast wood
        blob(b, 59, 82, 70, 91, seed=9),                                     # south coast grove
        blob(b, 98, 54, 112, 64, seed=10) & ~rect(104, 57, 114, 64),         # behind the ranch barn
        blob(b, 129, 72, 137, 86, seed=11),                                  # Fisher's Cove backwoods
    ]
    for m in woods:
        forest(b, m)
        forest_rim(b, m)
    # the rest of the unused land grows wild, except the open ground round the crystal
    yy, xx = np.mgrid[0:H, 0:W]
    keep_open = ((xx - 80) ** 2 + (yy - 56) ** 2 < 14 ** 2)
    wild = content2.wild_forests(b, cover=0.6, reserve=keep_open, road_gap=2)
    forest(b, wild)
    forest_rim(b, wild, density=0.25)
    allg = np.ones((H, W), bool)
    scatter(b, allg, FLOWERS, 0.03)
    scatter(b, allg, BUSHES, 0.01)
    scatter(b, allg, ROCKS, 0.005)
    scatter(b, allg, ['pine_small', 'stump_351', 'stump_352'], 0.003)
    scatter(b, allg, ['spr_deco_tree_01', 'spr_deco_tree_02'], 0.004)
    ys, xs = np.nonzero((b.lab == 'S') & ~b.occ)
    for y, x in zip(ys, xs):
        if b.rng.random() < 0.01: b.put(b.rng.choice(['rock_288', 'rock_289', 'rock_290']), x, y, terrain='S')


def build(seed=7):
    d = designer2.build(seed)
    b = Builder(d)
    network(b)
    content2.ladder_spurs(b)
    for f in (shrine, lakeside, spring, ruins, graveyard, quarry, windmill_fields, terraces, westbrook, almia_town, fishers_cove, islets, caves):
        f(b)
    greenery(b)
    finish_paths(b)
    d.paths = b.paths
    # Ranger outposts (healing points the trainers use) and the six spawn points, all on roads
    b.outposts = [(26, 68), (83, 82), (60, 40), (128, 24), (133, 68), (100, 40)]
    b.spawns = [(14, 48), (140, 48), (40, 80), (112, 80), (22, 27), (122, 14)]
    return d, b
