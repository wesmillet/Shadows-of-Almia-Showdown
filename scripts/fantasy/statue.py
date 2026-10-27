"""A stone statue of a Pokemon, from its own idle sprite (front-facing, first frame): the sprite's
shading kept as four stone tones with a dark outline, standing on a carved plinth. Returns RGBA
(numpy uint8). Used for the Celebi statue in the castle's fountain (build3.py)."""
import os, re
import numpy as np
from PIL import Image
from scipy import ndimage

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
STONE = np.array([[92, 90, 100], [138, 136, 146], [182, 180, 186], [220, 218, 222]], np.uint8)
OUTLINE = np.array([58, 54, 66], np.uint8)


def statue(dex, frame=0):
    xml = open(f'{ROOT}/assets/pokemon/{dex}/AnimData.xml').read()
    fw, fh = map(int, re.search(r'<Name>Idle</Name>.*?<FrameWidth>(\d+)</FrameWidth>\s*<FrameHeight>(\d+)</FrameHeight>', xml, re.S).groups())
    sheet = np.asarray(Image.open(f'{ROOT}/assets/pokemon/{dex}/Idle-Anim.png').convert('RGBA'))
    f = sheet[0:fh, frame * fw:(frame + 1) * fw]
    a = f[..., 3] > 40
    ys, xs = np.nonzero(a)
    f, a = f[ys.min():ys.max() + 1, xs.min():xs.max() + 1], a[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
    lum = (0.3 * f[..., 0] + 0.59 * f[..., 1] + 0.11 * f[..., 2]) / 255
    # four tones by luminance rank inside the figure, lit from the top-left like the tileset
    q = np.zeros(lum.shape, int)
    v = lum[a]
    cuts = np.quantile(v, [0.2, 0.5, 0.8])
    q[a] = np.digitize(lum[a], cuts)
    h, w = a.shape
    body = np.zeros((h, w, 4), np.uint8)
    body[a, :3] = STONE[q[a]]
    body[a, 3] = 255
    # the original's dark lines stay dark (its outline and details)
    dark = a & (lum < 0.18)
    body[dark, :3] = OUTLINE
    # depth: lit from the top-left like the tileset. A pixel whose lower-right neighbour is outside
    # the figure is in shade (one tone down, two at the very edge); one whose upper-left neighbour is
    # outside catches the light (one tone up). The right half sits a little in shade overall.
    def nb(dy, dx):
        p = np.pad(a, 1)
        return p[1 + dy:1 + dy + h, 1 + dx:1 + dx + w]
    shade = a & (~nb(1, 1) | ~nb(0, 1) | ~nb(1, 0))
    deep = a & ~nb(1, 1) & ~nb(0, 1)
    lit = a & (~nb(-1, -1) | ~nb(-1, 0)) & ~shade
    q2 = q.copy()
    xs_ = np.arange(w)[None, :].repeat(h, 0)
    q2[a & (xs_ > w * 0.55)] -= 1
    q2[shade] -= 1
    q2[deep] -= 1
    q2[lit] += 1
    q2 = q2.clip(0, 3)
    body[a, :3] = STONE[q2[a]]
    body[dark, :3] = OUTLINE
    # outline round the figure
    pad = np.pad(body, ((1, 1), (1, 1), (0, 0)))
    am = np.pad(a, 1)
    ring = ndimage.binary_dilation(am) & ~am
    pad[ring, :3] = OUTLINE
    pad[ring, 3] = 255
    body = pad
    h, w = body.shape[:2]
    # plinth: a stepped block, wider than the figure's feet
    pw = max(w + 6, 20)
    ph = 9
    plinth = np.zeros((ph, pw, 4), np.uint8)
    plinth[..., 3] = 255
    plinth[..., :3] = STONE[2]
    plinth[0, :, :3] = STONE[3]           # lit top edge
    plinth[1:3, :, :3] = STONE[2]
    plinth[3, :, :3] = OUTLINE            # the cap's shadow line
    plinth[4:, 2:-2, :3] = STONE[1]       # the narrower base
    plinth[4:, :2, 3] = 0
    plinth[4:, -2:, 3] = 0
    plinth[4:, 2, :3] = OUTLINE
    plinth[4:, -3, :3] = OUTLINE
    plinth[-1, 2:-2, :3] = OUTLINE
    plinth[0, :, :3] = OUTLINE
    plinth[:4, 0, :3] = OUTLINE
    plinth[:4, -1, :3] = OUTLINE
    plinth[1:3, -4:-1, :3] = STONE[1]     # the cap's shaded right end
    plinth[4:-1, -7:-3, :3] = STONE[0]    # the base's shaded right side
    W = max(w, pw)
    out = np.zeros((h - 2 + ph, W, 4), np.uint8)
    out[h - 2:, (W - pw) // 2:(W - pw) // 2 + pw] = plinth
    fig = body
    ox = (W - w) // 2
    region = out[0:h, ox:ox + w]
    m = fig[..., 3] > 0
    region[m] = fig[m]
    # its shadow, cast down and to the right: the figure's silhouette, flattened and offset, in a
    # see-through dark that falls on the plinth top and the water behind it
    H_, W_ = out.shape[:2]
    shadow = np.zeros((H_ + 4, W_ + 6, 4), np.uint8)
    sil = fig[..., 3] > 0
    ys_, xs_ = np.nonzero(sil)
    for y_, x_ in zip(ys_, xs_):
        sy = h - 2 - (h - 2 - y_) // 3 + 2          # squashed toward the feet
        sx = ox + x_ + 3 + (h - y_) // 6             # leaning right
        if 0 <= sy < shadow.shape[0] and 0 <= sx < shadow.shape[1]:
            shadow[sy, sx] = (20, 18, 40, 110)
    full = np.zeros_like(shadow)
    full[:H_, :W_] = out
    m2 = full[..., 3] == 0
    full[m2] = shadow[m2]
    return full


if __name__ == '__main__':
    im = statue('0251')
    Image.fromarray(im).resize((im.shape[1] * 8, im.shape[0] * 8), Image.NEAREST).save('/tmp/claude-0/tt/statue.png')
    print(im.shape)
