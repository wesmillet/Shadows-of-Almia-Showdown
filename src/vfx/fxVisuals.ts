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

export type FxFacing = 'right' | 'up' | 'down' | 'none';

/**
 * Which way a frame's artwork points, guessed from its shape: clearly tall frames point
 * up, clearly wide ones right. `ratio` is how elongated a frame must be to count.
 */
export function defaultFacing(sheet: FxSheet, ratio = 1.1): FxFacing {
  if (sheet.fh > sheet.fw * ratio) return 'up';
  if (sheet.fw > sheet.fh * ratio) return 'right';
  return 'none';
}

/** Rotation that turns the artwork's pointing direction onto the +x axis. */
function facingOffset(f: FxFacing): number {
  if (f === 'up') return Math.PI / 2;
  if (f === 'down') return -Math.PI / 2;
  return 0;
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
    const w = this.sheet.fw * (this.scale * view.zoom);
    const h = this.sheet.fh * (this.scale * view.zoom);
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
    const r = Math.max(this.sheet.fw, this.sheet.fh) * (this.scale * view.zoom) * 0.6;
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
  /** Height of a lobbed arc, in tiles. */
  arc?: number;
  /** Height at the start, in tiles (a fall from the sky); `lift` is the height at the end. */
  fromLift?: number;
  onHit?: () => void;
}

/** A looping frame that flies from attacker to target, rotated to face its travel direction. */
export class FxProjectile implements MoveVisual {
  private t = 0;
  private readonly dur: number;
  private readonly rot: number;
  private readonly spin: boolean;
  private readonly source: CanvasImageSource;
  private x: number;
  private wy: number;
  private lift: number;
  private readonly scale: number;
  private readonly fps: number;
  private hit = false;
  y: number;

  constructor(private readonly sheet: FxSheet, private readonly o: FxProjectileOptions) {
    const fall = o.fromLift !== undefined ? Math.abs(o.fromLift - (o.lift ?? 0.45)) : 0;
    const d = Math.max(Math.hypot(o.to.x - o.from.x, o.to.y - o.from.y), fall);
    this.dur = Math.max(0.12, d / (o.speed ?? 11));
    // A fall points straight down; otherwise along the ground path.
    const ang = o.fromLift !== undefined && fall > 0.5 ? Math.PI / 2 : Math.atan2(o.to.y - o.from.y, o.to.x - o.from.x);
    // Only clearly elongated art (a streak, a dart) turns to its flight path; balls,
    // rocks, bubbles and upright flames fly as drawn.
    const facing = o.facing ?? defaultFacing(sheet, 1.6);
    this.spin = facing !== 'none';
    this.rot = ang + facingOffset(facing);
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
    const end = this.o.lift ?? 0.45;
    const start = this.o.fromLift ?? end;
    // Falls accelerate; lobs follow a parabola.
    const pp = this.o.fromLift !== undefined ? p * p : p;
    this.lift = start + (end - start) * pp + (this.o.arc ?? 0) * 4 * p * (1 - p);
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
    const w = this.sheet.fw * (this.scale * view.zoom);
    const h = this.sheet.fh * (this.scale * view.zoom);
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.translate(Math.round(view.toScreenX(this.x)), Math.round(view.toScreenY(this.wy) - this.lift * view.pxPerTile));
    if (this.spin) ctx.rotate(this.rot);
    ctx.drawImage(this.source, f * this.sheet.fw, 0, this.sheet.fw, this.sheet.fh, -Math.floor(w / 2), -Math.floor(h / 2), w, h);
    ctx.restore();
  }

  drawLight(view: View): void {
    const r = Math.max(this.sheet.fw, this.sheet.fh) * (this.scale * view.zoom) * 0.7;
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
  private life: number;
  private ang: number;
  private len: number;
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

  /** True while it is still showing (a channelled beam reuses it rather than stacking another). */
  get alive(): boolean {
    return this.t < this.life;
  }

  /**
   * A channelled beam's next pulse: the same beam swings to the new line and keeps going for
   * `seconds` more, so one beam follows the sweep instead of a new one stacking on every pulse.
   */
  refresh(from: { x: number; y: number }, to: { x: number; y: number }, seconds: number): void {
    this.o.from = from;
    this.o.to = to;
    this.ang = Math.atan2(to.y - from.y, to.x - from.x);
    this.len = Math.hypot(to.x - from.x, to.y - from.y);
    this.y = Math.max(from.y, to.y) + 0.02;
    // Hold it at full strength: the fade starts at 70% of its life.
    this.life = Math.max(this.life, this.t + seconds);
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
    const tall = this.facing === 'up' || this.facing === 'down';
    const along = tall ? fh * (this.scale * view.zoom) : fw * (this.scale * view.zoom); // frame length along the beam
    const across = tall ? fw * (this.scale * view.zoom) : fh * (this.scale * view.zoom);
    const half = -Math.floor(across / 2);
    if (this.o.mode === 'stream') {
      if (this.facing === 'up') ctx.drawImage(this.source, f * fw, 0, fw, fh, half, -lenPx, across, lenPx);
      else if (this.facing === 'down') ctx.drawImage(this.source, f * fw, 0, fw, fh, half, 0, across, lenPx);
      else ctx.drawImage(this.source, f * fw, 0, fw, fh, 0, half, lenPx, across);
    } else {
      // Tile whole frames along the length, clipping the last one at the target.
      ctx.beginPath();
      if (this.facing === 'up') ctx.rect(-across, -lenPx, across * 2, lenPx);
      else if (this.facing === 'down') ctx.rect(-across, 0, across * 2, lenPx);
      else ctx.rect(0, -across, lenPx, across * 2);
      ctx.clip();
      for (let d = 0; d < lenPx; d += along) {
        if (this.facing === 'up') ctx.drawImage(this.source, f * fw, 0, fw, fh, half, -d - along, across, along);
        else if (this.facing === 'down') ctx.drawImage(this.source, f * fw, 0, fw, fh, half, d, across, along);
        else ctx.drawImage(this.source, f * fw, 0, fw, fh, d, half, along, across);
      }
    }
    ctx.restore();
  }

  drawLight(view: View): void {
    const k = this.alpha();
    const r = Math.min(this.sheet.fw, this.sheet.fh) * (this.scale * view.zoom) * 1.1;
    const n = Math.max(2, Math.ceil(this.len / 1.2));
    for (let i = 0; i <= n; i++) {
      const p = i / n;
      const x = this.o.from.x + (this.o.to.x - this.o.from.x) * p;
      const y = this.o.from.y + (this.o.to.y - this.o.from.y) * p;
      glow(view.lightCtx, view.toScreenX(x), view.toScreenY(y) - this.lift * view.pxPerTile, r, this.sheet.color, 0.25 * k);
    }
  }
}

/** Holds a visual back for `delay` seconds, then plays it. */
export class Delayed implements MoveVisual {
  private t = 0;
  constructor(private readonly delay: number, private readonly inner: MoveVisual) {}

  get y(): number {
    return this.inner.y;
  }

  update(dt: number): boolean {
    this.t += dt;
    if (this.t < this.delay) return true;
    return this.inner.update(dt);
  }

  draw(view: View): void {
    if (this.t >= this.delay) this.inner.draw(view);
  }

  drawLight(view: View): void {
    if (this.t >= this.delay) this.inner.drawLight(view);
  }
}
