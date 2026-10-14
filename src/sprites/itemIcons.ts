/** Item icons and ball sprites from assets/items, loaded once and shared by the HUD and the world. */
import type { Assets } from './assets';

export type BallKind = 'poke' | 'great' | 'ultra';
/** A drawable with pixel dimensions: a loaded image or a composed canvas. */
export type Drawable = HTMLImageElement | HTMLCanvasElement;

export class ItemIcons {
  private icons = new Map<string, HTMLImageElement | null>();
  private pending = new Set<string>();
  private openFrames = new Map<string, HTMLCanvasElement>();

  constructor(private readonly assets: Assets) {}

  /** The 32x32 bag icon for an item id (TMs resolve to their type disc). Null until loaded or when missing. */
  get(itemId: string, tmType?: string): HTMLImageElement | null {
    const key = tmType ? `tm-${tmType}` : itemId;
    if (!this.icons.has(key) && !this.pending.has(key)) {
      this.pending.add(key);
      void this.assets.loadImage(`items/${key}.png`).then((img) => {
        this.icons.set(key, img);
        this.pending.delete(key);
      });
    }
    return this.icons.get(key) ?? null;
  }

  /**
   * The overworld item-ball sprite (assets/items/balls/<kind>_ball.png, 18x18, bottom-centre anchored).
   * The open frame is composed from the closed sprite: the lid swings up and back on its hinge while
   * the inside glows, as the ball README asks; the wobble is a rotation applied by the caller.
   */
  ball(kind: BallKind, open = false): Drawable | null {
    const img = this.get(`balls/${kind}_ball`);
    if (!img || !open) return img;
    let frame = this.openFrames.get(kind);
    if (!frame) {
      frame = composeOpenBall(img);
      this.openFrames.set(kind, frame);
    }
    return frame;
  }

  /** Draws an icon centred at (x, y) at an integer scale, or the labeled placeholder. */
  draw(ctx: CanvasRenderingContext2D, itemId: string, x: number, y: number, scale: number, tmType?: string): void {
    const img = this.get(itemId, tmType);
    ctx.imageSmoothingEnabled = false;
    if (img) {
      const w = img.naturalWidth * scale;
      const h = img.naturalHeight * scale;
      ctx.drawImage(img, Math.round(x - w / 2), Math.round(y - h / 2), w, h);
    } else {
      const ph = this.assets.placeholder(itemId, 32, 32);
      ctx.drawImage(ph, Math.round(x - 16 * scale), Math.round(y - 16 * scale), 32 * scale, 32 * scale);
    }
  }
}

/** Builds the open-ball frame from a closed sprite: lower half in place, lid lifted and tilted back, a glow in the gap. */
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
  // Lower half, pushed down by the lift.
  ctx.drawImage(img, 0, half, w, h - half, 0, lift + half, w, h - half);
  // Lid: hinged at its back edge, tilted up.
  ctx.save();
  ctx.translate(w - 1, lift + half - lift);
  ctx.rotate(-0.55);
  ctx.drawImage(img, 0, 0, w, half, -(w - 1), -half, w, half);
  ctx.restore();
  return c;
}
