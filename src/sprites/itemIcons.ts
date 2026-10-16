/** Item icons and ball sprites from assets/items, loaded once and shared by the HUD and the world. */
import type { BallKind } from '../sim/items';
import type { Assets } from './assets';

/** A drawable with pixel dimensions: a loaded image or a composed canvas. */
export type Drawable = HTMLImageElement | HTMLCanvasElement;

/** Where an item's picture lives under assets/items/. Balls and the crystal shard use the overworld ball set. */
export function iconPath(itemId: string, tmType?: string, bag = false): string {
  if (tmType) return `tm-${tmType}`;
  // In the bag a ball shows its bag icon (bag-balls/, PokeAPI); on the ground and in flight, the overworld sprite.
  if (bag && itemId.endsWith('-ball')) return `bag-balls/${itemId}`;
  if (itemId.endsWith('-ball')) return `balls/${itemId.replace(/-ball$/, '')}_ball`;
  if (itemId === 'crystal-shard') return 'balls/vial';
  return itemId;
}

export class ItemIcons {
  private icons = new Map<string, HTMLImageElement | null>();
  private pending = new Set<string>();
  private openFrames = new Map<string, HTMLCanvasElement>();
  constructor(private readonly assets: Assets) {}

  /** The icon for an item id (TMs resolve to their type disc, balls to their sprite). Null until loaded or when missing. */
  get(itemId: string, tmType?: string, bag = false): HTMLImageElement | null {
    const key = iconPath(itemId, tmType, bag);
    if (!this.icons.has(key) && !this.pending.has(key)) {
      this.pending.add(key);
      void this.assets.loadImage(`items/${key}.png`).then((img) => {
        this.icons.set(key, img);
        this.pending.delete(key);
      });
    }
    return this.icons.get(key) ?? null;
  }

  /** Starts loading every icon in a list (bag and ground balls appear without a first-draw blink). */
  preload(ids: Iterable<string>): void {
    for (const id of ids) this.get(id);
  }

  /**
   * The overworld item-ball sprite (assets/items/balls/<kind>_ball.png, 18x18, bottom-centre anchored).
   * The open frame is composed from the closed sprite: the top half lifted straight up with the inside
   * glowing white, as the ball README asks; the white flash and the wobble are added by the caller.
   */
  ball(kind: BallKind, open = false): Drawable | null {
    const img = this.get(`${kind}-ball`);
    if (!img || !open) return img;
    let frame = this.openFrames.get(kind);
    if (!frame) {
      frame = composeOpenBall(img);
      this.openFrames.set(kind, frame);
    }
    return frame;
  }

  /**
   * Draws an icon centred at (x, y), scaled by whole pixels to fit `fit` pixels (18 px balls draw
   * larger than 32 px bag icons), or the labeled placeholder when the asset is missing.
   */
  draw(ctx: CanvasRenderingContext2D, itemId: string, x: number, y: number, fit: number, tmType?: string): void {
    // The bag icon for a ball, falling back to the ground sprite until (or unless) it loads.
    const img = (itemId.endsWith('-ball') && !tmType ? this.get(itemId, tmType, true) : null) ?? this.get(itemId, tmType);
    ctx.imageSmoothingEnabled = false;
    if (img) {
      // Scale the visible art (transparent margins trimmed) by whole pixels to fill `fit`, and centre it
      // on its weight rather than its box (an icon with a handle or cable to one side still sits in the middle).
      const b = opaqueBounds(img);
      const scale = Math.max(1, Math.floor(fit / Math.max(b.w, b.h)));
      const w = b.w * scale;
      const h = b.h * scale;
      const ox = Math.round((b.cx - b.x) * scale);
      const oy = Math.round((b.cy - b.y) * scale);
      ctx.drawImage(img, b.x, b.y, b.w, b.h, Math.round(x - ox), Math.round(y - oy), w, h);
    } else {
      const ph = this.assets.placeholder(itemId, 32, 32);
      ctx.drawImage(ph, Math.round(x - fit / 2), Math.round(y - fit / 2), fit, fit);
    }
  }
}

type Bounds = { x: number; y: number; w: number; h: number; cx: number; cy: number };
const boundsCache = new WeakMap<object, Bounds>();

/**
 * The box round an icon's non-transparent pixels (the whole image until it has loaded), and its
 * centre of weight (alpha-weighted, held to the middle third of the box so odd shapes stay framed).
 */
function opaqueBounds(img: HTMLImageElement | HTMLCanvasElement): Bounds {
  const iw = img instanceof HTMLImageElement ? img.naturalWidth : img.width;
  const ih = img instanceof HTMLImageElement ? img.naturalHeight : img.height;
  const whole = { x: 0, y: 0, w: Math.max(1, iw), h: Math.max(1, ih), cx: iw / 2, cy: ih / 2 };
  if (!iw || !ih) return whole;
  const hit = boundsCache.get(img);
  if (hit) return hit;
  let box = whole;
  try {
    const c = document.createElement('canvas');
    c.width = iw;
    c.height = ih;
    const g = c.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D;
    g.drawImage(img, 0, 0);
    const px = g.getImageData(0, 0, iw, ih).data;
    let x0 = iw, y0 = ih, x1 = -1, y1 = -1;
    let sx = 0, sy = 0, sa = 0;
    for (let y = 0; y < ih; y++) {
      for (let x = 0; x < iw; x++) {
        const a = px[(y * iw + x) * 4 + 3] as number;
        if (a < 16) continue;
        sx += (x + 0.5) * a;
        sy += (y + 0.5) * a;
        sa += a;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
    if (x1 >= x0) {
      const w = x1 - x0 + 1;
      const h = y1 - y0 + 1;
      const clampTo = (v: number, lo: number, len: number) => Math.max(lo + len / 3, Math.min(lo + (2 * len) / 3, v));
      box = { x: x0, y: y0, w, h, cx: clampTo(sx / sa, x0, w), cy: clampTo(sy / sa, y0, h) };
    }
  } catch {
    // Unreadable pixels: keep the whole image.
  }
  boundsCache.set(img, box);
  return box;
}

/** Builds the open-ball frame from a closed sprite: lower half in place, top half offset upward, a white glow in the gap. */
function composeOpenBall(img: HTMLImageElement): HTMLCanvasElement {
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  const half = Math.floor(h / 2);
  const lift = Math.max(3, Math.round(h * 0.3));
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h + lift;
  const ctx = c.getContext('2d') as CanvasRenderingContext2D;
  ctx.imageSmoothingEnabled = false;
  // Glow filling the opened interior.
  ctx.fillStyle = 'rgba(255,255,255,0.95)';
  ctx.beginPath();
  ctx.ellipse(w / 2, lift + half, w / 2 - 2, lift * 0.9, 0, 0, Math.PI * 2);
  ctx.fill();
  // Lower half, pushed down by the lift; top half offset straight up.
  ctx.drawImage(img, 0, half, w, h - half, 0, lift + half, w, h - half);
  ctx.drawImage(img, 0, 0, w, half, 0, 0, w, half);
  return c;
}
