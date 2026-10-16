/**
 * A map in format 3 (assets/maps/<name>.json, built by scripts/fantasy), drawn
 * with The Fan-tasy Tileset the way the artist stacks it in Tiled: ground,
 * roads, water, shadows at reduced opacity, cliffs, fences, animated tiles,
 * flat decals (shadows, grass patches) and upright objects (trees, buildings,
 * props) depth-sorted with the characters.
 *
 * Every tile the map uses is packed into one atlas; layers are run-length
 * encoded atlas indices (+1). The tile layers and decals are baked into 8x8
 * tile chunks at 1x. A chunk with animated tiles is baked once per distinct
 * animation state it shows and cached (a few states per chunk), so the layer
 * order stays exact.
 */
import type { View } from '../render/view';
import type { Assets } from '../sprites/assets';
import type { Biome, DecorItem, GroundRenderer } from './types';

const CHUNK = 8;
const STATE_CACHE = 24;
/** Biome codes in the file's biome grid. */
export const BIOME_CODES: Biome[] = ['water', 'meadow', 'forest', 'shore', 'snow', 'desert', 'autumn', 'castle'];
const MINIMAP: Record<string, string> = {
  w: '#3d7fc4', // water
  g: '#74c25a', // grass
  f: '#2f7a3a', // forest
  s: '#e3cf86', // sand
  n: '#eef4f8', // snow
  a: '#d7783a', // autumn
  p: '#c8a06a', // road
  c: '#9a5a3a', // cliff
  k: '#b9b2a6', // castle stone
  b: '#8a6a4a', // buildings
};

type Decal = [number, number, number, number, number, number, number];
type Obj = [number, number, number, number, number, number, number, number];

interface StackItem {
  kind: 'tiles' | 'decals';
  name: string;
  opacity: number;
  rle?: number[];
  decals?: Decal[];
}

export interface FanMapFile {
  version: 3;
  name: string;
  cols: number;
  rows: number;
  tileSize: number;
  atlas: { src: string; columns: number };
  anims: Record<string, Array<[number, number]>>;
  sheets: string[];
  stack: StackItem[];
  objects: Obj[];
  walkable: string[];
  reachable: string[];
  biome: string[];
  minimap: string[];
  stairs?: Array<[number, number]>;
  center: { x: number; y: number };
  outposts: Array<{ x: number; y: number }>;
  spawns: Array<{ x: number; y: number }>;
  credits?: string;
  npcs?: unknown;
  shops?: unknown;
  arena?: unknown;
}

interface Anim {
  frames: number[];
  ends: number[];
  total: number;
}

interface Chunk {
  still: HTMLCanvasElement | null;
  /** Animated cells: stack index, cell x, y in the chunk, base atlas index. */
  anim: Array<[number, number, number, number]>;
  /** Decals touching this chunk, per stack index. */
  decals: Map<number, Decal[]>;
  states: Map<string, HTMLCanvasElement>;
}

export class FanGround implements GroundRenderer {
  readonly tileSize = 16;
  readonly label: string;
  readonly decor: DecorItem[] = [];
  readonly outposts: Array<{ x: number; y: number }>;
  readonly spawns: Array<{ x: number; y: number }>;
  readonly cols: number;
  readonly rows: number;
  readonly center: { x: number; y: number };
  readonly features: GroundRenderer['features'];
  private walk: Uint8Array;
  private reach: Uint8Array;
  private biomes: Uint8Array;
  private stairCells = new Set<number>();
  private layers: Array<Int32Array | null> = [];
  private anims = new Map<number, Anim>();
  private chunks: Chunk[] = [];
  private chunkCols: number;
  private chunkRows: number;
  private time = 0;

  private constructor(readonly map: FanMapFile, private readonly atlas: CanvasImageSource, private readonly sheets: CanvasImageSource[]) {
    this.cols = map.cols;
    this.rows = map.rows;
    this.label = `${map.name} · ${map.cols}x${map.rows} · ${map.credits ?? 'The Fan-tasy Tileset'} at 3x`;
    this.outposts = map.outposts.map((p) => ({ ...p }));
    this.spawns = map.spawns.map((p) => ({ ...p }));
    this.center = map.center;
    this.features = {
      npcs: (map.npcs as NonNullable<GroundRenderer['features']>['npcs']) ?? [],
      arena: map.arena as NonNullable<GroundRenderer['features']>['arena'],
      finalArena: (map as { finalArena?: { x0: number; y0: number; x1: number; y1: number } }).finalArena,
      towns: (map as { towns?: Array<{ name: string; x: number; y: number }> }).towns ?? [],
      lake: (map as { lake?: { x: number; y: number; rx: number; ry: number } }).lake,
    };
    this.chunkCols = Math.ceil(this.cols / CHUNK);
    this.chunkRows = Math.ceil(this.rows / CHUNK);
    const n = this.cols * this.rows;
    this.walk = new Uint8Array(n);
    this.reach = new Uint8Array(n);
    this.biomes = new Uint8Array(n);
    for (let y = 0; y < this.rows; y++) {
      const wr = map.walkable[y] ?? '';
      const rr = map.reachable[y] ?? '';
      const br = map.biome[y] ?? '';
      for (let x = 0; x < this.cols; x++) {
        const i = y * this.cols + x;
        this.walk[i] = wr.charCodeAt(x) === 49 ? 1 : 0;
        this.reach[i] = rr.charCodeAt(x) === 49 ? 1 : 0;
        this.biomes[i] = Math.max(0, (br.charCodeAt(x) || 48) - 48);
      }
    }
    for (const [x, y] of map.stairs ?? []) this.stairCells.add(y * this.cols + x);
    for (const [k, seq] of Object.entries(map.anims)) {
      let t = 0;
      const ends: number[] = [];
      for (const [, ms] of seq) ends.push((t += ms));
      this.anims.set(Number(k), { frames: seq.map((s) => s[0]), ends, total: t });
    }
    for (const item of map.stack) this.layers.push(item.kind === 'tiles' && item.rle ? decodeRle(item.rle, n) : null);
  }

  static async load(assets: Assets, name: string, onProgress?: (p: number) => void): Promise<FanGround | null> {
    const map = await assets.json<FanMapFile>(`maps/${name}.json`);
    if (!map || map.version !== 3) return null;
    const [atlas, ...sheets] = await Promise.all([assets.loadImage(map.atlas.src), ...map.sheets.map((s) => assets.loadImage(s))]);
    const ph = assets.placeholder('map', 16, 16);
    const g = new FanGround(map, atlas ?? ph, sheets.map((s) => s ?? ph));
    g.indexChunks();
    g.buildDecor();
    const total = g.chunkCols * g.chunkRows;
    for (let i = 0; i < total; i++) {
      const c = g.chunks[i] as Chunk;
      if (!c.anim.length) c.still = g.bake(i, 0);
      if (i % (g.chunkCols * 4) === 0) {
        onProgress?.((i + 1) / total);
        await new Promise((res) => setTimeout(res, 0));
      }
    }
    onProgress?.(1);
    return g;
  }

  private idx(x: number, y: number): number {
    return y * this.cols + x;
  }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.cols && y < this.rows;
  }

  private indexChunks(): void {
    for (let cr = 0; cr < this.chunkRows; cr++) {
      for (let cc = 0; cc < this.chunkCols; cc++) {
        const anim: Chunk['anim'] = [];
        this.layers.forEach((layer, li) => {
          if (!layer) return;
          for (let ty = 0; ty < CHUNK; ty++) {
            const y = cr * CHUNK + ty;
            if (y >= this.rows) break;
            for (let tx = 0; tx < CHUNK; tx++) {
              const x = cc * CHUNK + tx;
              if (x >= this.cols) break;
              const v = layer[y * this.cols + x] ?? 0;
              if (v && this.anims.has(v - 1)) anim.push([li, tx, ty, v - 1]);
            }
          }
        });
        this.chunks.push({ still: null, anim, decals: new Map(), states: new Map() });
      }
    }
    this.map.stack.forEach((item, li) => {
      if (item.kind !== 'decals') return;
      for (const d of item.decals ?? []) {
        const [, , , w, h, x, y] = d;
        const c0 = Math.max(0, Math.floor(x / 16 / CHUNK));
        const c1 = Math.min(this.chunkCols - 1, Math.floor((x + w) / 16 / CHUNK));
        const r0 = Math.max(0, Math.floor(y / 16 / CHUNK));
        const r1 = Math.min(this.chunkRows - 1, Math.floor((y + h) / 16 / CHUNK));
        for (let r = r0; r <= r1; r++) {
          for (let c = c0; c <= c1; c++) {
            const ch = this.chunks[r * this.chunkCols + c] as Chunk;
            let list = ch.decals.get(li);
            if (!list) ch.decals.set(li, (list = []));
            list.push(d);
          }
        }
      }
    });
  }

  private frameOf(atlasIndex: number, ms: number): number {
    const a = this.anims.get(atlasIndex);
    if (!a) return atlasIndex;
    const t = ms % a.total;
    for (let i = 0; i < a.ends.length; i++) if (t < (a.ends[i] as number)) return a.frames[i] as number;
    return a.frames[a.frames.length - 1] as number;
  }

  /** All layers of chunk `i` at 1x, animated tiles shown at time `ms`. */
  private bake(i: number, ms: number): HTMLCanvasElement {
    const cc = i % this.chunkCols;
    const cr = Math.floor(i / this.chunkCols);
    const c = document.createElement('canvas');
    c.width = CHUNK * 16;
    c.height = CHUNK * 16;
    const ctx = c.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    const ac = this.map.atlas.columns;
    const chunk = this.chunks[i] as Chunk;
    this.map.stack.forEach((item, li) => {
      ctx.globalAlpha = item.opacity;
      const layer = this.layers[li];
      if (layer) {
        for (let ty = 0; ty < CHUNK; ty++) {
          const y = cr * CHUNK + ty;
          if (y >= this.rows) break;
          for (let tx = 0; tx < CHUNK; tx++) {
            const x = cc * CHUNK + tx;
            if (x >= this.cols) break;
            const v = layer[y * this.cols + x] ?? 0;
            if (!v) continue;
            const a = this.frameOf(v - 1, ms);
            ctx.drawImage(this.atlas, (a % ac) * 16, Math.floor(a / ac) * 16, 16, 16, tx * 16, ty * 16, 16, 16);
          }
        }
      } else {
        for (const [s, sx, sy, w, h, x, y] of chunk.decals.get(li) ?? []) {
          const img = this.sheets[s];
          if (img) ctx.drawImage(img, sx, sy, w, h, x - cc * CHUNK * 16, y - cr * CHUNK * 16, w, h);
        }
      }
    });
    ctx.globalAlpha = 1;
    return c;
  }

  private chunkCanvas(i: number): HTMLCanvasElement | null {
    const c = this.chunks[i];
    if (!c) return null;
    if (c.still) return c.still;
    const ms = this.time * 1000;
    let key = '';
    for (const a of c.anim) key += this.frameOf(a[3], ms) + ',';
    let canvas = c.states.get(key);
    if (!canvas) {
      canvas = this.bake(i, ms);
      if (c.states.size >= STATE_CACHE) c.states.delete(c.states.keys().next().value as string);
      c.states.set(key, canvas);
    }
    return canvas;
  }

  private buildDecor(): void {
    for (const [s, sx, sy, w, h, x, y, sort] of this.map.objects) {
      const img = this.sheets[s];
      if (!img) continue;
      this.decor.push({
        kind: 'prop',
        x: (x + w / 2) / 16,
        y: (y + h) / 16,
        image: img,
        srcX: sx,
        srcY: sy,
        frameW: w,
        frameH: h,
        frames: 1,
        fps: 0,
        anchorX: w / 2,
        anchorY: h,
        blockRadius: 0,
        sortY: sort,
        extent: Math.ceil(Math.max(w, h) / 16) + 1,
      });
    }
    this.decor.sort((a, b) => (a.sortY ?? a.y) - (b.sortY ?? b.y));
  }

  biomeAt(tx: number, ty: number): Biome {
    if (!this.inBounds(tx, ty)) return 'water';
    return BIOME_CODES[this.biomes[this.idx(tx, ty)] ?? 0] ?? 'water';
  }

  inWater(tx: number, ty: number): boolean {
    return this.biomeAt(tx, ty) === 'water';
  }

  walkable(tx: number, ty: number): boolean {
    return this.inBounds(tx, ty) && this.walk[this.idx(tx, ty)] === 1;
  }

  reachable(tx: number, ty: number): boolean {
    return this.inBounds(tx, ty) && this.reach[this.idx(tx, ty)] === 1;
  }

  onStairs(tx: number, ty: number): boolean {
    return this.inBounds(tx, ty) && this.stairCells.has(this.idx(tx, ty));
  }

  underCanopy(): boolean {
    return false;
  }

  minimapColor(tx: number, ty: number): string {
    if (!this.inBounds(tx, ty)) return MINIMAP.w as string;
    return MINIMAP[(this.map.minimap[ty] ?? '')[tx] ?? 'w'] ?? (MINIMAP.g as string);
  }

  update(dt: number): void {
    this.time += dt;
  }

  drawGround(view: View): void {
    const ctx = view.ctx;
    ctx.imageSmoothingEnabled = false;
    const vis = view.visibleTiles();
    const x0 = Math.max(0, Math.floor(vis.x0));
    const y0 = Math.max(0, Math.floor(vis.y0));
    const x1 = Math.min(this.cols - 1, Math.ceil(vis.x1));
    const y1 = Math.min(this.rows - 1, Math.ceil(vis.y1));
    // Chunk edges snap to whole screen pixels from both ends, so a fractional zoom leaves no seams.
    for (let cr = Math.floor(y0 / CHUNK); cr <= Math.floor(y1 / CHUNK); cr++) {
      for (let cc = Math.floor(x0 / CHUNK); cc <= Math.floor(x1 / CHUNK); cc++) {
        const canvas = this.chunkCanvas(cr * this.chunkCols + cc);
        if (!canvas) continue;
        const sx0 = Math.round(view.toScreenX(cc * CHUNK));
        const sy0 = Math.round(view.toScreenY(cr * CHUNK));
        const sx1 = Math.round(view.toScreenX((cc + 1) * CHUNK));
        const sy1 = Math.round(view.toScreenY((cr + 1) * CHUNK));
        ctx.drawImage(canvas, sx0, sy0, sx1 - sx0, sy1 - sy0);
      }
    }
  }

  drawCanopy(): void {
    // Trees are depth-sorted objects; there is no canopy layer.
  }
}

function decodeRle(rle: number[], n: number): Int32Array {
  const out = new Int32Array(n);
  let p = 0;
  for (let i = 0; i + 1 < rle.length; i += 2) {
    const v = rle[i] as number;
    const k = rle[i + 1] as number;
    if (v) out.fill(v, p, p + k);
    p += k;
  }
  return out;
}
