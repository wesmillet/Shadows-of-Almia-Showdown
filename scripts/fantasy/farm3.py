"""Farms outside the towns, drawn with the pack's own farm sets: a tilled field (Tileset_FarmField)
in rows of crops (the Plant_* props), a fence round it (Tileset_Fence_1, painted as the artist's
corner terrain, so the posts and rails turn the corners themselves) with a gap on the town's side,
and the farmstead beside it: a hay-roofed house, haystacks, a cart, a well, a scarecrow.
"""
import random
import numpy as np
from scipy import ndimage
import design3 as D
import wang, content3
from content3 import catalogue


CROPS = [r'Plant_Corn_[123]', r'Plant_Cabbage_1', r'Plant_Pumpkin_[12]', r'Plant_Tomato_1', r'Plant_Carrot_1',
         r'Plant_Eggplant_1', r'Plant_Potatoe_1', r'Plant_Radish_[12]', r'Plant_Cotton_[123]']


def flat_rect(ok, cx, cy, w, h, r=22):
    """The top-left of a w x h rectangle of ok cells nearest (cx, cy), or None."""
    best = None
    H, W = ok.shape
    for dy in range(-r, r + 1):
        for dx in range(-r, r + 1):
            x0, y0 = cx + dx - w // 2, cy + dy - h // 2
            if x0 < 1 or y0 < 1 or x0 + w >= W - 1 or y0 + h >= H - 1: continue
            if ok[y0:y0 + h, x0:x0 + w].all():
                dd = dx * dx + dy * dy
                if best is None or dd < best[0]: best = (dd, x0, y0)
    return None if best is None else best[1:]


def build(d, placer, ok, towards, near, size=(16, 10), seed=5, house=None):
    """A farm near `near` (tile x, y) on ok ground, its gate facing `towards`.
    Returns (fence layer, field layer, fence cells mask, objects) or None."""
    rng = random.Random(seed)
    fw, fh = size
    spot = flat_rect(ok & placer.free, near[0], near[1], fw + 2, fh + 2)
    if spot is None: return None
    x0, y0 = spot[0] + 1, spot[1] + 1                      # the fence rectangle
    shape = d.land.shape
    fence_cells = np.zeros(shape, np.int32)
    fence_cells[y0:y0 + fh, x0:x0 + fw] = 1
    Fe = wang.WangSet('Tileset_Fence_1', seed=seed)
    fence = Fe.paint(fence_cells)
    # the field: two tiles inside the fence, the crops in rows
    Ff = wang.WangSet('Tileset_FarmField', seed=seed)
    field_cells = np.zeros(shape, np.int32)
    field_cells[y0 + 2:y0 + fh - 2, x0 + 2:x0 + fw - 2] = 1
    field = Ff.paint(field_cells)
    # the gate: two fence cells facing the town, cleared
    ring = fence_cells.astype(bool) & ~ndimage.binary_erosion(fence_cells.astype(bool))
    gx, gy = x0 + fw // 2, (y0 + fh - 1 if towards[1] > y0 else y0)
    if abs(towards[0] - (x0 + fw / 2)) > abs(towards[1] - (y0 + fh / 2)):
        gx, gy = (x0 + fw - 1 if towards[0] > x0 else x0), y0 + fh // 2
        gap = [(gy, gx), (gy + 1, gx)]
    else:
        gap = [(gy, gx), (gy, gx + 1)]
    for (y, x) in gap: fence[y, x] = None; ring[y, x] = False
    objects = []
    yard = content3.Placer(np.ones(shape, bool))
    yard.free[:] = False
    yard.free[y0 + 2:y0 + fh - 2, x0 + 2:x0 + fw - 2] = True
    crops = [catalogue('Objects_Props', c) for c in CROPS]
    crops = [c for c in crops if c]
    rows = list(range(y0 + 2, y0 + fh - 2, 2))
    for i, y in enumerate(rows):
        pool = crops[(seed + i) % len(crops)]
        for x in range(x0 + 2, x0 + fw - 2):
            if rng.random() < 0.85: yard.put(rng.choice(pool), x, y, clear=0, shadow=False)
    # the farmstead on the far side from the gate
    P = lambda rx: catalogue('Objects_Props', rx)
    B = lambda rx: catalogue('Objects_Buildings', rx)
    hx = x0 + fw + 4 if towards[0] <= x0 + fw // 2 else x0 - 5
    hy = y0 + fh // 2 + 1
    homes = B(house or r'House_Hay_(1_[1-5]|2_[1-3]|3_[1-3])')
    stead = content3.Placer(ok & placer.free & ~fence_cells.astype(bool))
    stead.free &= ~ndimage.binary_dilation(fence_cells.astype(bool), iterations=1)
    placed = []
    if homes:
        k = rng.choice(homes)
        w, h = content3.size(k)
        tw, th = (w + 15) // 16, (h + 15) // 16
        bx0, by0 = hx - tw // 2, hy - th + 1
        if by0 > 0 and bx0 > 0 and stead.free[max(by0, hy - 2):hy + 1, bx0:bx0 + tw].all():
            stead.put(k, hx, hy, clear=0, shadow=False)
            stead.free[max(0, by0 - 1):hy + 2, max(0, bx0 - 1):bx0 + tw + 1] = False
            placed.append((k, hx, hy, tw))
    # the yard round the house: haystacks, the cart, a well, crates, wherever there is room
    props = [P(r'HayStack_[123]'), P(r'HayStack_[123]'), P(r'WoodCart_Hay'), B(r'Well_Generic_1'), P(r'Crate_Wide_Hay_[12]'), P(r'Barrel_Medium_Covered'), P(r'Sack_[1-3]')]
    spots = [(dx, dy) for dy in (2, 3, 4, 1, 5) for dx in (-5, 5, -3, 3, -6, 6, 0, -1, 1, -4, 4)]
    si = 0
    for pool in props:
        if not pool: continue
        while si < len(spots):
            dx, dy = spots[si]; si += 1
            x, y = hx + dx, hy + dy
            if 0 <= y < shape[0] and 0 <= x < shape[1] and stead.free[y, x] and stead.put(rng.choice(pool), x, y, clear=0, shadow=False): break
    # the scarecrow on an empty row in the middle of the field
    scare = P(r'Hay_Dummy_1')
    if scare:
        for y in range(y0 + 3, y0 + fh - 2, 2):
            x = x0 + fw // 2
            if yard.free[y, x] and yard.put(scare[0], x, y, clear=0, shadow=False): break
    objects = yard.objects + stead.objects
    # footprints: the house's bottom rows block, the fence blocks, the field is walked
    blocked = ring.copy()
    for (k, hx_, hy_, tw) in placed:
        blocked[hy_ - 2:hy_ + 1, hx_ - tw // 2:hx_ - tw // 2 + tw] = True
    claimed = ndimage.binary_dilation(fence_cells.astype(bool), iterations=2)
    claimed[hy - 9:hy + 3, hx - 7:hx + 8] = True
    return {'fence': fence, 'field': field, 'blocked': blocked, 'claimed': claimed, 'objects': objects, 'rect': (x0, y0, x0 + fw, y0 + fh)}
