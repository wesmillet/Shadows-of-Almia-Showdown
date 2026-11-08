"""The shades from the user's asset (shades_front_1x.png), as a design that can be drawn at any size.

At (lens 13x11, bridge 4, glints 2 wide) it reproduces the asset pixel for pixel; the sprites use
smaller sizes of the same design: a near-black frame with its corners cut, a dark inner rim, the
lens grey, a bright and a soft diagonal shine, a hollow bridge and a nub of the arms at each side.
"""
K = (22, 20, 26, 255)
B = (46, 44, 52, 255)
A = (66, 64, 74, 255)
G = (168, 168, 178, 255)
W = (214, 214, 222, 255)

def lens(x0, y0, w, h, glint=2, rim=True, shine_from=None, gap=2):
    """One lens, outer size w x h at (x0, y0). Returns {(x, y): colour}."""
    px = {}
    for y in range(h):
        for x in range(w):
            corner = (x in (0, w - 1)) and (y in (0, h - 1))
            if corner: continue
            edge = x in (0, w - 1) or y in (0, h - 1)
            if edge: px[(x0 + x, y0 + y)] = K; continue
            if rim and (x in (1, w - 2) or y in (1, h - 2)): px[(x0 + x, y0 + y)] = B; continue
            px[(x0 + x, y0 + y)] = A
    # the shine: two diagonal stripes, bright then soft, rising to the right
    r = 2 if rim else 1
    iw, ih = w - 2 * r, h - 2 * r
    if iw >= 2 and ih >= 2:
        g = glint
        s0 = shine_from if shine_from is not None else max(1, min(3, iw // 3))
        for y in range(ih):
            for x in range(iw):
                k = x + y
                if s0 <= k < s0 + g: px[(x0 + r + x, y0 + r + y)] = W
                elif s0 + g + gap <= k < s0 + 2 * g + gap and iw >= 4: px[(x0 + r + x, y0 + r + y)] = G
    return px

def pair(lw, lh, bridge, glint=2, rim=True, nubs=True, bar_row=3, bar_h=3, shine_from=None, gap=2):
    """The front view: two lenses, the hollow bridge between them and the arm nubs outside."""
    px = {}
    x = 1 if nubs else 0
    px.update(lens(x, 0, lw, lh, glint, rim, shine_from, gap))
    rx = x + lw + bridge
    px.update(lens(rx, 0, lw, lh, glint, rim, shine_from, gap))
    # bridge: frame lines top and bottom, the inner rim between (just frame when it's 2 high)
    for bx in range(x + lw - 1, rx + 1):
        px[(bx, bar_row)] = K
        px[(bx, bar_row + bar_h - 1)] = K
        for yy in range(bar_row + 1, bar_row + bar_h - 1):
            if x + lw - 1 < bx < rx: px[(bx, yy)] = B
    if nubs:
        px[(0, bar_row)] = K
        px[(rx + lw, bar_row)] = K
    return px

if __name__ == '__main__':
    import sys
    from PIL import Image
    ref = Image.open(sys.argv[1]).convert('RGBA')
    px = pair(13, 11, 4)
    out = Image.new('RGBA', ref.size, (0, 0, 0, 0))
    for (x, y), c in px.items(): out.putpixel((x, y), c)
    diff = [(x, y, ref.getpixel((x, y)), out.getpixel((x, y))) for x in range(ref.width) for y in range(ref.height) if ref.getpixel((x, y)) != out.getpixel((x, y))]
    print('differences', len(diff)); print(diff[:12])
