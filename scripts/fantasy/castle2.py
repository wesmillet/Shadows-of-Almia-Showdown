"""The castle, rebuilt from the pack's own Bosk Barracks sample (the red castle): an outer wall with
planked walkways, round towers on the south corners (the red-roofed one on the right), the arched
gatehouse on the south wall, the keep on the north wall, the wooden-roofed store beside it, and
the great hall inside with stairs down from the keep. The sample is 22 x 20 tiles; here it is
stretched by repeating its straight wall columns and rows, so it keeps every piece of the artist's
own art while growing to the size the game needs.

compose(n_left, n_right, n_rows) returns the tile layers (bottom first, as (name, object array)),
the castle's outer rectangle, the hall's interior rectangle, and the gatehouse passage, all in
tile units of the returned arrays (0,0 = the castle's top-left outer corner).
"""
import numpy as np
import tiled, automap

SAMPLE = 'Bosk Barracks'
LAYERS = ['Castle Floor', 'Castle Floor 2', 'Shadows 2/Shadows', 'Castle Walls', 'Castle Walls 2', 'Castle Details', 'Animations']
# the sample's castle: columns 15..36 and rows 13..32 (the keep above, rows 3..12, is stamped separately)
X0, X1, Y0, Y1 = 15, 37, 13, 33
# columns repeated to widen: left of the gatehouse and right of it. On the left the hall's north
# wall is an arched range (x 18..23), so the plain wall column 24 stands in for the upper rows and
# column 22 for the bottom wall; window slits (Castle Details) are left off repeated columns.
COL_L, COL_R = 22, 32
COL_L_UPPER = 25
# the gatehouse's two middle columns are doubled, so the gate is four tiles wide
GATE_DOUBLE = (25, 26)
# the row repeated to heighten: a plain stretch of side walls (x 33 on, taken from row 17 instead,
# where the right wall is whole: rows 21..29 hide it under the red tower)
ROW_REP, ROW_REP_RIGHT = 21, 17
# the red tower (all of 'Castle Walls 2'): sample columns 33..36, rows 21..29
TOWER = (33, 37, 21, 30)
# the hall's interior in the sample: columns 19..32, rows 19..24 (rows 19-20 only from column 24)
HALL = (19, 33, 19, 25)


def _layers():
    m = tiled.Map(SAMPLE)
    out = {}
    for kind, n, data in m.layers:
        if kind == 'tiles' and n in LAYERS: out[n] = automap.keys(m, data)
    return out


def compose(n_left=20, n_right=20, n_rows=22):
    L = _layers()
    cols = list(range(X0, COL_L)) + [COL_L] * (n_left + 1)
    for x in range(COL_L + 1, COL_R):
        cols += [x, x] if x in GATE_DOUBLE else [x]
    cols += [COL_R] * (n_right + 1) + list(range(COL_R + 1, X1))
    rows = list(range(Y0, ROW_REP)) + [ROW_REP] * (n_rows + 1) + list(range(ROW_REP + 1, Y1))
    H, W = len(rows), len(cols)
    out = {n: np.full((H, W), None, dtype=object) for n in LAYERS}
    tx0, tx1, ty0, ty1 = TOWER
    for oy, sy in enumerate(rows):
        for ox, sx in enumerate(cols):
            for n in LAYERS:
                src = L[n]
                y, x = sy, sx
                if sx == COL_L and sy < 27: x = COL_L_UPPER
                if sy == ROW_REP and sx >= 33: y = ROW_REP_RIGHT
                if n == 'Castle Details' and sx in (COL_L, COL_R): continue
                if n == 'Shadows 2/Shadows' and sx == COL_L and 20 <= sy <= 24: continue
                # inside the hall only the north wall's own shadow stays (the sample's props cast the rest)
                if n == 'Shadows 2/Shadows' and HALL[2] <= sy < HALL[3] and HALL[0] <= sx < HALL[1] and sy > 19 and not (sx <= 19): continue
                if n == 'Shadows 2/Shadows' and sy in (25, 26) and HALL[0] <= sx < HALL[1]: continue
                if n == 'Castle Walls 2': continue                      # the red tower: stamped below
                if n == 'Shadows 2/Shadows' and sy == ROW_REP and 20 <= sx <= 32: continue   # no long smears over the hall
                if n == 'Shadows 2/Shadows' and sy == ROW_REP and sx == 19: y = 23            # the hall wall's own shadow
                out[n][oy, ox] = src[y, x]
    # the red tower on the bottom-right, its base on the castle's bottom row
    tw, th = tx1 - tx0, ty1 - ty0
    ox = W - (X1 - tx0)
    oy = H - (Y1 - ty0)
    for dy in range(th):
        for dx in range(tw):
            t = L['Castle Walls 2'][ty0 + dy, tx0 + dx]
            if t is not None: out['Castle Walls 2'][oy + dy, ox + dx] = t
    # where everything landed
    col_of = {}
    for ox, sx in enumerate(cols): col_of.setdefault(sx, []).append(ox)
    row_of = {}
    for oy, sy in enumerate(rows): row_of.setdefault(sy, []).append(oy)
    hall = (col_of[HALL[0]][0], row_of[HALL[2]][0], col_of[HALL[1] - 1][-1] + 1, row_of[HALL[3] - 1][-1] + 1)
    gate_cols = col_of[GATE_DOUBLE[0]] + col_of[GATE_DOUBLE[1]]
    gate = (min(gate_cols), row_of[27][0], max(gate_cols) + 1, H)       # the passage: columns, from the walkway row down
    stairs = (col_of[27][0], row_of[15][0], col_of[30][-1] + 1, row_of[19][-1] + 1)
    return [(n, out[n]) for n in LAYERS], (W, H), hall, gate, stairs, col_of, row_of


def store_stamp():
    """The wooden-roofed store on the north wall, rows 10..12 of the sample (its lower rows come
    with the wall band): a list of (layer, array) for columns 18..24."""
    L = _layers()
    return [(n, L[n][10:13, 18:25].copy()) for n in LAYERS]
