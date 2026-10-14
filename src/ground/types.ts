/**
 * The swappable ground layer. A match owns one GroundRenderer: the
 * procedural painter today, a Tiled JSON map with painted 128 px tiles when
 * one is present in /assets/tiles. Everything above the ground (sprites,
 * telegraphs, lighting) only talks to this interface.
 */
import type { View } from '../render/view';

export type Biome = 'meadow' | 'forest' | 'shore' | 'water';
export const BIOMES: readonly Biome[] = ['meadow', 'forest', 'shore', 'water'];

export interface DecorItem {
  kind: 'tree' | 'rock';
  /** Base point in tiles (the item's ground contact, used for depth sorting). */
  x: number;
  y: number;
  image: HTMLCanvasElement;
  /** Image size in ground pixels (1 ground pixel = 1/tileSize tile). */
  w: number;
  h: number;
  anchorX: number;
  anchorY: number;
  /** Blocking radius in tiles (0 = decorative only). */
  blockRadius: number;
}

export interface GroundRenderer {
  readonly cols: number;
  readonly rows: number;
  readonly tileSize: number;
  /** Shown in the HUD so a stand-in ground is never mistaken for final art. */
  readonly label: string;
  readonly decor: DecorItem[];
  biomeAt(tx: number, ty: number): Biome;
  /** True when a character may stand on the tile (terrain only; decor is checked separately). */
  walkable(tx: number, ty: number): boolean;
  /** Reachable from the map centre on foot (spawn points use this). */
  reachable(tx: number, ty: number): boolean;
  minimapColor(tx: number, ty: number): string;
  drawGround(view: View): void;
}

export const CHUNK_TILES = 8;

/** Shared chunk cache + draw for any ground that bakes to canvases once per match. */
export abstract class ChunkedGround implements GroundRenderer {
  abstract readonly label: string;
  readonly decor: DecorItem[] = [];
  protected chunks: HTMLCanvasElement[] = [];
  protected readonly chunkCols: number;
  protected readonly chunkRows: number;
  protected biomes: Biome[];
  protected solid: Uint8Array;
  protected reach: Uint8Array;

  constructor(readonly cols: number, readonly rows: number, readonly tileSize: number) {
    this.chunkCols = Math.ceil(cols / CHUNK_TILES);
    this.chunkRows = Math.ceil(rows / CHUNK_TILES);
    this.biomes = new Array<Biome>(cols * rows).fill('meadow');
    this.solid = new Uint8Array(cols * rows);
    this.reach = new Uint8Array(cols * rows);
  }

  protected idx(tx: number, ty: number): number {
    return ty * this.cols + tx;
  }

  inBounds(tx: number, ty: number): boolean {
    return tx >= 0 && ty >= 0 && tx < this.cols && ty < this.rows;
  }

  biomeAt(tx: number, ty: number): Biome {
    if (!this.inBounds(tx, ty)) return 'water';
    return this.biomes[this.idx(tx, ty)] ?? 'meadow';
  }

  walkable(tx: number, ty: number): boolean {
    return this.inBounds(tx, ty) && this.solid[this.idx(tx, ty)] === 0;
  }

  reachable(tx: number, ty: number): boolean {
    return this.inBounds(tx, ty) && this.reach[this.idx(tx, ty)] === 1;
  }

  minimapColor(tx: number, ty: number): string {
    switch (this.biomeAt(tx, ty)) {
      case 'water':
        return '#2a5d8f';
      case 'shore':
        return '#9a927e';
      case 'forest':
        return '#2f6b3c';
      default:
        return '#5f9a46';
    }
  }

  /** Breadth-first flood from the centre over walkable tiles. */
  protected computeReach(): void {
    this.reach.fill(0);
    const cx = Math.floor(this.cols / 2);
    const cy = Math.floor(this.rows / 2);
    const queue: number[] = [];
    const start = this.idx(cx, cy);
    if (this.solid[start] !== 0) return;
    this.reach[start] = 1;
    queue.push(start);
    while (queue.length) {
      const i = queue.shift() as number;
      const x = i % this.cols;
      const y = Math.floor(i / this.cols);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nx = x + dx;
        const ny = y + dy;
        if (!this.inBounds(nx, ny)) continue;
        const j = this.idx(nx, ny);
        if (this.solid[j] !== 0 || this.reach[j] === 1) continue;
        this.reach[j] = 1;
        queue.push(j);
      }
    }
  }

  drawGround(view: View): void {
    const ctx = view.ctx;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    const vis = view.visibleTiles();
    const chunkPx = CHUNK_TILES * view.pxPerTile;
    const c0 = Math.max(0, Math.floor(vis.x0 / CHUNK_TILES));
    const c1 = Math.min(this.chunkCols - 1, Math.floor(vis.x1 / CHUNK_TILES));
    const r0 = Math.max(0, Math.floor(vis.y0 / CHUNK_TILES));
    const r1 = Math.min(this.chunkRows - 1, Math.floor(vis.y1 / CHUNK_TILES));
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const chunk = this.chunks[r * this.chunkCols + c];
        if (!chunk) continue;
        const sx = view.toScreenX(c * CHUNK_TILES);
        const sy = view.toScreenY(r * CHUNK_TILES);
        // A hair of overlap hides seams between smoothly scaled chunks.
        ctx.drawImage(chunk, sx, sy, chunkPx + 0.6, chunkPx + 0.6);
      }
    }
  }
}
