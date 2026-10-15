/**
 * UI pieces drawn at the integer pixel scale. Panels, round frames, ribbons,
 * plates, bag slots and tabs are Kenney's "UI Pack - Pixel Adventure" (CC0,
 * assets/ui/kenney): parchment for popups, wood for HUD panels. The segmented
 * HP bars (greenbar/redbar/bluebar_00..06, 15x7) are Sunnyside's; its 3x3
 * 9-slice boxes remain as a fallback while the Kenney art loads.
 */
import type { Assets } from '../sprites/assets';

export type BarColor = 'green' | 'red' | 'blue';
export type BoxStyle = 'lt' | 'dt' | 'w';

/** Kenney tiles by role (assets/ui/kenney/<name>.png). */
const KENNEY = [
  'panel_parchment', 'panel_wood', 'panel_slate_light', 'panel_slate', 'panel_parchment_rivets', 'panel_wood_rivets',
  'circle_parchment', 'circle_wood', 'circle_slate_light', 'circle_slate',
  'ribbon_left', 'ribbon_mid', 'ribbon_right', 'ribbon_hi_left', 'ribbon_hi_mid', 'ribbon_hi_right',
  'plate_left', 'plate_mid', 'plate_right', 'plate_hi_left', 'plate_hi_mid', 'plate_hi_right',
  'slot', 'slot_selected', 'slot_empty', 'tab_on', 'tab_off',
] as const;
type KenneyTile = (typeof KENNEY)[number];
/** Which Kenney panel each box style uses. */
const BOX_TILE: Record<BoxStyle, KenneyTile> = { lt: 'panel_parchment', dt: 'panel_wood', w: 'panel_slate_light' };

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
    for (const k of KENNEY) jobs.push(this.assets.loadImage(`ui/kenney/${k}.png`).then((img) => this.images.set(`k:${k}`, img)));
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

  private k(name: KenneyTile): HTMLImageElement | null {
    return this.images.get(`k:${name}`) ?? null;
  }

  /** True once the Kenney pieces are loaded. */
  get ready(): boolean {
    return !!this.k('panel_wood');
  }

  /**
   * A tile stretched as a 9-slice: `border` source pixels on each side keep their size
   * (times `scale`), the middle stretches. Edges are snapped to whole screen pixels.
   */
  nine(ctx: CanvasRenderingContext2D, img: HTMLImageElement, x: number, y: number, w: number, h: number, scale: number, border: number): void {
    const S = img.naturalWidth;
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

  /**
   * A horizontal 3-piece strip (ribbon or plate) at height h: the end caps keep their shape,
   * the middle tile stretches. Returns false while the art is loading.
   */
  strip(ctx: CanvasRenderingContext2D, kind: 'ribbon' | 'plate', x: number, y: number, w: number, h: number, hover = false): boolean {
    const pre = hover ? `${kind}_hi` : kind;
    const l = this.k(`${pre}_left` as KenneyTile);
    const m = this.k(`${pre}_mid` as KenneyTile);
    const r = this.k(`${pre}_right` as KenneyTile);
    if (!l || !m || !r) return false;
    ctx.imageSmoothingEnabled = false;
    const sc = h / l.naturalHeight;
    const cap = Math.round(Math.min(l.naturalWidth * sc, w / 2));
    const X = Math.round(x);
    const Y = Math.round(y);
    const H = Math.round(h);
    ctx.drawImage(l, X, Y, cap, H);
    ctx.drawImage(m, X + cap, Y, Math.round(w) - 2 * cap, H);
    ctx.drawImage(r, X + Math.round(w) - cap, Y, cap, H);
    return true;
  }

  /** A round frame (wood, or slate when dimmed) of radius r centred on (cx, cy). */
  circle(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, style: 'wood' | 'slate' | 'parchment' = 'wood'): boolean {
    const img = this.k(style === 'wood' ? 'circle_wood' : style === 'slate' ? 'circle_slate' : 'circle_parchment');
    if (!img) return false;
    ctx.imageSmoothingEnabled = false;
    // The art's circle spans 28 of its 32 pixels: size the tile so that circle has radius r.
    const k = (2 * r) / 28;
    const size = Math.round(img.naturalWidth * k);
    ctx.drawImage(img, Math.round(cx - size / 2), Math.round(cy - size / 2), size, size);
    return true;
  }

  /** A square bag slot (parchment in a wood frame; rivets when selected). */
  slot(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, scale: number, selected = false): boolean {
    const img = this.k(selected ? 'slot_selected' : 'slot');
    if (!img) return false;
    this.nine(ctx, img, x, y, size, size, scale, 5);
    return true;
  }

  /** A tab plate: parchment when active, slate otherwise. */
  tab(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, scale: number, active: boolean): boolean {
    const img = this.k(active ? 'tab_on' : 'tab_off');
    if (!img) return false;
    this.nine(ctx, img, x, y, w, h, scale, 5);
    return true;
  }

  /** A 9-slice box; width and height in screen pixels (rounded to the scale). */
  box(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, scale: number, style: BoxStyle = 'lt'): void {
    const panel = this.k(BOX_TILE[style]);
    if (panel) {
      this.nine(ctx, panel, x, y, w, h, Math.max(1, Math.round(scale * 0.75)), 6);
      return;
    }
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
