/**
 * Tiled JSON ground: an orthogonal map with embedded tilesets whose images
 * live under /assets/tiles. Tile properties drive gameplay:
 *   biome  (string: meadow | forest | shore | water)  on a tile or a layer
 *   solid  (bool)                                      on a tile, or any layer named "collision"
 * Layers draw in order; the result is baked into chunks like the procedural ground.
 */
import { Assets, warnOnce } from '../sprites/assets';
import { CHUNK_TILES, ChunkedGround, type Biome, BIOMES } from './types';

interface TiledProperty {
  name: string;
  type: string;
  value: unknown;
}
interface TiledTile {
  id: number;
  properties?: TiledProperty[];
}
interface TiledTileset {
  firstgid: number;
  image?: string;
  imagewidth?: number;
  imageheight?: number;
  tilewidth: number;
  tileheight: number;
  columns: number;
  tilecount: number;
  tiles?: TiledTile[];
  source?: string;
}
interface TiledLayer {
  type: string;
  name: string;
  width?: number;
  height?: number;
  data?: number[] | string;
  properties?: TiledProperty[];
  visible?: boolean;
}
export interface TiledMap {
  width: number;
  height: number;
  tilewidth: number;
  tileheight: number;
  layers: TiledLayer[];
  tilesets: TiledTileset[];
}

const FLIP_MASK = 0x1fffffff;

function prop(list: TiledProperty[] | undefined, name: string): unknown {
  return list?.find((p) => p.name === name)?.value;
}

export class TiledGround extends ChunkedGround {
  readonly label: string;

  private constructor(cols: number, rows: number, tileSize: number, label: string) {
    super(cols, rows, tileSize);
    this.label = label;
  }

  /** Loads /assets/tiles/<file>; resolves null (with a warning) when the map or its images are missing. */
  static async load(assets: Assets, file: string): Promise<TiledGround | null> {
    const map = await assets.json<TiledMap>(`tiles/${file}`);
    if (!map) return null;
    if (!Array.isArray(map.layers) || !Array.isArray(map.tilesets)) {
      warnOnce(`tiles/${file}#shape`, `tiles/${file} is not a Tiled JSON map`);
      return null;
    }
    const images = new Map<TiledTileset, HTMLImageElement | null>();
    for (const ts of map.tilesets) {
      if (!ts.image) {
        warnOnce(`tiles/${file}#external`, `tiles/${file}: external tileset "${ts.source}" is not supported; embed it in the map`);
        images.set(ts, null);
        continue;
      }
      const rel = ts.image.replace(/^(\.\.\/)+/, '').replace(/^\.\//, '');
      images.set(ts, await assets.loadImage(`tiles/${rel}`));
    }
    const g = new TiledGround(map.width, map.height, map.tilewidth, `Tiled map ${file} (${map.tilewidth} px painted tiles)`);
    g.build(map, images, assets);
    return g;
  }

  private build(map: TiledMap, images: Map<TiledTileset, HTMLImageElement | null>, assets: Assets): void {
    const tilesets = [...map.tilesets].sort((a, b) => b.firstgid - a.firstgid);
    const find = (gid: number): { ts: TiledTileset; local: number } | null => {
      for (const ts of tilesets) if (gid >= ts.firstgid) return { ts, local: gid - ts.firstgid };
      return null;
    };
    const tileProps = (ts: TiledTileset, local: number): TiledProperty[] | undefined => ts.tiles?.find((t) => t.id === local)?.properties;

    const layers = map.layers.filter((l) => l.type === 'tilelayer' && l.visible !== false);
    const decoded = layers.map((l) => {
      const raw = l.data;
      if (Array.isArray(raw)) return raw;
      if (typeof raw === 'string') {
        const bin = atob(raw);
        const out: number[] = [];
        for (let i = 0; i + 3 < bin.length; i += 4) {
          out.push((bin.charCodeAt(i) | (bin.charCodeAt(i + 1) << 8) | (bin.charCodeAt(i + 2) << 16) | (bin.charCodeAt(i + 3) << 24)) >>> 0);
        }
        return out;
      }
      return [];
    });

    // Biomes and solidity.
    for (let ty = 0; ty < this.rows; ty++) {
      for (let tx = 0; tx < this.cols; tx++) {
        const i = this.idx(tx, ty);
        const cell: { biome: Biome; solid: boolean } = { biome: 'meadow', solid: false };
        for (let li = 0; li < layers.length; li++) {
          const layer = layers[li] as TiledLayer;
          const gid = ((decoded[li] ?? [])[i] ?? 0) & FLIP_MASK;
          if (!gid) continue;
          const layerBiome = prop(layer.properties, 'biome');
          if (typeof layerBiome === 'string' && (BIOMES as readonly string[]).includes(layerBiome)) cell.biome = layerBiome as Biome;
          const hit = find(gid);
          if (hit) {
            const p = tileProps(hit.ts, hit.local);
            const b = prop(p, 'biome');
            if (typeof b === 'string' && (BIOMES as readonly string[]).includes(b)) cell.biome = b as Biome;
            if (prop(p, 'solid') === true) cell.solid = true;
          }
          if (/^(collision|solid)$/i.test(layer.name)) cell.solid = true;
        }
        const biome = cell.biome;
        let solid = cell.solid;
        if (biome === 'water') solid = true;
        this.biomes[i] = biome;
        this.solid[i] = solid ? 1 : 0;
      }
    }
    this.computeReach();

    // Bake.
    const ts = this.tileSize;
    for (let cr = 0; cr < this.chunkRows; cr++) {
      for (let cc = 0; cc < this.chunkCols; cc++) {
        const canvas = document.createElement('canvas');
        canvas.width = CHUNK_TILES * ts;
        canvas.height = CHUNK_TILES * ts;
        const g = canvas.getContext('2d')!;
        for (let ty = 0; ty < CHUNK_TILES; ty++) {
          for (let tx = 0; tx < CHUNK_TILES; tx++) {
            const gx = cc * CHUNK_TILES + tx;
            const gy = cr * CHUNK_TILES + ty;
            if (gx >= this.cols || gy >= this.rows) continue;
            const i = this.idx(gx, gy);
            layers.forEach((_layer, li) => {
              const gid = ((decoded[li] ?? [])[i] ?? 0) & FLIP_MASK;
              if (!gid) return;
              const hit = find(gid);
              if (!hit) return;
              const img = images.get(hit.ts) ?? null;
              const cols = hit.ts.columns || 1;
              const sx = (hit.local % cols) * hit.ts.tilewidth;
              const sy = Math.floor(hit.local / cols) * hit.ts.tileheight;
              if (img) g.drawImage(img, sx, sy, hit.ts.tilewidth, hit.ts.tileheight, tx * ts, ty * ts, ts, ts);
              else g.drawImage(assets.placeholder(`tile ${gid}`, 64, 64), tx * ts, ty * ts, ts, ts);
            });
          }
        }
        this.chunks[cr * this.chunkCols + cc] = canvas;
      }
    }
  }
}
