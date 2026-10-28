"""Castle walls built from the Atlas_Castle_Building kit, piece by piece.

The kit is a set of 16 px pieces (the artist's "build your own" atlas): wall faces with their
left and right edges, parapets, bases, plank walkways (a terrain set of the floor atlas), round
towers, gatehouse arches, doors, roofs in every faction colour. This module knows which piece
does what (learned by reading how the artist assembled the pack's own castles, then written out
here as rules) and composes a castle of any size from them: a ring of plank walkway with the
parapet along its outer edge, round towers on the corners, a gatehouse in the south wall, red
roofed towers either side of the side gates, and the keep on the north wall with its red roof,
crenellated band and arched door.

Pieces are atlas (col, row) pairs: tile id = row * 50 + col.
"""
import numpy as np
import tiled, wang

ATLAS = 'Atlas_Castle_Building'
FLOOR = 'Atlas_Castle_Floor'


def P(c, r):
    return (ATLAS, r * 50 + c, 0)


# the wall cross-section, seen from the south: parapet at the back of the walkway, then the front
# parapet, two rows of face and the base
BACK_PARAPET = P(2, 1)
FRONT_PARAPET, FRONT_CAP_L, FRONT_CAP_R = P(2, 5), P(5, 1), P(7, 1)
FACE, BASE = P(2, 6), P(2, 7)
FACE_L, FACE_R, BASE_L, BASE_R = P(1, 6), P(3, 6), P(1, 7), P(3, 7)
# the side walls: the outer edge piece and the inner edge piece either side of the plank walkway
W_OUTER, W_INNER = P(1, 4), P(5, 4)
E_OUTER, E_INNER = P(7, 4), P(3, 4)
W_INNER_TOP, E_INNER_TOP = [P(5, 1), P(5, 2), P(5, 3)], [P(7, 1), P(7, 2), P(7, 3)]
W_INNER_BOT, E_INNER_BOT = P(5, 5), P(7, 5)
# where the south face meets a tower
FACE_TO_TOWER_L = [P(41, 3), P(41, 4), P(43, 5)]
FACE_TO_TOWER_R = [P(38, 3), P(38, 4), P(36, 5)]
# the gatehouse: six wide, four tall, the arch in the middle
GATEHOUSE = [
    [P(37, 11), P(6, 1), P(6, 1), P(6, 1), P(6, 1), P(39, 11)],
    [P(37, 12), P(1, 50), P(2, 50), P(3, 50), P(4, 50), P(39, 12)],     # the open arch (the kit's
    [P(35, 13), P(1, 51), P(2, 51), P(3, 51), P(4, 51), P(41, 13)],     # wooden door, P(11..14),
    [P(31, 14), P(1, 52), P(2, 52), P(3, 52), P(4, 52), P(33, 14)],     # kept everyone out)
]
# the keep's stairs down the north wall into the courtyard, three wide
STAIRS = [[P(25, 45), P(10, 45), P(26, 45)], [P(1, 26), P(2, 26), P(3, 26)], [P(1, 27), P(2, 27), P(3, 27)], [P(1, 27), P(2, 27), P(3, 27)], [P(1, 28), P(2, 28), P(3, 28)]]
# round towers: four wide, seven tall
TOWER = [[P(c, r) for c in range(31, 35)] for r in range(1, 8)]
# a tower with a red cone roof: the roof, a parapet, two rows of body
RED_TOWER = [[P(c, r) for c in range(20, 24)] for r in range(199, 205)] + [[P(c, 5) for c in range(31, 35)], [P(c, 6) for c in range(36, 40)], [P(c, 7) for c in range(36, 40)]]
# the keep, nine wide: red roof, crenellated band, the front wall with its arched door
def keep_rows(w=9):
    mid = w - 2
    rows = [[P(5, r)] + [P(6, r)] * mid + [P(7, r)] for r in (199, 201, 201, 202, 203)]
    rows += [[P(0, 10), P(1, 10)] + [P(2, 10)] * (w - 4) + [P(3, 10), P(4, 10)]] * 2
    rows += [[P(0, 11), P(1, 11)] + [P(2, 11)] * (w - 4) + [P(3, 11), P(4, 11)]]
    inner = w - 2
    for r in (43, 44):
        k = (inner - 3) // 2
        rows.append([None, P(1, 6)] + [P(2, 6)] * (k - 1) + [P(9, r), P(10, r), P(11, r)] + [P(2, 6)] * (inner - 3 - k - 1) + [P(3, 6), None])
    return rows


def stamp(layer, rows, x0, y0):
    for dy, row in enumerate(rows):
        for dx, k in enumerate(row):
            if k is not None and 0 <= y0 + dy < layer.shape[0] and 0 <= x0 + dx < layer.shape[1]: layer[y0 + dy, x0 + dx] = k


def compose(W, H, gate_x=None, side_gates=(), seed=8):
    """A castle W x H tiles (the outer rectangle; the bottom row holds the corner towers' feet).
    gate_x: the gatehouse arch's left column (four wide), default the middle.
    side_gates: rows (y0, y1) of gaps in the west and east walls, as [('W', y0, y1), ('E', y0, y1)].
    Returns (layers, hall, gate, stairs, solid, top, keep): layers a list of (name, object array
    (H + top, W)) bottom first, whose row `top` is the castle's first row, the
    hall rectangle (x0, y0, x1, y1, exclusive) inside the walls, the gate passage rectangle, the
    keep's stairs rectangle on the north wall."""
    T = 10                          # rows above the rectangle, for the keep
    walls = np.full((H + T, W), None, dtype=object)
    walls2 = np.full((H + T, W), None, dtype=object)
    wood_cells = np.zeros((H + T, W), np.int32)
    Fw = wang.WangSet(FLOOR, seed=seed)
    wood = Fw.color('Wood Floor')
    gx = gate_x if gate_x is not None else W // 2 - 2
    s0 = H - 7                      # the south band: back parapet, planks, front parapet, face, face, base
    walls_all, walls2_all, wood_all = walls, walls2, wood_cells
    walls, walls2, wood_cells = walls[T:], walls2[T:], wood_cells[T:]     # views: y = 0 is the parapet row
    # the walkway ring: two rows across the north, three columns down each side, one row along the south
    wood_cells[1:3, 2:W - 2] = wood
    wood_cells[1:s0 + 2, 1:4] = wood
    wood_cells[1:s0 + 2, W - 4:W - 1] = wood
    # the south walkway is two rows of planks, the front parapet standing on the second (as the
    # artist's Bosk Barracks lays it): with one row, the parapet and the gatehouse's top stood on
    # nothing and the grass below showed through their gaps
    wood_cells[s0 + 1:s0 + 3, 1:W - 1] = wood
    wood_cells[s0 + 2:s0 + 4, 1:5] = wood                  # under the corner towers
    wood_cells[s0 + 2:s0 + 4, W - 5:W - 1] = wood
    # the parapet along the north, the side walls' edges, the south cross-section
    for x in range(1, W - 1): walls[0, x] = BACK_PARAPET
    for y in range(3, s0 + 1):
        walls[y, 0], walls[y, 3] = W_OUTER, W_INNER
        walls[y, W - 4], walls[y, W - 1] = E_OUTER, E_INNER
    for i, k in enumerate(W_INNER_TOP): walls[3 + i, 3] = k
    for i, k in enumerate(E_INNER_TOP): walls[3 + i, W - 4] = k
    walls[s0, 3], walls[s0, W - 4] = W_INNER_BOT, E_INNER_BOT
    for x in range(1, W - 1):
        walls[s0, x] = BACK_PARAPET
        walls[s0 + 2, x] = FRONT_PARAPET
        walls[s0 + 3, x] = walls[s0 + 4, x] = FACE
        walls[s0 + 5, x] = BASE
    walls[s0, 1], walls[s0, W - 2] = FRONT_PARAPET, FRONT_PARAPET
    for i, k in enumerate(FACE_TO_TOWER_L): walls[s0 + 3 + i, 4] = k
    for i, k in enumerate(FACE_TO_TOWER_R): walls[s0 + 3 + i, W - 5] = k
    # the gatehouse: the front parapet breaks either side of it, the arch replaces face and base
    walls[s0 + 2, gx - 2], walls[s0 + 2, gx + 5] = FRONT_CAP_R, FRONT_CAP_L
    for x in range(gx - 1, gx + 5): walls[s0 + 2, x] = None
    stamp(walls, GATEHOUSE, gx - 1, s0 + 2)
    # and the back parapet opens over the gate, so the passage runs from the courtyard straight out
    for x in range(gx, gx + 4): walls[s0, x] = None
    walls[s0, gx - 1], walls[s0, gx + 4] = FRONT_CAP_R, FRONT_CAP_L
    gate = (gx, s0, gx + 4, H)
    # side gates: the wall opens, the walkway too; red roofed towers stand above and below
    for (side, y0, y1) in side_gates:
        xs = range(0, 4) if side == 'W' else range(W - 4, W)
        for y in range(y0, y1):
            for x in xs: walls[y, x] = None; wood_cells[y, x] = 0
        tx = 0 if side == 'W' else W - 4
        stamp(walls2, RED_TOWER, tx, y0 - 9)
        stamp(walls2, RED_TOWER, tx, y1)
    # the corner towers
    stamp(walls, TOWER, 0, 0); stamp(walls, TOWER, W - 4, 0)
    stamp(walls, TOWER, 0, H - 7); stamp(walls, TOWER, W - 4, H - 7)
    # the keep over the middle of the north wall, its stairs coming down the wall into the courtyard
    kw = 9
    kx = W // 2 - kw // 2
    keep = keep_rows(kw)
    stamp(walls2_all, keep, kx, T - len(keep) + 1)
    floor = Fw.paint(wood_all)
    close_edges(floor[T:], walls)
    # the south wall's back parapet stands on the court's slab floor, as in the artist's sample
    # (two slab tiles in turn); on nothing, the grass showed between its merlons
    for x in range(W):
        if walls[s0, x] in (BACK_PARAPET, FRONT_CAP_R, FRONT_CAP_L) and floor[T + s0, x] is None:
            floor[T + s0, x] = (FLOOR, 14 if x % 2 else 164, 0)
    # the bottom corner towers' tops: their planks run on under the tower's inner edge to meet that slab
    for x in (3, W - 4):
        k = floor[T + s0, x]
        if k is not None and k[1] in (301, 303): floor[T + s0, x] = (k[0], 302, 0)
    stamp(walls_all, STAIRS, kx + 3, T)
    stairs = (kx + 3, 0, kx + 6, 5)
    hall = (4, 3, W - 4, s0)
    layers = [('Castle Floor 2', floor), ('Castle Walls', walls_all), ('Castle Walls 2', walls2_all)]
    solid = np.ones((H, W), bool)
    solid[3:s0, 4:W - 4] = False
    solid[gate[1]:gate[3], gate[0]:gate[2]] = False
    for (side, y0, y1) in side_gates:
        solid[y0:y1, 0:4 if side == 'W' else W] = False
        if side == 'E': solid[y0:y1, W - 4:W] = False
    return layers, hall, gate, stairs, solid, T, (kx, kw, len(keep))


# The floor's plank edge pieces: left edge, middle, right edge, for the top row, the run and the
# bottom row (Atlas_Castle_Floor). Their planks reach from the middle of the first tile to the
# middle of the last.
PLANK_ROWS = [(289, 290, 291), (301, 302, 303), (313, 314, 315)]


def close_edges(floor, walls, gid0=0):
    """The side walls and corner towers are four tiles across, edge piece to edge piece, but the
    plank floor under them was laid three across, so its planks stopped a whole tile short of the
    outer edge piece and the island's grass showed through (down the walkways, and inside the
    corner towers' open tops). The artist's own walls are three across and their tower tops sit on
    planks in all four columns. Where an outer edge piece or a corner tower stands on the tile
    beyond a plank edge, the edge moves out under it and the old edge becomes a middle piece.
    In place. Also run on the Tiled castle (areas/castle.tmx), whose cells are tile ids: then
    gid0 is the first id of the castle building atlas and floor ids are the floor atlas's own."""
    H, W = floor.shape
    keys = floor.dtype == object
    def fid(t): return None if t is None or t == 0 else (t[1] if keys else t)
    def wid(t): return None if t is None or t == 0 else (t[1] if keys else t - gid0)
    outer = {W_OUTER[1], E_INNER[1]} | {k[1] for row in TOWER for k in row}
    before = floor.copy()
    n = 0
    for y in range(H):
        for (l, m, r) in PLANK_ROWS:
            for x in range(1, W - 1):
                t = before[y, x]
                for (edge, nx) in ((l, x - 1), (r, x + 1)):
                    if fid(t) == edge and fid(before[y, nx]) is None and wid(walls[y, nx]) in outer:
                        floor[y, nx] = (t[0], edge, 0) if keys else edge
                        floor[y, x] = (t[0], m, 0) if keys else m
                        n += 1
    return n
