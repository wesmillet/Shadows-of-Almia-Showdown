/**
 * Sunnyside ui/ pieces drawn at the integer pixel scale: the segmented HP
 * bars (greenbar/redbar/bluebar_00..06, 15x7, one frame per fill level)
 * and the 3x3-piece 9-slice boxes (lt = light, dt = dark, w = white).
 */
import type { Assets } from '../sprites/assets';

export type BarColor = 'green' | 'red' | 'blue';
export type BoxStyle = 'lt' | 'dt' | 'w';

const BAR_FRAMES: Record<BarColor, number> = { green: 7, red: 7, blue: 6 };
const SLICE_PARTS = ['tl', 'tc', 'tr', 'lc', 'c', 'rc', 'bl', 'bc', 'br'] as const;

export class PixelUi {
  private images = new Map<string, HTMLImageElement | null>();

  constructor(private readonly assets: Assets) {}

  async load(): Promise<void> {
    const jobs: Promise<unknown>[] = [];
    const want = (name: string) => jobs.push(this.assets.loadImage(`tiles/sunnyside/ui/${name}.png`).then((img) => this.images.set(name, img)));
    for (const color of ['green', 'red', 'blue'] as BarColor[]) for (let i = 0; i < BAR_FRAMES[color]; i++) want(`${color}bar_${String(i).padStart(2, '0')}`);
    for (const style of ['lt', 'dt', 'w'] as BoxStyle[]) for (const part of SLICE_PARTS) want(`${style}_box_9slice_${part}`);
    for (const extra of ['label_left', 'label_middle', 'label_right', 'itemdisc_01', 'indicator']) want(extra);
    await Promise.all(jobs);
  }

  private img(name: string): HTMLImageElement | null {
    return this.images.get(name) ?? null;
  }

  /**
   * A bar frame picked by fraction, drawn with its top-left at (x, y) at
   * integer `scale` and stretched horizontally by repeating the middle
   * column so wide bars keep their caps. Colour switches to red below 25%
   * when `auto` is set.
   */
  bar(ctx: CanvasRenderingContext2D, x: number, y: number, widthPx: number, scale: number, frac: number, color: BarColor = 'green', auto = true): void {
    let c = color;
    if (auto) c = frac > 0.5 ? 'green' : frac > 0.25 ? 'blue' : 'red';
    const frames = BAR_FRAMES[c];
    const f = Math.round(Math.max(0, Math.min(1, frac)) * (frames - 1));
    const img = this.img(`${c}bar_${String(f).padStart(2, '0')}`);
    ctx.imageSmoothingEnabled = false;
    if (!img) {
      ctx.drawImage(this.assets.placeholder('bar', 15, 7), x, y, widthPx, 7 * scale);
      return;
    }
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    const cap = 3;
    const total = Math.max(w * scale, widthPx);
    const midW = total - 2 * cap * scale;
    ctx.drawImage(img, 0, 0, cap, h, x, y, cap * scale, h * scale);
    // Repeat a middle column sampled from the fill boundary so partial frames stretch sensibly.
    const fillCols = w - 2 * cap;
    const fillPx = fillCols * scale;
    let dx = x + cap * scale;
    let remaining = midW;
    while (remaining > 0) {
      const chunk = Math.min(fillPx, remaining);
      ctx.drawImage(img, cap, 0, Math.ceil(chunk / scale), h, dx, y, chunk, h * scale);
      dx += chunk;
      remaining -= chunk;
    }
    ctx.drawImage(img, w - cap, 0, cap, h, x + total - cap * scale, y, cap * scale, h * scale);
  }

  /** A 9-slice box; width and height in screen pixels (rounded to the scale). */
  box(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, scale: number, style: BoxStyle = 'lt'): void {
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
}
