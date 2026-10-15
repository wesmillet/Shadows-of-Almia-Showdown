"""Tiled automapping, enough of it for the Fan-tasy rule files.

A rules map has a `Regions` layer marking each rule's cells, `input_<L>`
layers (what layer L must hold there) and `output_<L>` layers (what is
written). Inputs match tiles literally (the artist paints explicit marker
tiles: E for empty, a solid body, UP for the upper side). Empty input cells
are ignored. Rules are taken in reading order of their regions; with
NoOverlappingOutput a match is skipped when any of its output cells was
already written by an earlier match.
"""
import numpy as np
from scipy import ndimage
import tiled


class Rule:
    __slots__ = ('inputs', 'outputs', 'origin')

    def __init__(self):
        self.inputs = {}    # layer -> [(dx, dy, (tileset, id) )]
        self.outputs = {}   # layer -> [(dx, dy, (tileset, id), gid flags)]
        self.origin = (0, 0)


def key(m, gid):
    r = m.resolve(gid)
    return None if r is None else (r[0], r[1], gid & 0xE0000000)


class RuleSet:
    def __init__(self, name):
        m = tiled.Map('Rules/' + name)
        self.name = name
        props = {}
        import xml.etree.ElementTree as ET, os
        root = ET.parse(os.path.join(tiled.TMX_DIR, 'Rules', name + '.tmx')).getroot()
        for p in root.find('properties') or []:
            props[p.get('name')] = p.get('value')
        self.no_overlap = props.get('NoOverlappingOutput', 'false') == 'true'
        reg = m.layer('Regions') > 0
        lbl, n = ndimage.label(reg, structure=np.ones((3, 3)))
        objs = ndimage.find_objects(lbl)
        rules = []
        for i, sl in enumerate(objs, 1):
            r = Rule(); ys, xs = sl
            r.origin = (ys.start, xs.start)
            cells = np.argwhere(lbl[sl] == i)
            for kind, lname, data in m.layers:
                if kind != 'tiles' or lname == 'Regions': continue
                tgt = r.inputs if lname.startswith('input') else r.outputs if lname.startswith('output') else None
                if tgt is None: continue
                layer = lname.split('_', 1)[1]
                lst = []
                for (cy, cx) in cells:
                    g = int(data[ys.start + cy, xs.start + cx])
                    k = key(m, g)
                    if k is not None: lst.append((cx, cy, k))
                    elif tgt is r.outputs: pass
                if lst: tgt.setdefault(layer, []).extend(lst)
            if r.inputs and r.outputs: rules.append(r)
        rules.sort(key=lambda r: r.origin)
        self.rules = rules

    def apply(self, layers, w, h):
        """layers: dict name -> object array (h, w) of keys (tileset, id, flags) or None. Writes outputs in place."""
        written = {}
        for r in self.rules:
            # candidate anchors: positions where the first input cell matches
            (lname0, cells0) = next(iter(r.inputs.items()))
            dx0, dy0, k0 = cells0[0]
            L0 = layers.get(lname0)
            if L0 is None: continue
            hits = np.argwhere(L0 == k0) if False else [(y, x) for y in range(h) for x in range(w) if L0[y, x] == k0]
            for (y, x) in hits:
                ox, oy = x - dx0, y - dy0
                ok = True
                for lname, cells in r.inputs.items():
                    L = layers.get(lname)
                    for dx, dy, k in cells:
                        X, Y = ox + dx, oy + dy
                        if not (0 <= X < w and 0 <= Y < h) or L[Y, X] != k: ok = False; break
                    if not ok: break
                if not ok: continue
                outs = [(lname, ox + dx, oy + dy, k) for lname, cells in r.outputs.items() for dx, dy, k in cells
                        if 0 <= ox + dx < w and 0 <= oy + dy < h]
                if self.no_overlap and any((ln, X, Y) in written for ln, X, Y, _ in outs): continue
                for ln, X, Y, k in outs:
                    layers.setdefault(ln, np.full((h, w), None, dtype=object))[Y, X] = k
                    written[(ln, X, Y)] = True
        return layers


def keys(m, a):
    """A map layer as an object array of tile keys (None = empty)."""
    out = np.full(a.shape, None, dtype=object)
    for y in range(a.shape[0]):
        for x in range(a.shape[1]):
            out[y, x] = key(m, int(a[y, x]))
    return out
