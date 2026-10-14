/**
 * The island drawn with the Sunnyside World tileset: animated sea under
 * Land autotiles (cliffs on the bottom edges), River autotile streams, Path
 * 01 trails between the outposts and the crystal, the 32 px forest_01 canopy
 * above the characters, and decor stamped from the sheet and the plants
 * strips. Baked once per match into 8x8-tile chunks at 1x and drawn at 3x
 * with nearest-neighbour; the sea, rivers and animated decor redraw each
 * frame.
 */
import { Rng } from '../core/rng';
import type { View } from '../render/view';
import type { Assets } from '../sprites/assets';
import { generateIsland, type IslandGrids } from './island';
import { autotileIndex, neighbourMask, Sunnyside, type AutotileSet } from './sunnyside';
import { BIOMES, type Biome, type DecorItem, type GroundRenderer } from './types';

const CHUNK = 8;
/** Animated sea fill (4 frames) and the sparkle overlays. */
const SEA_FRAMES = [478, 479, 480, 481];
const SEA_SPARKLE = [212, 215];
const RIVER_FRAMES = [542, 543, 544, 545];
/** Grass detail variants scattered over plain land, and the cliff wall under bottom edges. */
const GRASS_DETAIL = [131, 132, 133, 134, 340, 403];
const CLIFF_WALL = [266, 267, 268];
/** Decor tiles from the 16 px sheet. */
const DECOR_TILES = {
  bush: [114, 307, 219, 221, 155, 157],
  flower: [176, 240, 304, 368, 223, 227],
  rock: [287, 289, 290, 497, 498],
};
/** Multi-tile trees: [top-left index, width in tiles, height in tiles]. */
const TREE_STAMPS: Array<[number, number, number]> = [
  [119, 2, 2],
  [121, 2, 2],
  [435, 1, 2],
  [436, 1, 2],
  [308, 1, 2],
];
const PLANT_STRIPS: Array<{ file: string; kind: DecorItem['kind']; frames: number; w: number; h: number; block: number }> = [
  { file: 'spr_deco_tree_01_strip4.png', kind: 'tree', frames: 4, w: 32, h: 34, block: 0.45 },
  { file: 'spr_deco_tree_02_strip4.png', kind: 'tree', frames: 4, w: 28, h: 43, block: 0.45 },
  { file: 'spr_deco_mushroom_blue_01_strip4.png', kind: 'mushroom', frames: 4, w: 16, h: 16, block: 0 },
  { file: 'spr_deco_mushroom_blue_02_strip4.png', kind: 'mushroom', frames: 4, w: 16, h: 16, block: 0 },
  { file: 'spr_deco_mushroom_red_01_strip4.png', kind: 'mushroom', frames: 4, w: 16, h: 16, block: 0 },
];

export class SunnysideGround implements GroundRenderer {
  readonly tileSize = 16;
  readonly label = 'Sunnyside World tileset (Daniel Diggle) · 16 px at 3x';
  readonly decor: DecorItem[] = [];
  readonly outposts: Array<{ x: number; y: number }> = [];
  readonly spawns: Array<{ x: number; y: number }> = [];
  readonly cols: number;
  readonly rows: number;
  private grids: IslandGrids;
  private landIdx: Uint16Array;
  private riverIdx: Uint16Array;
  private pathIdx: Uint16Array;
  private canopyIdx: Uint16Array; // per 2x2 block, indexed by (by/2)*(cols/2)+(bx/2)
  private shore: Uint8Array;
  private reach: Uint8Array;
  private chunks: HTMLCanvasElement[] = [];
  private chunkCols: number;
  private chunkRows: number;
  private time = 0;
  private sparkles: Array<{ x: number; y: number; phase: number }> = [];

  private constructor(private readonly sunny: Sunnyside, cols: number, rows: number, seed: number) {
    this.cols = cols;
    this.rows = rows;
    this.chunkCols = Math.ceil(cols / CHUNK);
    this.chunkRows = Math.ceil(rows / CHUNK);
    const n = cols * rows;
    this.landIdx = new Uint16Array(n);
    this.riverIdx = new Uint16Array(n);
    this.pathIdx = new Uint16Array(n);
    this.canopyIdx = new Uint16Array(Math.ceil(cols / 2) * Math.ceil(rows / 2));
    this.shore = new Uint8Array(n);
    this.reach = new Uint8Array(n);
    // First pass: island without trails, to choose the points of interest.
    const draft = generateIsland(seed, cols, rows);
    const rng = new Rng(seed ^ 0x77aa);
    const pois = this.choosePois(draft, rng);
    this.grids = generateIsland(seed, cols, rows, pois);
    this.outposts.push(...pois.slice(0, 2));
    this.spawns.push(...pois.slice(2));
  }

  static async create(assets: Assets, cols: number, rows: number, seed: number, onProgress?: (p: number) => void): Promise<SunnysideGround> {
    const sunny = await Sunnyside.load(assets);
    if (!sunny) throw new Error('assets/tiles/sunnyside/sunnyside.json is missing');
    const g = new SunnysideGround(sunny, cols, rows, seed);
    g.resolveTiles();
    g.computeReach();
    await g.scatterDecor(assets, seed);
    const total = g.chunkCols * g.chunkRows;
    for (let r = 0; r < g.chunkRows; r++) {
      for (let c = 0; c < g.chunkCols; c++) {
        g.chunks[r * g.chunkCols + c] = g.bakeChunk(c, r);
        onProgress?.((r * g.chunkCols + c + 1) / total);
      }
      await new Promise((res) => setTimeout(res, 0));
    }
    return g;
  }

  private idx(x: number, y: number): number {
    return y * this.cols + x;
  }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.cols && y < this.rows;
  }

  /** Two outposts a third of the way out on opposite sides, then three spawn points on the coast. */
  private choosePois(g: IslandGrids, rng: Rng): Array<{ x: number; y: number }> {
    const cx = g.cols / 2;
    const cy = g.rows / 2;
    const open = (x: number, y: number, r: number): boolean => {
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        const i = (y + dy) * g.cols + (x + dx);
        if (!this.inBounds(x + dx, y + dy) || !g.walkable[i]) return false;
      }
      return true;
    };
    const out: Array<{ x: number; y: number }> = [];
    const base = rng.range(0, Math.PI * 2);
    for (let k = 0; k < 2; k++) {
      let best: { x: number; y: number } | null = null;
      for (let r = 9; r < 24 && !best; r += 1) {
        for (let da = 0; da < 1.2 && !best; da += 0.1) {
          for (const s of [1, -1]) {
            const a = base + k * Math.PI + da * s;
            const x = Math.floor(cx + Math.cos(a) * r);
            const y = Math.floor(cy + Math.sin(a) * r);
            if (this.inBounds(x, y) && open(x, y, 2)) {
              best = { x, y };
              break;
            }
          }
        }
      }
      out.push(best ?? { x: Math.floor(cx) + (k ? 6 : -6), y: Math.floor(cy) });
    }
    // Spawns: far from the centre and from each other, with open ground around.
    const candidates: Array<{ x: number; y: number; d: number }> = [];
    for (let y = 2; y < g.rows - 2; y++) {
      for (let x = 2; x < g.cols - 2; x++) {
        if (!open(x, y, 1)) continue;
        candidates.push({ x, y, d: Math.hypot(x - cx, y - cy) });
      }
    }
    candidates.sort((a, b) => b.d - a.d);
    const spawns: Array<{ x: number; y: number }> = [];
    for (const c of candidates) {
      if (spawns.length >= 3) break;
      if (spawns.every((s) => Math.hypot(s.x - c.x, s.y - c.y) > g.cols * 0.35) && out.every((o) => Math.hypot(o.x - c.x, o.y - c.y) > 5)) spawns.push({ x: c.x, y: c.y });
    }
    while (spawns.length < 3) spawns.push({ x: Math.floor(cx), y: Math.floor(cy) });
    return [...out, ...spawns];
  }

  private resolveTiles(): void {
    const g = this.grids;
    const land = this.sunny.autotile('Land');
    const river = this.sunny.autotile('River');
    const path = this.sunny.autotile('Path 01');
    const forest = this.sunny.autotile('forest_01');
    const has = (grid: Uint8Array) => (x: number, y: number) => this.inBounds(x, y) && grid[this.idx(x, y)] === 1;
    const landAt = has(g.land);
    const riverAt = has(g.river);
    const pathAt = has(g.path);
    for (let y = 0; y < this.rows; y++) {
      for (let x = 0; x < this.cols; x++) {
        const i = this.idx(x, y);
        if (g.land[i]) {
          this.landIdx[i] = autotileIndex(land, neighbourMask(landAt, x, y));
          this.shore[i] = neighbourMask(landAt, x, y) !== 15 ? 1 : 0;
        }
        if (g.river[i]) this.riverIdx[i] = autotileIndex(river, neighbourMask(riverAt, x, y));
        if (g.path[i]) this.pathIdx[i] = autotileIndex(path, neighbourMask(pathAt, x, y));
      }
    }
    // Canopy on the 2x2 block grid.
    const bc = Math.ceil(this.cols / 2);
    const blockAt = (bx: number, by: number) => bx >= 0 && by >= 0 && bx * 2 < this.cols && by * 2 < this.rows && g.forest[this.idx(bx * 2, by * 2)] === 1;
    for (let by = 0; by * 2 < this.rows; by++) {
      for (let bx = 0; bx * 2 < this.cols; bx++) {
        if (!blockAt(bx, by)) continue;
        const mask = neighbourMask(blockAt, bx, by);
        let t = autotileIndex(forest, mask);
        if (!t || (mask === 15 && t === forest.tiles[0])) t = forest.tiles[3] ?? t; // the dense canopy is slot 3
        this.canopyIdx[by * bc + bx] = t;
      }
    }
    // Sea sparkles.
    const rng = new Rng(0x5ea);
    for (let k = 0; k < (this.cols * this.rows) / 20; k++) {
      const x = rng.int(0, this.cols - 1);
      const y = rng.int(0, this.rows - 1);
      if (!g.land[this.idx(x, y)]) this.sparkles.push({ x, y, phase: rng.range(0, 10) });
    }
  }

  private computeReach(): void {
    const g = this.grids;
    const start = this.idx(Math.floor(this.cols / 2), Math.floor(this.rows / 2));
    const queue: number[] = [];
    if (!g.walkable[start]) {
      // Find the nearest walkable cell to the centre.
      let best = -1;
      let bd = Infinity;
      for (let i = 0; i < g.walkable.length; i++) {
        if (!g.walkable[i]) continue;
        const d = Math.hypot((i % this.cols) - this.cols / 2, Math.floor(i / this.cols) - this.rows / 2);
        if (d < bd) {
          bd = d;
          best = i;
        }
      }
      if (best < 0) return;
      queue.push(best);
      this.reach[best] = 1;
    } else {
      queue.push(start);
      this.reach[start] = 1;
    }
    while (queue.length) {
      const i = queue.shift() as number;
      const x = i % this.cols;
      const y = Math.floor(i / this.cols);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nx = x + dx;
        const ny = y + dy;
        if (!this.inBounds(nx, ny)) continue;
        const j = this.idx(nx, ny);
        if (!g.walkable[j] || this.reach[j]) continue;
        this.reach[j] = 1;
        queue.push(j);
      }
    }
  }

  private async scatterDecor(assets: Assets, seed: number): Promise<void> {
    const rng = new Rng(seed ^ 0xdec0);
    const g = this.grids;
    const ts = this.sunny.main;
    const strips = await Promise.all(PLANT_STRIPS.map(async (p) => ({ ...p, image: await assets.loadImage(`tiles/sunnyside/plants/${p.file}`) })));
    const stamp = (indices: number[][], w: number, h: number): HTMLCanvasElement => {
      const c = document.createElement('canvas');
      c.width = w * 16;
      c.height = h * 16;
      const ctx = c.getContext('2d')!;
      ctx.imageSmoothingEnabled = false;
      indices.forEach((row, y) => row.forEach((t, x) => ts.draw(ctx, t, x * 16, y * 16, 1)));
      return c;
    };
    const treeStamps = TREE_STAMPS.map(([tl, w, h]) => {
      const rows: number[][] = [];
      for (let y = 0; y < h; y++) {
        const row: number[] = [];
        for (let x = 0; x < w; x++) row.push(tl + y * 64 + x);
        rows.push(row);
      }
      return { image: stamp(rows, w, h), w: w * 16, h: h * 16 };
    });
    const single = (t: number) => stamp([[t]], 1, 1);
    const avoid = (x: number, y: number): boolean => {
      for (const p of [...this.outposts, ...this.spawns]) if (Math.hypot(p.x + 0.5 - x, p.y + 0.5 - y) < 3) return true;
      return Math.hypot(x - this.cols / 2, y - this.rows / 2) < 3;
    };
    const place = (item: DecorItem, block: boolean): void => {
      this.decor.push(item);
      if (block) {
        const tx = Math.floor(item.x);
        const ty = Math.floor(item.y);
        if (this.inBounds(tx, ty)) g.walkable[this.idx(tx, ty)] = 0;
      }
    };
    for (let y = 1; y < this.rows - 1; y++) {
      for (let x = 1; x < this.cols - 1; x++) {
        const i = this.idx(x, y);
        if (!g.walkable[i] || g.path[i] || this.shore[i]) continue;
        if (avoid(x + 0.5, y + 0.5)) continue;
        const r = rng.next();
        const forestEdge = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => g.forest[this.idx(x + (dx as number), y + (dy as number))] === 1);
        if (r < (forestEdge ? 0.12 : 0.05)) {
          // Trees: animated plants strips or sheet stamps; they block their base tile.
          if (rng.next() < 0.5) {
            const s = rng.pick(strips);
            const img = s.image;
            place({ kind: 'tree', x: x + 0.5, y: y + 0.95, image: img ?? assets.placeholder(s.file.slice(9, 20), s.w, s.h), frameW: s.w, frameH: s.h, frames: img ? s.frames : 1, fps: 4, anchorX: s.w / 2, anchorY: s.h - 2, blockRadius: s.block }, true);
          } else {
            const t = rng.pick(treeStamps);
            place({ kind: 'tree', x: x + 0.5, y: y + 0.95, image: t.image, frameW: t.w, frameH: t.h, frames: 1, fps: 0, anchorX: t.w / 2, anchorY: t.h - 2, blockRadius: 0.45 }, true);
          }
        } else if (r < 0.1) {
          const t = rng.pick(DECOR_TILES.bush);
          place({ kind: 'bush', x: x + 0.5, y: y + 0.9, image: single(t), frameW: 16, frameH: 16, frames: 1, fps: 0, anchorX: 8, anchorY: 15, blockRadius: 0 }, false);
        } else if (r < 0.16) {
          const t = rng.pick(DECOR_TILES.flower);
          place({ kind: 'flower', x: x + 0.5, y: y + 0.9, image: single(t), frameW: 16, frameH: 16, frames: 1, fps: 0, anchorX: 8, anchorY: 15, blockRadius: 0 }, false);
        } else if (r < 0.18) {
          const t = rng.pick(DECOR_TILES.rock);
          place({ kind: 'rock', x: x + 0.5, y: y + 0.9, image: single(t), frameW: 16, frameH: 16, frames: 1, fps: 0, anchorX: 8, anchorY: 15, blockRadius: 0.4 }, true);
        } else if (r < 0.2 && forestEdge) {
          const s = rng.pick(strips.filter((p) => p.kind === 'mushroom'));
          const img = s.image;
          place({ kind: 'mushroom', x: x + 0.5, y: y + 0.9, image: img ?? assets.placeholder('mushroom', 16, 16), frameW: 16, frameH: 16, frames: img ? 4 : 1, fps: 3, anchorX: 8, anchorY: 15, blockRadius: 0 }, false);
        }
      }
    }
    this.decor.sort((a, b) => a.y - b.y);
    // Re-run reachability since trees and rocks now block.
    this.reach.fill(0);
    this.computeReach();
  }

  /** Bakes land (with grass detail and cliff walls), river banks and paths of one chunk at 1x. */
  private bakeChunk(cc: number, cr: number): HTMLCanvasElement {
    const c = document.createElement('canvas');
    c.width = CHUNK * 16;
    c.height = CHUNK * 16;
    const ctx = c.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    const ts = this.sunny.main;
    const landSet = this.sunny.autotile('Land');
    const rng = new Rng((cc * 7919 + cr * 104729 + 3) >>> 0);
    for (let ty = 0; ty < CHUNK; ty++) {
      for (let tx = 0; tx < CHUNK; tx++) {
        const x = cc * CHUNK + tx;
        const y = cr * CHUNK + ty;
        if (!this.inBounds(x, y)) continue;
        const i = this.idx(x, y);
        const landTile = this.landIdx[i] ?? 0;
        if (!this.grids.land[i]) {
          // A cliff wall hangs one row under every bottom land edge.
          const above = y > 0 ? this.landIdx[this.idx(x, y - 1)] ?? 0 : 0;
          if (above === landSet.tiles[12] || above === landSet.tiles[13] || above === landSet.tiles[14]) {
            ts.draw(ctx, CLIFF_WALL[(x * 3 + y) % CLIFF_WALL.length] as number, tx * 16, ty * 16, 1);
          }
          continue;
        }
        ts.draw(ctx, landTile, tx * 16, ty * 16, 1);
        if (landTile === landSet.tiles[0] && !this.grids.path[i] && !this.grids.river[i] && rng.next() < 0.14) {
          ts.draw(ctx, rng.pick(GRASS_DETAIL), tx * 16, ty * 16, 1);
        }
        const r = this.riverIdx[i] ?? 0;
        if (r && r !== this.sunny.autotile('River').tiles[0]) ts.draw(ctx, r, tx * 16, ty * 16, 1);
        ts.draw(ctx, this.pathIdx[i] ?? 0, tx * 16, ty * 16, 1);
      }
    }
    return c;
  }

  biomeAt(tx: number, ty: number): Biome {
    if (!this.inBounds(tx, ty)) return 'water';
    const i = this.idx(tx, ty);
    if (!this.grids.land[i]) return 'water';
    if (this.grids.forest[i]) return 'forest';
    if (this.shore[i] || this.grids.river[i]) return 'shore';
    return 'meadow';
  }

  inWater(tx: number, ty: number): boolean {
    if (!this.inBounds(tx, ty)) return true;
    const i = this.idx(tx, ty);
    return !this.grids.land[i] || !!this.grids.river[i];
  }

  walkable(tx: number, ty: number): boolean {
    return this.inBounds(tx, ty) && this.grids.walkable[this.idx(tx, ty)] === 1;
  }

  reachable(tx: number, ty: number): boolean {
    return this.inBounds(tx, ty) && this.reach[this.idx(tx, ty)] === 1;
  }

  underCanopy(x: number, y: number): boolean {
    const tx = Math.floor(x);
    const ty = Math.floor(y);
    return this.inBounds(tx, ty) && this.grids.forest[this.idx(tx, ty)] === 1;
  }

  minimapColor(tx: number, ty: number): string {
    if (!this.inBounds(tx, ty)) return '#2a6fb5';
    const i = this.idx(tx, ty);
    if (!this.grids.land[i]) return '#2a6fb5';
    if (this.grids.path[i]) return '#c8a06a';
    if (this.grids.river[i]) return '#5fd4e8';
    if (this.grids.forest[i]) return '#2f7a3a';
    if (this.shore[i]) return '#7fbe55';
    return '#6cc24a';
  }

  update(dt: number): void {
    this.time += dt;
  }

  drawGround(view: View): void {
    const ctx = view.ctx;
    ctx.imageSmoothingEnabled = false;
    const ts = this.sunny.main;
    const s = view.pxPerTile / 16;
    const vis = view.visibleTiles();
    const x0 = Math.max(0, Math.floor(vis.x0));
    const y0 = Math.max(0, Math.floor(vis.y0));
    const x1 = Math.min(this.cols - 1, Math.ceil(vis.x1));
    const y1 = Math.min(this.rows - 1, Math.ceil(vis.y1));
    const sea = SEA_FRAMES[Math.floor(this.time * 5) % SEA_FRAMES.length] as number;
    const riverFill = RIVER_FRAMES[Math.floor(this.time * 5) % RIVER_FRAMES.length] as number;
    const riverSet = this.sunny.autotile('River');
    // Sea everywhere (land tiles cover it; cliff corners show it through).
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const i = this.idx(x, y);
        const sx = Math.round(view.toScreenX(x));
        const sy = Math.round(view.toScreenY(y));
        if (!this.grids.land[i] || this.shore[i]) ts.draw(ctx, sea, sx, sy, s);
      }
    }
    for (const sp of this.sparkles) {
      if (sp.x < x0 || sp.x > x1 || sp.y < y0 || sp.y > y1) continue;
      const k = (this.time * 0.5 + sp.phase) % 4;
      if (k < 1) ts.draw(ctx, SEA_SPARKLE[k < 0.5 ? 0 : 1] as number, Math.round(view.toScreenX(sp.x)), Math.round(view.toScreenY(sp.y)), s);
    }
    // Baked land / river edges / paths.
    const chunkPx = CHUNK * view.pxPerTile;
    for (let cr = Math.floor(y0 / CHUNK); cr <= Math.floor(y1 / CHUNK); cr++) {
      for (let cc = Math.floor(x0 / CHUNK); cc <= Math.floor(x1 / CHUNK); cc++) {
        const chunk = this.chunks[cr * this.chunkCols + cc];
        if (!chunk) continue;
        ctx.drawImage(chunk, Math.round(view.toScreenX(cc * CHUNK)), Math.round(view.toScreenY(cr * CHUNK)), chunkPx, chunkPx);
      }
    }
    // Animated river water inside the banks.
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const i = this.idx(x, y);
        if (this.riverIdx[i] === riverSet.tiles[0]) ts.draw(ctx, riverFill, Math.round(view.toScreenX(x)), Math.round(view.toScreenY(y)), s);
      }
    }
  }

  drawCanopy(view: View): void {
    const ctx = view.ctx;
    ctx.imageSmoothingEnabled = false;
    const s = view.pxPerTile / 16;
    const vis = view.visibleTiles();
    const bc = Math.ceil(this.cols / 2);
    const bx0 = Math.max(0, Math.floor(vis.x0 / 2) - 1);
    const by0 = Math.max(0, Math.floor(vis.y0 / 2) - 1);
    const bx1 = Math.min(bc - 1, Math.ceil(vis.x1 / 2));
    const by1 = Math.min(Math.ceil(this.rows / 2) - 1, Math.ceil(vis.y1 / 2));
    for (let by = by0; by <= by1; by++) {
      for (let bx = bx0; bx <= bx1; bx++) {
        const t = this.canopyIdx[by * bc + bx] ?? 0;
        if (!t) continue;
        this.sunny.forest.draw(ctx, t, Math.round(view.toScreenX(bx * 2)), Math.round(view.toScreenY(by * 2)), s);
      }
    }
  }

  /** Current frame of a decor item. */
  frameOf(d: DecorItem): number {
    return d.frames > 1 ? Math.floor(this.time * d.fps) % d.frames : 0;
  }

  get grid(): IslandGrids {
    return this.grids;
  }

  get tileset(): Sunnyside {
    return this.sunny;
  }
}

export { BIOMES, type AutotileSet };
