"""Areas drawn in Tiled: hand-made places (the castle) kept as Tiled maps the island build stamps
in, so anyone can open them with the pack's whole tileset and change them.

    python3 scripts/fantasy/build3.py --export-castle   writes areas/castle.tmx from the generated castle
    python3 scripts/fantasy/areas.py install castle      copies it into the pack (next to the samples) to edit
    python3 scripts/fantasy/areas.py fetch castle        copies the edited map back into the repo
    python3 scripts/fantasy/build3.py                    builds the island with areas/castle.tmx when it exists

The map covers the area's rectangle (its top-left is map tile `rect` x0, y0, stored as the map
properties `x0` and `y0`). What the build reads:

    tile layers       stamped over the island as they are, in order, as stack layers of the same
                      names (a name ending in "(preview)" is only there to look at: the island
                      paints that part itself, so edits to it are ignored)
    "Solid"           a tile layer: tiles with anything in them are walls, never walked
    "Paving"          an object layer of rectangles and ellipses, class "Slab" or "Mid Slab" (a
                      rectangle's int property "corner" rounds its outer corners, in pixels):
                      slabs painted with the castle floor set, with the edges smoothed at pixel
                      level, ellipses as true ovals (the battlefield's light oval)
    "Objects"         an object layer of tile objects: props, trees, furniture from any object tileset
    "Buildings"       a group: each image layer in it (a baked picture, such as the keep) stands on the
                      map as a depth-sorted object; its property `foot` (rows, default 3) is the
                      part of it nobody walks through. A group of tile layers inside it is baked
                      into one picture the same way.
    "Markers"         an object layer of points and rectangles by name: `healer`, `challenger`
                      (where those NPCs stand), `statue` (a stone Pokémon, property `dex`),
                      `arena` (a rectangle: the battlefield's box)
"""
import os, sys, shutil, functools
import xml.etree.ElementTree as ET
import numpy as np
from PIL import Image
import tiled

HERE = os.path.dirname(os.path.abspath(__file__))
AREAS = os.path.join(HERE, 'areas')
META = 'almia_meta'
PREVIEW = ' (preview)'
PAVE_CLASS = {'Slab': 1, 'Mid Slab': 2}


def path(name):
    return os.path.join(AREAS, name + '.tmx')


def exists(name):
    return os.path.exists(path(name))


# ---------------------------------------------------------------- writing

def write(area, preview_layers=()):
    """Writes area (castle3's dict) as areas/<name>.tmx with its pictures beside it.
    preview_layers: [(name, full-map object array, opacity)] the island's own layers under the
    area, written as "(preview)" layers so the editor shows the ground."""
    name = area['name']
    x0, y0, x1, y1 = area['rect']
    w, h = x1 - x0, y1 - y0
    os.makedirs(AREAS, exist_ok=True)
    # every tileset of the pack goes in, so the editor's tileset panel offers the whole set
    used = {fn[:-4] for fn in os.listdir(tiled.TSX_DIR) if fn.endswith('.tsx') and fn[:-4] != META}
    first = {}
    gid = 1
    for ts in sorted(used) + [META]:
        first[ts] = gid
        t = tiled.tileset(ts) if ts != META else None
        gid += (max(t.count, (max(t.tiles) + 1) if t.tiles else 0)) if t else 1
    root = ET.Element('map', version='1.10', tiledversion='1.11.0', orientation='orthogonal', renderorder='right-down',
                      width=str(w), height=str(h), tilewidth='16', tileheight='16', infinite='0', nextlayerid='1', nextobjectid='1')
    props = ET.SubElement(root, 'properties')
    for k, v in (('x0', x0), ('y0', y0)):
        ET.SubElement(props, 'property', name=k, type='int', value=str(v))
    for ts in sorted(first, key=first.get):
        ET.SubElement(root, 'tileset', firstgid=str(first[ts]), source=f'../Tilesets/{ts}.tsx')
    lid = [1]; oid = [1]

    def tile_layer(parent, lname, arr, opacity=1.0, visible=True, locked=False):
        el = ET.SubElement(parent, 'layer', id=str(lid[0]), name=lname, width=str(w), height=str(h))
        lid[0] += 1
        if opacity != 1.0: el.set('opacity', f'{opacity:g}')
        if not visible: el.set('visible', '0')
        if locked: el.set('locked', '1')
        rows = []
        for y in range(y0, y1):
            row = []
            for x in range(x0, x1):
                k = arr[y, x] if (0 <= y < arr.shape[0] and 0 <= x < arr.shape[1]) else None
                row.append('0' if k is None else str((first[k[0]] + k[1]) | k[2]))
            rows.append(','.join(row))
        data = ET.SubElement(el, 'data', encoding='csv')
        data.text = '\n' + ',\n'.join(rows) + '\n'
        return el

    for lname, arr, op in preview_layers:
        tile_layer(root, lname + PREVIEW, arr, op, locked=True)
    for lname, arr, op in area['layers']:
        tile_layer(root, lname, arr, op)
    # the solid tiles
    solid = np.full(area['solid'].shape, None, dtype=object)
    for (yy, xx) in zip(*np.nonzero(area['solid'])): solid[yy, xx] = (META, 0, 0)
    tile_layer(root, 'Solid', solid, 0.45)
    # paving shapes
    pg = ET.SubElement(root, 'objectgroup', id=str(lid[0]), name='Paving'); lid[0] += 1
    for sh in area['pave']:
        cls = {1: 'Slab', 2: 'Mid Slab'}[sh[5]]
        if sh[0] == 'rect':
            _, rx0, ry0, rx1, ry1, _ = sh
            ET.SubElement(pg, 'object', id=str(oid[0]), **{'class': cls}, x=str((rx0 - x0) * 16), y=str((ry0 - y0) * 16), width=str((rx1 - rx0) * 16), height=str((ry1 - ry0) * 16))
        else:
            _, cx, cy, rx, ry, _ = sh
            el = ET.SubElement(pg, 'object', id=str(oid[0]), **{'class': cls}, x=f'{(cx - rx - x0) * 16:g}', y=f'{(cy - ry - y0) * 16:g}', width=f'{rx * 32:g}', height=f'{ry * 32:g}')
            ET.SubElement(el, 'ellipse')
        oid[0] += 1
    # props
    og = ET.SubElement(root, 'objectgroup', id=str(lid[0]), name='Objects'); lid[0] += 1
    for o in area['objects']:
        if 'key' not in o: continue
        ts, tid, flags = o['key']
        tw, th = tiled.tileset(ts).tiles[tid].w, tiled.tileset(ts).tiles[tid].h
        ET.SubElement(og, 'object', id=str(oid[0]), gid=str((first[ts] + tid) | flags), x=str(o['x'] - x0 * 16), y=str(o['y'] - y0 * 16), width=str(tw), height=str(th))
        oid[0] += 1
    # baked pictures as image layers
    bg = ET.SubElement(root, 'group', id=str(lid[0]), name='Buildings'); lid[0] += 1
    for o in area['objects']:
        if 'img' not in o: continue
        fn = f'{name}_{o["name"]}.png'
        Image.fromarray(o['img']).save(os.path.join(AREAS, fn))
        el = ET.SubElement(bg, 'imagelayer', id=str(lid[0]), name=o['name'], offsetx=str(o['x'] - x0 * 16), offsety=str(o['y'] - y0 * 16 - o['img'].shape[0]))
        lid[0] += 1
        ps = ET.SubElement(el, 'properties')
        ET.SubElement(ps, 'property', name='foot', type='int', value=str(o.get('foot', 3)))
        ET.SubElement(el, 'image', source=fn, width=str(o['img'].shape[1]), height=str(o['img'].shape[0]))
    # markers
    mg = ET.SubElement(root, 'objectgroup', id=str(lid[0]), name='Markers'); lid[0] += 1
    def point(nm, x, y, props=None):
        el = ET.SubElement(mg, 'object', id=str(oid[0]), name=nm, x=f'{(x - x0) * 16:g}', y=f'{(y - y0) * 16:g}')
        ET.SubElement(el, 'point')
        if props:
            ps = ET.SubElement(el, 'properties')
            for k, v in props.items(): ET.SubElement(ps, 'property', name=k, value=str(v))
        oid[0] += 1
    for n in area['npcs']: point(n['role'], n['x'], n['y'])
    for (dex, sx, sy) in area.get('statues', []): point('statue', sx, sy, {'dex': dex})
    a = area.get('arena')
    if a:
        ET.SubElement(mg, 'object', id=str(oid[0]), name='arena', x=str((a['x0'] - x0) * 16), y=str((a['y0'] - y0) * 16), width=str((a['x1'] - a['x0']) * 16), height=str((a['y1'] - a['y0']) * 16))
        oid[0] += 1
    root.set('nextlayerid', str(lid[0])); root.set('nextobjectid', str(oid[0]))
    ET.indent(root)
    ET.ElementTree(root).write(path(name), encoding='UTF-8', xml_declaration=True)
    return path(name)


def refresh_previews(name, layers):
    """Rewrites the "(preview)" layers of areas/<name>.tmx from the island's own layers
    [(name, full-map object array, opacity)], so the editor shows the ground and the paving as
    the last build made them. Everything else in the file is left as it is."""
    tree = ET.parse(path(name))
    root = tree.getroot()
    mp = tiled.properties(root)
    x0, y0 = int(mp.get('x0', 0)), int(mp.get('y0', 0))
    w, h = int(root.get('width')), int(root.get('height'))
    sets = [(int(t.get('firstgid')), os.path.basename(t.get('source').replace('\\', '/'))[:-4], t) for t in root.findall('tileset')]
    first = {n: f for f, n, _ in sets}
    def gid_of(k):
        if k[0] not in first:
            t = tiled.tileset(k[0])
            last_f, last_n, last_el = max(sets, key=lambda s: s[0])
            lt = tiled.tileset(last_n) if last_n != META else None
            nf = last_f + ((max(lt.count, (max(lt.tiles) + 1) if lt.tiles else 0)) if lt else 1)
            el = ET.Element('tileset', firstgid=str(nf), source=f'../Tilesets/{k[0]}.tsx')
            root.insert(list(root).index(last_el) + 1, el)
            sets.append((nf, k[0], el)); first[k[0]] = nf
        return (first[k[0]] + k[1]) | k[2]
    existing = {c.get('name'): c for c in root.findall('layer') if c.get('name', '').endswith(PREVIEW)}
    nid = int(root.get('nextlayerid', 1))
    at = 0
    for lname, arr, op in layers:
        pn = lname + PREVIEW
        el = existing.get(pn)
        if el is None:
            el = ET.Element('layer', id=str(nid), name=pn, width=str(w), height=str(h), locked='1'); nid += 1
            if op != 1.0: el.set('opacity', f'{op:g}')
            root.insert(at + sum(1 for c in root if c.tag in ('properties', 'tileset')), el)
            ET.SubElement(el, 'data', encoding='csv')
        at += 1
        rows = []
        for y in range(y0, y0 + h):
            row = []
            for x in range(x0, x0 + w):
                k = arr[y, x] if (0 <= y < arr.shape[0] and 0 <= x < arr.shape[1]) else None
                row.append('0' if k is None else str(gid_of(k)))
            rows.append(','.join(row))
        el.find('data').text = '\n' + ',\n'.join(rows) + '\n'
    root.set('nextlayerid', str(nid))
    ET.indent(root)
    tree.write(path(name), encoding='UTF-8', xml_declaration=True)


# ---------------------------------------------------------------- reading

def load(name, shape, statue_fn=None):
    """areas/<name>.tmx as castle3's area dict for a map of `shape` (rows, cols) tiles."""
    m = tiled.Map(name, path=path(name))
    mp = tiled.properties(ET.parse(m.path).getroot())
    x0, y0 = int(mp.get('x0', 0)), int(mp.get('y0', 0))
    w, h = m.w, m.h
    area = {'name': name, 'rect': (x0, y0, x0 + w, y0 + h), 'layers': [], 'pave': [], 'objects': [], 'statues': [], 'npcs': [], 'arena': None}
    solid = np.zeros(shape, bool)
    blocked = np.zeros(shape, bool)
    claimed = np.zeros(shape, bool)

    def place(arr):
        full = np.full(shape, None, dtype=object)
        ys, xs = slice(y0, min(shape[0], y0 + h)), slice(x0, min(shape[1], x0 + w))
        full[ys, xs] = arr[:ys.stop - ys.start, :xs.stop - xs.start]
        return full

    def picture(img, px, py_bottom, foot, nm):
        """A baked picture at map pixels (px left, py_bottom), with its bottom `foot` rows solid."""
        ih, iw = img.shape[:2]
        area['objects'].append({'img': img, 'name': nm, 'x': int(px), 'y': int(py_bottom), 'foot': foot})
        al = img[:, :, 3] > 40
        ty1 = int(round(py_bottom / 16)); tx0 = int(round(px / 16))
        th, tw = ih // 16, iw // 16
        tiles = al[:th * 16, :tw * 16].reshape(th, 16, tw, 16).mean(axis=(1, 3)) > 0.3
        for r in range(max(0, th - foot), th):
            for c in range(tw):
                yy, xx = ty1 - th + r, tx0 + c
                if tiles[r, c] and 0 <= yy < shape[0] and 0 <= xx < shape[1]: blocked[yy, xx] = True
        claimed[max(0, ty1 - th):ty1 + 2, max(0, tx0 - 1):tx0 + tw + 1] = True

    root = ET.parse(m.path).getroot()
    buildings = set()
    for g in root.findall('group'):
        if g.get('name') == 'Buildings':
            for c in g:
                if c.tag == 'imagelayer' and c.get('visible', '1') != '0':
                    src = os.path.join(AREAS, c.find('image').get('source'))
                    img = np.array(Image.open(src).convert('RGBA'))
                    ox, oy = float(c.get('offsetx', 0)), float(c.get('offsety', 0))
                    foot = int(tiled.properties(c).get('foot', 3))
                    picture(img, x0 * 16 + ox, y0 * 16 + oy + img.shape[0], foot, c.get('name'))
                elif c.tag == 'group':
                    buildings.add('Buildings/' + c.get('name') + '/')
    baked = {}
    for kind, lname, data in m.layers:
        meta = m.meta.get(lname, {})
        if kind != 'tiles' or not meta.get('visible', True): continue
        if lname.endswith(PREVIEW): continue
        base = lname.split('/')[-1]
        if base == 'Solid':
            solid |= place(data > 0) == True
            continue
        grp = next((b for b in buildings if lname.startswith(b)), None)
        if grp:
            # a building drawn as tiles: baked into one picture
            img = baked.setdefault(grp, np.zeros((h * 16, w * 16, 4), np.float32))
            for y in range(h):
                for x in range(w):
                    g = int(data[y, x]); rs = m.resolve(g)
                    if not rs: continue
                    a = tiled.tileset(rs[0]).tile_image(rs[1])
                    if a is not None: tiled.blit(img, tiled.apply_flips(a, g), x * 16, y * 16, meta.get('opacity', 1.0))
            continue
        if lname.startswith('Buildings/'): continue
        keys = np.full((h, w), None, dtype=object)
        for y in range(h):
            for x in range(w):
                g = int(data[y, x]); rs = m.resolve(g)
                if rs: keys[y, x] = (rs[0], rs[1], g & 0xE0000000)
        area['layers'].append((base, place(keys), meta.get('opacity', 1.0)))
    for grp, img in baked.items():
        img8 = img.clip(0, 255).astype(np.uint8)
        al = img8[:, :, 3] > 40
        if not al.any(): continue
        ys, xs = np.nonzero(al)
        ty0, ty1 = ys.min() // 16, ys.max() // 16 + 1
        tx0, tx1 = xs.min() // 16, xs.max() // 16 + 1
        gname = grp.split('/')[1]
        foot = 3
        for g in root.findall('group'):
            if g.get('name') == 'Buildings':
                for c in g.findall('group'):
                    if c.get('name') == gname: foot = int(tiled.properties(c).get('foot', 3))
        picture(img8[ty0 * 16:ty1 * 16, tx0 * 16:tx1 * 16], (x0 + tx0) * 16, (y0 + ty1) * 16, foot, gname)
    for o in m.shapes.get('Paving', []):
        if not o['visible']: continue
        cls = PAVE_CLASS.get(o['cls'], 1)
        if o['kind'] == 'ellipse':
            area['pave'].append(('ellipse', x0 + (o['x'] + o['w'] / 2) / 16, y0 + (o['y'] + o['h'] / 2) / 16, o['w'] / 32, o['h'] / 32, cls))
        elif o['kind'] == 'rect':
            r = ('rect', x0 + int(round(o['x'] / 16)), y0 + int(round(o['y'] / 16)),
                 x0 + int(round((o['x'] + o['w']) / 16)), y0 + int(round((o['y'] + o['h']) / 16)), cls)
            area['pave'].append(r)
            # a "corner" property (pixels): the rectangle's outer corners are rounded that much
            if o['props'].get('corner'): area.setdefault('rounded', []).append(r[1:5] + (int(o['props']['corner']),))
    for o in m.shapes.get('Objects', []):
        if not o['visible'] or not o['gid']: continue
        rs = m.resolve(o['gid'])
        if not rs: continue
        area['objects'].append({'key': (rs[0], rs[1], o['gid'] & 0xE0000000), 'x': x0 * 16 + o['x'], 'y': y0 * 16 + o['y']})
    for o in m.shapes.get('Markers', []):
        if not o['visible']: continue
        nm = o['name']
        if nm in ('healer', 'challenger'):
            area['npcs'].append({'role': nm, 'x': x0 + o['x'] / 16, 'y': y0 + o['y'] / 16, 'town': 'Castle'})
        elif nm == 'statue':
            area['statues'].append((str(o['props'].get('dex', '0251')), x0 + o['x'] / 16, y0 + o['y'] / 16))
        elif nm == 'arena' and o['kind'] == 'rect':
            area['arena'] = {'x0': x0 + int(round(o['x'] / 16)), 'y0': y0 + int(round(o['y'] / 16)),
                             'x1': x0 + int(round((o['x'] + o['w']) / 16)), 'y1': y0 + int(round((o['y'] + o['h']) / 16))}
    area['solid'] = solid
    area['blocked'] = blocked
    area['claimed'] = claimed
    return area


# ---------------------------------------------------------------- the pack round trip

def install(name):
    """Copies areas/<name>.tmx, its pictures and the meta tileset into the pack, next to the samples."""
    dst = os.path.join(tiled.TMX_DIR, f'Almia {name}.tmx')
    shutil.copy(path(name), dst)
    for fn in os.listdir(AREAS):
        if fn.startswith(name + '_') and fn.endswith('.png'): shutil.copy(os.path.join(AREAS, fn), tiled.TMX_DIR)
    for fn in (META + '.tsx', META + '.png'): shutil.copy(os.path.join(AREAS, fn), tiled.TSX_DIR)
    print('installed', dst)
    print('open it in Tiled, save, then: python3 scripts/fantasy/areas.py fetch', name)


def fetch(name):
    src = os.path.join(tiled.TMX_DIR, f'Almia {name}.tmx')
    shutil.copy(src, path(name))
    for fn in os.listdir(tiled.TMX_DIR):
        if fn.startswith(name + '_') and fn.endswith('.png'): shutil.copy(os.path.join(tiled.TMX_DIR, fn), AREAS)
    print('fetched', path(name))


if __name__ == '__main__':
    cmd, nm = sys.argv[1], sys.argv[2]
    {'install': install, 'fetch': fetch}[cmd](nm)
