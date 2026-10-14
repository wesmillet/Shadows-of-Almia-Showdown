"""Shared helpers for studying and rendering the Sunnyside tileset."""
import json, numpy as np
from PIL import Image
import os
ROOT=os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
TS=json.load(open(f'{ROOT}/assets/tiles/sunnyside/sunnyside.json'))
SHEET=np.array(Image.open(f'{ROOT}/assets/tiles/sunnyside/spr_tileset_sunnysideworld_16px.png').convert('RGBA'))
FSHEET=np.array(Image.open(f'{ROOT}/assets/tiles/sunnyside/spr_tileset_sunnysideworld_forest_32px.png').convert('RGBA'))
ANIMS=TS['tilesets']['tileset_sunnysideworld']['animations']
def raw(idx, forest=False):
    if forest:
        r,c=divmod(idx,10); return FSHEET[r*32:r*32+32,c*32:c*32+32]
    r,c=divmod(idx,64); return SHEET[r*16:r*16+16,c*16:c*16+16]
def xform(t, flags, order='flip_first'):
    m,f,rot=flags&1,(flags>>1)&1,(flags>>2)&1
    if order=='rot_first':
        if rot: t=np.rot90(t,-1)
        if m: t=t[:,::-1]
        if f: t=t[::-1,:]
    else:
        if m: t=t[:,::-1]
        if f: t=t[::-1,:]
        if rot: t=np.rot90(t,-1)
    return t
def tile(idx, flags=0, forest=False, order='flip_first'):
    return xform(raw(idx,forest),flags,order)
def layers():
    return {l['name']:l for l in TS['demo_room']['layers']}
def composite(dst, src, x, y):
    """alpha-composite RGBA uint8 src onto float dst at x,y"""
    h,w=src.shape[:2]; H,W=dst.shape[:2]
    if x>=W or y>=H or x+w<=0 or y+h<=0: return
    sx0=max(0,-x); sy0=max(0,-y); sx1=min(w,W-x); sy1=min(h,H-y)
    s=src[sy0:sy1,sx0:sx1].astype(float); a=s[:,:,3:4]/255
    d=dst[y+sy0:y+sy1, x+sx0:x+sx1]
    d[:,:,:3]=d[:,:,:3]*(1-a)+s[:,:,:3]*a; d[:,:,3:4]=np.maximum(d[:,:,3:4],s[:,:,3:4])
def render_layers(names, x0=0,y0=0,x1=None,y1=None, order='flip_first', bg=(0,0,0)):
    L=layers(); first=L['land']; W=first['w']; H=first['h']
    x1=x1 or W; y1=y1 or H
    out=np.zeros(((y1-y0)*16,(x1-x0)*16,4)); out[:,:,:3]=bg; out[:,:,3]=255
    for n in names:
        l=L[n]
        if 'tiles' not in l: continue
        forest=l['tileset']=='tileset_forest'; s=32 if forest else 16
        for ty,row in enumerate(l['tiles']):
            for tx,t in enumerate(row):
                if not t: continue
                px,py=tx*s-x0*16,ty*s-y0*16
                if px<-s or py<-s or px>=(x1-x0)*16 or py>=(y1-y0)*16: continue
                composite(out, tile(t,l['flags'][ty][tx],forest,order), px,py)
    return out.astype(np.uint8)

import json as _json, os as _os
PROPS = _json.load(open(f'{ROOT}/assets/tiles/sunnyside/props/props.json'))
_strips = {}
def prop_frame(name, frame=0):
    m = PROPS[name]
    if name not in _strips:
        _strips[name] = np.array(Image.open(f"{ROOT}/assets/tiles/sunnyside/props/{m['file']}").convert('RGBA'))
    s = _strips[name]; f = frame % m['frames']
    return s[:, f*m['w']:(f+1)*m['w']]
def draw_prop(dst, name, x, y, ox=0, oy=0, frame=0):
    """x,y = origin position in pixels (GameMaker convention)"""
    m = PROPS[name]
    composite(dst, prop_frame(name, frame), int(round(x - m['originX'] - ox)), int(round(y - m['originY'] - oy)))
