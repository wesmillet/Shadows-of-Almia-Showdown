/**
 * Move visuals built from Guardian Signs effect sheets: a frame animation
 * anchored to a point or a Pokémon (impacts, rings, auras, status loops),
 * a projectile that flies attacker -> target facing its travel direction,
 * and a beam that tiles (or a stream that stretches) the strip between
 * attacker and target. Each emits light of the sheet's dominant colour.
 */
import type { View } from '../render/view';
import { rgba } from '../ui/screens';
import { tintedSheet, type FxSheet } from './fxLibrary';
import type { MoveVisual } from './visuals';

export type FxFacing = 'right' | 'up' | 'none';

/** Which way a frame's artwork points: tall frames point up, wide ones right. */
export function defaultFacing(sheet: FxSheet): FxFacing {
  if (sheet.fh > sheet.fw * 1.1) return 'up';
  if (sheet.fw > sheet.fh * 1.1) return 'right';
  return 'none';
}

function facingOffset(f: FxFacing): number {
  return f === 'up' ? Math.PI / 2 : 0;
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

export interface FxAnimOptions {
  x: number;
  y: number;
  /** Height above the ground point, in tiles. */
  lift?: number;
  scale?: number;
  fps?: number;
  /** Loop for this many seconds instead of playing once. */
  loopSeconds?: number;
  /** Follow a moving thing (status loops above a head). */
  follow?: { x: number; y: number } | null;
  tint?: string;
  rotation?: number;
  /** Light strength multiplier (0 disables). */
  light?: number;
}

/** A frame animation at a world point. */
export class FxAnim implements MoveVisual {
  private t = 0;
  private x: number;
  private wy: number;
  private readonly lift: number;
  private readonly scale: number;
  private readonly fps: number;
  private readonly loopSeconds: number;
  private readonly follow: { x: number; y: number } | null;
  private readonly source: CanvasImageSource;
  private readonly rotation: number;
  private readonly light: number;
  y: number;

  constructor(private readonly sheet: FxSheet, o: FxAnimOptions) {
    this.x = o.x;
    this.wy = o.y;
    this.lift = o.lift ?? 0.45;
    this.scale = o.scale ?? 3;
    this.fps = o.fps ?? 15;
    this.loopSeconds = o.loopSeconds ?? 0;
    this.follow = o.follow ?? null;
    this.source = o.tint ? tintedSheet(sheet, o.tint) : sheet.img;
    this.rotation = o.rotation ?? 0;
    this.light = o.light ?? 1;
    this.y = o.y + 0.01;
  }

  private get life(): number {
    return this.loopSeconds > 0 ? this.loopSeconds : this.sheet.frames / this.fps;
  }

  private frame(): number {
    const f = Math.floor(this.t * this.fps);
    return this.loopSeconds > 0 ? f % this.sheet.frames : Math.min(this.sheet.frames - 1, f);
  }

  update(dt: number): boolean {
    this.t += dt;
    if (this.follow) {
      this.x = this.follow.x;
      this.wy = this.follow.y;
      this.y = this.wy + 0.01;
    }
    return this.t < this.life;
  }

  /** 1 while playing, fading over the last 25% of a loop. */
  private alpha(): number {
    if (this.loopSeconds <= 0) return 1;
    const k = this.t / this.life;
    return k > 0.75 ? Math.max(0, 1 - (k - 0.75) / 0.25) : 1;
  }

  draw(view: View): void {
    const ctx = view.ctx;
    const f = this.frame();
    const w = this.sheet.fw * this.scale;
    const h = this.sheet.fh * this.scale;
    const sx = Math.round(view.toScreenX(this.x));
    const sy = Math.round(view.toScreenY(this.wy) - this.lift * view.pxPerTile);
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.globalAlpha = this.alpha();
    ctx.translate(sx, sy);
    if (this.rotation) ctx.rotate(this.rotation);
    ctx.drawImage(this.source, f * this.sheet.fw, 0, this.sheet.fw, this.sheet.fh, -Math.floor(w / 2), -Math.floor(h / 2), w, h);
    ctx.restore();
  }

  drawLight(view: View): void {
    if (this.light <= 0) return;
    const k = this.loopSeconds > 0 ? this.alpha() : 1 - this.t / this.life;
    const r = Math.max(this.sheet.fw, this.sheet.fh) * this.scale * 0.6;
    glow(view.lightCtx, view.toScreenX(this.x), view.toScreenY(this.wy) - this.lift * view.pxPerTile, r, this.sheet.color, 0.4 * k * this.light);
  }
}

export interface FxProjectileOptions {
  from: { x: number; y: number };
  to: { x: number; y: number };
  lift?: number;
  scale?: number;
  fps?: number;
  tint?: string;
  facing?: FxFacing;
  /** Tiles per second. */
  speed?: number;
  onHit?: () => void;
}

/** A looping frame that flies from attacker to target, rotated to face its travel direction. */
export class FxProjectile implements MoveVisual {
  private t = 0;
  private readonly dur: number;
  private readonly rot: number;
  private readonly source: CanvasImageSource;
  private x: number;
  private wy: number;
  private readonly lift: number;
  private readonly scale: number;
  private readonly fps: number;
  private hit = false;
  y: number;

  constructor(private readonly sheet: FxSheet, private readonly o: FxProjectileOptions) {
    const d = Math.hypot(o.to.x - o.from.x, o.to.y - o.from.y);
    this.dur = Math.max(0.12, d / (o.speed ?? 11));
    const ang = Math.atan2(o.to.y - o.from.y, o.to.x - o.from.x);
    this.rot = ang + facingOffset(o.facing ?? defaultFacing(sheet));
    this.source = o.tint ? tintedSheet(sheet, o.tint) : sheet.img;
    this.x = o.from.x;
    this.wy = o.from.y;
    this.lift = o.lift ?? 0.45;
    this.scale = o.scale ?? 3;
    this.fps = o.fps ?? 15;
    this.y = o.from.y + 0.02;
  }

  update(dt: number): boolean {
    this.t += dt;
    const p = Math.min(1, this.t / this.dur);
    this.x = this.o.from.x + (this.o.to.x - this.o.from.x) * p;
    this.wy = this.o.from.y + (this.o.to.y - this.o.from.y) * p;
    this.y = this.wy + 0.02;
    if (p >= 1 && !this.hit) {
      this.hit = true;
      this.o.onHit?.();
      return false;
    }
    return true;
  }

  draw(view: View): void {
    const ctx = view.ctx;
    const f = Math.floor(this.t * this.fps) % this.sheet.frames;
    const w = this.sheet.fw * this.scale;
    const h = this.sheet.fh * this.scale;
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.translate(Math.round(view.toScreenX(this.x)), Math.round(view.toScreenY(this.wy) - this.lift * view.pxPerTile));
    if (this.o.facing !== 'none') ctx.rotate(this.rot);
    ctx.drawImage(this.source, f * this.sheet.fw, 0, this.sheet.fw, this.sheet.fh, -Math.floor(w / 2), -Math.floor(h / 2), w, h);
    ctx.restore();
  }

  drawLight(view: View): void {
    const r = Math.max(this.sheet.fw, this.sheet.fh) * this.scale * 0.7;
    glow(view.lightCtx, view.toScreenX(this.x), view.toScreenY(this.wy) - this.lift * view.pxPerTile, r, this.sheet.color, 0.45);
  }
}

export interface FxBeamOptions {
  from: { x: number; y: number };
  to: { x: number; y: number };
  /** 'beam' tiles the strip along the length, 'stream' stretches one copy to it. */
  mode: 'beam' | 'stream';
  lift?: number;
  scale?: number;
  fps?: number;
  seconds?: number;
  tint?: string;
  facing?: FxFacing;
}

/** The strip laid from attacker to target: tiled (beam) or stretched (stream) along its long axis. */
export class FxBeam implements MoveVisual {
  private t = 0;
  private readonly life: number;
  private readonly ang: number;
  private readonly len: number;
  private readonly facing: FxFacing;
  private readonly source: CanvasImageSource;
  private readonly lift: number;
  private readonly scale: number;
  private readonly fps: number;
  y: number;

  constructor(private readonly sheet: FxSheet, private readonly o: FxBeamOptions) {
    this.life = o.seconds ?? Math.max(0.4, sheet.frames / (o.fps ?? 15));
    this.ang = Math.atan2(o.to.y - o.from.y, o.to.x - o.from.x);
    this.len = Math.hypot(o.to.x - o.from.x, o.to.y - o.from.y);
    this.facing = o.facing ?? (defaultFacing(sheet) === 'none' ? 'right' : defaultFacing(sheet));
    this.source = o.tint ? tintedSheet(sheet, o.tint) : sheet.img;
    this.lift = o.lift ?? 0.45;
    this.scale = o.scale ?? 3;
    this.fps = o.fps ?? 15;
    this.y = Math.max(o.from.y, o.to.y) + 0.02;
  }

  update(dt: number): boolean {
    this.t += dt;
    return this.t < this.life;
  }

  private alpha(): number {
    const k = this.t / this.life;
    return k > 0.7 ? Math.max(0, 1 - (k - 0.7) / 0.3) : 1;
  }

  draw(view: View): void {
    const ctx = view.ctx;
    const f = Math.floor(this.t * this.fps) % this.sheet.frames;
    const fw = this.sheet.fw;
    const fh = this.sheet.fh;
    const lenPx = this.len * view.pxPerTile;
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.globalAlpha = this.alpha();
    ctx.translate(Math.round(view.toScreenX(this.o.from.x)), Math.round(view.toScreenY(this.o.from.y) - this.lift * view.pxPerTile));
    // Rotate so the frame's long axis runs along the attacker -> target line, source end at the attacker.
    ctx.rotate(this.ang + facingOffset(this.facing));
    const along = this.facing === 'up' ? fh * this.scale : fw * this.scale; // frame length along the beam
    const across = this.facing === 'up' ? fw * this.scale : fh * this.scale;
    if (this.o.mode === 'stream') {
      if (this.facing === 'up') ctx.drawImage(this.source, f * fw, 0, fw, fh, -Math.floor(across / 2), -lenPx, across, lenPx);
      else ctx.drawImage(this.source, f * fw, 0, fw, fh, 0, -Math.floor(across / 2), lenPx, across);
    } else {
      // Tile whole frames along the length, clipping the last one at the target.
      ctx.beginPath();
      if (this.facing === 'up') ctx.rect(-across, -lenPx, across * 2, lenPx);
      else ctx.rect(0, -across, lenPx, across * 2);
      ctx.clip();
      for (let d = 0; d < lenPx; d += along) {
        if (this.facing === 'up') ctx.drawImage(this.source, f * fw, 0, fw, fh, -Math.floor(across / 2), -d - along, across, along);
        else ctx.drawImage(this.source, f * fw, 0, fw, fh, d, -Math.floor(across / 2), along, across);
      }
    }
    ctx.restore();
  }

  drawLight(view: View): void {
    const k = this.alpha();
    const r = Math.min(this.sheet.fw, this.sheet.fh) * this.scale * 1.1;
    const n = Math.max(2, Math.ceil(this.len / 1.2));
    for (let i = 0; i <= n; i++) {
      const p = i / n;
      const x = this.o.from.x + (this.o.to.x - this.o.from.x) * p;
      const y = this.o.from.y + (this.o.to.y - this.o.from.y) * p;
      glow(view.lightCtx, view.toScreenX(x), view.toScreenY(y) - this.lift * view.pxPerTile, r, this.sheet.color, 0.25 * k);
    }
  }
}
