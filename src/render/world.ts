/**
 * Draws one frame of the match: ground, soft shadows, then every sprite and
 * decor item sorted by its ground point so things overlap correctly.
 */
import { lerp, dir8To4 } from '../core/math';
import type { Match } from '../sim/match';
import { bodyRadius, drawScale, monScale } from '../sim/data';
import { EVOLVE_SECONDS, EVOLVE_SWAP } from '../sim/evolution';
import type { Mon, Trainer } from '../sim/entities';
import type { RangerSprites } from '../sprites/rangerSprite';
import type { View } from './view';
import { uiFont } from '../ui/screens';
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
  const s = view.spriteScale * vis.scale * monScale(m);
  // Alphas shed red embers: half rise behind the body, half in front (drawn after the sprite).
  const embers = m.alpha && !m.fainted && vis.alpha > 0.5;
  if (embers) drawEmbers(ctx, m, sx, sy, s, 0);
  // Sprites shrunk below one screen pixel per art pixel are filtered rather than decimated.
  ctx.imageSmoothingEnabled = s < 1;
  ctx.imageSmoothingQuality = 'high';
  // Mid-dodge the sprite goes see-through, so the dash reads at a glance.
  const ghost = !!m.dodge && m.dodge.safe > 0;
  const tween = vis.scale < 1 || vis.alpha < 1 || vis.flash > 0 || ghost;
  if (tween) {
    ctx.save();
    ctx.globalAlpha = vis.alpha * (ghost ? 0.55 : 1);
  }
  const f = m.anim.current();
  const dx = sx - (f.w * s) / 2;
  // Shrink toward the ground point so the Pokémon is pulled into the ball from its feet; a leap lifts it on an arc.
  const leapLift = m.leap ? m.leap.h * Math.sin(Math.PI * Math.min(1, m.leap.t / m.leap.dur)) * view.pxPerTile : 0;
  const dy = sy - (f.h * s) / 2 - (1 - vis.scale) * f.h * view.spriteScale * monScale(m) * 0.15 - leapLift;
  if (m.aura || m.alpha) {
    // A purple glow for Pokémon under the darkness, a red one for Alphas.
    ctx.save();
    ctx.shadowColor = m.alpha && !m.aura ? 'rgba(255,60,70,0.9)' : 'rgba(150,60,255,0.95)';
    ctx.shadowBlur = 14 * view.baseScale;
    ctx.drawImage(f.image, f.sx, f.sy, f.w, f.h, dx, dy, f.w * s, f.h * s);
    ctx.restore();
  }
  ctx.drawImage(f.image, f.sx, f.sy, f.w, f.h, dx, dy, f.w * s, f.h * s);
  if (embers) drawEmbers(ctx, m, sx, sy, s, 1);
  if (m.shiny && !m.fainted) drawSparkle(ctx, m.id, dx, dy, f.w * s, f.h * s, view.baseScale);
  if (m.flash > 0 && !m.fainted) {
    // Two-frame white flash: draw the frame again through a white tint.
    ctx.save();
    ctx.globalCompositeOperation = 'source-atop';
    ctx.globalAlpha = 0.0;
    ctx.restore();
    const c = flashCanvas(f.image, f.sx, f.sy, f.w, f.h);
    ctx.drawImage(c, dx, dy, f.w * s, f.h * s);
  }
  if (m.status === 'freeze') {
    // Frozen: an icy glaze over the held pose.
    const c = flashCanvas(f.image, f.sx, f.sy, f.w, f.h);
    ctx.save();
    ctx.globalAlpha = 0.5 * vis.alpha;
    ctx.drawImage(tint(c, '#9fe6ff'), dx, dy, f.w * s, f.h * s);
    ctx.restore();
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
  ctx.font = uiFont(14 * view.baseScale);
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

/** The bottom of a market stand picture (its counter), redrawn over the vendor standing behind it. */
const COUNTER_FRACTION = 0.38;
function drawCounterFront(view: View, d: DecorItem, tileSize: number): void {
  const k = view.pxPerTile / tileSize;
  const rows = Math.round(d.frameH * COUNTER_FRACTION);
  const sx = Math.round(view.toScreenX(d.x));
  const sy = Math.round(view.toScreenY(d.y) - d.anchorY * k);
  view.ctx.imageSmoothingEnabled = false;
  view.ctx.drawImage(d.image, d.srcX ?? 0, (d.srcY ?? 0) + d.frameH - rows, d.frameW, rows, Math.round(sx - d.anchorX * k), sy + (d.frameH - rows) * k, d.frameW * k, rows * k);
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
    if (!inView(p.x, p.y) || m.visual.alpha <= 0.05) continue;
    // Sized to the body: a Jirachi gets a small pool of shade, a Steelix a wide one.
    const r = Math.max(0.1, Math.min(2.6, bodyRadius(m.species) * 0.8)) * Math.min(1, m.visual.scale);
    // One shadow per Pokémon, under the frame's ground point (the sprite sheet's own shadow is not drawn too).
    const [gx, gy] = m.anim.ground();
    const k = view.spriteScale * m.visual.scale * monScale(m);
    drawSoftShadow(view, view.toScreenX(p.x) + gx * k, view.toScreenY(p.y) + gy * k, r, 0.28 * m.visual.alpha);
  }
  for (const t of [match.player, ...match.trainers, ...match.npcs]) {
    if (!t.alive || t.downUntil !== undefined) continue;
    const p = trainerPos(t, alpha);
    // Wider than the stance and centred just above the soles, so the feet stand in the shade.
    if (inView(p.x, p.y)) drawSoftShadow(view, view.toScreenX(p.x), view.toScreenY(p.y) - view.spriteScale, 0.5, 0.3);
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
    if (!t.alive || t.downUntil !== undefined) continue;
    const p = trainerPos(t, alpha);
    if (!inView(p.x, p.y)) continue;
    const c = t.counter;
    if (c) {
      // A vendor behind the counter: drawn just after the stand, then the counter's front over the legs.
      list.push({ y: (c.sortY ?? c.y) + 0.001, draw: () => {
        drawTrainer(view, t, opts.rangers, alpha, match.ground);
        drawCounterFront(view, c, match.ground.tileSize);
      } });
    } else list.push({ y: p.y, draw: () => drawTrainer(view, t, opts.rangers, alpha, match.ground) });
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
    if (!t.alive || t.downUntil !== undefined) continue;
    const p = trainerPos(t, alpha);
    if (inView(p.x, p.y) && match.ground.underCanopy(p.x, p.y)) drawTrainer(view, t, opts.rangers, alpha, match.ground);
  }
  ctx.restore();
}

/** A shiny's glint: a four-point star that twinkles somewhere on the body every couple of seconds. */
function drawSparkle(ctx: CanvasRenderingContext2D, id: number, x: number, y: number, w: number, h: number, scale: number): void {
  const t = performance.now() / 1000 + id * 0.73;
  const cycle = Math.floor(t / 1.8);
  const ph = (t / 1.8) % 1;
  if (ph > 0.3) return;
  const k = Math.sin((ph / 0.3) * Math.PI);
  // A different spot each glint, from the cycle number.
  const rx = ((cycle * 7919 + id * 104729) % 1000) / 1000;
  const ry = ((cycle * 3571 + id * 7727) % 1000) / 1000;
  const cx = x + w * (0.25 + rx * 0.5);
  const cy = y + h * (0.2 + ry * 0.45);
  const r = (5 + 4 * k) * scale;
  ctx.save();
  ctx.globalAlpha = 0.9 * k;
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.moveTo(cx, cy - r);
  ctx.lineTo(cx + r * 0.22, cy - r * 0.22);
  ctx.lineTo(cx + r, cy);
  ctx.lineTo(cx + r * 0.22, cy + r * 0.22);
  ctx.lineTo(cx, cy + r);
  ctx.lineTo(cx - r * 0.22, cy + r * 0.22);
  ctx.lineTo(cx - r, cy);
  ctx.lineTo(cx - r * 0.22, cy - r * 0.22);
  ctx.closePath();
  ctx.fill();
  ctx.globalAlpha = 0.5 * k;
  ctx.fillStyle = '#bff6ff';
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.35, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

const EMBER_LIFE = 1.6;
const EMBERS_PER_LAYER = 9;

/**
 * An Alpha's embers: art-pixel squares that leave the body, drift up and sway, cooling from
 * yellow through orange and red to a dark ember as they fade. Stateless: each ember's spot and
 * phase come from its index and the Pokémon's id. `layer` 0 draws the ones behind the body.
 */
function drawEmbers(ctx: CanvasRenderingContext2D, m: Mon, sx: number, sy: number, s: number, layer: 0 | 1): void {
  const now = performance.now() / 1000;
  const bw = m.species.body[0] * s;
  const bh = m.species.body[1] * s;
  const px = Math.max(2, Math.round(s));
  ctx.save();
  for (let i = 0; i < EMBERS_PER_LAYER; i++) {
    const k = i * 2 + layer;
    const h1 = hash01(m.id * 131 + k * 17);
    const h2 = hash01(m.id * 71 + k * 29 + 5);
    const h3 = hash01(m.id * 13 + k * 53 + 9);
    const t = now + h1 * EMBER_LIFE;
    const cycle = Math.floor(t / EMBER_LIFE);
    const a = (t % EMBER_LIFE) / EMBER_LIFE;
    // A fresh spot on the body each time round.
    const rx = hash01(cycle * 977 + k * 31 + m.id) - 0.5;
    const ry = 0.25 + 0.65 * hash01(cycle * 389 + k * 7 + m.id * 3);
    const sway = Math.sin(t * 3 + k) * 2.2 * a * s;
    const x = sx + rx * bw * 0.8 + sway;
    const y = sy - bh * ry - (26 * a + h3 * 2) * s;
    const col = a < 0.25 ? '255,228,120' : a < 0.55 ? '255,120,40' : a < 0.8 ? '220,40,40' : '120,20,30';
    const alpha = Math.pow(1 - a, 0.6);
    const size = (h2 < 0.25 && a < 0.5 ? 2 : 1) * px;
    const gx = Math.round(x / px) * px;
    const gy = Math.round(y / px) * px;
    ctx.fillStyle = `rgba(255,60,30,${alpha * 0.2})`;
    ctx.fillRect(gx - px, gy - px, size + px * 2, size + px * 2);
    ctx.fillStyle = `rgba(${col},${alpha})`;
    ctx.fillRect(gx, gy, size, size);
  }
  ctx.restore();
}

function hash01(n: number): number {
  const x = Math.sin(n * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}
