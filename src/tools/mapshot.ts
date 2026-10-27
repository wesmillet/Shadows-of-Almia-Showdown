/**
 * Dev tool: the whole island drawn at one scale into one PNG (window.shot, base64), for map
 * previews and for scripts/mapgen/center_blend.py. Open tools/mapshot.html on the dev server:
 * `?k=16` pixels per tile (16 = the art's own size), `?layer=ground|decor|all`, `?blend=0` to
 * draw without the centre blend (the input center_blend.py needs), `?overlay=0` without the
 * paving overlay, `?skip=Courtyard` leaving stack layers out (pave_smooth.py's inputs).
 */
import { Assets } from '../sprites/assets';
import { FanGround } from '../ground/fanGround';
import { drawDecorItem } from '../render/world';
import { CONFIG } from '../sim/data';
import type { View } from '../render/view';

(async () => {
  const q = new URLSearchParams(location.search);
  const k = Number(q.get('k') ?? 16);
  const layer = q.get('layer') ?? 'all';
  const g = await FanGround.load(new Assets(), CONFIG.map.name, undefined, {
    blend: q.get('blend') !== '0',
    overlay: q.get('overlay') !== '0',
    skip: (q.get('skip') ?? '').split(',').filter(Boolean),
  });
  if (!g) throw new Error('no map');
  const W = g.cols * k;
  const H = g.rows * k;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d') as CanvasRenderingContext2D;
  ctx.imageSmoothingEnabled = false;
  const view = {
    ctx, width: W, height: H, zoom: 1, tileSize: 16, pxPerTile: k, spriteScale: k / 16,
    toScreenX: (x: number) => x * k, toScreenY: (y: number) => y * k,
    visibleTiles: () => ({ x0: 0, y0: 0, x1: g.cols, y1: g.rows }),
  } as unknown as View;
  if (layer !== 'decor') {
    ctx.fillStyle = '#0b0a12';
    ctx.fillRect(0, 0, W, H);
    g.drawGround(view);
  }
  if (layer !== 'ground') for (const d of g.decor) drawDecorItem(view, d, g.tileSize, 0);
  const blob: Blob = await new Promise((r) => c.toBlob((b) => r(b as Blob), 'image/png'));
  const buf = new Uint8Array(await blob.arrayBuffer());
  let s = '';
  for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  (window as unknown as { shot: string }).shot = btoa(s);
})().catch((e) => ((window as unknown as { shotErr: string }).shotErr = String(e)));
