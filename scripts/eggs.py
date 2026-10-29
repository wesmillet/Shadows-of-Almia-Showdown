"""Builds the daily Egg's pictures in assets/ui/eggs/ from Pokémon Emerald's own Egg graphics
(scripts/eggs-src/hatch.png and shard.png, from the pret/pokeemerald decompilation):

  egg_<tier>.png        the Egg, its spots in that starter tier's colour (data/spawns.json starterTiers)
  egg_<tier>_hatch.png  the four hatching frames side by side (32 x 32 each): whole, then cracking
  egg_shards.png        the four shell pieces that fly off when it breaks (8 x 8 each)

Palette index 0 is the background (made transparent). Run: python3 scripts/eggs.py"""
import json, os
from PIL import Image

ROOT = os.path.join(os.path.dirname(__file__), '..')
SRC = os.path.join(ROOT, 'scripts', 'eggs-src')
out = os.path.join(ROOT, 'assets', 'ui', 'eggs')
os.makedirs(out, exist_ok=True)
tiers = json.load(open(os.path.join(ROOT, 'data', 'spawns.json')))['starterTiers']


def rgba(path):
    """The indexed picture with palette index 0 transparent."""
    p = Image.open(path)
    idx = p.load()
    im = p.convert('RGBA')
    px = im.load()
    for y in range(im.height):
        for x in range(im.width):
            if idx[x, y] == 0:
                px[x, y] = (0, 0, 0, 0)
    return im


def hex2rgb(h):
    h = h.lstrip('#')
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


hatch = rgba(os.path.join(SRC, 'hatch.png'))       # 32 x 128: four frames stacked
frames = [hatch.crop((0, i * 32, 32, i * 32 + 32)) for i in range(4)]
# The spots: the Egg's two greens.
SPOT, SHADE = (123, 205, 74), (106, 148, 82)
for t in tiers:
    c = hex2rgb(t['color'])
    swap = {SPOT: c, SHADE: tuple(int(v * 0.72) for v in c)}
    sheet = Image.new('RGBA', (32 * 4, 32), (0, 0, 0, 0))
    for i, f in enumerate(frames):
        f = f.copy()
        px = f.load()
        for y in range(32):
            for x in range(32):
                r, g, b, a = px[x, y]
                if a and (r, g, b) in swap:
                    px[x, y] = swap[(r, g, b)] + (a,)
        sheet.alpha_composite(f, (i * 32, 0))
        if i == 0:
            f.save(os.path.join(out, f"egg_{t['id']}.png"))
    sheet.save(os.path.join(out, f"egg_{t['id']}_hatch.png"))
    print(t['id'])
rgba(os.path.join(SRC, 'shard.png')).save(os.path.join(out, 'egg_shards.png'))
