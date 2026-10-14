/**
 * The 16:9 canvas and the camera. World positions are in tiles; the ground
 * scales continuously with the window (`pxPerTile`) while character sprites
 * use an integer multiple of 3x (`spriteScale`) so pixel art stays crisp.
 */
import { clamp, lerp } from '../core/math';

export class View {
  readonly ctx: CanvasRenderingContext2D;
  width = 1280;
  height = 720;
  camX = 0;
  camY = 0;
  zoom = 1;
  targetZoom = 1;
  shakeX = 0;
  shakeY = 0;
  private shakeAmp = 0;
  private shakeTime = 0;

  constructor(readonly canvas: HTMLCanvasElement, readonly tileSize: number) {
    this.ctx = canvas.getContext('2d', { alpha: false })!;
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize(): void {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const ww = window.innerWidth;
    const wh = window.innerHeight;
    let cssW = ww;
    let cssH = (ww * 9) / 16;
    if (cssH > wh) {
      cssH = wh;
      cssW = (wh * 16) / 9;
    }
    this.canvas.style.width = `${Math.floor(cssW)}px`;
    this.canvas.style.height = `${Math.floor(cssH)}px`;
    this.width = Math.max(320, Math.round(cssW * dpr));
    this.height = Math.max(180, Math.round(cssH * dpr));
    this.canvas.width = this.width;
    this.canvas.height = this.height;
  }

  /** 1 at a 720 px tall canvas. */
  get baseScale(): number {
    return this.height / 720;
  }

  get pxPerTile(): number {
    return this.tileSize * this.baseScale * this.zoom;
  }

  get spriteScale(): number {
    return Math.max(1, Math.round(3 * this.baseScale * this.zoom));
  }

  /** Overworld (human) sheets are 1x art drawn at the same integer scale. */
  get rangerScale(): number {
    return this.spriteScale;
  }

  toScreenX(wx: number): number {
    return (wx - this.camX) * this.pxPerTile + this.width / 2 + this.shakeX;
  }

  toScreenY(wy: number): number {
    return (wy - this.camY) * this.pxPerTile + this.height / 2 + this.shakeY;
  }

  toWorld(sx: number, sy: number): { x: number; y: number } {
    return {
      x: (sx - this.width / 2 - this.shakeX) / this.pxPerTile + this.camX,
      y: (sy - this.height / 2 - this.shakeY) / this.pxPerTile + this.camY,
    };
  }

  /** Visible world rectangle in tiles. */
  visibleTiles(): { x0: number; y0: number; x1: number; y1: number } {
    const a = this.toWorld(0, 0);
    const b = this.toWorld(this.width, this.height);
    return { x0: a.x, y0: a.y, x1: b.x, y1: b.y };
  }

  shake(amplitudePx: number, seconds = 0.25): void {
    this.shakeAmp = Math.max(this.shakeAmp, amplitudePx);
    this.shakeTime = Math.max(this.shakeTime, seconds);
  }

  /** Eases the camera toward a target and advances the shake. Called per render frame. */
  follow(tx: number, ty: number, dt: number, cols: number, rows: number): void {
    const k = 1 - Math.exp(-dt * 8);
    this.camX = lerp(this.camX, tx, k);
    this.camY = lerp(this.camY, ty, k);
    this.zoom = lerp(this.zoom, this.targetZoom, 1 - Math.exp(-dt * 4));
    const halfW = this.width / 2 / this.pxPerTile;
    const halfH = this.height / 2 / this.pxPerTile;
    this.camX = clamp(this.camX, Math.min(halfW, cols / 2), Math.max(cols - halfW, cols / 2));
    this.camY = clamp(this.camY, Math.min(halfH, rows / 2), Math.max(rows - halfH, rows / 2));
    if (this.shakeTime > 0) {
      this.shakeTime -= dt;
      const a = this.shakeAmp * clamp(this.shakeTime / 0.25, 0, 1) * this.baseScale;
      this.shakeX = (Math.random() * 2 - 1) * a;
      this.shakeY = (Math.random() * 2 - 1) * a;
      if (this.shakeTime <= 0) {
        this.shakeAmp = 0;
        this.shakeX = this.shakeY = 0;
      }
    }
  }

  snapTo(x: number, y: number): void {
    this.camX = x;
    this.camY = y;
  }
}
