"""
Minimap from render: the in-game minimap picture and the preview, taken from a full 1x render of
the map (tools/mapshot.html, `?layer=all`), so they show the island exactly as the game draws it:
the centre blend, the smoothed paving and everything else build3's own quick render leaves out.

    python3 scripts/mapgen/minimap_from_render.py almia3 /path/to/map_all.png
"""
import json, sys
from PIL import Image

name, png = sys.argv[1], sys.argv[2]
m = json.load(open(f'assets/maps/{name}.json'))
cols, rows = m['cols'], m['rows']
im = Image.open(png).convert('RGB')
if im.size != (cols * 16, rows * 16): raise SystemExit(f'render is {im.size}, the map is {cols * 16}x{rows * 16}')
im.resize((cols * 4, rows * 4), Image.LANCZOS).save(f'assets/maps/{name}_preview.png')
im.resize((cols * 2, rows * 2), Image.LANCZOS).save(f'assets/maps/{name}_minimap.png', optimize=True)
print('minimap', cols * 2, rows * 2)
