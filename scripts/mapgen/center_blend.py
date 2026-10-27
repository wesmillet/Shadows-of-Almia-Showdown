"""
Center blend: the colour gradient where the centre meadow meets the snow, desert and autumn lands.

Reads a 1x render of the island's ground (no trees or buildings; make it with tools/mapshot.html,
`?layer=ground`), and writes a per-pixel colour multiplier the game applies when it bakes ground
chunks (src/ground/fanGround.ts):

    assets/maps/<name>_blend.png   RGB multipliers, byte = multiplier x 85 (85 = unchanged)
    assets/maps/<name>_blend.json  where that image sits on the map, in pixels: {x, y, w, h}

Both sides of each border drift halfway toward the other's typical colour at the border and back
to their own over BAND tiles. The border's own edge tiles hold both grounds, so near a border each
pixel is classed by its colour (paths stay neutral). Re-run it whenever the map changes:

    python3 scripts/mapgen/center_blend.py almia3 /path/to/ground.png
"""
import json, sys
import numpy as np
from PIL import Image
from scipy import ndimage as nd

name = sys.argv[1] if len(sys.argv) > 1 else 'almia3'
ground_png = sys.argv[2]
BAND = 10          # tiles each side of a border
MEADOW, LANDS = 1, [4, 5, 6]   # biome codes: meadow; snow, desert, autumn

m = json.load(open(f'assets/maps/{name}.json'))
bio = np.array([[ord(c) - 48 for c in row] for row in m['biome']], dtype=np.int8)
G = np.asarray(Image.open(ground_png).convert('RGB')).astype(np.float32) / 255
H, W, _ = G.shape
th, tw = H // 16, W // 16
bt = bio[:th, :tw].copy()
tiles = G.reshape(th, 16, tw, 16, 3).mean((1, 3))
cls = [MEADOW] + LANDS
mean = {c: np.median(tiles[bt == c], 0) for c in cls}

# Tiles near a border: re-labelled by what they look like (the grid is a tile or two off the art).
dists = np.stack([np.abs(tiles - mean[c]).sum(-1) for c in cls], -1)
best = np.array(cls)[dists.argmin(-1)]
near = nd.binary_dilation(bt == MEADOW, iterations=4) & nd.binary_dilation(np.isin(bt, LANDS), iterations=4)
far = dists.min(-1) > 0.16
upd = near & np.isin(bt, cls)
bt[upd & ~far] = best[upd & ~far]
bt[upd & far] = 9

bp = np.repeat(np.repeat(bt, 16, 0), 16, 1)
# Pixels near a border: classed one by one (edge tiles hold both grounds); paths stay neutral, and a
# pixel may only take a class found around its tile.
nearP = np.repeat(np.repeat(nd.binary_dilation(near, iterations=1), 16, 0), 16, 1)
pd = np.stack([np.abs(G - mean[c]).sum(-1) for c in cls], -1)
pbest = np.array(cls)[pd.argmin(-1)]
pfar = pd.min(-1) > 0.30
for c in cls:
    allowed = np.repeat(np.repeat(nd.binary_dilation(bio[:th, :tw] == c, iterations=3), 16, 0), 16, 1)
    pbest = np.where((pbest == c) & ~allowed, 9, pbest)
bp = np.where(nearP, np.where(pfar, 9, pbest), bp)

Mp = bp == MEADOW
Lp = np.isin(bp, LANDS)
dM, iM = nd.distance_transform_edt(~Lp, return_indices=True)
dL = nd.distance_transform_edt(~Mp)
nearLand = bp[iM[0], iM[1]]
R = np.ones_like(G)
for b in LANDS:
    R[Mp & (nearLand == b)] = np.clip(mean[b] / mean[MEADOW], 0.35, 2.5)
    R[bp == b] = np.clip(mean[MEADOW] / mean[b], 0.35, 2.5)
dist = np.where(Mp, dM, np.where(Lp, dL, 1e9))
x = np.clip(1 - dist / (BAND * 16), 0, 1)
w = 0.5 * x * x * (3 - 2 * x)
# Paths, rocks and anything else that is not plain ground keep their own colour.
own = np.full(G.shape[:2], 9.0, dtype=np.float32)
for k, c in enumerate(cls):
    own = np.where(bp == c, pd[..., k], own)
w = np.where(own > 0.30, 0, w)[..., None]
mult = 1 + w * (R - 1)
enc = np.clip(np.round(mult * 85), 0, 255).astype(np.uint8)
touched = np.any(enc != 85, -1)
ys, xs = np.nonzero(touched)
x0, x1 = xs.min() // 16 * 16, (xs.max() // 16 + 1) * 16
y0, y1 = ys.min() // 16 * 16, (ys.max() // 16 + 1) * 16
Image.fromarray(enc[y0:y1, x0:x1]).save(f'assets/maps/{name}_blend.png', optimize=True)
json.dump({'x': int(x0), 'y': int(y0), 'w': int(x1 - x0), 'h': int(y1 - y0)}, open(f'assets/maps/{name}_blend.json', 'w'))
print('blend', x0, y0, x1 - x0, y1 - y0)
