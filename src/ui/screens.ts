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

/**
 * Ink for text on the cream skin (Crusenho's flat UI pack, assets/ui/flat): every panel, button and
 * strip in the game is cream with an orange lip, so text on them is dark brown with warm accents.
 */
export const INK = {
  text: '#4a3424',
  dim: '#8a6a4a',
  accent: '#c2611a',
  good: '#2e7d32',
  bad: '#b0302a',
  storm: '#6a3fc8',
  blue: '#1f5aa0',
  gold: '#a8720a',
  /** White text on the orange (primary) buttons sits on this shadow. */
  onOrangeShadow: '#8a3a0a',
};

/** Whole screen pixels per art pixel for the skin's big pieces (panels, buttons). */
export function skinPx(view: View): number {
  return Math.max(2, Math.round(3 * view.baseScale));
}

/** The same for slim pieces (strips, tabs, chips). */
export function skinPx2(view: View): number {
  return Math.max(2, Math.round(2 * view.baseScale));
}

/** A panel: the skin's cream card (text on it uses INK). `fill` only colours the old fallback. */
export function panel(view: View, x: number, y: number, w: number, h: number, radius = 14, fill = 'rgba(12,12,22,0.72)', ctx: CanvasRenderingContext2D = view.hud): void {
  if (skin?.flat(ctx, 'cream', x, y, w, h, skinPx(view))) return;
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
  /** The drop shadow's colour (default a soft black). */
  shadowColor?: string;
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
    ctx.fillStyle = opts.shadowColor ?? 'rgba(0,0,0,0.55)';
    ctx.fillText(s, x + 1.5 * view.baseScale, y + 1.5 * view.baseScale);
  }
  ctx.fillStyle = opts.color ?? '#f4f1ff';
  ctx.fillText(s, x, y);
  ctx.restore();
}

/** Accent colours meaning "the main action" (a red ribbon) and "not available" (a faded plate). */
const PRIMARY = '#8a6cff';
const DISABLED = '#44405a';

/**
 * A button in the skin. The main action (the default accent) is orange with white lettering; a
 * disabled one is grey; any other is a cream button with dark ink. Hovered, it rises a pixel and
 * brightens.
 */
export function button(view: View, label: string, x: number, y: number, w: number, h: number, hover: boolean, accent = PRIMARY): void {
  const ctx = view.hud;
  const k = skinPx(view);
  const disabled = accent === DISABLED;
  const primary = accent === PRIMARY;
  const lift = hover && !disabled ? -k : 0;
  const piece = disabled ? 'grey' : primary ? 'orange' : 'button';
  // The cream button's art has 4 clear rows on top: it is drawn that much higher, so the button fills
  // its rect (outline at the top, a 4-pixel orange lip at the bottom).
  const top = piece === 'button' ? 4 * k : 0;
  if (skin?.flat(ctx, piece, x, y + lift - top, w, h + top, k)) {
    const faceMid = piece === 'button' ? y + lift + (h - 3 * k) / 2 : y + lift + h / 2 - k / 2;
    if (hover && !disabled) {
      ctx.save();
      ctx.fillStyle = 'rgba(255,255,255,0.18)';
      if (piece === 'button') ctx.fillRect(x + k, y + lift + k, w - 2 * k, h - 5 * k);
      else ctx.fillRect(x + 2 * k, y + lift + 2 * k, w - 4 * k, h - 4 * k);
      ctx.restore();
    }
    text(view, label, x + w / 2, faceMid + 1, h * 0.34 / view.baseScale, {
      maxWidth: w - 24 * view.baseScale,
      align: 'center', baseline: 'middle',
      color: disabled ? '#5c6472' : primary ? '#ffffff' : INK.text,
      shadow: primary, shadowColor: INK.onOrangeShadow,
    });
    return;
  }
  // Pixel kit fallback while the skin loads.
  if (skin?.ready) {
    const ribbon = primary;
    ctx.save();
    if (disabled) ctx.globalAlpha = 0.55;
    skin.strip(ctx, ribbon ? 'ribbon' : 'plate', x, y + lift, w, h, hover && !disabled, Math.max(1, Math.round(view.baseScale)));
    ctx.restore();
    text(view, label, x + w / 2, y + h / 2 + 1 + lift, h * 0.36 / view.baseScale, {
      maxWidth: w - 28 * view.baseScale,
      align: 'center', baseline: 'middle', color: ribbon ? '#1a1030' : disabled ? '#8a83a6' : '#f4f1ff', shadow: !ribbon,
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

/**
 * A one-line cream strip centred on `cx`, its top at `y` (notices, hints, version tags). Returns
 * its width and height.
 */
export function strip(view: View, s: string, cx: number, y: number, size: number, color: string = INK.text, ctx: CanvasRenderingContext2D = view.hud): { w: number; h: number } {
  const k = skinPx2(view);
  const sc = view.baseScale;
  ctx.save();
  ctx.font = uiFont(size * sc);
  const tw = ctx.measureText(s).width;
  ctx.restore();
  const w = Math.round(tw + 12 * k + 10 * sc);
  const h = Math.round(8 * k + size * 1.25 * sc);
  const x = Math.round(cx - w / 2);
  if (!skin?.flat(ctx, 'cream', x, y, w, h, k)) panel(view, x, y, w, h, 10, undefined, ctx);
  text(view, s, x + w / 2, y + 3 * k + (h - 8 * k) / 2 + size * 0.42 * sc, size, { align: 'center', color, shadow: false, ctx });
  return { w, h };
}

/**
 * The menus' backdrop (trainer picker, PC, roll): the storm's deep violet with a faint pixel dither
 * and a darker rim, so the cream cards stand out.
 */
export function backdrop(view: View, ctx: CanvasRenderingContext2D = view.hud): void {
  const w = view.width;
  const h = view.height;
  ctx.fillStyle = '#17112a';
  ctx.fillRect(0, 0, w, h);
  const u = Math.max(2, Math.round(3 * view.baseScale));
  ctx.fillStyle = 'rgba(155,110,255,0.07)';
  for (let y = 0; y < h; y += u * 4) {
    for (let x = ((y / (u * 4)) % 2) * u * 2; x < w; x += u * 4) ctx.fillRect(x, y, u, u);
  }
  const g = ctx.createRadialGradient(w / 2, h * 0.45, Math.min(w, h) * 0.2, w / 2, h * 0.5, Math.max(w, h) * 0.75);
  g.addColorStop(0, 'rgba(8,4,18,0)');
  g.addColorStop(1, 'rgba(8,4,18,0.7)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

/** A screen's title: big cream lettering with a dark drop, and an optional line under it. */
export function heading(view: View, title: string, sub: string | null, y: number): void {
  const s = view.baseScale;
  text(view, title, view.width / 2, y, 30, { align: 'center', color: '#fff3d6', shadowColor: 'rgba(10,4,20,0.9)', maxWidth: view.width - 40 * s });
  if (sub) text(view, sub, view.width / 2, y + 28 * s, 12, { align: 'center', color: '#cdbfe6', maxWidth: view.width - 60 * s, shadowColor: 'rgba(10,4,20,0.9)' });
}

/** A skin piece drawn through the shared skin (false while it loads): for screens without their own PixelUi. */
export function skinPiece(view: View, piece: Parameters<PixelUi['flat']>[1], x: number, y: number, w: number, h: number, k: number, ctx: CanvasRenderingContext2D = view.hud): boolean {
  return !!skin?.flat(ctx, piece, x, y, w, h, k);
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
