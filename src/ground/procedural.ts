/**
 * Procedural painted ground: simplex-noise biomes (meadow, forest edge,
 * rocky shore, water) blended with soft gradients, baked once per match into
 * 8x8-tile chunk canvases, with brush-stroke detail, grain and scattered
 * decor (trees, rocks) drawn from simple shaded shapes.
 */
import { Rng } from '../core/rng';
import { Simplex2 } from '../core/noise';
import { clamp, smoothstep } from '../core/math';
import { CHUNK_TILES, ChunkedGround, type Biome, type DecorItem } from './types';

/** Noise samples per tile edge in the blended base layer (upscaled smoothly). */
const SAMPLES_PER_TILE = 8;

interface Weights {
  water: number;
  shore: number;
  meadow: number;
  forest: number;
}

export class ProceduralGround extends ChunkedGround {
  readonly label = 'Procedural stand-in terrain (drop painted tiles into /assets/tiles)';
  private elev: Simplex2;
  private moist: Simplex2;
  private detail: Simplex2;
  private rng: Rng;
  private grain: HTMLCanvasElement;

  private constructor(cols: number, rows: number, tileSize: number, seed: number) {
    super(cols, rows, tileSize);
    this.elev = new Simplex2(seed);
    this.moist = new Simplex2(seed ^ 0x9e3779b9);
    this.detail = new Simplex2(seed ^ 0x51ed27f);
    this.rng = new Rng(seed ^ 0xabcdef);
    this.grain = makeGrain(new Rng(seed ^ 0x777));
  }

  static async create(cols: number, rows: number, tileSize: number, seed: number, onProgress?: (p: number) => void): Promise<ProceduralGround> {
    const g = new ProceduralGround(cols, rows, tileSize, seed);
    g.classifyTiles();
    g.scatterDecor();
    g.computeReach();
    const total = g.chunkCols * g.chunkRows;
    for (let r = 0; r < g.chunkRows; r++) {
      for (let c = 0; c < g.chunkCols; c++) {
        g.chunks[r * g.chunkCols + c] = g.bakeChunk(c, r);
        onProgress?.((r * g.chunkCols + c + 1) / total);
        await new Promise((res) => setTimeout(res, 0));
      }
    }
    return g;
  }

  /** Elevation in [0,1] with the centre raised (the crystal clearing) and the rim lowered (shoreline). */
  private elevation(x: number, y: number): number {
    let e = this.elev.fbm(x / 13, y / 13, 4, 2, 0.5);
    const cx = this.cols / 2;
    const cy = this.rows / 2;
    const dc = Math.hypot(x - cx, y - cy);
    e += 0.3 * (1 - smoothstep(0, 7, dc));
    const edge = Math.min(x, y, this.cols - x, this.rows - y);
    e -= 0.28 * (1 - smoothstep(0, 4.5, edge));
    return e;
  }

  private weights(x: number, y: number): Weights {
    const e = this.elevation(x, y);
    const m = this.moist.fbm(x / 9 + 100, y / 9 - 50, 3, 2, 0.5);
    const a = smoothstep(0.37, 0.43, e);
    const b = smoothstep(0.455, 0.52, e);
    const land = a * b;
    const f = smoothstep(0.47, 0.6, m);
    return { water: 1 - a, shore: a * (1 - b), meadow: land * (1 - f), forest: land * f };
  }

  private classifyTiles(): void {
    for (let ty = 0; ty < this.rows; ty++) {
      for (let tx = 0; tx < this.cols; tx++) {
        const w = this.weights(tx + 0.5, ty + 0.5);
        let best: Biome = 'meadow';
        let bw = w.meadow;
        if (w.forest > bw) (best = 'forest'), (bw = w.forest);
        if (w.shore > bw) (best = 'shore'), (bw = w.shore);
        if (w.water > bw) (best = 'water'), (bw = w.water);
        const i = this.idx(tx, ty);
        this.biomes[i] = best;
        this.solid[i] = best === 'water' ? 1 : 0;
      }
    }
  }

  private scatterDecor(): void {
    const cx = this.cols / 2;
    const cy = this.rows / 2;
    const trees = [0, 1, 2].map((v) => makeTree(this.rng, v, this.tileSize));
    const rocks = [0, 1, 2].map((v) => makeRock(this.rng, v, this.tileSize));
    for (let ty = 1; ty < this.rows - 1; ty++) {
      for (let tx = 1; tx < this.cols - 1; tx++) {
        if (Math.hypot(tx + 0.5 - cx, ty + 0.5 - cy) < 4) continue;
        const biome = this.biomeAt(tx, ty);
        if (biome === 'water') continue;
        const r = this.rng.next();
        let item: DecorItem | null = null;
        if (biome === 'forest' && r < 0.2) {
          const t = this.rng.pick(trees);
          item = { ...t, kind: 'tree', x: tx + this.rng.range(0.3, 0.7), y: ty + this.rng.range(0.55, 0.9), blockRadius: 0.42 };
        } else if ((biome === 'shore' && r < 0.1) || (biome === 'meadow' && r < 0.025)) {
          const k = this.rng.pick(rocks);
          item = { ...k, kind: 'rock', x: tx + this.rng.range(0.3, 0.7), y: ty + this.rng.range(0.5, 0.85), blockRadius: 0.34 };
        }
        if (item) {
          this.decor.push(item);
          this.solid[this.idx(tx, ty)] = 1;
        }
      }
    }
    this.decor.sort((a, b) => a.y - b.y);
  }

  private bakeChunk(cc: number, cr: number): HTMLCanvasElement {
    const ts = this.tileSize;
    const px = CHUNK_TILES * ts;
    const canvas = document.createElement('canvas');
    canvas.width = px;
    canvas.height = px;
    const g = canvas.getContext('2d')!;

    // 1. Blended base colours at low resolution, upscaled with smoothing.
    const n = CHUNK_TILES * SAMPLES_PER_TILE;
    const base = document.createElement('canvas');
    base.width = n;
    base.height = n;
    const bg = base.getContext('2d')!;
    const img = bg.createImageData(n, n);
    const d = img.data;
    const ox = cc * CHUNK_TILES;
    const oy = cr * CHUNK_TILES;
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const x = ox + (i + 0.5) / SAMPLES_PER_TILE;
        const y = oy + (j + 0.5) / SAMPLES_PER_TILE;
        const w = this.weights(x, y);
        const e = this.elevation(x, y);
        const dn = this.detail.noise(x * 1.7, y * 1.7);
        const dn2 = this.detail.noise(x * 0.35 + 7, y * 0.35 - 3);
        // water: deep navy to shallow teal, lighter near the shore
        const depth = clamp((0.43 - e) / 0.2, 0, 1);
        const wr = 52 - 28 * depth + 6 * dn;
        const wg = 128 - 60 * depth + 8 * dn;
        const wb = 150 - 40 * depth + 10 * dn;
        // shore: tan grey with pebbly mottling
        const sv = 14 * dn + 10 * dn2;
        const sr = 158 + sv;
        const sg = 146 + sv;
        const sb = 124 + sv * 0.8;
        // meadow: grass greens with sunlit patches
        const mv = 16 * dn + 22 * dn2;
        const mr = 104 + mv * 0.9;
        const mg = 164 + mv;
        const mb = 70 + mv * 0.5;
        // forest edge: cooler, darker greens
        const fv = 12 * dn + 14 * dn2;
        const fr = 52 + fv * 0.7;
        const fg = 106 + fv;
        const fb = 64 + fv * 0.6;
        const shade = 0.93 + 0.1 * dn2;
        const k = (j * n + i) * 4;
        d[k] = clamp((w.water * wr + w.shore * sr + w.meadow * mr + w.forest * fr) * shade, 0, 255);
        d[k + 1] = clamp((w.water * wg + w.shore * sg + w.meadow * mg + w.forest * fg) * shade, 0, 255);
        d[k + 2] = clamp((w.water * wb + w.shore * sb + w.meadow * mb + w.forest * fb) * shade, 0, 255);
        d[k + 3] = 255;
      }
    }
    bg.putImageData(img, 0, 0);
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = 'high';
    g.drawImage(base, 0, 0, px, px);

    // 2. Painted detail strokes per tile.
    const rng = new Rng((cc * 7919 + cr * 104729 + 17) >>> 0);
    for (let ty = 0; ty < CHUNK_TILES; ty++) {
      for (let tx = 0; tx < CHUNK_TILES; tx++) {
        const gx = ox + tx;
        const gy = oy + ty;
        if (gx >= this.cols || gy >= this.rows) continue;
        const biome = this.biomeAt(gx, gy);
        const x0 = tx * ts;
        const y0 = ty * ts;
        paintTile(g, rng, biome, x0, y0, ts);
      }
    }

    // 3. Canvas grain for a painted, not vector, feel.
    g.globalCompositeOperation = 'overlay';
    g.globalAlpha = 0.28;
    for (let y = 0; y < px; y += this.grain.height) {
      for (let x = 0; x < px; x += this.grain.width) g.drawImage(this.grain, x, y);
    }
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
    return canvas;
  }
}

function paintTile(g: CanvasRenderingContext2D, rng: Rng, biome: Biome, x0: number, y0: number, ts: number): void {
  const u = () => rng.next();
  if (biome === 'meadow') {
    for (let i = 0; i < 7; i++) {
      const x = x0 + u() * ts;
      const y = y0 + u() * ts;
      const dark = u() < 0.5;
      g.strokeStyle = dark ? 'rgba(58,118,44,0.55)' : 'rgba(172,214,104,0.5)';
      g.lineWidth = 2 + u() * 2;
      g.lineCap = 'round';
      const h = 10 + u() * 14;
      g.beginPath();
      for (let b = 0; b < 3; b++) {
        const bx = x + (b - 1) * 4;
        g.moveTo(bx, y);
        g.quadraticCurveTo(bx + (u() - 0.5) * 8, y - h * 0.6, bx + (u() - 0.5) * 10, y - h);
      }
      g.stroke();
    }
    if (u() < 0.35) {
      g.fillStyle = rng.pick(['rgba(255,255,255,0.85)', 'rgba(255,230,120,0.9)', 'rgba(240,150,200,0.85)']);
      g.beginPath();
      g.arc(x0 + u() * ts, y0 + u() * ts, 2.5 + u() * 2, 0, Math.PI * 2);
      g.fill();
    }
  } else if (biome === 'forest') {
    for (let i = 0; i < 4; i++) {
      const x = x0 + u() * ts;
      const y = y0 + u() * ts;
      const r = 10 + u() * 22;
      const grad = g.createRadialGradient(x, y, 0, x, y, r);
      grad.addColorStop(0, 'rgba(30,70,44,0.35)');
      grad.addColorStop(1, 'rgba(30,70,44,0)');
      g.fillStyle = grad;
      g.fillRect(x - r, y - r, r * 2, r * 2);
    }
    for (let i = 0; i < 5; i++) {
      g.fillStyle = u() < 0.5 ? 'rgba(120,96,48,0.45)' : 'rgba(150,170,70,0.4)';
      g.beginPath();
      g.ellipse(x0 + u() * ts, y0 + u() * ts, 3 + u() * 3, 2 + u() * 2, u() * Math.PI, 0, Math.PI * 2);
      g.fill();
    }
  } else if (biome === 'shore') {
    for (let i = 0; i < 4; i++) {
      const x = x0 + u() * ts;
      const y = y0 + u() * ts;
      const rx = 4 + u() * 9;
      const ry = rx * (0.55 + u() * 0.35);
      const grad = g.createRadialGradient(x - rx * 0.3, y - ry * 0.4, 1, x, y, rx);
      grad.addColorStop(0, 'rgba(210,205,190,0.9)');
      grad.addColorStop(1, 'rgba(110,104,92,0.9)');
      g.fillStyle = grad;
      g.beginPath();
      g.ellipse(x, y, rx, ry, u() * Math.PI, 0, Math.PI * 2);
      g.fill();
    }
  } else {
    for (let i = 0; i < 3; i++) {
      const x = x0 + u() * ts;
      const y = y0 + u() * ts;
      g.strokeStyle = 'rgba(190,230,240,0.32)';
      g.lineWidth = 1.5 + u() * 1.5;
      g.beginPath();
      g.ellipse(x, y, 14 + u() * 26, 4 + u() * 5, 0, Math.PI * 1.05, Math.PI * 1.95);
      g.stroke();
    }
  }
}

function makeGrain(rng: Rng): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const g = c.getContext('2d')!;
  const img = g.createImageData(256, 256);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = 110 + Math.floor(rng.next() * 70);
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return c;
}

function makeTree(rng: Rng, variant: number, ts: number): Omit<DecorItem, 'kind' | 'x' | 'y' | 'blockRadius'> {
  const w = Math.round(ts * (1.35 + variant * 0.12));
  const h = Math.round(ts * (1.75 + variant * 0.15));
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  // trunk
  const tx = w / 2;
  const trunk = g.createLinearGradient(tx - 10, 0, tx + 10, 0);
  trunk.addColorStop(0, '#4a3220');
  trunk.addColorStop(0.5, '#7a553a');
  trunk.addColorStop(1, '#3d2816');
  g.fillStyle = trunk;
  g.beginPath();
  g.moveTo(tx - 9, h - 4);
  g.lineTo(tx + 9, h - 4);
  g.lineTo(tx + 6, h * 0.45);
  g.lineTo(tx - 6, h * 0.45);
  g.closePath();
  g.fill();
  // canopy blobs
  const blobs = 6 + variant;
  for (let i = 0; i < blobs; i++) {
    const a = (i / blobs) * Math.PI * 2 + rng.next();
    const rad = w * 0.22;
    const bx = tx + Math.cos(a) * w * 0.2;
    const by = h * 0.36 + Math.sin(a) * h * 0.14;
    const grad = g.createRadialGradient(bx - rad * 0.35, by - rad * 0.4, rad * 0.1, bx, by, rad);
    grad.addColorStop(0, `rgb(${120 + variant * 8},${176 + variant * 6},88)`);
    grad.addColorStop(0.6, `rgb(${60 + variant * 4},${120 + variant * 4},62)`);
    grad.addColorStop(1, 'rgb(30,70,44)');
    g.fillStyle = grad;
    g.beginPath();
    g.arc(bx, by, rad, 0, Math.PI * 2);
    g.fill();
  }
  const top = g.createRadialGradient(tx - w * 0.1, h * 0.25, 4, tx, h * 0.32, w * 0.3);
  top.addColorStop(0, 'rgb(150,200,100)');
  top.addColorStop(0.7, 'rgb(84,140,70)');
  top.addColorStop(1, 'rgba(60,110,56,0)');
  g.fillStyle = top;
  g.beginPath();
  g.arc(tx, h * 0.3, w * 0.3, 0, Math.PI * 2);
  g.fill();
  return { image: c, w, h, anchorX: w / 2, anchorY: h - 4 };
}

function makeRock(rng: Rng, variant: number, ts: number): Omit<DecorItem, 'kind' | 'x' | 'y' | 'blockRadius'> {
  const w = Math.round(ts * (0.6 + variant * 0.1));
  const h = Math.round(w * 0.7);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(w * 0.35, h * 0.3, 2, w / 2, h / 2, w * 0.6);
  grad.addColorStop(0, '#c9c4b4');
  grad.addColorStop(0.55, '#8d877a');
  grad.addColorStop(1, '#4e4a42');
  g.fillStyle = grad;
  g.beginPath();
  g.moveTo(w * 0.1, h * 0.75);
  g.quadraticCurveTo(w * 0.05, h * 0.3, w * 0.35, h * 0.15);
  g.quadraticCurveTo(w * 0.6, h * 0.02, w * 0.85, h * 0.3);
  g.quadraticCurveTo(w * 1.0, h * 0.6, w * 0.8, h * 0.9);
  g.quadraticCurveTo(w * 0.4, h * 1.02, w * 0.1, h * 0.75);
  g.fill();
  g.strokeStyle = 'rgba(255,255,255,0.25)';
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(w * 0.3, h * 0.3);
  g.quadraticCurveTo(w * 0.45, h * 0.2 + rng.next() * 4, w * 0.6, h * 0.28);
  g.stroke();
  return { image: c, w, h, anchorX: w / 2, anchorY: h * 0.85 };
}
