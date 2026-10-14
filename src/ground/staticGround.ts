/**
 * A pre-authored map from assets/maps/<name>.json (format 2, built by
 * scripts/mapgen). Every tile is already resolved, so this renderer only
 * stacks the layers (sea, land, paths, bridge decks, shadows, ground decor)
 * into 8x8-tile chunks at 1x and draws them at the view's integer scale.
 *
 * Tiles are stored as `index | flags << 12` (flags: 1 mirror, 2 flip,
 * 4 rotate 90 degrees clockwise, as GameMaker exports them).
 *
 * Animated tiles (sea foam, river, waterfalls) make a chunk animated: each
 * distinct animation state of such a chunk is baked once, on first use, and
 * reused, so the layer order stays exact (a bridge deck stays above the water
 * it crosses).
 *
 * Buildings and other multi-tile objects are baked into canvases and handed
 * to the world renderer as decor, depth-sorted with the characters, together
 * with the pack's sprites (trees, animals, boats, crops, the windmills).
 * Walkability, reachability, biomes and the minimap come straight from the
 * file.
 */
import type { View } from '../render/view';
import type { Assets } from '../sprites/assets';
import { Tileset, type TilesetDef } from './sunnyside';
import type { Biome, DecorItem, GroundRenderer } from './types';

const CHUNK = 8;
const SEA_SPARKLE = [212, 215];
const BIOME_CODES: Biome[] = ['water', 'meadow', 'forest', 'shore'];
/** The longest tile animation in the pack has 16 frames; every state of a chunk repeats within that. */
const ANIM_PERIOD = 16;
const MINIMAP: Record<string, string> = {
  w: '#2a6fb5',
  g: '#6cc24a',
  s: '#e3cf86',
  f: '#2f7a3a',
  p: '#c8a06a',
  b: '#b0563c',
  c: '#9a5a3a',
};

type Enc = number;

export interface MapPrefab {
  w: number;
  h: number;
  layers: Enc[][][];
}

export interface MapSpriteDef {
  src: string;
  w: number;
  h: number;
  frames: number;
  fps: number;
}

export interface MapSprite {
  s: string;
  /** Anchor position in map pixels (16 per tile). */
  x: number;
  y: number;
  /** Anchor inside the frame, in source pixels. */
  ax: number;
  ay: number;
  /** Depth in tiles. */
  z: number;
  f?: number;
  fr?: number;
}

export interface MapFile {
  version: number;
  name: string;
  seed: number;
  cols: number;
  rows: number;
  tileSize: number;
  tileset: string;
  tilesetColumns: number;
  layers: Array<{ name: string; tiles: Enc[][] }>;
  prefabs: Record<string, MapPrefab>;
  objects: Array<[string, number, number]>;
  spriteDefs: Record<string, MapSpriteDef>;
  sprites: MapSprite[];
  walkable: string[];
  reachable: string[];
  biome: string[];
  minimap: string[];
  center: { x: number; y: number };
  outposts: Array<{ x: number; y: number }>;
  spawns: Array<{ x: number; y: number }>;
}

interface Chunk {
  /** Baked canvas for a chunk without animated tiles. */
  still: HTMLCanvasElement | null;
  /** Animated cells: layer index, x, y, encoded tile. */
  anim: Array<[number, number, number, Enc]>;
  /** Baked states of an animated chunk, keyed by the frames its animated tiles show. */
  states: Map<string, HTMLCanvasElement>;
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
  private mini: string[];
  private chunks: Chunk[] = [];
  private chunkCols: number;
  private chunkRows: number;
  private time = 0;
  private sparkles: Array<{ x: number; y: number; phase: number }> = [];

  private constructor(private readonly map: MapFile, private readonly main: Tileset) {
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
    this.mini = map.minimap;
  }

  static async load(assets: Assets, name: string, onProgress?: (p: number) => void): Promise<StaticGround | null> {
    const map = await assets.json<MapFile>(`maps/${name}.json`);
    if (!map || map.version !== 2) return null;
    const data = await assets.json<{ tilesets: Record<string, TilesetDef> }>('tiles/sunnyside/sunnyside.json');
    const mainDef = data?.tilesets.tileset_sunnysideworld;
    if (!mainDef) return null;
    mainDef.columns = map.tilesetColumns;
    const mainImg = await assets.loadImage(map.tileset);
    const main = new Tileset(mainDef, mainImg, assets.placeholder('tile', 16, 16));
    main.indexAnimations();
    const g = new StaticGround(map, main);
    g.indexChunks();
    await g.buildDecor(assets);
    g.seedSparkles();
    const total = g.chunkCols * g.chunkRows;
    for (let i = 0; i < total; i++) {
      const c = g.chunks[i] as Chunk;
      if (!c.anim.length) c.still = g.bake(i, null);
      if (i % g.chunkCols === g.chunkCols - 1) {
        onProgress?.((i + 1) / total);
        await new Promise((res) => setTimeout(res, 0));
      }
    }
    return g;
  }

  private idx(x: number, y: number): number {
    return y * this.cols + x;
  }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.cols && y < this.rows;
  }

  /** Which cells of each chunk hold animated tiles. */
  private indexChunks(): void {
    for (let cr = 0; cr < this.chunkRows; cr++) {
      for (let cc = 0; cc < this.chunkCols; cc++) {
        const anim: Chunk['anim'] = [];
        this.map.layers.forEach((layer, li) => {
          for (let ty = 0; ty < CHUNK; ty++) {
            for (let tx = 0; tx < CHUNK; tx++) {
              const e = layer.tiles[cr * CHUNK + ty]?.[cc * CHUNK + tx] ?? 0;
              if (e && this.main.isAnimated(e & 4095)) anim.push([li, tx, ty, e]);
            }
          }
        });
        this.chunks.push({ still: null, anim, states: new Map() });
      }
    }
  }

  /** All layers of chunk `i` at 1x; `frameTime` picks the animation state (null: first frames). */
  private bake(i: number, frameTime: number | null): HTMLCanvasElement {
    const cc = i % this.chunkCols;
    const cr = Math.floor(i / this.chunkCols);
    const c = document.createElement('canvas');
    c.width = CHUNK * 16;
    c.height = CHUNK * 16;
    const ctx = c.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    for (const layer of this.map.layers) {
      for (let ty = 0; ty < CHUNK; ty++) {
        const row = layer.tiles[cr * CHUNK + ty];
        if (!row) continue;
        for (let tx = 0; tx < CHUNK; tx++) {
          const e = row[cc * CHUNK + tx] ?? 0;
          if (!e) continue;
          let t = e & 4095;
          if (frameTime !== null) t = this.main.animated(t, frameTime);
          this.main.draw(ctx, t, tx * 16, ty * 16, 1, e >> 12);
        }
      }
    }
    return c;
  }

  private chunkCanvas(i: number): HTMLCanvasElement | null {
    const c = this.chunks[i];
    if (!c) return null;
    if (c.still) return c.still;
    const fps = this.main.def.frame_duration_s || 5;
    const step = Math.floor(this.time * fps) % ANIM_PERIOD;
    const t = (step + 0.5) / fps;
    let key = '';
    for (const a of c.anim) key += this.main.animated(a[3] & 4095, t) + ',';
    let canvas = c.states.get(key);
    if (!canvas) {
      canvas = this.bake(i, t);
      c.states.set(key, canvas);
    }
    return canvas;
  }

  private seedSparkles(): void {
    let s = 0x5ea1 ^ this.map.seed;
    const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
    for (let k = 0; k < (this.cols * this.rows) / 18; k++) {
      const x = Math.floor(rnd() * this.cols);
      const y = Math.floor(rnd() * this.rows);
      if ((this.mini[y] ?? '')[x] === 'w' && this.biomes[this.idx(x, y)] === 0) this.sparkles.push({ x, y, phase: rnd() * 10 });
    }
  }

  /** A multi-tile object baked to a canvas; animated tiles (bushes) become a frame strip. */
  private bakePrefab(p: MapPrefab): { canvas: HTMLCanvasElement; frames: number } {
    let animated = false;
    for (const l of p.layers) for (const r of l) for (const e of r) if (e && this.main.isAnimated(e & 4095)) animated = true;
    const frames = animated ? 4 : 1;
    const fps = this.main.def.frame_duration_s || 5;
    const c = document.createElement('canvas');
    c.width = p.w * 16 * frames;
    c.height = p.h * 16;
    const ctx = c.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    for (let f = 0; f < frames; f++) {
      for (const l of p.layers) {
        l.forEach((row, y) =>
          row.forEach((e, x) => {
            if (!e) return;
            const t = animated ? this.main.animated(e & 4095, (f + 0.5) / fps) : e & 4095;
            this.main.draw(ctx, t, f * p.w * 16 + x * 16, y * 16, 1, e >> 12);
          }),
        );
      }
    }
    return { canvas: c, frames };
  }

  private async buildDecor(assets: Assets): Promise<void> {
    const fps = this.main.def.frame_duration_s || 5;
    const baked = new Map<string, { canvas: HTMLCanvasElement; frames: number }>();
    for (const [key, x, y] of this.map.objects) {
      const p = this.map.prefabs[key];
      if (!p) continue;
      let b = baked.get(key);
      if (!b) {
        b = this.bakePrefab(p);
        baked.set(key, b);
      }
      // anchored at the bottom centre; sorted by the bottom edge
      this.decor.push({
        kind: p.w * p.h >= 9 ? 'building' : 'prop',
        x: x + p.w / 2,
        y: y + p.h,
        image: b.canvas,
        frameW: p.w * 16,
        frameH: p.h * 16,
        frames: b.frames,
        fps,
        anchorX: (p.w * 16) / 2,
        anchorY: p.h * 16,
        blockRadius: 0,
        phase: (x * 7 + y * 3) % 4,
        extent: Math.max(p.w, p.h),
      });
    }
    const images = new Map<string, HTMLImageElement | null>();
    await Promise.all(
      Object.entries(this.map.spriteDefs).map(async ([name, d]) => {
        images.set(name, await assets.loadImage(d.src));
      }),
    );
    for (const s of this.map.sprites) {
      const d = this.map.spriteDefs[s.s];
      if (!d) continue;
      const img = images.get(s.s) ?? null;
      this.decor.push({
        kind: s.s.startsWith('spr_deco_tree') ? 'tree' : 'prop',
        x: s.x / 16,
        y: s.y / 16,
        image: img ?? assets.placeholder(s.s.slice(-12), d.w, d.h),
        frameW: d.w,
        frameH: d.h,
        frames: img ? d.frames : 1,
        fps: d.fps,
        anchorX: s.ax,
        anchorY: s.ay,
        blockRadius: 0,
        sortY: s.z,
        flip: !!s.f,
        phase: s.fr ?? 0,
        extent: Math.ceil(Math.max(d.w, d.h) / 16),
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

  underCanopy(): boolean {
    return false;
  }

  minimapColor(tx: number, ty: number): string {
    if (!this.inBounds(tx, ty)) return MINIMAP.w as string;
    return MINIMAP[(this.mini[ty] ?? '')[tx] ?? 'w'] ?? (MINIMAP.g as string);
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
        const canvas = this.chunkCanvas(cr * this.chunkCols + cc);
        if (!canvas) continue;
        ctx.drawImage(canvas, Math.round(view.toScreenX(cc * CHUNK)), Math.round(view.toScreenY(cr * CHUNK)), chunkPx, chunkPx);
      }
    }
    for (const sp of this.sparkles) {
      if (sp.x < x0 || sp.x > x1 || sp.y < y0 || sp.y > y1) continue;
      const k = (this.time * 0.5 + sp.phase) % 4;
      if (k < 1) this.main.draw(ctx, SEA_SPARKLE[k < 0.5 ? 0 : 1] as number, Math.round(view.toScreenX(sp.x)), Math.round(view.toScreenY(sp.y)), s);
    }
  }

  drawCanopy(): void {
    // Trees are depth-sorted sprites on this map; there is no canopy layer.
  }
}
