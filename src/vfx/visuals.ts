/**
 * Procedural move VFX. Five families, each parameterised by a type colour
 * and a size, drawn in world space on the scene canvas and emitting light
 * into the lighting layer. `SpriteStripVisual` plays a hand-made strip
 * instead, so any move can swap families for art later (moves.json `strip`).
 */
import type { View } from '../render/view';
import { rgba } from '../ui/screens';

export interface MoveVisual {
  /** Ground point used for depth sorting. */
  y: number;
  /** Advance; return false when finished. */
  update(dt: number): boolean;
  /** Draw on the scene canvas (world space via the view). */
  draw(view: View): void;
  /** Draw additive light on the light canvas. */
  drawLight(view: View): void;
  /**
   * Waiting on the simulation's clock (a shot in flight, an impact not yet due): it waits out a
   * hit-stop with the simulation, so it still lands in the frame its damage does.
   */
  waitsOnSim?(): boolean;
}

function glow(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string, alpha: number): void {
  if (r <= 0 || alpha <= 0) return;
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, rgba(color, alpha));
  g.addColorStop(0.5, rgba(color, alpha * 0.35));
  g.addColorStop(1, rgba(color, 0));
  ctx.fillStyle = g;
  ctx.fillRect(x - r, y - r, r * 2, r * 2);
}

export class ImpactBurst implements MoveVisual {
  private t = 0;
  private readonly life = 0.38;
  private sparks: Array<{ a: number; v: number; len: number }> = [];
  y: number;

  constructor(private readonly x: number, private readonly wy: number, private readonly color: string, private readonly size: number) {
    this.y = wy + 0.01;
    for (let i = 0; i < 9; i++) this.sparks.push({ a: (i / 9) * Math.PI * 2 + Math.random() * 0.5, v: 0.8 + Math.random() * 0.9, len: 0.12 + Math.random() * 0.15 });
  }

  update(dt: number): boolean {
    this.t += dt;
    return this.t < this.life;
  }

  draw(view: View): void {
    const ctx = view.ctx;
    const p = this.t / this.life;
    const sx = view.toScreenX(this.x);
    const sy = view.toScreenY(this.wy) - 0.35 * view.pxPerTile;
    const unit = view.pxPerTile * this.size;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    // central flash
    glow(ctx, sx, sy, unit * 0.55 * (1 - p * 0.5), '#ffffff', (1 - p) * 0.9);
    glow(ctx, sx, sy, unit * 0.8, this.color, (1 - p) * 0.8);
    // expanding ring
    ctx.strokeStyle = rgba(this.color, (1 - p) * 0.95);
    ctx.lineWidth = Math.max(1.5, unit * 0.08 * (1 - p));
    ctx.beginPath();
    ctx.ellipse(sx, sy, unit * 0.65 * p + 2, unit * 0.5 * p + 2, 0, 0, Math.PI * 2);
    ctx.stroke();
    // sparks
    ctx.lineCap = 'round';
    for (const s of this.sparks) {
      const d = unit * s.v * p;
      const x0 = sx + Math.cos(s.a) * d;
      const y0 = sy + Math.sin(s.a) * d * 0.7;
      ctx.strokeStyle = rgba('#ffffff', (1 - p) * 0.9);
      ctx.lineWidth = Math.max(1, unit * 0.04);
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x0 + Math.cos(s.a) * unit * s.len, y0 + Math.sin(s.a) * unit * s.len * 0.7);
      ctx.stroke();
    }
    ctx.restore();
  }

  drawLight(view: View): void {
    const p = this.t / this.life;
    glow(view.lightCtx, view.toScreenX(this.x), view.toScreenY(this.wy) - 0.3 * view.pxPerTile, view.pxPerTile * 1.6 * this.size, this.color, (1 - p) * 0.9);
  }
}

export class Projectile implements MoveVisual {
  private t = 0;
  private readonly dur: number;
  private x: number;
  private wy: number;
  private trail: Array<{ x: number; y: number }> = [];
  y: number;

  constructor(
    private readonly x0: number,
    private readonly y0: number,
    private readonly x1: number,
    private readonly y1: number,
    private readonly color: string,
    private readonly size: number,
    private readonly onArrive: () => void,
  ) {
    const d = Math.hypot(x1 - x0, y1 - y0);
    this.dur = Math.max(0.12, d / 11);
    this.x = x0;
    this.wy = y0;
    this.y = y0;
  }

  update(dt: number): boolean {
    this.t += dt;
    const p = Math.min(1, this.t / this.dur);
    this.x = this.x0 + (this.x1 - this.x0) * p;
    this.wy = this.y0 + (this.y1 - this.y0) * p;
    this.y = this.wy + 0.02;
    this.trail.push({ x: this.x, y: this.wy });
    if (this.trail.length > 7) this.trail.shift();
    if (p >= 1) {
      this.onArrive();
      return false;
    }
    return true;
  }

  draw(view: View): void {
    const ctx = view.ctx;
    const unit = view.pxPerTile * this.size;
    const lift = 0.4 * view.pxPerTile;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    this.trail.forEach((pt, i) => {
      const k = (i + 1) / this.trail.length;
      glow(ctx, view.toScreenX(pt.x), view.toScreenY(pt.y) - lift, unit * 0.22 * k, this.color, 0.35 * k);
    });
    const sx = view.toScreenX(this.x);
    const sy = view.toScreenY(this.wy) - lift;
    glow(ctx, sx, sy, unit * 0.45, this.color, 0.9);
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(sx, sy, Math.max(2, unit * 0.11), 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  drawLight(view: View): void {
    glow(view.lightCtx, view.toScreenX(this.x), view.toScreenY(this.wy) - 0.4 * view.pxPerTile, view.pxPerTile * 1.1 * this.size, this.color, 0.8);
  }
}

export class Beam implements MoveVisual {
  private t = 0;
  private readonly life = 0.42;
  y: number;

  constructor(
    private readonly x0: number,
    private readonly y0: number,
    private readonly fx: number,
    private readonly fy: number,
    private readonly length: number,
    private readonly color: string,
    private readonly size: number,
    private readonly cone: boolean,
  ) {
    this.y = y0 + fy * length + 0.05;
  }

  update(dt: number): boolean {
    this.t += dt;
    return this.t < this.life;
  }

  private geometry(view: View): { sx: number; sy: number; ex: number; ey: number; w: number } {
    const lift = 0.35 * view.pxPerTile;
    const grow = Math.min(1, this.t / 0.1);
    const sx = view.toScreenX(this.x0);
    const sy = view.toScreenY(this.y0) - lift;
    const ex = view.toScreenX(this.x0 + this.fx * this.length * grow);
    const ey = view.toScreenY(this.y0 + this.fy * this.length * grow) - lift;
    return { sx, sy, ex, ey, w: view.pxPerTile * 0.22 * this.size };
  }

  draw(view: View): void {
    const ctx = view.ctx;
    const g = this.geometry(view);
    const fade = 1 - Math.max(0, (this.t - 0.25) / (this.life - 0.25));
    const flicker = 0.85 + 0.15 * Math.sin(this.t * 90);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    if (this.cone) {
      const len = Math.hypot(g.ex - g.sx, g.ey - g.sy);
      const nx = -(g.ey - g.sy) / (len || 1);
      const ny = (g.ex - g.sx) / (len || 1);
      const half = view.pxPerTile * 1.5;
      const grad = ctx.createLinearGradient(g.sx, g.sy, g.ex, g.ey);
      grad.addColorStop(0, rgba(this.color, 0.75 * fade));
      grad.addColorStop(1, rgba(this.color, 0));
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(g.sx, g.sy);
      ctx.lineTo(g.ex + nx * half, g.ey + ny * half);
      ctx.lineTo(g.ex - nx * half, g.ey - ny * half);
      ctx.closePath();
      ctx.fill();
      // leaf / shard streaks
      for (let i = 0; i < 7; i++) {
        const k = (i + 0.5) / 7;
        const spread = (k - 0.5) * 2 * half * 0.9;
        const px = g.sx + (g.ex - g.sx) * (0.3 + 0.7 * ((this.t * 3 + i * 0.13) % 1)) + nx * spread;
        const py = g.sy + (g.ey - g.sy) * (0.3 + 0.7 * ((this.t * 3 + i * 0.13) % 1)) + ny * spread;
        glow(ctx, px, py, g.w * 1.2, '#ffffff', 0.5 * fade);
      }
    } else {
      ctx.strokeStyle = rgba(this.color, 0.55 * fade * flicker);
      ctx.lineWidth = g.w * 2.4;
      ctx.beginPath();
      ctx.moveTo(g.sx, g.sy);
      ctx.lineTo(g.ex, g.ey);
      ctx.stroke();
      ctx.strokeStyle = rgba(this.color, 0.9 * fade * flicker);
      ctx.lineWidth = g.w;
      ctx.stroke();
      ctx.strokeStyle = rgba('#ffffff', 0.95 * fade);
      ctx.lineWidth = Math.max(1.5, g.w * 0.35);
      ctx.stroke();
      glow(ctx, g.ex, g.ey, g.w * 2.5, this.color, 0.8 * fade);
    }
    ctx.restore();
  }

  drawLight(view: View): void {
    const g = this.geometry(view);
    const fade = 1 - Math.max(0, (this.t - 0.25) / (this.life - 0.25));
    const ctx = view.lightCtx;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.strokeStyle = rgba(this.color, 0.55 * fade);
    ctx.lineWidth = view.pxPerTile * (this.cone ? 2.2 : 1.1) * this.size;
    ctx.filter = `blur(${Math.round(view.pxPerTile * 0.25)}px)`;
    ctx.beginPath();
    ctx.moveTo(g.sx, g.sy);
    ctx.lineTo(g.ex, g.ey);
    ctx.stroke();
    ctx.restore();
  }
}

/** Pieces of a shattering crystal: whole-pixel shards flung up and out, falling back and fading. */
export class ShardBurst implements MoveVisual {
  private t = 0;
  private readonly life = 1.1;
  private readonly bits: Array<{ vx: number; vy: number; size: number; color: string }> = [];
  y: number;

  constructor(private readonly x: number, private readonly wy: number, private readonly lift: number, colors: string[]) {
    this.y = wy + 0.05;
    for (let i = 0; i < 22; i++) {
      const a = (i / 22) * Math.PI * 2 + Math.random() * 0.4;
      const v = 2.2 + Math.random() * 3.2;
      this.bits.push({ vx: Math.cos(a) * v, vy: Math.sin(a) * v * 0.6 - 2.5, size: 1 + Math.floor(Math.random() * 3), color: colors[i % colors.length] as string });
    }
  }

  update(dt: number): boolean {
    this.t += dt;
    return this.t < this.life;
  }

  draw(view: View): void {
    const ctx = view.ctx;
    const k = view.spriteScale;
    const p = this.t / this.life;
    const sx = view.toScreenX(this.x);
    const sy = view.toScreenY(this.wy) - this.lift * view.pxPerTile;
    ctx.save();
    ctx.globalAlpha = 1 - p * p;
    for (const b of this.bits) {
      const x = sx + b.vx * this.t * view.pxPerTile;
      const y = sy + (b.vy * this.t + 4.5 * this.t * this.t) * view.pxPerTile;
      ctx.fillStyle = b.color;
      ctx.fillRect(Math.round(x / k) * k, Math.round(y / k) * k, b.size * k, b.size * k);
    }
    ctx.restore();
  }

  drawLight(view: View): void {
    const p = this.t / this.life;
    glow(view.lightCtx, view.toScreenX(this.x), view.toScreenY(this.wy) - this.lift * view.pxPerTile, 3.5 * view.pxPerTile, '#c77dff', (1 - p) * 0.9);
  }
}

export class RingPulse implements MoveVisual {
  private t = 0;
  private readonly life = 0.55;
  y: number;

  constructor(private readonly x: number, private readonly wy: number, private readonly radius: number, private readonly color: string, private readonly size: number) {
    this.y = wy + 0.03;
  }

  update(dt: number): boolean {
    this.t += dt;
    return this.t < this.life;
  }

  draw(view: View): void {
    const ctx = view.ctx;
    const p = this.t / this.life;
    const sx = view.toScreenX(this.x);
    const sy = view.toScreenY(this.wy);
    const r = this.radius * view.pxPerTile * (0.15 + 0.85 * Math.sqrt(p));
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.translate(sx, sy);
    ctx.scale(1, 0.92);
    for (let i = 0; i < 3; i++) {
      const rr = r * (1 - i * 0.18);
      ctx.strokeStyle = rgba(i === 1 ? '#ffffff' : this.color, (1 - p) * (0.9 - i * 0.25));
      ctx.lineWidth = Math.max(1.5, view.pxPerTile * 0.1 * this.size * (1 - p * 0.6));
      ctx.beginPath();
      ctx.arc(0, 0, Math.max(1, rr), 0, Math.PI * 2);
      ctx.stroke();
    }
    const fill = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
    fill.addColorStop(0, rgba(this.color, 0));
    fill.addColorStop(0.75, rgba(this.color, 0.25 * (1 - p)));
    fill.addColorStop(1, rgba(this.color, 0));
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  drawLight(view: View): void {
    const p = this.t / this.life;
    glow(view.lightCtx, view.toScreenX(this.x), view.toScreenY(this.wy), this.radius * view.pxPerTile * (0.4 + p), this.color, (1 - p) * 0.9);
  }
}

export class StatusCloud implements MoveVisual {
  private t = 0;
  private readonly life = 0.9;
  private puffs: Array<{ dx: number; dy: number; r: number; drift: number }> = [];
  y: number;

  constructor(private readonly x: number, private readonly wy: number, private readonly color: string, private readonly size: number) {
    this.y = wy + 0.02;
    for (let i = 0; i < 8; i++) this.puffs.push({ dx: (Math.random() - 0.5) * 0.9, dy: (Math.random() - 0.5) * 0.5, r: 0.18 + Math.random() * 0.22, drift: Math.random() * Math.PI * 2 });
  }

  update(dt: number): boolean {
    this.t += dt;
    return this.t < this.life;
  }

  draw(view: View): void {
    const ctx = view.ctx;
    const p = this.t / this.life;
    const unit = view.pxPerTile * this.size;
    ctx.save();
    for (const pf of this.puffs) {
      const px = view.toScreenX(this.x + pf.dx * (1 + p * 0.6)) + Math.sin(this.t * 3 + pf.drift) * unit * 0.05;
      const py = view.toScreenY(this.wy + pf.dy) - unit * (0.3 + p * 0.5);
      const g = ctx.createRadialGradient(px, py, 0, px, py, unit * pf.r * (1 + p * 0.5));
      g.addColorStop(0, rgba(this.color, 0.55 * (1 - p)));
      g.addColorStop(1, rgba(this.color, 0));
      ctx.fillStyle = g;
      ctx.fillRect(px - unit, py - unit, unit * 2, unit * 2);
    }
    ctx.restore();
  }

  drawLight(view: View): void {
    const p = this.t / this.life;
    glow(view.lightCtx, view.toScreenX(this.x), view.toScreenY(this.wy) - 0.4 * view.pxPerTile, view.pxPerTile * 1.2 * this.size, this.color, (1 - p) * 0.4);
  }
}

/** A hand-made effect strip (frames left to right) played once at a world position. */
export class SpriteStripVisual implements MoveVisual {
  private t = 0;
  y: number;

  constructor(
    private readonly image: HTMLImageElement,
    private readonly frameW: number,
    private readonly frameH: number,
    private readonly fps: number,
    private readonly x: number,
    private readonly wy: number,
    private readonly color: string,
    private readonly scale = 3,
  ) {
    this.y = wy + 0.02;
  }

  private get frames(): number {
    return Math.max(1, Math.floor(this.image.naturalWidth / this.frameW));
  }

  update(dt: number): boolean {
    this.t += dt;
    return this.t * this.fps < this.frames;
  }

  draw(view: View): void {
    const f = Math.min(this.frames - 1, Math.floor(this.t * this.fps));
    const s = this.scale * view.baseScale;
    view.ctx.imageSmoothingEnabled = false;
    view.ctx.drawImage(this.image, f * this.frameW, 0, this.frameW, this.frameH, view.toScreenX(this.x) - (this.frameW * s) / 2, view.toScreenY(this.wy) - this.frameH * s * 0.75, this.frameW * s, this.frameH * s);
  }

  drawLight(view: View): void {
    glow(view.lightCtx, view.toScreenX(this.x), view.toScreenY(this.wy) - 0.3 * view.pxPerTile, view.pxPerTile, this.color, 0.7);
  }
}

/** Soft point light that follows a world position (trainer styler glow, crystal, Darkrai). */
export function drawPointLight(view: View, x: number, y: number, radiusTiles: number, color: string, alpha: number, lift = 0.3): void {
  glow(view.lightCtx, view.toScreenX(x), view.toScreenY(y) - lift * view.pxPerTile, radiusTiles * view.pxPerTile, color, alpha);
}

export class VfxLayer {
  readonly list: MoveVisual[] = [];
  /** Added since the last update: they show their first frame before they start to play. */
  private readonly fresh = new Set<MoveVisual>();

  add(v: MoveVisual): void {
    this.list.push(v);
    this.fresh.add(v);
  }

  /**
   * Advances every effect by a frame. One added during this frame's simulation step is left at its
   * start for this frame, so effect time runs in step with the simulation: a shot the simulation
   * lands after n steps arrives on screen n frames after it was fired, in the same frame its damage
   * shows (it used to arrive one frame early, as did every delayed impact).
   */
  update(dt: number, simHeld = false): void {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const v = this.list[i] as MoveVisual;
      if (this.fresh.has(v)) continue;
      // During a hit-stop the simulation stands still: shots in flight and impacts not yet due wait
      // with it (impacts already playing keep playing, which is the point of the freeze).
      if (simHeld && v.waitsOnSim?.()) continue;
      if (!v.update(dt)) this.list.splice(i, 1);
    }
    this.fresh.clear();
  }

  draw(view: View): void {
    for (const v of this.list) v.draw(view);
  }

  drawLights(view: View): void {
    for (const v of this.list) v.drawLight(view);
  }
}
