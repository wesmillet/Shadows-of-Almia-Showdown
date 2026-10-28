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
 * animation state it shows, so the layer order stays exact; those frames share
 * one capped cache (chunkCanvas) so memory stays flat over a long match.
 */
import type { View } from '../render/view';
import { imagePixels, type Assets } from '../sprites/assets';
import type { Biome, DecorItem, GroundRenderer } from './types';

const CHUNK = 8;
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
}

export class FanGround implements GroundRenderer {
  readonly tileSize = 16;
  readonly label: string;
  readonly mapName: string;
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
  /**
   * The centre blend (scripts/mapgen/center_blend.py): per-pixel colour multipliers (byte / 85) over
   * one rectangle of the map, in map pixels, applied when ground chunks bake; null without one.
   */
  private blend: { x: number; y: number; w: number; h: number; px: Uint8ClampedArray } | null = null;
  /** The paving overlay (see load), in map pixels. */
  private overlay: { x: number; y: number; w: number; h: number; img: CanvasImageSource } | null = null;
  /** Stack layers left out (preview tool only). */
  private skip = new Set<string>();

  private constructor(readonly map: FanMapFile, private readonly atlas: CanvasImageSource, private readonly sheets: CanvasImageSource[]) {
    this.cols = map.cols;
    this.rows = map.rows;
    this.mapName = map.name;
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

  /**
   * The map without any pictures, for the game server: walkability, biomes, stairs, features and
   * spawn points only (nothing is baked or drawn). Objects are decorative (blockRadius 0), so
   * collision is identical to the drawn map.
   */
  static headless(map: FanMapFile): FanGround {
    return new FanGround(map, null as unknown as CanvasImageSource, []);
  }

  /**
   * `opts` (the map preview tool, src/tools/mapshot.ts): blend / overlay false draw without the
   * centre blend or the paving overlay, skip leaves out stack layers by name.
   */
  static async load(
    assets: Assets,
    name: string,
    onProgress?: (p: number) => void,
    opts: { blend?: boolean; overlay?: boolean; skip?: string[] } = {},
  ): Promise<FanGround | null> {
    const withBlend = opts.blend !== false;
    const map = await assets.json<FanMapFile>(`maps/${name}.json`);
    if (!map || map.version !== 3) return null;
    const [atlas, ...sheets] = await Promise.all([assets.loadImage(map.atlas.src), ...map.sheets.map((s) => assets.loadImage(s))]);
    const ph = assets.placeholder('map', 16, 16);
    const g = new FanGround(map, atlas ?? ph, sheets.map((s) => s ?? ph));
    // The centre blend is optional: a map without one draws as it is.
    const [rect, blendImg] = await Promise.all([
      assets.json<{ x: number; y: number; w: number; h: number }>(`maps/${name}_blend.json`),
      assets.loadImage(`maps/${name}_blend.png`),
    ]);
    if (withBlend && rect && blendImg && blendImg.naturalWidth === rect.w && blendImg.naturalHeight === rect.h) {
      try {
        g.blend = { ...rect, px: imagePixels(blendImg) };
      } catch {
        g.blend = null;
      }
    }
    // The paving overlay (scripts/mapgen/pave_smooth.py): smooth curved edges for the courtyard
    // and arena paving, drawn over the tiles before the blend. Optional too.
    if (opts.overlay !== false) {
      const [orect, oimg] = await Promise.all([
        assets.json<{ x: number; y: number; w: number; h: number }>(`maps/${name}_overlay.json`),
        assets.loadImage(`maps/${name}_overlay.png`),
      ]);
      if (orect && oimg && oimg.naturalWidth === orect.w && oimg.naturalHeight === orect.h) g.overlay = { ...orect, img: oimg };
    }
    g.skip = new Set(opts.skip ?? []);
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
        this.chunks.push({ still: null, anim, decals: new Map() });
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

  /**
   * All layers of chunk `i` at 1x, animated tiles shown at time `ms`, into `into` (a frame evicted
   * from the cache, reused) or a new canvas. Null if the browser will not give a canvas (out of
   * canvas memory): that chunk is skipped this frame instead of breaking the draw.
   */
  private bake(i: number, ms: number, into?: HTMLCanvasElement): HTMLCanvasElement | null {
    const cc = i % this.chunkCols;
    const cr = Math.floor(i / this.chunkCols);
    const c = into ?? document.createElement('canvas');
    if (!into) {
      c.width = CHUNK * 16;
      c.height = CHUNK * 16;
    }
    const ctx = c.getContext('2d');
    if (!ctx) return null;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.imageSmoothingEnabled = false;
    const ac = this.map.atlas.columns;
    const chunk = this.chunks[i] as Chunk;
    const drawOverlay = () => {
      const o = this.overlay;
      if (!o) return;
      const x0 = cc * CHUNK * 16;
      const y0 = cr * CHUNK * 16;
      const ix0 = Math.max(x0, o.x);
      const iy0 = Math.max(y0, o.y);
      const ix1 = Math.min(x0 + c.width, o.x + o.w);
      const iy1 = Math.min(y0 + c.height, o.y + o.h);
      if (ix1 > ix0 && iy1 > iy0) ctx.drawImage(o.img, ix0 - o.x, iy0 - o.y, ix1 - ix0, iy1 - iy0, ix0 - x0, iy0 - y0, ix1 - ix0, iy1 - iy0);
    };
    let overlayDrawn = false;
    this.map.stack.forEach((item, li) => {
      if (this.skip.size && this.skip.has(item.name)) return;
      // the paving overlay goes under the animated props (torches and braziers stand on the paving)
      if (item.name === 'Animations' && !overlayDrawn) {
        ctx.globalAlpha = 1;
        drawOverlay();
        overlayDrawn = true;
      }
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
      } else if (item.name.endsWith('Shadows')) {
        // Shadow discs are drawn as one shape and faded once, so where two overlap the ground
        // is not shaded twice (each disc at the layer's opacity left dark lenses where trees stand close).
        const list = chunk.decals.get(li);
        if (list?.length) {
          const sc = this.shadeScratch(c.width, c.height);
          const sctx = sc.getContext('2d') as CanvasRenderingContext2D;
          sctx.clearRect(0, 0, sc.width, sc.height);
          for (const [s, sx, sy, w, h, x, y] of list) {
            const img = this.sheets[s];
            if (img) sctx.drawImage(img, sx, sy, w, h, x - cc * CHUNK * 16, y - cr * CHUNK * 16, w, h);
          }
          ctx.drawImage(sc, 0, 0, c.width, c.height, 0, 0, c.width, c.height);
        }
      } else {
        for (const [s, sx, sy, w, h, x, y] of chunk.decals.get(li) ?? []) {
          const img = this.sheets[s];
          if (img) ctx.drawImage(img, sx, sy, w, h, x - cc * CHUNK * 16, y - cr * CHUNK * 16, w, h);
        }
      }
    });
    ctx.globalAlpha = 1;
    if (!overlayDrawn) drawOverlay();
    this.applyBlend(ctx, cc * CHUNK * 16, cr * CHUNK * 16, c.width, c.height);
    return c;
  }

  private shadeCanvas: HTMLCanvasElement | null = null;

  /** A scratch canvas at least w x h for drawing a chunk's shadow discs before fading them. */
  private shadeScratch(w: number, h: number): HTMLCanvasElement {
    let sc = this.shadeCanvas;
    if (!sc || sc.width < w || sc.height < h) {
      sc = document.createElement('canvas');
      sc.width = w;
      sc.height = h;
      this.shadeCanvas = sc;
    }
    return sc;
  }

  /** Multiplies a freshly baked chunk (map pixels x0, y0) by the centre blend where they overlap. */
  private applyBlend(ctx: CanvasRenderingContext2D, x0: number, y0: number, w: number, h: number): void {
    const b = this.blend;
    if (!b) return;
    const ix0 = Math.max(x0, b.x);
    const iy0 = Math.max(y0, b.y);
    const ix1 = Math.min(x0 + w, b.x + b.w);
    const iy1 = Math.min(y0 + h, b.y + b.h);
    if (ix1 <= ix0 || iy1 <= iy0) return;
    // Skip chunks the blend leaves unchanged (most of the rectangle).
    let any = false;
    for (let y = iy0; y < iy1 && !any; y += 2) {
      let o = ((y - b.y) * b.w + (ix0 - b.x)) * 4;
      for (let x = ix0; x < ix1; x += 2, o += 8) {
        if (b.px[o] !== 85 || b.px[o + 1] !== 85 || b.px[o + 2] !== 85) {
          any = true;
          break;
        }
      }
    }
    if (!any) return;
    let img: ImageData;
    try {
      img = ctx.getImageData(ix0 - x0, iy0 - y0, ix1 - ix0, iy1 - iy0);
    } catch {
      return;
    }
    const d = img.data;
    const rw = ix1 - ix0;
    for (let y = iy0; y < iy1; y++) {
      let o = ((y - b.y) * b.w + (ix0 - b.x)) * 4;
      let q = (y - iy0) * rw * 4;
      for (let x = ix0; x < ix1; x++, o += 4, q += 4) {
        const mr = b.px[o] as number;
        const mg = b.px[o + 1] as number;
        const mb = b.px[o + 2] as number;
        if (mr === 85 && mg === 85 && mb === 85) continue;
        d[q] = Math.min(255, ((d[q] as number) * mr) / 85);
        d[q + 1] = Math.min(255, ((d[q + 1] as number) * mg) / 85);
        d[q + 2] = Math.min(255, ((d[q + 2] as number) * mb) / 85);
      }
    }
    ctx.putImageData(img, ix0 - x0, iy0 - y0);
  }

  /**
   * Baked animation frames of every chunk, least recently drawn first. One shared cache with a cap
   * (frameCap: enough for every chunk on screen through its whole cycle) whose evicted canvases are
   * reused for new frames, so memory stays flat however much of the island is explored. (Keeping
   * frames per chunk grew without bound over a match, past what browsers allow for canvases, and
   * chunks then drew blank.)
   */
  private frames = new Map<string, HTMLCanvasElement>();
  private frameCap = 480;

  private chunkCanvas(i: number): HTMLCanvasElement | null {
    const c = this.chunks[i];
    if (!c) return null;
    if (c.still) return c.still;
    const ms = this.time * 1000;
    let key = `${i}|`;
    for (const a of c.anim) key += this.frameOf(a[3], ms) + ',';
    const hit = this.frames.get(key);
    if (hit) {
      // Most recently drawn goes to the back of the queue.
      this.frames.delete(key);
      this.frames.set(key, hit);
      return hit;
    }
    let reuse: HTMLCanvasElement | undefined;
    if (this.frames.size >= this.frameCap) {
      const oldest = this.frames.keys().next().value as string;
      reuse = this.frames.get(oldest);
      this.frames.delete(oldest);
    }
    const canvas = this.bake(i, ms, reuse);
    if (canvas) this.frames.set(key, canvas);
    return canvas;
  }

  private buildDecor(): void {
    // The market stands: the objects a vendor stands at (standX inside it, its foot on standY).
    const vendors = ((this.map.npcs as Array<{ role?: string; standX?: number; standY?: number }> | undefined) ?? []).filter((n) => n.role === 'vendor' && n.standX !== undefined && n.standY !== undefined);
    const isStand = (x: number, y: number, w: number, h: number) =>
      vendors.some((n) => (n.standX as number) * 16 >= x && (n.standX as number) * 16 <= x + w && Math.abs(y + h - (n.standY as number) * 16) <= 2);
    for (const [s, sx, sy, w, h, x, y, sort] of this.map.objects) {
      const img = this.sheets[s];
      if (!img) continue;
      // A market stand gets a taller canopy, so its vendor stands under the roof instead of in front of it.
      const tall = isStand(x, y, w, h) ? raisedStand(img, sx, sy, w, h, STAND_RAISE) : null;
      const fh = tall ? h + STAND_RAISE : h;
      this.decor.push({
        kind: 'prop',
        x: (x + w / 2) / 16,
        y: (y + h) / 16,
        image: tall ?? img,
        srcX: tall ? 0 : sx,
        srcY: tall ? 0 : sy,
        frameW: w,
        frameH: fh,
        frames: 1,
        fps: 0,
        anchorX: w / 2,
        anchorY: fh,
        blockRadius: 0,
        sortY: sort,
        extent: Math.ceil(Math.max(w, fh) / 16) + 1,
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

  block(tx: number, ty: number): void {
    if (this.inBounds(tx, ty)) this.walk[this.idx(tx, ty)] = 0;
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
    // The frame cache holds every chunk on screen through its whole animation cycle (16 states at most).
    const onScreen = (Math.floor(y1 / CHUNK) - Math.floor(y0 / CHUNK) + 1) * (Math.floor(x1 / CHUNK) - Math.floor(x0 / CHUNK) + 1);
    this.frameCap = Math.max(480, onScreen * 18);
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

/** How many pixels higher a market stand's canopy sits (its posts grow to match). */
const STAND_RAISE = 17;

/**
 * A market stand redrawn with its canopy `raise` pixels higher: the stand is cut at the last
 * row under the canopy where only its two posts show (nothing in the middle), the canopy above
 * is lifted, and that posts-only row is repeated to fill the gap. Null if the art has no such
 * row, or there is no canvas (the test runner); the stand is then drawn as it is.
 */
function raisedStand(img: CanvasImageSource, sx: number, sy: number, w: number, h: number, raise: number): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null;
  const src = document.createElement('canvas');
  src.width = w;
  src.height = h;
  const sctx = src.getContext('2d', { willReadFrequently: true });
  if (!sctx) return null;
  sctx.drawImage(img, sx, sy, w, h, 0, 0, w, h);
  let data: Uint8ClampedArray;
  try {
    data = sctx.getImageData(0, 0, w, h).data;
  } catch {
    return null;
  }
  const x0 = Math.floor(w * 0.2);
  const x1 = Math.ceil(w * 0.8);
  const clear = (y: number) => {
    for (let x = x0; x < x1; x++) if ((data[(y * w + x) * 4 + 3] ?? 0) > 20) return false;
    return true;
  };
  // The last clear row of the first clear run below the canopy (just above the counter).
  let cut = -1;
  for (let y = Math.floor(h * 0.4); y < Math.floor(h * 0.9); y++) {
    if (clear(y)) cut = y;
    else if (cut >= 0) break;
  }
  if (cut < 0) return null;
  const out = document.createElement('canvas');
  out.width = w;
  out.height = h + raise;
  const ctx = out.getContext('2d');
  if (!ctx) return null;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(src, 0, 0, w, cut, 0, 0, w, cut);
  for (let k = 0; k < raise; k++) ctx.drawImage(src, 0, cut, w, 1, 0, cut + k, w, 1);
  ctx.drawImage(src, 0, cut, w, h - cut, 0, cut + raise, w, h - cut);
  return out;
}
