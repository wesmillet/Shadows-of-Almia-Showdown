import sys, json, numpy as np, sunny
from PIL import Image, ImageDraw
ALL = ['decoration_01', 'building', 'walls', 'decoration_02', 'decoration_03']
SMALL = {95,96,97,98,99,159,160,161,162,163,223,224,225,226,227,287,288,289,290,1975,351,352,91,155,219,283,93,94,92,156,157,158,220,221,222,284,285,286}
def cut(rect, layers=ALL, drop=(), drop_ids=SMALL):
    L = sunny.layers(); x0, y0, x1, y1 = rect
    out = {'w': x1 - x0, 'h': y1 - y0, 'demo': [x0, y0], 'layers': []}
    for n in layers:
        T = np.array(L[n]['tiles'])[y0:y1, x0:x1].copy(); F = np.array(L[n]['flags'])[y0:y1, x0:x1].copy()
        bad = np.isin(T, list(set(drop_ids) | {264} | set(PINES)))
        for (dx, dy) in drop: bad[dy - y0, dx - x0] = True
        T[bad] = 0; F[bad] = 0
        if T.any(): out['layers'].append({'tiles': T.tolist(), 'flags': F.tolist()})
    return out
PINES = {435, 436, 499, 500, 563, 564, 308, 372}
def render(p):
    img = np.zeros((p['h'] * 16, p['w'] * 16, 4))
    for l in p['layers']:
        for y, row in enumerate(l['tiles']):
            for x, t in enumerate(row):
                if t: sunny.composite(img, sunny.tile(t, l['flags'][y][x]), x * 16, y * 16)
    return img.astype(np.uint8)
def sheet(items, path, S=3):
    pad = 12; maxw = 1500; x = y = 0; rowh = 0; placed = []
    for k, p in items:
        pw, ph = p['w'] * 16 * S + pad * 2, p['h'] * 16 * S + pad * 2 + 14
        if x + pw > maxw: x = 0; y += rowh; rowh = 0
        placed.append((k, p, x, y)); x += pw; rowh = max(rowh, ph)
    sh = Image.new('RGBA', (maxw, y + rowh), (90, 170, 80, 255)); dr = ImageDraw.Draw(sh)
    for k, p, px, py in placed:
        im = Image.fromarray(render(p)).resize((p['w'] * 16 * S, p['h'] * 16 * S), Image.NEAREST)
        dr.rectangle((px + pad - 1, py + pad + 13, px + pad + im.width, py + pad + 14 + im.height), outline=(255, 255, 255))
        sh.alpha_composite(im, (px + pad, py + pad + 14)); dr.text((px + pad, py + 2), f"{k} {p['demo']} {p['w']}x{p['h']}", fill='white', stroke_width=2, stroke_fill='black')
    sh.save(path)
