/**
 * Draws one frame of the match: ground, soft shadows, then every sprite and
 * decor item sorted by its ground point so things overlap correctly.
 */
import { lerp, dir8To4 } from '../core/math';
import type { Match } from '../sim/match';
import { drawScale } from '../sim/data';
import { EVOLVE_SECONDS, EVOLVE_SWAP } from '../sim/evolution';
import type { Mon, Trainer } from '../sim/entities';
import type { RangerSprites } from '../sprites/rangerSprite';
import type { View } from './view';
import type { DecorItem, GroundRenderer } from '../ground/types';

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

/** Flat oval drop shadow on the pixel grid (no gradient). */
export function drawSoftShadow(view: View, sx: number, sy: number, radiusTiles: number, alpha = 0.28): void {
  const ctx = view.ctx;
  const s = view.spriteScale;
  const rx = Math.max(s, Math.round((radiusTiles * view.pxPerTile) / s) * s);
  const ry = Math.max(s, Math.round(rx * 0.45 / s) * s);
  const cx = Math.round(sx / s) * s;
  const cy = Math.round(sy / s) * s;
  ctx.save();
  ctx.fillStyle = `rgba(10,6,20,${alpha})`;
  // Stepped ellipse: rows of whole pixels.
  for (let yy = -ry; yy < ry; yy += s) {
    const k = Math.sqrt(Math.max(0, 1 - ((yy + s / 2) / ry) ** 2));
    const half = Math.round((rx * k) / s) * s;
    if (half <= 0) continue;
    ctx.fillRect(cx - half, cy + yy, half * 2, s);
  }
  ctx.restore();
}

export function drawMon(view: View, m: Mon, alpha: number): void {
  const ctx = view.ctx;
  const p = monPos(m, alpha);
  const sx = Math.round(view.toScreenX(p.x));
  const sy = Math.round(view.toScreenY(p.y));
  const vis = m.visual;
  if (vis.alpha <= 0.01 || vis.scale <= 0.01) return;
  // Drawn at canonical size against the trainers (see drawScale): screen pixels per sprite pixel.
  const s = view.spriteScale * vis.scale * drawScale(m.species);
  // Sprites shrunk below one screen pixel per art pixel are filtered rather than decimated.
  ctx.imageSmoothingEnabled = s < 1;
  ctx.imageSmoothingQuality = 'high';
  const tween = vis.scale < 1 || vis.alpha < 1 || vis.flash > 0;
  if (tween) {
    ctx.save();
    ctx.globalAlpha = vis.alpha;
  }
  const shadow = m.anim.shadow();
  if (shadow) {
    ctx.drawImage(shadow.image, shadow.sx, shadow.sy, shadow.w, shadow.h, sx - (shadow.w * s) / 2, sy - (shadow.h * s) / 2, shadow.w * s, shadow.h * s);
  }
  const f = m.anim.current();
  const dx = sx - (f.w * s) / 2;
  // Shrink toward the ground point so the Pokémon is pulled into the ball from its feet.
  const dy = sy - (f.h * s) / 2 - (1 - vis.scale) * f.h * view.spriteScale * drawScale(m.species) * 0.15;
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
  if (vis.flash > 0) {
    const c = flashCanvas(f.image, f.sx, f.sy, f.w, f.h);
    ctx.save();
    ctx.globalAlpha = vis.alpha * vis.flash;
    ctx.drawImage(tint(c, '#ff3b3b'), dx, dy, f.w * s, f.h * s);
    ctx.restore();
  }
  if (m.evolving) {
    // Evolution: the body glows white, brighter and faster toward the swap, then fades.
    const e = m.evolving;
    const k = e.t < EVOLVE_SWAP ? (e.t / EVOLVE_SWAP) * (0.65 + 0.35 * Math.sin(e.t * (8 + 14 * (e.t / EVOLVE_SWAP))))
      : Math.max(0, 1 - (e.t - EVOLVE_SWAP) / (EVOLVE_SECONDS - EVOLVE_SWAP));
    const c = flashCanvas(f.image, f.sx, f.sy, f.w, f.h);
    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, k));
    ctx.drawImage(c, dx, dy, f.w * s, f.h * s);
    ctx.restore();
  }
  if (tween) ctx.restore();
  ctx.imageSmoothingEnabled = false;
  if (m.status === 'sleep' && !tween) drawZzz(view, sx, sy - m.species.body[1] * s, m.anim.time);
}

const tintCache = document.createElement('canvas');
function tint(src: HTMLCanvasElement, color: string): HTMLCanvasElement {
  tintCache.width = src.width;
  tintCache.height = src.height;
  const g = tintCache.getContext('2d')!;
  g.clearRect(0, 0, src.width, src.height);
  g.drawImage(src, 0, 0);
  g.globalCompositeOperation = 'source-in';
  g.fillStyle = color;
  g.fillRect(0, 0, src.width, src.height);
  g.globalCompositeOperation = 'source-over';
  return tintCache;
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

export function drawTrainer(view: View, t: Trainer, rangers: RangerSprites, alpha: number, ground?: GroundRenderer): void {
  const ctx = view.ctx;
  const p = trainerPos(t, alpha);
  const sx = Math.round(view.toScreenX(p.x));
  const sy = Math.round(view.toScreenY(p.y));
  const s = view.rangerScale;
  const sheet = rangers.get(t.role);
  // On a ladder trainers climb facing the cliff, up or down, with the back-view walk cycle.
  const climbing = ground?.onLadder?.(Math.floor(p.x), Math.floor(p.y)) ?? false;
  const f = sheet.frame(climbing ? 'up' : dir8To4(t.dir), t.walkPhase, t.moving);
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

let worldTime = 0;

/** One map object (tree, building, prop) at its place; shared by the match and the title screen. */
export function drawDecorItem(view: View, d: DecorItem, tileSize: number, time: number): void {
  const ctx = view.ctx;
  const k = view.pxPerTile / tileSize;
  ctx.imageSmoothingEnabled = false;
  if (d.kind === 'tree' && !d.extent) drawSoftShadow(view, view.toScreenX(d.x), view.toScreenY(d.y), 0.5, 0.22);
  const f = d.frames > 1 ? (Math.floor(time * d.fps) + (d.phase ?? 0)) % d.frames : 0;
  const sx = Math.round(view.toScreenX(d.x));
  const sy = Math.round(view.toScreenY(d.y) - d.anchorY * k);
  if (d.flip) {
    ctx.save();
    ctx.translate(sx, sy);
    ctx.scale(-1, 1);
    ctx.drawImage(d.image, (d.srcX ?? 0) + f * d.frameW, d.srcY ?? 0, d.frameW, d.frameH, Math.round(-(d.frameW - d.anchorX) * k), 0, d.frameW * k, d.frameH * k);
    ctx.restore();
  } else {
    ctx.drawImage(d.image, (d.srcX ?? 0) + f * d.frameW, d.srcY ?? 0, d.frameW, d.frameH, Math.round(sx - d.anchorX * k), sy, d.frameW * k, d.frameH * k);
  }
}

/** Every map object in view, in depth order (no characters): the title screen's backdrop. */
export function drawDecor(view: View, ground: GroundRenderer, time: number): void {
  const vis = view.visibleTiles();
  for (const d of ground.decor) {
    const pad = Math.max(3, d.extent ?? 0);
    if (d.x < vis.x0 - pad || d.x > vis.x1 + pad || d.y < vis.y0 - pad || d.y > vis.y1 + pad) continue;
    drawDecorItem(view, d, ground.tileSize, time);
  }
}

export function renderWorld(view: View, match: Match, opts: WorldRenderOptions): void {
  const { alpha } = opts;
  const ctx = view.ctx;
  worldTime = match.time;
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
    if (!inView(d.x, d.y, Math.max(3, d.extent ?? 0))) continue;
    list.push({
      y: d.sortY ?? d.y,
      draw: () => drawDecorItem(view, d, match.ground.tileSize, worldTime),
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
    list.push({ y: p.y, draw: () => drawTrainer(view, t, opts.rangers, alpha, match.ground) });
  }
  if (opts.extra) list.push(...opts.extra);
  list.sort((a, b) => a.y - b.y);
  for (const d of list) d.draw();

  // Forest canopy above everything; anyone standing under it shows through faded.
  match.ground.drawCanopy(view);
  ctx.save();
  ctx.globalAlpha = 0.45;
  for (const m of match.renderMons()) {
    const p = monPos(m, alpha);
    if (inView(p.x, p.y) && match.ground.underCanopy(p.x, p.y)) drawMon(view, m, alpha);
  }
  for (const t of [match.player, ...match.trainers, ...match.npcs]) {
    if (!t.alive) continue;
    const p = trainerPos(t, alpha);
    if (inView(p.x, p.y) && match.ground.underCanopy(p.x, p.y)) drawTrainer(view, t, opts.rangers, alpha, match.ground);
  }
  ctx.restore();
}
