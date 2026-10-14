/**
 * A pre-authored map from assets/maps/<name>.json (built by
 * scripts/build_map.py). Every tile is already resolved, so this renderer only
 * stacks the layers: sea, ground (grass, cliff faces, foam base), water
 * shadows, river banks, beaches and trails, baked into 8x8-tile chunks at 1x
 * and drawn at the view's integer scale. River water inside the banks and the
 * sea sparkle animate each frame; the 32 px canopy is drawn above the
 * characters. Walkability and reachability come straight from the file.
 */
import type { View } from '../render/view';
import type { Assets } from '../sprites/assets';
import { Tileset, type TilesetDef } from './sunnyside';
import type { Biome, DecorItem, GroundRenderer } from './types';

const CHUNK = 8;
const SEA_SPARKLE = [212, 215];
const BIOME_CODES: Biome[] = ['water', 'meadow', 'forest', 'shore'];
const STRIPS: Record<string, { kind: DecorItem['kind']; frames: number; w: number; h: number; block: number }> = {
  'spr_deco_tree_01_strip4.png': { kind: 'tree', frames: 4, w: 32, h: 34, block: 0.45 },
  'spr_deco_tree_02_strip4.png': { kind: 'tree', frames: 4, w: 28, h: 43, block: 0.45 },
  'spr_deco_mushroom_blue_01_strip4.png': { kind: 'mushroom', frames: 4, w: 16, h: 16, block: 0 },
  'spr_deco_mushroom_blue_02_strip4.png': { kind: 'mushroom', frames: 4, w: 16, h: 16, block: 0 },
  'spr_deco_mushroom_red_01_strip4.png': { kind: 'mushroom', frames: 4, w: 16, h: 16, block: 0 },
};

export interface MapDecor {
  kind: DecorItem['kind'];
  x: number;
  y: number;
  tile?: number;
  stamp?: [number, number, number];
  strip?: string;
}

export interface MapFile {
  name: string;
  seed: number;
  cols: number;
  rows: number;
  tileSize: number;
  tileset: string;
  tilesetColumns: number;
  forestTileset: string;
  forestColumns: number;
  layers: Array<{ name: string; tiles: number[][] }>;
  canopy: number[][];
  riverFillFrames: number[];
  walkable: number[][];
  reachable: number[][];
  biome: number[][];
  center: { x: number; y: number };
  outposts: Array<{ x: number; y: number }>;
  spawns: Array<{ x: number; y: number }>;
  decor: MapDecor[];
}

export class StaticGround implements GroundRenderer {
  readonly tileSize = 16;
  readonly label: string;
  readonly decor: DecorItem[] = [];
  readonly outposts: Array<{ x: number; y: number }>;
  readonly spawns: Array<{ x: number; y: number }>;
  readonly cols: number;
  readonly rows: number;
  readonly center: { x: number; y: number };
  private walk: Uint8Array;
  private reach: Uint8Array;
  private biomes: Uint8Array;
  private landMask: Uint8Array;
  private riverFill: Uint8Array;
  private canopyIdx: number[][];
  private chunks: HTMLCanvasElement[] = [];
  private chunkCols: number;
  private chunkRows: number;
  private time = 0;
  private sparkles: Array<{ x: number; y: number; phase: number }> = [];
  private riverFillTile: number;

  private constructor(private readonly map: MapFile, private readonly main: Tileset, private readonly forest: Tileset) {
    this.cols = map.cols;
    this.rows = map.rows;
    this.label = `${map.name} · authored map ${map.cols}x${map.rows} · Sunnyside World tileset (Daniel Diggle) at 3x`;
    this.outposts = map.outposts.map((p) => ({ ...p }));
    this.spawns = map.spawns.map((p) => ({ ...p }));
    this.center = map.center;
    this.chunkCols = Math.ceil(this.cols / CHUNK);
    this.chunkRows = Math.ceil(this.rows / CHUNK);
    const n = this.cols * this.rows;
    this.walk = new Uint8Array(n);
    this.reach = new Uint8Array(n);
    this.biomes = new Uint8Array(n);
    this.landMask = new Uint8Array(n);
    this.riverFill = new Uint8Array(n);
    this.riverFillTile = map.riverFillFrames[0] ?? 542;
    const ground = this.layer('ground');
    const river = this.layer('river');
    for (let y = 0; y < this.rows; y++) {
      for (let x = 0; x < this.cols; x++) {
        const i = y * this.cols + x;
        this.walk[i] = map.walkable[y]?.[x] ?? 0;
        this.reach[i] = map.reachable[y]?.[x] ?? 0;
        this.biomes[i] = map.biome[y]?.[x] ?? 0;
        this.landMask[i] = (map.biome[y]?.[x] ?? 0) !== 0 ? 1 : 0;
        if (river && river[y]?.[x] === this.riverFillTile) this.riverFill[i] = 1;
        if (ground && !ground[y]?.[x]) this.landMask[i] = 0;
      }
    }
    this.canopyIdx = map.canopy;
  }

  static async load(assets: Assets, name: string, onProgress?: (p: number) => void): Promise<StaticGround | null> {
    const map = await assets.json<MapFile>(`maps/${name}.json`);
    if (!map) return null;
    const data = await assets.json<{ tilesets: Record<string, TilesetDef> }>('tiles/sunnyside/sunnyside.json');
    if (!data) return null;
    const mainDef = data.tilesets.tileset_sunnysideworld;
    const forestDef = data.tilesets.tileset_forest;
    if (!mainDef || !forestDef) return null;
    mainDef.columns = map.tilesetColumns;
    forestDef.columns = map.forestColumns;
    const [mainImg, forestImg] = await Promise.all([assets.loadImage(map.tileset), assets.loadImage(map.forestTileset)]);
    const main = new Tileset(mainDef, mainImg, assets.placeholder('tile', 16, 16));
    const forest = new Tileset(forestDef, forestImg, assets.placeholder('forest', 32, 32));
    main.indexAnimations();
    const g = new StaticGround(map, main, forest);
    await g.buildDecor(assets);
    g.seedSparkles();
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

  private layer(name: string): number[][] | null {
    return this.map.layers.find((l) => l.name === name)?.tiles ?? null;
  }

  private idx(x: number, y: number): number {
    return y * this.cols + x;
  }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.cols && y < this.rows;
  }

  private seedSparkles(): void {
    let s = 0x5ea1 ^ this.map.seed;
    const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
    for (let k = 0; k < (this.cols * this.rows) / 18; k++) {
      const x = Math.floor(rnd() * this.cols);
      const y = Math.floor(rnd() * this.rows);
      if (!this.landMask[this.idx(x, y)]) this.sparkles.push({ x, y, phase: rnd() * 10 });
    }
  }

  private async buildDecor(assets: Assets): Promise<void> {
    const ts = this.main;
    const stampCache = new Map<string, HTMLCanvasElement>();
    const stamp = (indices: number[][], w: number, h: number): HTMLCanvasElement => {
      const key = indices.map((r) => r.join(',')).join('|');
      let c = stampCache.get(key);
      if (c) return c;
      c = document.createElement('canvas');
      c.width = w * 16;
      c.height = h * 16;
      const ctx = c.getContext('2d')!;
      ctx.imageSmoothingEnabled = false;
      indices.forEach((row, y) => row.forEach((t, x) => ts.draw(ctx, t, x * 16, y * 16, 1)));
      stampCache.set(key, c);
      return c;
    };
    const strips = new Map<string, HTMLImageElement | null>();
    for (const d of this.map.decor) {
      if (d.strip && !strips.has(d.strip)) strips.set(d.strip, await assets.loadImage(`tiles/sunnyside/plants/${d.strip}`));
    }
    for (const d of this.map.decor) {
      if (d.tile !== undefined) {
        const img = stamp([[d.tile]], 1, 1);
        this.decor.push({ kind: d.kind, x: d.x, y: d.y, image: img, frameW: 16, frameH: 16, frames: 1, fps: 0, anchorX: 8, anchorY: 15, blockRadius: d.kind === 'rock' ? 0.4 : 0 });
      } else if (d.stamp) {
        const [tl, w, h] = d.stamp;
        const rows: number[][] = [];
        for (let y = 0; y < h; y++) {
          const row: number[] = [];
          for (let x = 0; x < w; x++) row.push(tl + y * this.map.tilesetColumns + x);
          rows.push(row);
        }
        const img = stamp(rows, w, h);
        this.decor.push({ kind: d.kind, x: d.x, y: d.y, image: img, frameW: w * 16, frameH: h * 16, frames: 1, fps: 0, anchorX: (w * 16) / 2, anchorY: h * 16 - 2, blockRadius: 0.45 });
      } else if (d.strip) {
        const meta = STRIPS[d.strip];
        if (!meta) continue;
        const img = strips.get(d.strip) ?? null;
        this.decor.push({
          kind: meta.kind,
          x: d.x,
          y: d.y,
          image: img ?? assets.placeholder(d.strip.slice(9, 24), meta.w, meta.h),
          frameW: meta.w,
          frameH: meta.h,
          frames: img ? meta.frames : 1,
          fps: meta.kind === 'tree' ? 4 : 3,
          anchorX: meta.w / 2,
          anchorY: meta.h - 2,
          blockRadius: meta.block,
        });
      }
    }
    this.decor.sort((a, b) => a.y - b.y);
  }

  /** All static layers of one chunk at 1x, bottom to top. */
  private bakeChunk(cc: number, cr: number): HTMLCanvasElement {
    const c = document.createElement('canvas');
    c.width = CHUNK * 16;
    c.height = CHUNK * 16;
    const ctx = c.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    for (const layer of this.map.layers) {
      const isRiver = layer.name === 'river';
      for (let ty = 0; ty < CHUNK; ty++) {
        for (let tx = 0; tx < CHUNK; tx++) {
          const x = cc * CHUNK + tx;
          const y = cr * CHUNK + ty;
          if (!this.inBounds(x, y)) continue;
          const t = layer.tiles[y]?.[x] ?? 0;
          if (!t) continue;
          if (isRiver && t === this.riverFillTile) continue; // animated at draw time
          this.main.draw(ctx, t, tx * 16, ty * 16, 1);
        }
      }
    }
    return c;
  }

  biomeAt(tx: number, ty: number): Biome {
    if (!this.inBounds(tx, ty)) return 'water';
    return BIOME_CODES[this.biomes[this.idx(tx, ty)] ?? 0] ?? 'water';
  }

  inWater(tx: number, ty: number): boolean {
    if (!this.inBounds(tx, ty)) return true;
    return this.biomeAt(tx, ty) === 'water' || this.riverFill[this.idx(tx, ty)] === 1;
  }

  walkable(tx: number, ty: number): boolean {
    return this.inBounds(tx, ty) && this.walk[this.idx(tx, ty)] === 1;
  }

  reachable(tx: number, ty: number): boolean {
    return this.inBounds(tx, ty) && this.reach[this.idx(tx, ty)] === 1;
  }

  underCanopy(x: number, y: number): boolean {
    const bx = Math.floor(x / 2);
    const by = Math.floor(y / 2);
    return (this.canopyIdx[by]?.[bx] ?? 0) !== 0;
  }

  minimapColor(tx: number, ty: number): string {
    if (!this.inBounds(tx, ty)) return '#2a6fb5';
    const i = this.idx(tx, ty);
    if (!this.landMask[i]) return '#2a6fb5';
    const b = this.biomes[i];
    if (this.riverFill[i]) return '#5fd4e8';
    const path = this.layer('path');
    if (path && path[ty]?.[tx]) return '#c8a06a';
    if (b === 2) return '#2f7a3a';
    if (b === 3) return '#d9c27a';
    if (!this.walk[i]) return '#4e9a3c';
    return '#6cc24a';
  }

  update(dt: number): void {
    this.time += dt;
  }

  drawGround(view: View): void {
    const ctx = view.ctx;
    ctx.imageSmoothingEnabled = false;
    const s = view.pxPerTile / 16;
    const vis = view.visibleTiles();
    const x0 = Math.max(0, Math.floor(vis.x0));
    const y0 = Math.max(0, Math.floor(vis.y0));
    const x1 = Math.min(this.cols - 1, Math.ceil(vis.x1));
    const y1 = Math.min(this.rows - 1, Math.ceil(vis.y1));
    const chunkPx = CHUNK * view.pxPerTile;
    for (let cr = Math.floor(y0 / CHUNK); cr <= Math.floor(y1 / CHUNK); cr++) {
      for (let cc = Math.floor(x0 / CHUNK); cc <= Math.floor(x1 / CHUNK); cc++) {
        const chunk = this.chunks[cr * this.chunkCols + cc];
        if (!chunk) continue;
        ctx.drawImage(chunk, Math.round(view.toScreenX(cc * CHUNK)), Math.round(view.toScreenY(cr * CHUNK)), chunkPx, chunkPx);
      }
    }
    for (const sp of this.sparkles) {
      if (sp.x < x0 || sp.x > x1 || sp.y < y0 || sp.y > y1) continue;
      const k = (this.time * 0.5 + sp.phase) % 4;
      if (k < 1) this.main.draw(ctx, SEA_SPARKLE[k < 0.5 ? 0 : 1] as number, Math.round(view.toScreenX(sp.x)), Math.round(view.toScreenY(sp.y)), s);
    }
    const frames = this.map.riverFillFrames;
    const fill = frames[Math.floor(this.time * 5) % frames.length] as number;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        if (this.riverFill[this.idx(x, y)]) this.main.draw(ctx, fill, Math.round(view.toScreenX(x)), Math.round(view.toScreenY(y)), s);
      }
    }
  }

  drawCanopy(view: View): void {
    const ctx = view.ctx;
    ctx.imageSmoothingEnabled = false;
    const s = view.pxPerTile / 16;
    const vis = view.visibleTiles();
    const bx0 = Math.max(0, Math.floor(vis.x0 / 2) - 1);
    const by0 = Math.max(0, Math.floor(vis.y0 / 2) - 1);
    const bx1 = Math.min(Math.ceil(this.cols / 2) - 1, Math.ceil(vis.x1 / 2));
    const by1 = Math.min(Math.ceil(this.rows / 2) - 1, Math.ceil(vis.y1 / 2));
    for (let by = by0; by <= by1; by++) {
      for (let bx = bx0; bx <= bx1; bx++) {
        const t = this.canopyIdx[by]?.[bx] ?? 0;
        if (!t) continue;
        this.forest.draw(ctx, t, Math.round(view.toScreenX(bx * 2)), Math.round(view.toScreenY(by * 2)), s);
      }
    }
  }
}
