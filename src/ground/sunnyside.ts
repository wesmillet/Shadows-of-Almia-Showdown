/**
 * Sunnyside World tileset data (assets/tiles/sunnyside/sunnyside.json): the
 * 16 px sheet, the 32 px forest canopy sheet, GameMaker 16-tile autotile
 * sets, tile animations and the pack's demo room.
 *
 * Tile index = row * columns + column in its sheet; 0 = empty.
 *
 * GameMaker's 16-tile autotile is looked up by the 4-bit mask of the cardinal
 * neighbours (left = 1, top = 2, right = 4, bottom = 8). The set lists its 16
 * tiles in GameMaker's template order; the slots that matter are the fill
 * (all four neighbours), the four edges and the four outer corners. The
 * other slots hold the pack's variant or diagonal tiles, so masks without a
 * dedicated shape (end caps, corridors, isolated) draw the fill tile.
 */
import type { Assets } from '../sprites/assets';

export interface AutotileSet {
  closed_edge: boolean;
  tiles: number[];
}

export interface TilesetDef {
  image: string;
  tile_w: number;
  tile_h: number;
  columns: number;
  autotiles: Record<string, AutotileSet>;
  animations: Array<{ name: string; frames: number[] }>;
  frame_duration_s: number;
}

export interface DemoLayer {
  name: string;
  tileset?: string;
  w?: number;
  h?: number;
  tiles?: number[][];
  flags?: number[][];
  sprites?: Array<{ sprite: string; x: number; y: number }>;
}

export interface SunnysideData {
  tilesets: Record<string, TilesetDef>;
  autotile_order: string;
  demo_room: { width_px: number; height_px: number; layers: DemoLayer[] };
}

/** mask (L=1,T=2,R=4,B=8) -> slot in the 16-tile template. */
export const MASK_TO_SLOT: readonly number[] = (() => {
  const t = new Array<number>(16).fill(0);
  t[15] = 0; // fill
  t[13] = 3; // top edge (no top neighbour)
  t[14] = 5; // left edge
  t[11] = 10; // right edge
  t[7] = 12; // bottom edge
  t[12] = 7; // top-left corner (right + bottom)
  t[9] = 11; // top-right corner (left + bottom)
  t[6] = 13; // bottom-left corner (top + right)
  t[3] = 14; // bottom-right corner (left + top)
  return t;
})();

export const MASK_LEFT = 1;
export const MASK_TOP = 2;
export const MASK_RIGHT = 4;
export const MASK_BOTTOM = 8;

/** Tile index for a cell of an autotile set given its neighbour mask (0 when the slot is empty and no fill exists). */
export function autotileIndex(set: AutotileSet, mask: number): number {
  const slot = MASK_TO_SLOT[mask & 15] ?? 0;
  const idx = set.tiles[slot] ?? 0;
  if (idx) return idx;
  return set.tiles[0] ?? 0;
}

/** Neighbour mask for a cell from a presence test. */
export function neighbourMask(present: (x: number, y: number) => boolean, x: number, y: number): number {
  let m = 0;
  if (present(x - 1, y)) m |= MASK_LEFT;
  if (present(x, y - 1)) m |= MASK_TOP;
  if (present(x + 1, y)) m |= MASK_RIGHT;
  if (present(x, y + 1)) m |= MASK_BOTTOM;
  return m;
}

export class Tileset {
  constructor(readonly def: TilesetDef, readonly image: HTMLImageElement | null, private readonly placeholder: HTMLCanvasElement) {}

  get tileW(): number {
    return this.def.tile_w;
  }

  /** Draws tile `idx` (sheet index, 0 = empty) with its top-left at (dx, dy) at `scale`. flags: bit0 mirror, bit1 flip, bit2 rotate. */
  draw(ctx: CanvasRenderingContext2D, idx: number, dx: number, dy: number, scale: number, flags = 0): void {
    if (!idx) return;
    const tw = this.def.tile_w;
    const th = this.def.tile_h;
    const sx = (idx % this.def.columns) * tw;
    const sy = Math.floor(idx / this.def.columns) * th;
    const w = tw * scale;
    const h = th * scale;
    const img: CanvasImageSource = this.image ?? this.placeholder;
    if (!flags) {
      if (this.image) ctx.drawImage(img, sx, sy, tw, th, dx, dy, w, h);
      else ctx.drawImage(this.placeholder, dx, dy, w, h);
      return;
    }
    ctx.save();
    ctx.translate(dx + w / 2, dy + h / 2);
    if (flags & 4) ctx.rotate(Math.PI / 2);
    ctx.scale(flags & 1 ? -1 : 1, flags & 2 ? -1 : 1);
    if (this.image) ctx.drawImage(img, sx, sy, tw, th, -w / 2, -h / 2, w, h);
    else ctx.drawImage(this.placeholder, -w / 2, -h / 2, w, h);
    ctx.restore();
  }

  /** The current frame of an animated tile (the index itself when it is not animated). */
  animated(idx: number, time: number): number {
    const anim = this.animIndex.get(idx);
    if (!anim) return idx;
    const fps = this.def.frame_duration_s || 5;
    const f = Math.floor(time * fps) % anim.length;
    return anim[f] ?? idx;
  }

  private animIndex = new Map<number, number[]>();

  /** Registers animations so `animated(firstFrame)` cycles through the frames. */
  indexAnimations(): void {
    for (const a of this.def.animations) {
      const first = a.frames[0];
      if (first !== undefined && !this.animIndex.has(first)) this.animIndex.set(first, a.frames);
    }
  }

  isAnimated(idx: number): boolean {
    return this.animIndex.has(idx);
  }
}

export class Sunnyside {
  private constructor(readonly data: SunnysideData, readonly main: Tileset, readonly forest: Tileset) {}

  static async load(assets: Assets): Promise<Sunnyside | null> {
    const data = await assets.json<SunnysideData>('tiles/sunnyside/sunnyside.json');
    if (!data) return null;
    const main = data.tilesets.tileset_sunnysideworld;
    const forest = data.tilesets.tileset_forest;
    if (!main || !forest) return null;
    const [mainImg, forestImg] = await Promise.all([
      assets.loadImage(`tiles/sunnyside/${main.image}`),
      assets.loadImage(`tiles/sunnyside/${forest.image}`),
    ]);
    const s = new Sunnyside(data, new Tileset(main, mainImg, assets.placeholder('tile', 16, 16)), new Tileset(forest, forestImg, assets.placeholder('forest', 32, 32)));
    s.main.indexAnimations();
    s.forest.indexAnimations();
    return s;
  }

  autotile(name: string): AutotileSet {
    const set = this.main.def.autotiles[name] ?? this.forest.def.autotiles[name];
    if (!set) throw new Error(`sunnyside.json has no autotile set "${name}"`);
    return set;
  }

  /**
   * Re-renders the pack's demo room from the JSON (all tile layers, bottom
   * to top, with flip flags) at 1x into a canvas, for comparison against
   * demo_room_render.png.
   */
  renderDemoRoom(): HTMLCanvasElement {
    const room = this.data.demo_room;
    const c = document.createElement('canvas');
    c.width = room.width_px;
    c.height = room.height_px;
    const ctx = c.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    for (const layer of room.layers) {
      if (!layer.tiles || !layer.tileset) continue;
      const ts = layer.tileset === 'tileset_forest' ? this.forest : this.main;
      const tw = ts.tileW;
      layer.tiles.forEach((row, y) => {
        row.forEach((idx, x) => {
          if (!idx) return;
          ts.draw(ctx, idx, x * tw, y * tw, 1, layer.flags?.[y]?.[x] ?? 0);
        });
      });
    }
    return c;
  }
}
