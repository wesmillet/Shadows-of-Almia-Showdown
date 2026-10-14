/** Item icons and ball sprites from assets/items, loaded once and shared by the HUD and the world. */
import type { BallKind } from '../sim/items';
import type { Assets } from './assets';

/** A drawable with pixel dimensions: a loaded image or a composed canvas. */
export type Drawable = HTMLImageElement | HTMLCanvasElement;

/** Where an item's picture lives under assets/items/. Balls and the crystal shard use the overworld ball set. */
export function iconPath(itemId: string, tmType?: string): string {
  if (tmType) return `tm-${tmType}`;
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
  get(itemId: string, tmType?: string): HTMLImageElement | null {
    const key = iconPath(itemId, tmType);
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
    const img = this.get(itemId, tmType);
    ctx.imageSmoothingEnabled = false;
    if (img) {
      const scale = Math.max(1, Math.floor(fit / Math.max(img.naturalWidth, img.naturalHeight)));
      const w = img.naturalWidth * scale;
      const h = img.naturalHeight * scale;
      ctx.drawImage(img, Math.round(x - w / 2), Math.round(y - h / 2), w, h);
    } else {
      const ph = this.assets.placeholder(itemId, 32, 32);
      ctx.drawImage(ph, Math.round(x - fit / 2), Math.round(y - fit / 2), fit, fit);
    }
  }
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
