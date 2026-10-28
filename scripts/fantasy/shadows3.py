"""Ground shadows for upright pictures, the way the artist uses the pack's shadow decals.

The pack's trees and props carry no baked shadow. In the sample maps the artist sets a round
shadow decal under the things that stand on a trunk or a narrow base (palms, cacti, stumps,
rocks, now and then a tree): the "Short" disc, sized to the object, a few pixels right of its
base (the light comes from the upper left). They never sit under banners, lamps, signs, bushes or
buildings. Before this, every wide tree got the same 40 or 48 px disc, a cypress or a banner the
same as an oak, and the palms and cacti of the desert none.

shadow_for(name, alpha) picks the decal for one picture from its file name (what it is) and its
alpha mask (how wide its canopy and where its trunk is); place(...) turns that into a decal dict
for a picture standing at (left, bottom). build3 (content3.Placer, the castle area's trees) and
polish3 both use it, so every shadow on the island follows one rule.
"""
import re
import numpy as np

SIZES = (16, 24, 32, 40, 48)
# the shadow layer's opacity in the map (the game draws all its discs as one shape, then fades it)
OPACITY = 0.25


def _snap(v, lo=16, hi=48):
    v = max(lo, min(hi, v))
    return min(SIZES, key=lambda s: (abs(s - v), s))


def kind(name):
    """What a picture is, for shadows: tree, bare, palm, cactus, stump, rock, or None (no shadow)."""
    n = name
    if re.match(r'(Palm)_', n): return 'palm'
    if re.match(r'Cactus_', n): return 'cactus'
    if re.match(r'(Tree_Dead|Birch_Dead)', n): return 'bare'
    if re.match(r'(Tree|Birch|Pine|Spruce|Fir|Willow|Maple|Oak)_', n): return 'tree'
    if re.match(r'TreeStump', n): return 'stump'
    if re.match(r'Rock_', n) and not re.search(r'Rune|Crystal|Floating', n): return 'rock'
    return None


def measure(alpha):
    """(canopy width, trunk centre x) of an alpha mask (h, w): the widest opaque row in the upper
    three quarters, and the middle of the opaque pixels in the bottom four rows."""
    a = np.asarray(alpha) > 0
    h, w = a.shape
    if not a.any(): return 0, w / 2
    rows = a[: max(1, int(h * 0.75))]
    widths = [(int(np.ptp(np.nonzero(r)[0])) + 1) if r.any() else 0 for r in rows]
    canopy = max(widths) if widths else w
    ys = np.nonzero(a.any(axis=1))[0]
    base = a[max(0, ys.max() - 3): ys.max() + 1]
    xs = np.nonzero(base.any(axis=0))[0]
    trunk = (xs.min() + xs.max() + 1) / 2 if len(xs) else w / 2
    return int(canopy), float(trunk)


def size_for(k, canopy, w, h):
    """The disc's nominal size for a picture of kind k (None: no shadow)."""
    if k == 'tree': return _snap(canopy * 0.45, hi=40)
    if k == 'palm': return _snap(canopy * 0.55, hi=40)
    if k == 'bare': return _snap(canopy * 0.35, hi=32)
    if k == 'cactus': return 16 if min(w, h) < 22 else 24     # a low flowering cactus is small however wide
    if k == 'stump': return 16 if w <= 20 else 32
    if k == 'rock':
        if w < 14 or h < 10: return None
        return _snap(w * 0.8, hi=32)
    return None


def shadow_for(name, alpha):
    """(size, trunk x) or None for one picture."""
    k = kind(name)
    if k is None: return None
    a = np.asarray(alpha)
    h, w = a.shape[:2]
    canopy, trunk = measure(a)
    s = size_for(k, canopy, w, h)
    if s is None: return None
    return s, trunk


def decal_name(s):
    return f'Shadow_Round_{s}x{s}_Short_Black'


def place(s, left, bottom, trunk):
    """Top-left of the decal picture ((s + 4) square: the disc and its short cast to the lower
    right) for a picture whose left edge is `left`, bottom edge `bottom` and trunk at `trunk`
    pixels from its left: the disc centred on the base, 2 px right, 2 px up."""
    cx = left + trunk + 2
    cy = bottom - 2
    return int(round(cx - s / 2)), int(round(cy - s / 2))
