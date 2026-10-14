/** Item icons and ball sprites from assets/items, loaded once and shared by the HUD and the world. */
import type { Assets } from './assets';

export class ItemIcons {
  private icons = new Map<string, HTMLImageElement | null>();
  private pending = new Set<string>();

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

  /** Closed or open ball frame for a ball kind. */
  ball(kind: 'poke' | 'great' | 'ultra', open = false): HTMLImageElement | null {
    return this.get(`ball-${kind}-${open ? 'open' : 'closed'}`);
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
