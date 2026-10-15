"""Collision shapes to a walkability grid.

Shapes are rasterised on a 2 px grid (8x8 samples per 16 px tile). A tile is
blocked when a quarter of it is covered, or its centre is.
"""
import numpy as np
from PIL import Image, ImageDraw
import tiled

SUB = 8


class Raster:
    def __init__(self, cols, rows):
        self.cols, self.rows = cols, rows
        self.img = Image.new('L', (cols * SUB, rows * SUB), 0)
        self.d = ImageDraw.Draw(self.img)

    def shape(self, sh, ox, oy, sx=1.0, sy=1.0, flipx_w=None):
        """One collision shape of a picture whose top-left is at map pixel (ox, oy)."""
        kind, x, y, w, h, pts = sh
        k = SUB / 16.0
        def P(px, py):
            if flipx_w is not None: px = flipx_w - px
            return ((ox + px * sx) * k, (oy + py * sy) * k)
        if kind == 'rect':
            a = P(x, y); b = P(x + w, y + h)
            self.d.rectangle([min(a[0], b[0]), min(a[1], b[1]), max(a[0], b[0]) - 0.01, max(a[1], b[1]) - 0.01], fill=255)
        elif kind == 'ellipse':
            a = P(x, y); b = P(x + w, y + h)
            self.d.ellipse([min(a[0], b[0]), min(a[1], b[1]), max(a[0], b[0]), max(a[1], b[1])], fill=255)
        else:
            self.d.polygon([P(px, py) for px, py in pts], fill=255)

    def tile(self, key, tx, ty):
        ts, tid, flags = key
        t = tiled.tileset(ts).tiles.get(tid)
        if t is None or not t.shapes: return
        for sh in t.shapes:
            self.shape(sh, tx * 16, ty * 16, flipx_w=16 if flags & tiled.FLIP_H else None)

    def picture(self, key, x, y_bottom, w=None, h=None):
        ts, tid, flags = key
        t = tiled.tileset(ts).tiles.get(tid)
        if t is None or not t.shapes: return
        W, H = t.w, t.h
        sx = (w / W) if w else 1.0; sy = (h / H) if h else 1.0
        top = y_bottom - H * sy
        for sh in t.shapes:
            self.shape(sh, x, top, sx, sy, flipx_w=W if flags & tiled.FLIP_H else None)

    def blocked(self):
        a = np.array(self.img) > 0
        a = a.reshape(self.rows, SUB, self.cols, SUB)
        frac = a.mean(axis=(1, 3))
        centre = a[:, SUB // 2, :, SUB // 2]
        return (frac >= 0.25) | centre
