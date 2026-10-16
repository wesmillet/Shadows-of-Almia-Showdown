/**
 * UI pieces drawn at the integer pixel scale. Panels, popups, buttons, slots
 * and tabs are Kenney's "Fantasy UI Borders" (CC0, assets/ui/fantasy): thin
 * white frames tinted in code over dark, translucent fills. Move buttons are
 * drawn rings in the same style, and HP bars are drawn in code so they follow
 * the exact fraction. Sunnyside's 3x3 9-slice boxes remain as a fallback while
 * the frames load.
 */
import type { Assets } from '../sprites/assets';

export type BarColor = 'green' | 'red' | 'blue';
export type BoxStyle = 'lt' | 'dt' | 'w';

/** The frames (assets/ui/fantasy/<name>.png), 48x48 with 2 px lines. */
const FRAMES = ['border_000', 'border_002', 'border_009', 'border_011', 'border_024', 'panel_000'] as const;
type Frame = (typeof FRAMES)[number];
/** Source pixels each frame keeps unstretched at its corners, and where its line sits (for the fill). */
const FRAME_INFO: Record<Frame, { border: number; inset: number }> = {
  border_000: { border: 12, inset: 4 },
  border_002: { border: 12, inset: 1 },
  border_009: { border: 12, inset: 2 },
  border_011: { border: 12, inset: 1 },
  border_024: { border: 16, inset: 8 },
  panel_000: { border: 12, inset: 4 },
};

/** Colours of the skin: lavender lines over deep violet glass. */
export const SKIN = {
  line: '#cdbfff',
  lineBright: '#ffffff',
  lineDim: '#7d6fb0',
  gold: '#ffd36b',
  fill: 'rgba(14,10,28,0.86)',
  fillPopup: 'rgba(22,16,42,0.95)',
  fillSlot: 'rgba(8,6,18,0.72)',
  text: '#f4f1ff',
  textDim: '#b9b4cc',
  textOnLight: '#1a1030',
};

/** HP fill colours: 'blue' is the middle band (amber), kept under its old name. */
const BAR_HUES: Record<BarColor, { light: string; mid: string; dark: string }> = {
  green: { light: '#a8f0a0', mid: '#4cc85c', dark: '#2a8a44' },
  blue: { light: '#ffe08a', mid: '#f0b030', dark: '#b07418' },
  red: { light: '#ff9a9a', mid: '#e84848', dark: '#a02434' },
};
const SLICE_PARTS = ['tl', 'tc', 'tr', 'lc', 'c', 'rc', 'bl', 'bc', 'br'] as const;

/**
 * The HUD's skin: Crusenho's Complete UI Essential Pack, flat theme (CC BY 4.0, assets/ui/flat).
 * Each piece is nine-sliced at a whole-pixel scale; `slice` is [top, right, bottom, left] in art pixels.
 */
export const FLAT = {
  cream: { file: 'InputField01a', slice: [3, 3, 5, 3] },
  banner: { file: 'Banner01a', slice: [5, 9, 5, 9] },
  tab: { file: 'Banner03a', slice: [2, 2, 4, 4] },
  button: { file: 'Button01a_1', slice: [6, 3, 5, 3] },
  buttonDown: { file: 'Button01a_3', slice: [6, 3, 5, 3] },
  slotOrange: { file: 'FrameSlot03a', slice: [4, 4, 4, 4] },
  slotGrey: { file: 'FrameSlot01a', slice: [4, 4, 4, 4] },
  slotGhost: { file: 'FrameSlot02c', slice: [4, 4, 4, 4] },
  barGold: { file: 'Bar11a', slice: [4, 3, 4, 3] },
  select: { file: 'Select01a_1', slice: [10, 10, 10, 10] },
} as const;
export type FlatPiece = keyof typeof FLAT;
/** The pack's bar fills (3 px tall strips): green, red, gold. */
export const FLAT_FILLS = { green: 'BarFill01a', red: 'BarFill01c', gold: 'BarFill01e' } as const;
/** Ink on the cream pieces. */
export const FLAT_INK = { text: '#4a3424', dim: '#8a6a4a', accent: '#c2611a', storm: '#6a3fc8' };

export class PixelUi {
  private images = new Map<string, HTMLImageElement | null>();

  constructor(private readonly assets: Assets) {}

  async load(): Promise<void> {
    const jobs: Promise<unknown>[] = [];
    const want = (name: string) => jobs.push(this.assets.loadImage(`tiles/sunnyside/ui/${name}.png`).then((img) => this.images.set(name, img)));
    for (const style of ['lt', 'dt', 'w'] as BoxStyle[]) for (const part of SLICE_PARTS) want(`${style}_box_9slice_${part}`);
    for (const extra of ['label_left', 'label_middle', 'label_right', 'itemdisc_01', 'indicator']) want(extra);
    for (const f of FRAMES) jobs.push(this.assets.loadImage(`ui/fantasy/${f}.png`).then((img) => this.images.set(`f:${f}`, img)));
    const flat = new Set<string>([...Object.values(FLAT).map((p) => p.file), ...Object.values(FLAT_FILLS)]);
    for (const f of flat) jobs.push(this.assets.loadImage(`ui/flat/${f}.png`).then((img) => this.images.set(`flat:${f}`, img)));
    await Promise.all(jobs);
  }

  private img(name: string): HTMLImageElement | null {
    return this.images.get(name) ?? null;
  }

  /**
   * A slim HP bar drawn in code, its bottom edge where a 7-pixel bar at `scale` would end
   * (so callers lay out as before): a dark rim, a dark track, and a fill with a light top
   * row that follows the exact fraction at any width. Green over half, amber over a fifth,
   * red below (when `auto`); `color` picks the hue otherwise.
   */
  bar(ctx: CanvasRenderingContext2D, x: number, y: number, widthPx: number, scale: number, frac: number, color: BarColor = 'green', auto = true): void {
    const f = Math.max(0, Math.min(1, frac));
    let c = color;
    if (auto) c = f > 0.5 ? 'green' : f > 0.2 ? 'blue' : 'red';
    const hue = BAR_HUES[c];
    const u = Math.max(1, Math.round(scale / 2));
    const H = 4 * u;
    const X = Math.round(x);
    const Y = Math.round(y + 7 * scale - H);
    const W = Math.max(4 * u, Math.round(widthPx));
    ctx.save();
    ctx.fillStyle = 'rgba(10,6,22,0.9)';
    ctx.fillRect(X, Y, W, H);
    ctx.fillStyle = '#3a3150';
    ctx.fillRect(X + u, Y + u, W - 2 * u, H - 2 * u);
    const inner = W - 2 * u;
    let fw = Math.round(inner * f);
    if (f > 0 && fw < u) fw = u;
    if (fw > 0) {
      ctx.fillStyle = hue.mid;
      ctx.fillRect(X + u, Y + u, fw, H - 2 * u);
      ctx.fillStyle = hue.light;
      ctx.fillRect(X + u, Y + u, fw, u);
    }
    ctx.restore();
  }

  private tinted = new Map<string, HTMLCanvasElement>();

  /** A frame recoloured (its white lines become `color`), cached per colour. */
  private frame(name: Frame, color: string): HTMLCanvasElement | null {
    const key = `${name}|${color}`;
    const hit = this.tinted.get(key);
    if (hit) return hit;
    const img = this.images.get(`f:${name}`);
    if (!img) return null;
    const c = document.createElement('canvas');
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    const g = c.getContext('2d') as CanvasRenderingContext2D;
    g.drawImage(img, 0, 0);
    g.globalCompositeOperation = 'source-in';
    g.fillStyle = color;
    g.fillRect(0, 0, c.width, c.height);
    this.tinted.set(key, c);
    return c;
  }

  /** True once the frames are loaded. */
  get ready(): boolean {
    return !!this.images.get('f:border_011');
  }

  /**
   * A tile stretched as a 9-slice: `border` source pixels on each side keep their size
   * (times `scale`), the middle stretches. Edges are snapped to whole screen pixels.
   */
  nine(ctx: CanvasRenderingContext2D, img: HTMLImageElement | HTMLCanvasElement, x: number, y: number, w: number, h: number, scale: number, border: number): void {
    const S = img.width;
    const b = border;
    const B = Math.min(b * scale, w / 2, h / 2);
    const X = [x, x + B, x + w - B, x + w].map(Math.round);
    const Y = [y, y + B, y + h - B, y + h].map(Math.round);
    const sx = [0, b, S - b, S];
    ctx.imageSmoothingEnabled = false;
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        const dw = (X[c + 1] as number) - (X[c] as number);
        const dh = (Y[r + 1] as number) - (Y[r] as number);
        if (dw <= 0 || dh <= 0) continue;
        ctx.drawImage(img, sx[c] as number, sx[r] as number, (sx[c + 1] as number) - (sx[c] as number), (sx[r + 1] as number) - (sx[r] as number), X[c] as number, Y[r] as number, dw, dh);
      }
    }
  }

  /** A filled, framed rectangle: the fill sits inside the frame's line, the tinted frame on top. */
  framed(ctx: CanvasRenderingContext2D, name: Frame, x: number, y: number, w: number, h: number, scale: number, line: string, fill: string | null): boolean {
    const img = this.frame(name, line);
    if (!img) return false;
    const info = FRAME_INFO[name];
    const X = Math.round(x);
    const Y = Math.round(y);
    const W = Math.round(w);
    const H = Math.round(h);
    if (fill) {
      const i = info.inset * scale;
      ctx.fillStyle = fill;
      ctx.fillRect(X + i, Y + i, W - 2 * i, H - 2 * i);
    }
    this.nine(ctx, img, X, Y, W, H, scale, info.border);
    return true;
  }

  /**
   * A button face: 'ribbon' is the main action (a light filled panel), 'plate' any other
   * (a framed dark panel). Returns false while the art is loading.
   */
  strip(ctx: CanvasRenderingContext2D, kind: 'ribbon' | 'plate', x: number, y: number, w: number, h: number, hover = false, scale = 1): boolean {
    if (kind === 'ribbon') return this.framed(ctx, 'panel_000', x, y, w, h, scale, hover ? SKIN.lineBright : '#e9ddff', null);
    return this.framed(ctx, 'border_000', x, y, w, h, scale, hover ? SKIN.lineBright : SKIN.line, hover ? 'rgba(60,40,110,0.9)' : SKIN.fill);
  }

  /** A round move button frame of radius r: a dark disc ringed in lavender with four square studs. */
  circle(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, style: 'wood' | 'slate' | 'parchment' = 'wood'): boolean {
    if (!this.ready) return false;
    const color = style === 'parchment' ? SKIN.lineBright : style === 'slate' ? SKIN.lineDim : SKIN.line;
    const px = Math.max(2, Math.round(r / 14));
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = style === 'slate' ? 'rgba(8,6,18,0.6)' : SKIN.fill;
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = px;
    ctx.beginPath();
    ctx.arc(cx, cy, r - px / 2, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = color;
    for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]] as const) {
      const sx = Math.round(cx + dx * (r - px / 2) - px * 1.5);
      const sy = Math.round(cy + dy * (r - px / 2) - px * 1.5);
      ctx.fillRect(sx, sy, px * 3, px * 3);
    }
    ctx.restore();
    return true;
  }

  /** A square bag slot: dark glass in a thin frame; the armed slot gets a gold ornate frame. */
  slot(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, scale: number, selected = false): boolean {
    return selected
      ? this.framed(ctx, 'border_024', x, y, size, size, scale, SKIN.gold, 'rgba(60,44,10,0.55)')
      : this.framed(ctx, 'border_009', x, y, size, size, scale, SKIN.lineDim, SKIN.fillSlot);
  }

  /** A tab: a filled light tab when active, a framed dark one otherwise. */
  tab(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, scale: number, active: boolean): boolean {
    return active
      ? this.framed(ctx, 'panel_000', x, y, w, h, scale, '#e9ddff', null)
      : this.framed(ctx, 'border_009', x, y, w, h, scale, SKIN.lineDim, SKIN.fill);
  }

  /** A 9-slice box; width and height in screen pixels (rounded to the scale). */
  box(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, scale: number, style: BoxStyle = 'lt'): void {
    // Frames keep thin lines: one source pixel per screen pixel at 720p, two at 1440p.
    const k = Math.max(1, Math.round(scale / 3));
    if (style === 'lt' ? this.framed(ctx, 'border_002', x, y, w, h, k, '#e9ddff', SKIN.fillPopup)
      : style === 'w' ? this.framed(ctx, 'border_000', x, y, w, h, k, SKIN.line, SKIN.fill)
      : this.framed(ctx, 'border_011', x, y, w, h, k, SKIN.line, SKIN.fill)) return;
    const parts = SLICE_PARTS.map((p) => this.img(`${style}_box_9slice_${p}`));
    ctx.imageSmoothingEnabled = false;
    const s = 3 * scale; // every piece is 3x3 source pixels
    if (parts.some((p) => !p)) {
      ctx.drawImage(this.assets.placeholder(`${style} box`, 9, 9), x, y, w, h);
      return;
    }
    const [tl, tc, tr, lc, c, rc, bl, bc, br] = parts as HTMLImageElement[];
    const iw = Math.max(0, w - 2 * s);
    const ih = Math.max(0, h - 2 * s);
    ctx.drawImage(tl!, x, y, s, s);
    ctx.drawImage(tc!, x + s, y, iw, s);
    ctx.drawImage(tr!, x + s + iw, y, s, s);
    ctx.drawImage(lc!, x, y + s, s, ih);
    ctx.drawImage(c!, x + s, y + s, iw, ih);
    ctx.drawImage(rc!, x + s + iw, y + s, s, ih);
    ctx.drawImage(bl!, x, y + s + ih, s, s);
    ctx.drawImage(bc!, x + s, y + s + ih, iw, s);
    ctx.drawImage(br!, x + s + iw, y + s + ih, s, s);
  }

  /** The small name label strip (label_left/middle/right). */
  label(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, scale: number): void {
    const l = this.img('label_left');
    const m = this.img('label_middle');
    const r = this.img('label_right');
    if (!l || !m || !r) return;
    ctx.imageSmoothingEnabled = false;
    const lw = l.naturalWidth * scale;
    const h = l.naturalHeight * scale;
    ctx.drawImage(l, x, y, lw, h);
    ctx.drawImage(m, x + lw, y, Math.max(0, w - 2 * lw), h);
    ctx.drawImage(r, x + w - lw, y, lw, h);
  }

  /**
   * A piece of the flat skin nine-sliced over (x, y, w, h) at `k` screen pixels per art pixel:
   * corners kept, edges and middle stretched. False while its image is loading.
   */
  flat(ctx: CanvasRenderingContext2D, piece: FlatPiece, x: number, y: number, w: number, h: number, k: number): boolean {
    const def = FLAT[piece];
    const img = this.img(`flat:${def.file}`);
    if (!img || !img.naturalWidth) return false;
    const [t, r, b, l] = def.slice;
    const iw = img.naturalWidth;
    const ih = img.naturalHeight;
    const X = Math.round(x);
    const Y = Math.round(y);
    const W = Math.max(Math.round(w), (l + r) * k);
    const H = Math.max(Math.round(h), (t + b) * k);
    const sx = [0, l, iw - r, iw];
    const sy = [0, t, ih - b, ih];
    const dx = [X, X + l * k, X + W - r * k, X + W];
    const dy = [Y, Y + t * k, Y + H - b * k, Y + H];
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    for (let j = 0; j < 3; j++) {
      for (let i = 0; i < 3; i++) {
        const sw = (sx[i + 1] as number) - (sx[i] as number);
        const sh = (sy[j + 1] as number) - (sy[j] as number);
        const ddw = (dx[i + 1] as number) - (dx[i] as number);
        const ddh = (dy[j + 1] as number) - (dy[j] as number);
        if (sw <= 0 || sh <= 0 || ddw <= 0 || ddh <= 0) continue;
        ctx.drawImage(img, sx[i] as number, sy[j] as number, sw, sh, dx[i] as number, dy[j] as number, ddw, ddh);
      }
    }
    ctx.restore();
    return true;
  }

  /**
   * The pack's gold-rimmed bar (Bar11a) over (x, y) `w` wide at scale `k` (10 art pixels tall):
   * a dark well filled to `frac` with `fill` (a pack fill name or a CSS colour).
   */
  flatBar(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, k: number, frac: number, fill: keyof typeof FLAT_FILLS | string, well = '#3a1a06'): boolean {
    const h = 10 * k;
    const X = Math.round(x);
    const Y = Math.round(y);
    const W = Math.round(w);
    const inner = { x: X + 3 * k, y: Y + 4 * k, w: W - 6 * k, h: 2 * k };
    ctx.fillStyle = well;
    ctx.fillRect(inner.x, inner.y, inner.w, inner.h);
    const fw = Math.round(inner.w * Math.max(0, Math.min(1, frac)));
    if (fw > 0) {
      const img = fill in FLAT_FILLS ? this.img(`flat:${FLAT_FILLS[fill as keyof typeof FLAT_FILLS]}`) : null;
      if (img && img.naturalWidth) {
        ctx.save();
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(img, 0, 0, img.naturalWidth, img.naturalHeight, inner.x, inner.y, fw, inner.h);
        ctx.restore();
      } else {
        ctx.fillStyle = fill in FLAT_FILLS ? ({ green: '#13e01f', red: '#e81c1c', gold: '#e9b04a' } as Record<string, string>)[fill] as string : fill;
        ctx.fillRect(inner.x, inner.y, fw, inner.h);
      }
    }
    return this.flat(ctx, 'barGold', X, Y, W, h, k);
  }
}
