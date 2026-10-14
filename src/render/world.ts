/**
 * Draws one frame of the match: ground, soft shadows, then every sprite and
 * decor item sorted by its ground point so things overlap correctly.
 */
import { lerp, dir8To4 } from '../core/math';
import type { Match } from '../sim/match';
import type { Mon, Trainer } from '../sim/entities';
import type { RangerSprites } from '../sprites/rangerSprite';
import type { View } from './view';

interface Drawable {
  y: number;
  draw: () => void;
}

export interface WorldRenderOptions {
  alpha: number;
  rangers: RangerSprites;
  /** Extra ground-layer drawing (telegraphs, items) between the ground and the sprites. */
  groundOverlay?: (view: View) => void;
  /** Extra depth-sorted drawables (VFX, balls). */
  extra?: Drawable[];
}

export function monPos(m: Mon, alpha: number): { x: number; y: number } {
  return { x: lerp(m.px, m.x, alpha), y: lerp(m.py, m.y, alpha) };
}

export function trainerPos(t: Trainer, alpha: number): { x: number; y: number } {
  return { x: lerp(t.px, t.x, alpha), y: lerp(t.py, t.y, alpha) };
}

export function drawSoftShadow(view: View, sx: number, sy: number, radiusTiles: number, alpha = 0.28): void {
  const ctx = view.ctx;
  const rx = radiusTiles * view.pxPerTile;
  const ry = rx * 0.45;
  const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, rx);
  g.addColorStop(0, `rgba(10,6,20,${alpha})`);
  g.addColorStop(0.6, `rgba(10,6,20,${alpha * 0.5})`);
  g.addColorStop(1, 'rgba(10,6,20,0)');
  ctx.save();
  ctx.translate(sx, sy);
  ctx.scale(1, ry / rx);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, rx, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

export function drawMon(view: View, m: Mon, alpha: number): void {
  const ctx = view.ctx;
  const p = monPos(m, alpha);
  const sx = Math.round(view.toScreenX(p.x));
  const sy = Math.round(view.toScreenY(p.y));
  const s = view.spriteScale;
  ctx.imageSmoothingEnabled = false;
  const shadow = m.anim.shadow();
  if (shadow) {
    ctx.drawImage(shadow.image, shadow.sx, shadow.sy, shadow.w, shadow.h, sx - (shadow.w * s) / 2, sy - (shadow.h * s) / 2, shadow.w * s, shadow.h * s);
  }
  const f = m.anim.current();
  const dx = sx - (f.w * s) / 2;
  const dy = sy - (f.h * s) / 2;
  if (m.aura) {
    ctx.save();
    ctx.shadowColor = 'rgba(150,60,255,0.95)';
    ctx.shadowBlur = 14 * view.baseScale;
    ctx.drawImage(f.image, f.sx, f.sy, f.w, f.h, dx, dy, f.w * s, f.h * s);
    ctx.restore();
  }
  ctx.drawImage(f.image, f.sx, f.sy, f.w, f.h, dx, dy, f.w * s, f.h * s);
  if (m.flash > 0 && !m.fainted) {
    // Two-frame white flash: draw the frame again through a white tint.
    ctx.save();
    ctx.globalCompositeOperation = 'source-atop';
    ctx.globalAlpha = 0.0;
    ctx.restore();
    const c = flashCanvas(f.image, f.sx, f.sy, f.w, f.h);
    ctx.drawImage(c, dx, dy, f.w * s, f.h * s);
  }
  if (m.status === 'sleep') drawZzz(view, sx, sy - (f.h * s) / 2, m.anim.time);
}

const flashCache = document.createElement('canvas');
function flashCanvas(img: CanvasImageSource, sx: number, sy: number, w: number, h: number): HTMLCanvasElement {
  flashCache.width = w;
  flashCache.height = h;
  const g = flashCache.getContext('2d')!;
  g.clearRect(0, 0, w, h);
  g.drawImage(img, sx, sy, w, h, 0, 0, w, h);
  g.globalCompositeOperation = 'source-in';
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, w, h);
  g.globalCompositeOperation = 'source-over';
  return flashCache;
}

function drawZzz(view: View, sx: number, top: number, t: number): void {
  const ctx = view.ctx;
  ctx.save();
  ctx.font = `bold ${Math.round(14 * view.baseScale)}px sans-serif`;
  ctx.textAlign = 'center';
  for (let i = 0; i < 3; i++) {
    const ph = (t * 0.8 + i * 0.33) % 1;
    ctx.globalAlpha = 1 - ph;
    ctx.fillStyle = '#dfe7ff';
    ctx.fillText('z', sx + (8 + ph * 18) * view.baseScale, top - (ph * 26 + 4) * view.baseScale);
  }
  ctx.restore();
}

export function drawTrainer(view: View, t: Trainer, rangers: RangerSprites, alpha: number): void {
  const ctx = view.ctx;
  const p = trainerPos(t, alpha);
  const sx = Math.round(view.toScreenX(p.x));
  const sy = Math.round(view.toScreenY(p.y));
  const s = view.rangerScale;
  const sheet = rangers.get(t.role);
  const f = sheet.frame(dir8To4(t.dir), t.walkPhase, t.moving);
  drawSheetFrame(ctx, f, sx, sy, s);
}

/** Draws an overworld frame with its feet at (sx, sy), mirrored when the manifest says so. */
export function drawSheetFrame(ctx: CanvasRenderingContext2D, f: { image: CanvasImageSource; sx: number; sy: number; w: number; h: number; footY: number; flip: boolean }, sx: number, sy: number, s: number): void {
  ctx.imageSmoothingEnabled = false;
  const dw = f.w * s;
  const dh = f.h * s;
  const dx = sx - Math.round(dw / 2);
  const dy = sy - f.footY * s;
  if (f.flip) {
    ctx.save();
    ctx.translate(dx + dw, dy);
    ctx.scale(-1, 1);
    ctx.drawImage(f.image, f.sx, f.sy, f.w, f.h, 0, 0, dw, dh);
    ctx.restore();
  } else {
    ctx.drawImage(f.image, f.sx, f.sy, f.w, f.h, dx, dy, dw, dh);
  }
}

export function renderWorld(view: View, match: Match, opts: WorldRenderOptions): void {
  const { alpha } = opts;
  const ctx = view.ctx;
  match.ground.drawGround(view);
  opts.groundOverlay?.(view);

  const vis = view.visibleTiles();
  const inView = (x: number, y: number, pad = 2) => x > vis.x0 - pad && x < vis.x1 + pad && y > vis.y0 - pad && y < vis.y1 + pad;

  // Soft shadows under everyone.
  for (const m of match.renderMons()) {
    const p = monPos(m, alpha);
    if (!inView(p.x, p.y)) continue;
    drawSoftShadow(view, view.toScreenX(p.x), view.toScreenY(p.y), 0.42);
  }
  for (const t of [match.player, ...match.trainers, ...match.npcs]) {
    if (!t.alive) continue;
    const p = trainerPos(t, alpha);
    if (inView(p.x, p.y)) drawSoftShadow(view, view.toScreenX(p.x), view.toScreenY(p.y + 0.02), 0.3);
  }

  const list: Drawable[] = [];
  for (const d of match.ground.decor) {
    if (!inView(d.x, d.y, 3)) continue;
    list.push({
      y: d.y,
      draw: () => {
        const k = view.pxPerTile / match.ground.tileSize;
        ctx.imageSmoothingEnabled = true;
        drawSoftShadow(view, view.toScreenX(d.x), view.toScreenY(d.y), d.kind === 'tree' ? 0.7 : 0.35, 0.22);
        ctx.drawImage(d.image, view.toScreenX(d.x) - d.anchorX * k, view.toScreenY(d.y) - d.anchorY * k, d.w * k, d.h * k);
      },
    });
  }
  for (const m of match.renderMons()) {
    const p = monPos(m, alpha);
    if (!inView(p.x, p.y)) continue;
    list.push({ y: p.y, draw: () => drawMon(view, m, alpha) });
  }
  for (const t of [match.player, ...match.trainers, ...match.npcs]) {
    if (!t.alive) continue;
    const p = trainerPos(t, alpha);
    if (!inView(p.x, p.y)) continue;
    list.push({ y: p.y, draw: () => drawTrainer(view, t, opts.rangers, alpha) });
  }
  if (opts.extra) list.push(...opts.extra);
  list.sort((a, b) => a.y - b.y);
  for (const d of list) d.draw();
}
