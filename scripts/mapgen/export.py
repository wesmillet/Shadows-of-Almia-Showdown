"""Writes assets/maps/almia.json (format 2) and a preview PNG from the
resolved terrain and the placed content."""
import json, os, numpy as np, sunny, lib, render2
from scipy import ndimage

ROOT = sunny.ROOT
WATER_TILES = {414, 415, 416, 417, 470, 478, 479, 480, 481, 542, 543, 544, 545, 859}
CENTER = (80, 56)


def layer_rows(T, F):
    return [[int(t) | (int(f) << 12) if t else 0 for t, f in zip(rt, rf)] for rt, rf in zip(T, F)]


def grid_rows(a):
    return [''.join(str(int(v)) for v in row) for row in a]


def sprite_def(name):
    if name in sunny.PROPS:
        m = sunny.PROPS[name]
        return {'src': f"tiles/sunnyside/props/{m['file']}", 'w': m['w'], 'h': m['h'], 'frames': m['frames'], 'fps': m['fps']}
    return None


def export(d, b, out, name='almia', seed=7):
    H, W = d.lab.shape
    lab = d.lab
    # ---- tile layers
    sea = np.zeros((H, W), np.int32)
    for y in range(H):
        for x in range(W):
            sea[y, x] = render2.SEA[(x % 4, y % 4)]
    layers = [{'name': 'sea', 'tiles': layer_rows(sea, np.zeros_like(sea))}]
    layers.append({'name': 'land', 'tiles': layer_rows(*out['land'])})
    layers.append({'name': 'paths', 'tiles': layer_rows(*out['paths'])})
    if 'dark' in out: layers.append({'name': 'dark', 'tiles': layer_rows(*out['dark'])})
    decks = np.zeros((H, W), np.int32)
    for (x, y), e in b.ptile.items():
        if 0 <= x < W and 0 <= y < H: decks[y, x] = e
    layers.append({'name': 'decks', 'tiles': decks.tolist()})
    layers.append({'name': 'shadows', 'tiles': layer_rows(*out['shadows'])})
    depth = max((len(v) for v in b.gdeco.values()), default=0)
    for k in range(depth):
        g = np.zeros((H, W), np.int32)
        for (x, y), es in b.gdeco.items():
            if k < len(es) and 0 <= x < W and 0 <= y < H: g[y, x] = es[k]
        layers.append({'name': f'decor{k + 1}', 'tiles': g.tolist()})
    # ---- objects
    prefabs, objects, sprites, sdefs = {}, [], [], {}
    for o in b.objs:
        if o['kind'] == 'prefab':
            if o.get('name'):
                key = o['name']
                if key not in prefabs:
                    p = lib.PREFABS[key]
                    prefabs[key] = {'w': p['w'], 'h': p['h'], 'layers': p['layers']}
            else:
                key = 't' + '_'.join(str(e) for row in o['tiles'] for e in row)
                if key not in prefabs:
                    prefabs[key] = {'w': o['w'], 'h': o['h'], 'layers': [o['tiles']]}
            objects.append([key, o['x'], o['y']])
        elif o['kind'] == 'crop':
            nm = 'crop_' + o['name']
            if nm not in sdefs:
                from PIL import Image
                im = Image.open(f"{ROOT}/assets/tiles/sunnyside/crops/{o['name']}.png")
                sdefs[nm] = {'src': f"tiles/sunnyside/crops/{o['name']}.png", 'w': im.width, 'h': im.height, 'frames': 1, 'fps': 0}
            dd = sdefs[nm]
            # bottom-centre of the crop sits 2 px above the cell's bottom
            sprites.append({'s': nm, 'x': o['tx'] * 16 + 8, 'y': o['ty'] * 16 + 14, 'ax': dd['w'] / 2, 'ay': dd['h'], 'z': o['ty'] + 0.6})
        else:
            nm = o['name']
            if nm not in sdefs: sdefs[nm] = sprite_def(nm)
            m = sunny.PROPS[nm]
            fr = int(o.get('frame', 0)) % m['frames']
            if 'px' in o:
                ax = (m['w'] - m['originX']) if o.get('flip') else m['originX']
                sprites.append({'s': nm, 'x': o['px'], 'y': o['py'], 'ax': ax, 'ay': m['originY'], 'z': o.get('z', o['py'] / 16), 'f': int(bool(o.get('flip'))), 'fr': fr})
            else:
                fx, fy = render2.sprite_foot(nm)
                if o.get('flip'): fx = m['w'] - fx
                sprites.append({'s': nm, 'x': o['tx'] * 16 + 8, 'y': o['ty'] * 16 + 15 + o.get('dy', 0), 'ax': fx, 'ay': fy,
                                'z': o.get('z', o['ty'] + 0.99), 'f': int(bool(o.get('flip'))), 'fr': fr})
    # ---- walking
    T, Fl = out['land']
    terrain = np.isin(lab, ['G', 'S', 'M'])
    river = lab == 'R'
    terrain |= river & ~np.isin(T, list(WATER_TILES))
    walk = (terrain & ~b.block) | b.walk_extra
    lbl, n = ndimage.label(walk)
    reach = lbl == lbl[CENTER[1], CENTER[0]]
    # ---- biomes: 0 water, 1 meadow, 2 forest, 3 shore
    biome = np.ones((H, W), np.int8)
    biome[lab == 'W'] = 0
    biome[river & np.isin(T, list(WATER_TILES))] = 0
    biome[(lab == 'S')] = 3
    near_sea = ndimage.binary_dilation(lab == 'W', iterations=4) & walk & (biome == 1)
    biome[near_sea] = 3
    near_forest = ndimage.binary_dilation(b.forest, iterations=3) & walk
    biome[near_forest & (biome == 1)] = 2
    # ---- minimap: w water, g grass, s sand, f forest, p path, b building, c cliff
    mini = np.full((H, W), 'g')
    mini[biome == 0] = 'w'
    mini[lab == 'S'] = 's'
    mini[lab == 'F'] = 'c'
    mini[b.forest] = 'f'
    mini[(b.paths != '.')] = 'p'
    for o in b.objs:
        if o['kind'] == 'prefab' and o.get('name') and lib.PREFABS[o['name']]['kind'] == 'building':
            mini[o['y']:o['y'] + o['h'], o['x']:o['x'] + o['w']] = 'b'
    data = {
        'version': 2, 'name': name, 'seed': seed, 'cols': W, 'rows': H, 'tileSize': 16,
        'tileset': 'tiles/sunnyside/spr_tileset_sunnysideworld_16px.png', 'tilesetColumns': 64,
        'layers': layers, 'prefabs': prefabs, 'objects': objects, 'spriteDefs': sdefs, 'sprites': sprites,
        'walkable': grid_rows(walk), 'reachable': grid_rows(reach), 'biome': grid_rows(biome),
        'minimap': [''.join(r) for r in mini],
        'center': {'x': CENTER[0], 'y': CENTER[1]},
        'outposts': [{'x': x, 'y': y} for (x, y) in b.outposts],
        'spawns': [{'x': x, 'y': y} for (x, y) in b.spawns],
    }
    for p in data['outposts'] + data['spawns']:
        assert reach[p['y'], p['x']], ('unreachable', p)
    path = f'{ROOT}/assets/maps/{name}.json'
    def conv(o):
        if isinstance(o, np.integer): return int(o)
        if isinstance(o, np.floating): return float(o)
        raise TypeError(type(o))
    with open(path, 'w') as f:
        json.dump(data, f, separators=(',', ':'), default=conv)
    return path, data, walk, reach
