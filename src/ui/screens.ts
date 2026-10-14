import type { Input } from '../core/input';
import type { View } from '../render/view';

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

export function text(view: View, s: string, x: number, y: number, size: number, opts: { color?: string; align?: CanvasTextAlign; weight?: string; shadow?: boolean; baseline?: CanvasTextBaseline; ctx?: CanvasRenderingContext2D } = {}): void {
  const ctx = opts.ctx ?? view.hud;
  ctx.save();
  ctx.font = `${opts.weight ?? '600'} ${Math.round(size * view.baseScale)}px "Segoe UI", Inter, system-ui, sans-serif`;
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

export function button(view: View, label: string, x: number, y: number, w: number, h: number, hover: boolean, accent = '#8a6cff'): void {
  const ctx = view.hud;
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
