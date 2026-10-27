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
    W = max(w, pw)
    out = np.zeros((h - 2 + ph, W, 4), np.uint8)
    out[h - 2:, (W - pw) // 2:(W - pw) // 2 + pw] = plinth
    fig = body
    ox = (W - w) // 2
    region = out[0:h, ox:ox + w]
    m = fig[..., 3] > 0
    region[m] = fig[m]
    return out


if __name__ == '__main__':
    im = statue('0251')
    Image.fromarray(im).resize((im.shape[1] * 8, im.shape[0] * 8), Image.NEAREST).save('/tmp/claude-0/tt/statue.png')
    print(im.shape)
