/**
 * The Alpha mark (assets/ui/alpha.png, 57x64), drawn wherever an Alpha is shown: the match's name
 * bars, the PC (box icons and the side panel), the party cards and the starter reels.
 */
import { ASSET_ROOT } from '../sprites/assets';

let img: HTMLImageElement | null = null;
let asked = false;

/** The mark once loaded (null until then; screens redraw every frame, so it appears on its own). */
export function alphaBadge(): HTMLImageElement | null {
  if (!asked && typeof Image !== 'undefined') {
    asked = true;
    const i = new Image();
    i.onload = () => (img = i);
    i.src = ASSET_ROOT + 'ui/alpha.png';
  }
  return img;
}

/** Draws the mark `h` pixels tall with its top-left at (x, y); returns its width (0 if not loaded yet). */
export function drawAlphaBadge(ctx: CanvasRenderingContext2D, x: number, y: number, h: number): number {
  const b = alphaBadge();
  if (!b) return 0;
  const w = (h * b.width) / b.height;
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(b, Math.round(x), Math.round(y), Math.round(w), Math.round(h));
  ctx.restore();
  return w;
}
