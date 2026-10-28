"""
Pave smooth: curved, soft-edged paving for the castle courtyard and the crystal arena.

The courtyard slabs are tiles, so an oval or a corner where a walk meets it comes out in 16-pixel
steps with a hard rim. This redraws the edges at pixel level: the paving's shape is smoothed (the
oval becomes a true curve, walks meet the plaza with rounded joins), the stone gets a thin rim on
the new edge, and the grass right beside the stone is shaded a little, so stone and lawn meet
softly. The result is an overlay image the game draws over the ground tiles
(src/ground/fanGround.ts):

    assets/maps/<name>_overlay.png   RGBA, opaque where a pixel changes
    assets/maps/<name>_overlay.json  where it sits on the map, in pixels: {x, y, w, h}

Inputs:
    scripts/fantasy/out/<name>_pave.npz  written by build3.py: the paving per tile (0 none, 1 slab,
                                         2 light slab) and the tiles never to touch (walls, fountain)
    two ground renders from tools/mapshot.html (?layer=ground&blend=0&overlay=0), one as is and one
    with &skip=Courtyard (the grass under the paving)

    python3 scripts/mapgen/pave_smooth.py almia3 ground.png ground_no_courtyard.png
"""
import json, sys, os
import numpy as np
from PIL import Image
from scipy import ndimage as nd

name, a_png, b_png = sys.argv[1], sys.argv[2], sys.argv[3]
here = os.path.dirname(os.path.abspath(__file__))
z = np.load(os.path.join(here, '..', 'fantasy', 'out', f'{name}_pave.npz'))
pav, fixed = z['pav'], z['fixed']
A = np.asarray(Image.open(a_png).convert('RGB')).astype(np.float32)
B = np.asarray(Image.open(b_png).convert('RGB')).astype(np.float32)
th, tw = pav.shape
SIGMA = 11          # pixels: how round the corners get
BAND = 22           # pixels each side of an edge that are redrawn

# work in the paving's bounding box (plus a margin)
ys, xs = np.nonzero(pav)
tx0, tx1 = max(0, xs.min() - 3), min(tw, xs.max() + 4)
ty0, ty1 = max(0, ys.min() - 3), min(th, ys.max() + 4)
P = pav[ty0:ty1, tx0:tx1]
Fx = fixed[ty0:ty1, tx0:tx1]
up = lambda g: np.repeat(np.repeat(g, 16, 0), 16, 1)
Pp, Fp = up(P), up(Fx)
X0, Y0 = tx0 * 16, ty0 * 16
Ac = A[Y0:Y0 + Pp.shape[0], X0:X0 + Pp.shape[1]]
Bc = B[Y0:Y0 + Pp.shape[0], X0:X0 + Pp.shape[1]]
valid = ~Fp


def disk(r):
    y, x = np.mgrid[-r:r + 1, -r:r + 1]
    return x * x + y * y <= r * r


def smooth(mask):
    """Rounded joins and corners: concave corners filled with a radius-12 curve, convex corners
    rounded with radius 6 (fixed tiles keep their own shape)."""
    m = nd.binary_closing(np.pad(mask, 16, mode='edge'), structure=disk(12))[16:-16, 16:-16]
    m = nd.binary_opening(np.pad(m, 8, mode='edge'), structure=disk(6))[8:-8, 8:-8]
    return np.where(valid, m, mask)


# The ovals are drawn as true ellipses: their stepped tiles are taken out and the curve put in.
yy, xx = np.mgrid[0:Pp.shape[0], 0:Pp.shape[1]]
pxx, pyy = (xx + X0 + 0.5) / 16.0, (yy + Y0 + 0.5) / 16.0
tyy, txx = np.mgrid[ty0:ty1, tx0:tx1]
stone_t = P >= 1
walk_px = up(z['walks'][ty0:ty1, tx0:tx1])
light_t = P == 2
stone_px = up(stone_t)
light_px = up(light_t)
for (ocx, ocy, rx, ry, cls) in z['ovals']:
    inside_t = ((txx + 0.5 - ocx) / rx) ** 2 + ((tyy + 0.5 - ocy) / ry) ** 2 < 1
    ring_t = inside_t & ~nd.binary_erosion(inside_t, iterations=2)      # the stepped rim tiles
    curve = ((pxx - ocx) / rx) ** 2 + ((pyy - ocy) / ry) ** 2 < 1
    if cls == 2:
        light_px = (light_px & ~up(ring_t)) | (curve & up(inside_t | ring_t | nd.binary_dilation(inside_t)))
    else:
        # the stepped rim tiles beyond the curve go, but never where a walk runs
        stone_px = (stone_px & ~(up(ring_t) & ~curve & ~walk_px)) | (curve & valid)
        # a slab oval drawn over a light one (the rings of the castle court's medallion) takes its
        # curve back out of the light paving: ovals paint in order, later over earlier
        light_px = light_px & ~curve
S1 = smooth(stone_px)                  # any stone
S2 = light_px & S1                     # light slabs

# reference textures: a tile deep inside each kind of paving (tiles are 16-pixel aligned)
def ref_tile(cls):
    inner = nd.binary_erosion(P == cls, iterations=2) & ~nd.binary_dilation(Fx, iterations=2)
    yy, xx = np.nonzero(inner)
    if not len(yy): raise SystemExit(f'no interior tile of class {cls}')
    i = len(yy) // 2
    return Ac[yy[i] * 16:yy[i] * 16 + 16, xx[i] * 16:xx[i] * 16 + 16]

T1, T2 = ref_tile(1), ref_tile(2)
H, W = Pp.shape
yy, xx = np.mgrid[0:H, 0:W]
tex1 = T1[yy % 16, xx % 16]
tex2 = T2[yy % 16, xx % 16]

# tiles whose own picture is an edge (a different class among their 8 neighbours): never reused
edge_t = np.zeros_like(P, bool)
for dy in (-1, 0, 1):
    for dx in (-1, 0, 1):
        edge_t |= np.roll(np.roll(P, dy, 0), dx, 1) != P
edge_p = up(edge_t)

orig_cls = Pp
new_cls = np.where(S2, 2, np.where(S1, 1, 0))
near = np.zeros((H, W), bool)
for m in (S1, S2):
    b = m ^ nd.binary_erosion(m)
    near |= nd.binary_dilation(b, iterations=BAND)
redo = near & valid & (edge_p | (new_cls != orig_cls))

out = Ac.copy()
keep_orig = (new_cls == orig_cls) & ~edge_p
out = np.where((redo & (new_cls == 0))[..., None], Bc, out)
out = np.where((redo & (new_cls == 1) & ~keep_orig)[..., None], tex1, out)
out = np.where((redo & (new_cls == 2) & ~keep_orig)[..., None], tex2, out)

# the rim: stone within 1-2 px of grass gets the slab's darker edge; grass within 5 px of stone is
# shaded a little (worn turf), fading out
d_in = nd.distance_transform_edt(S1)            # inside stone: distance to grass
d_out = nd.distance_transform_edt(~S1)          # on grass: distance to stone
rim = redo & S1 & (d_in <= 1.0)
rim2 = redo & S1 & (d_in > 1.0) & (d_in <= 2.0)
out = np.where(rim[..., None], out * 0.70, out)
out = np.where(rim2[..., None], np.minimum(255, out * 1.06), out)
shade = redo & ~S1 & (d_out <= 5)
k = (1 - 0.16 * (1 - (d_out - 1) / 5)).clip(0.84, 1)
out = np.where(shade[..., None], out * k[..., None], out)
# the light slabs meet the ring with a faint line
seam = redo & S2 & (nd.distance_transform_edt(S2) <= 1.0)
out = np.where(seam[..., None], out * 0.9, out)

changed = redo | shade | seam | rim
alpha = np.where(changed, 255, 0).astype(np.uint8)
rgba = np.dstack([np.clip(out, 0, 255).astype(np.uint8), alpha])
ys, xs = np.nonzero(changed)
x0, x1 = xs.min(), xs.max() + 1
y0, y1 = ys.min(), ys.max() + 1
Image.fromarray(rgba[y0:y1, x0:x1], 'RGBA').save(f'assets/maps/{name}_overlay.png', optimize=True)
json.dump({'x': int(X0 + x0), 'y': int(Y0 + y0), 'w': int(x1 - x0), 'h': int(y1 - y0)}, open(f'assets/maps/{name}_overlay.json', 'w'))
print('overlay', X0 + x0, Y0 + y0, x1 - x0, y1 - y0, 'changed px', int(changed.sum()))
