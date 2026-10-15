import type { Input } from '../core/input';
import type { View } from '../render/view';
import type { PixelUi } from './pixelUi';

/** The pixel UI kit buttons are drawn with once it has loaded (set at boot). */
let skin: PixelUi | null = null;
export function setUiSkin(ui: PixelUi): void {
  skin = ui;
}

/** One full-canvas screen (title, roll, match, results). */
export interface Screen {
  enter?(): void;
  exit?(): void;
  step(dt: number, input: Input): void;
  render(alpha: number, frameDt: number): void;
}

export interface GameContext {
  view: View;
  input: Input;
  setScreen(s: Screen): void;
}

/** Shared modern-menu drawing helpers (no retro styling). */
export function panel(view: View, x: number, y: number, w: number, h: number, radius = 14, fill = 'rgba(12,12,22,0.72)', ctx: CanvasRenderingContext2D = view.hud): void {
  // The pixel kit's wood panel once it has loaded.
  if (skin?.ready) {
    skin.box(ctx, x, y, w, h, Math.max(2, Math.round(3 * view.baseScale)), 'dt');
    return;
  }
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, radius);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.12)';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();
}

/** UI lettering: BoldPixels by YukiPixels (CC BY-SA 4.0), falling back to the system UI font for missing glyphs. */
export const FONT_FAMILY = '"BoldPixels", "Segoe UI", Inter, system-ui, sans-serif';
/** BoldPixels' capitals are half an em tall (8 of 16 pixels), so sizes are scaled up to read like the old UI font. */
export const FONT_SCALE = 1.3;

/** A canvas font string for `px` canvas pixels of the old UI font. */
export function uiFont(px: number): string {
  return `${Math.max(8, Math.round(px * FONT_SCALE))}px ${FONT_FAMILY}`;
}

export interface TextOpts {
  color?: string;
  align?: CanvasTextAlign;
  weight?: string;
  shadow?: boolean;
  baseline?: CanvasTextBaseline;
  ctx?: CanvasRenderingContext2D;
  /** Shrink the text (down to 8 px) until it is no wider than this many canvas pixels. */
  maxWidth?: number;
}

/** The font size (in `size` units) at which `s` fits `maxWidth` canvas pixels, never above `size`. */
export function fitSize(view: View, s: string, size: number, maxWidth: number, ctx: CanvasRenderingContext2D = view.hud): number {
  ctx.save();
  ctx.font = uiFont(size * view.baseScale);
  const w = ctx.measureText(s).width;
  ctx.restore();
  if (w <= maxWidth || w <= 0) return size;
  return Math.max(8 / (view.baseScale * FONT_SCALE), size * (maxWidth / w) * 0.98);
}

/**
 * Word-wrapped text inside `maxWidth`: up to `maxLines` lines `lineHeight` apart (canvas pixels),
 * the last one shrunk to fit if words are left over. Returns the number of lines drawn.
 */
export function wrapText(view: View, s: string, x: number, y: number, size: number, maxWidth: number, lineHeight: number, maxLines: number, opts: TextOpts = {}): number {
  const ctx = opts.ctx ?? view.hud;
  ctx.save();
  ctx.font = uiFont(size * view.baseScale);
  const words = s.split(' ');
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (cur && ctx.measureText(next).width > maxWidth && lines.length < maxLines - 1) {
      lines.push(cur);
      cur = w;
    } else cur = next;
  }
  if (cur) lines.push(cur);
  ctx.restore();
  lines.forEach((line, i) => text(view, line, x, y + i * lineHeight, size, { ...opts, maxWidth }));
  return lines.length;
}

export function text(view: View, s: string, x: number, y: number, size: number, opts: TextOpts = {}): void {
  const ctx = opts.ctx ?? view.hud;
  if (opts.maxWidth !== undefined) size = fitSize(view, s, size, opts.maxWidth, ctx);
  ctx.save();
  ctx.font = uiFont(size * view.baseScale);
  ctx.textAlign = opts.align ?? 'left';
  ctx.textBaseline = opts.baseline ?? 'alphabetic';
  if (opts.shadow !== false) {
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillText(s, x + 1.5 * view.baseScale, y + 1.5 * view.baseScale);
  }
  ctx.fillStyle = opts.color ?? '#f4f1ff';
  ctx.fillText(s, x, y);
  ctx.restore();
}

/** Accent colours meaning "the main action" (a red ribbon) and "not available" (a faded plate). */
const PRIMARY = '#8a6cff';
const DISABLED = '#44405a';

export function button(view: View, label: string, x: number, y: number, w: number, h: number, hover: boolean, accent = PRIMARY): void {
  const ctx = view.hud;
  // The pixel kit: the main action is a ribbon, other buttons are plates.
  if (skin?.ready) {
    const ribbon = accent === PRIMARY;
    ctx.save();
    if (accent === DISABLED) ctx.globalAlpha = 0.55;
    const lift = hover && accent !== DISABLED ? -2 * view.baseScale : 0;
    skin.strip(ctx, ribbon ? 'ribbon' : 'plate', x, y + lift, w, h, hover && accent !== DISABLED, Math.max(1, Math.round(view.baseScale)));
    ctx.restore();
    text(view, label, x + w / 2, y + h / 2 + 1 + lift, h * 0.36 / view.baseScale, {
      maxWidth: w - 28 * view.baseScale,
      align: 'center', baseline: 'middle', color: ribbon ? '#1a1030' : accent === DISABLED ? '#8a83a6' : '#f4f1ff', shadow: !ribbon,
    });
    return;
  }
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, h / 2);
  const g = ctx.createLinearGradient(x, y, x, y + h);
  g.addColorStop(0, hover ? lighten(accent, 0.25) : accent);
  g.addColorStop(1, hover ? accent : darken(accent, 0.25));
  ctx.fillStyle = g;
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.restore();
  text(view, label, x + w / 2, y + h / 2 + 1, h * 0.42 / view.baseScale, { align: 'center', baseline: 'middle', weight: '700' });
}

export function hit(x: number, y: number, bx: number, by: number, bw: number, bh: number): boolean {
  return x >= bx && x <= bx + bw && y >= by && y <= by + bh;
}

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export function lighten(hex: string, k: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgb(${Math.min(255, r + (255 - r) * k)},${Math.min(255, g + (255 - g) * k)},${Math.min(255, b + (255 - b) * k)})`;
}
export function darken(hex: string, k: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgb(${r * (1 - k)},${g * (1 - k)},${b * (1 - k)})`;
}
export function rgba(hex: string, a: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}
