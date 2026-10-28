"""Renders the whole island through the game's own ground renderer (tools/mapshot.html on a running
dev server) into one PNG: the input for pave_smooth.py, center_blend.py and minimap_from_render.py,
and the full-resolution picture of the map.

    python3 scripts/mapgen/mapshot.py out.png "layer=all&k=16" [port]
"""
import sys, base64
from playwright.sync_api import sync_playwright

out = sys.argv[1]
q = sys.argv[2] if len(sys.argv) > 2 else 'k=16'
port = sys.argv[3] if len(sys.argv) > 3 else '5179'
with sync_playwright() as p:
    br = p.chromium.launch()
    pg = br.new_page()
    pg.goto(f'http://127.0.0.1:{port}/tools/mapshot.html?{q}')
    pg.wait_for_function('window.shot || window.shotErr', timeout=600000)
    err = pg.evaluate('window.shotErr || null')
    if err: raise SystemExit(err)
    open(out, 'wb').write(base64.b64decode(pg.evaluate('window.shot')))
    br.close()
print('wrote', out)
