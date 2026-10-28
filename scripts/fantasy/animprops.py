"""Animated props from the pack's Animation_* tilesets (torches, campfires, braziers, banners,
flowers, water plants, waterfalls, crystals): multi-tile pictures whose frames sit side by side
in the sheet. A prop is placed as tiles of an "Animations" layer, and the game animates them
(every tile carries its own frame list, exported by export3).

block(tileset, tid)  the prop whose top-left animated tile is tid: (w, h, cells) with cells a
                     list of (dx, dy, tid) to write
blocks(tileset)      every prop in the sheet, by its top-left tile
place(layer, tileset, tid, tx, ty_bottom)  writes the prop with its bottom row on ty_bottom
"""
import functools
import numpy as np
import tiled


@functools.lru_cache(maxsize=None)
def blocks(tileset):
    ts = tiled.tileset(tileset)
    cols = ts.columns
    animated = {tid: t.anim for tid, t in ts.tiles.items() if t.anim}
    px = ts.pixels
    def alpha(t):
        a = px[(t // cols) * 16:(t // cols) * 16 + 16, (t % cols) * 16:(t % cols) * 16 + 16, 3]
        return a
    def joined_v(t_up, t_dn):
        """Two tiles one above the other belong to one picture when their shared edge is drawn."""
        return bool((alpha(t_up)[-1] > 0).any() and (alpha(t_dn)[0] > 0).any())
    seen = set()
    out = {}
    for tid in sorted(animated):
        if tid in seen: continue
        frames = [f for f, _ in animated[tid]]
        step = (frames[1] - frames[0]) if len(frames) > 1 else 1
        if step <= 0 or step >= cols: step = 1
        c0, r0 = tid % cols, tid // cols
        # The prop's first frame may start left of its first animated tile: a still part (a
        # banner's pole) drawn the same in every frame. Such a column joins the prop, so the frame
        # is taken whole (it used to start at the flag, take in the next frame's pole instead, and
        # draw every banner cut off between two poles).
        def same(a, b):
            # a still tile whose place in the next frame holds a still tile too
            return 0 <= b < ts.count and a not in animated and b not in animated and bool((alpha(b) > 0).any())
        while c0 > 0 and c0 - 1 > (tid % cols) - step and (alpha(r0 * cols + c0 - 1) > 0).any() and same(r0 * cols + c0 - 1, r0 * cols + c0 - 1 + step):
            c0 -= 1
        def row_cells(r):
            return [r * cols + c for c in range(c0, min(cols, c0 + step)) if (alpha(r * cols + c) > 0).any()]
        band = [r0]
        r = r0 + 1
        while r * cols + c0 < ts.count and any(joined_v(a, a + cols) for a in row_cells(r - 1) if a + cols in animated or (alpha(a + cols) > 0).any()) and row_cells(r):
            # still rows joined below belong too (a banner's pole and its stone foot); a row of
            # animated tiles under a still row is the next prop in the sheet
            if any(t in animated for t in row_cells(r)) and not any(t in animated for t in row_cells(r - 1)): break
            band.append(r); r += 1
        cells = []
        for r in band:
            for t in row_cells(r):
                cells.append((t % cols - c0, r - band[0], t))
                seen.add(t)
        out[tid] = (step, len(band), sorted(cells, key=lambda c: (c[1], c[0])))
    return out


def block(tileset, tid):
    b = blocks(tileset)
    if tid in b: return b[tid]
    # tid may be any cell of the prop
    for top, (w, h, cells) in b.items():
        if any(t == tid for _, _, t in cells): return b[top]
    raise KeyError(f'{tileset} tile {tid} is not an animated prop')


def place(layer, tileset, tid, tx, ty_bottom):
    """Writes the prop into the object-array layer with its bottom row on ty_bottom and its left
    column on tx. Returns the cells written (y, x) or None when any falls off the layer."""
    w, h, cells = block(tileset, tid)
    y0 = ty_bottom - h + 1
    H, W = layer.shape
    if y0 < 0 or tx < 0 or tx + w > W or ty_bottom >= H: return None
    done = []
    for dx, dy, t in cells:
        layer[y0 + dy, tx + dx] = (tileset, t, 0)
        done.append((y0 + dy, tx + dx))
    return done


def picture(tileset, tid):
    """The prop's first frame as RGBA, for previews."""
    w, h, cells = block(tileset, tid)
    ts = tiled.tileset(tileset)
    img = np.zeros((h * 16, w * 16, 4), np.uint8)
    for dx, dy, t in cells:
        img[dy * 16:dy * 16 + 16, dx * 16:dx * 16 + 16] = ts.tile_image(t)
    return img
