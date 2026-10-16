/**
 * The canvas (filling the whole window, any shape) and the camera. World positions are in tiles; the ground
 * scales continuously with the window (`pxPerTile`) while character sprites
 * use an integer multiple of 3x (`spriteScale`) so pixel art stays crisp.
 */
import { clamp, lerp } from '../core/math';

export class View {
  /** Offscreen world canvas (2D). Everything in the world is drawn here. */
  readonly sceneCanvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  /** Offscreen additive light canvas, composed by the lighting pass. */
  readonly lightCanvas: HTMLCanvasElement;
  readonly lightCtx: CanvasRenderingContext2D;
  /** Visible canvas the lighting pass renders into (WebGL). */
  readonly outputCanvas: HTMLCanvasElement;
  /** Visible transparent canvas above it for the HUD, menus and floating text. */
  readonly hudCanvas: HTMLCanvasElement;
  readonly hud: CanvasRenderingContext2D;
  width = 1280;
  height = 720;
  camX = 0;
  camY = 0;
  zoom = 1;
  targetZoom = 1;

  constructor(stage: HTMLElement, readonly tileSize: number) {
    this.sceneCanvas = document.createElement('canvas');
    this.ctx = this.sceneCanvas.getContext('2d', { alpha: false })!;
    this.lightCanvas = document.createElement('canvas');
    this.lightCtx = this.lightCanvas.getContext('2d')!;
    this.outputCanvas = document.createElement('canvas');
    this.hudCanvas = document.createElement('canvas');
    this.hud = this.hudCanvas.getContext('2d')!;
    for (const c of [this.outputCanvas, this.hudCanvas]) {
      c.style.position = 'absolute';
      c.style.left = '50%';
      c.style.top = '50%';
      c.style.transform = 'translate(-50%, -50%)';
      stage.appendChild(c);
    }
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize(): void {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const ww = window.innerWidth;
    const wh = window.innerHeight;
    // The canvas fills the window whatever its shape; the world just shows more or less of the island.
    const cssW = ww;
    const cssH = wh;
    this.width = Math.max(320, Math.round(cssW * dpr));
    this.height = Math.max(180, Math.round(cssH * dpr));
    for (const c of [this.sceneCanvas, this.lightCanvas, this.outputCanvas, this.hudCanvas]) {
      c.width = this.width;
      c.height = this.height;
      c.style.width = `${Math.floor(cssW)}px`;
      c.style.height = `${Math.floor(cssH)}px`;
    }
  }

  /** Clears the light canvas for a new frame. */
  beginLights(): void {
    this.lightCtx.globalCompositeOperation = 'source-over';
    this.lightCtx.fillStyle = '#000';
    this.lightCtx.fillRect(0, 0, this.width, this.height);
    this.lightCtx.globalCompositeOperation = 'lighter';
  }

  /** HUD text scale: 1 at 1280x720, following the shorter way round so the HUD always fits. */
  get baseScale(): number {
    return Math.min(this.height / 720, this.width / 1280);
  }

  /** Everything in the world draws at one integer scale: 16 px tiles at 3x = 48 px, sprites at 3x. */
  static readonly PIXEL_SCALE = 3;

  /** Screen pixels per art pixel: the integer pixel scale times the camera zoom (1 normally, closer in battles). */
  get pxPerTile(): number {
    return this.tileSize * View.PIXEL_SCALE * this.zoom;
  }

  get spriteScale(): number {
    return View.PIXEL_SCALE * this.zoom;
  }

  /** Overworld (human) sheets are 1x art drawn at the same integer scale. */
  get rangerScale(): number {
    return this.spriteScale;
  }

  toScreenX(wx: number): number {
    return (wx - this.camX) * this.pxPerTile + Math.floor(this.width / 2);
  }

  toScreenY(wy: number): number {
    return (wy - this.camY) * this.pxPerTile + Math.floor(this.height / 2);
  }

  toWorld(sx: number, sy: number): { x: number; y: number } {
    return {
      x: (sx - this.width / 2) / this.pxPerTile + this.camX,
      y: (sy - this.height / 2) / this.pxPerTile + this.camY,
    };
  }

  /** Visible world rectangle in tiles. */
  visibleTiles(): { x0: number; y0: number; x1: number; y1: number } {
    const a = this.toWorld(0, 0);
    const b = this.toWorld(this.width, this.height);
    return { x0: a.x, y0: a.y, x1: b.x, y1: b.y };
  }

  /** Eases the camera toward a target. Called per render frame. */
  follow(tx: number, ty: number, dt: number, cols: number, rows: number): void {
    const k = 1 - Math.exp(-dt * 8);
    this.camX = lerp(this.camX, tx, k);
    this.camY = lerp(this.camY, ty, k);
    const halfW = this.width / 2 / this.pxPerTile;
    const halfH = this.height / 2 / this.pxPerTile;
    this.camX = clamp(this.camX, Math.min(halfW, cols / 2), Math.max(cols - halfW, cols / 2));
    this.camY = clamp(this.camY, Math.min(halfH, rows / 2), Math.max(rows - halfH, rows / 2));
  }

  snapTo(x: number, y: number): void {
    this.camX = x;
    this.camY = y;
  }
}
