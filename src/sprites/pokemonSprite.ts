/**
 * A Pokémon's SpriteCollab folder in memory, and the animation player that
 * steps through an action with the XML's per-frame timing.
 */
import type { Dir8 } from '../core/math';
import { Assets, imagePixels, warnOnce } from './assets';

/** Preloaded sprite sets by dex number. */
export class SpriteRegistry {
  private sets = new Map<string, PokemonSprites>();

  constructor(private readonly assets: Assets) {}

  async preload(dexes: Iterable<string>, onProgress?: (done: number, total: number) => void): Promise<void> {
    const list = [...new Set(dexes)];
    let done = 0;
    await Promise.all(list.map(async (dex) => {
      const s = await PokemonSprites.load(this.assets, dex);
      this.sets.set(dex, s);
      done++;
      onProgress?.(done, list.length);
    }));
  }

  /** True once a species' sprites have been loaded. */
  has(dex: string): boolean {
    return this.sets.has(dex);
  }

  get(dex: string): PokemonSprites {
    let s = this.sets.get(dex);
    if (!s) {
      s = PokemonSprites.empty(this.assets, dex);
      this.sets.set(dex, s);
    }
    return s;
  }
}
import { parseAnimData, type AnimData, type AnimDef, TICK_SECONDS } from './animData';
import { decodeOffsets, effectAnchor, type OffsetTable } from './offsets';

/** Actions loaded up front; anything else in AnimData.xml loads on first use. */
export const CORE_ACTIONS = ['Idle', 'Walk', 'Attack', 'Hurt', 'Sleep', 'Charge', 'Shoot', 'Faint'] as const;

/** When an action's sheet is absent, the next one in its chain plays instead (with one warning). */
const FALLBACKS: Record<string, string[]> = {
  Sleep: ['Idle'],
  Charge: ['Shoot', 'Attack', 'Idle'],
  Shoot: ['Attack', 'Idle'],
  Attack: ['Shoot', 'Idle'],
  Hurt: ['Idle'],
  Faint: ['Hurt', 'Idle'],
  Walk: ['Idle'],
};

interface Sheet {
  anim: HTMLImageElement | null;
  /** The Shadow sheet baked to a dark, translucent drop shadow for this folder's ShadowSize. */
  shadow: HTMLCanvasElement | null;
  /** Raw Shadow sheet pixels, for finding each frame's ground point. */
  ground: { px: Uint8ClampedArray; w: number; h: number } | null;
  offsets: OffsetTable | undefined;
}

/**
 * Shadow sheets encode three shadow sizes as colours (red = small,
 * green = medium, blue = large, white = centre). AnimData's ShadowSize picks
 * how many rings to keep; the result is painted as one soft dark shape.
 */
export function bakeShadow(img: HTMLImageElement, shadowSize: number): HTMLCanvasElement {
  const px = imagePixels(img);
  const c = document.createElement('canvas');
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  const g = c.getContext('2d')!;
  const out = g.createImageData(c.width, c.height);
  for (let i = 0; i < px.length; i += 4) {
    if ((px[i + 3] ?? 0) < 128) continue;
    const r = (px[i] ?? 0) > 128;
    const gr = (px[i + 1] ?? 0) > 128;
    const b = (px[i + 2] ?? 0) > 128;
    const keep = (r && gr && b) || r || (gr && shadowSize >= 1) || (b && shadowSize >= 2);
    if (!keep) continue;
    out.data[i] = 10;
    out.data[i + 1] = 6;
    out.data[i + 2] = 20;
    out.data[i + 3] = 150;
  }
  g.putImageData(out, 0, 0);
  return c;
}

export interface FrameRect {
  image: CanvasImageSource;
  sx: number;
  sy: number;
  w: number;
  h: number;
  placeholder: boolean;
}

export class PokemonSprites {
  readonly sheets = new Map<string, Sheet>();
  readonly pending = new Map<string, Promise<void>>();
  portrait: HTMLImageElement | null = null;

  private constructor(readonly dex: string, readonly data: AnimData | null, private readonly assets: Assets) {}

  /** A sprite set with no folder: every frame is a labeled placeholder. */
  static empty(assets: Assets, dex: string): PokemonSprites {
    warnOnce(`pokemon/${dex}#missing`, `no sprite folder loaded for pokemon/${dex} (drawing placeholders)`);
    return new PokemonSprites(dex, null, assets);
  }

  static async load(assets: Assets, dex: string): Promise<PokemonSprites> {
    const xml = await assets.text(`pokemon/${dex}/AnimData.xml`);
    let data: AnimData | null = null;
    if (xml !== null) {
      try {
        data = parseAnimData(xml);
      } catch (e) {
        warnOnce(`${dex}/AnimData#parse`, `pokemon/${dex}/AnimData.xml failed to parse: ${(e as Error).message}`);
      }
    }
    const s = new PokemonSprites(dex, data, assets);
    const jobs: Promise<unknown>[] = [];
    for (const action of CORE_ACTIONS) {
      if (data?.anims.has(action)) jobs.push(s.ensureSheet(action));
    }
    jobs.push(assets.loadImage(`portraits/${dex}/Normal.png`).then((img) => (s.portrait = img)));
    await Promise.all(jobs);
    return s;
  }

  /** Loads the Anim, Shadow and Offsets PNGs behind an action once. */
  ensureSheet(action: string): Promise<void> {
    const def = this.data?.anims.get(action);
    if (!def) return Promise.resolve();
    const name = def.sheet;
    let p = this.pending.get(name);
    if (p) return p;
    const base = `pokemon/${this.dex}/${name}`;
    p = Promise.all([
      this.assets.loadImage(`${base}-Anim.png`),
      this.assets.loadImage(`${base}-Shadow.png`),
      this.assets.loadImage(`${base}-Offsets.png`),
    ]).then(([anim, shadow, offsets]) => {
      let table: OffsetTable | undefined;
      if (offsets && anim) {
        table = decodeOffsets(imagePixels(offsets), offsets.naturalWidth, offsets.naturalHeight, def.frameWidth, def.frameHeight);
      }
      this.sheets.set(name, {
        anim,
        shadow: shadow ? bakeShadow(shadow, this.data?.shadowSize ?? 1) : null,
        ground: shadow ? { px: imagePixels(shadow), w: shadow.naturalWidth, h: shadow.naturalHeight } : null,
        offsets: table,
      });
    });
    this.pending.set(name, p);
    return p;
  }

  has(action: string): boolean {
    const def = this.data?.anims.get(action);
    return !!def && (this.sheets.get(def.sheet)?.anim ?? null) !== null;
  }

  /** The action to actually play for a request, following the fallback chain. */
  resolve(action: string): string {
    if (this.has(action)) return action;
    for (const alt of FALLBACKS[action] ?? ['Idle']) {
      if (this.has(alt)) {
        warnOnce(`${this.dex}/${action}`, `pokemon/${this.dex}: no ${action} sheet, playing ${alt}`);
        return alt;
      }
    }
    return action;
  }

  def(action: string): AnimDef | undefined {
    return this.data?.anims.get(action);
  }

  frameCount(action: string): number {
    return this.def(action)?.durations.length ?? 1;
  }

  frame(action: string, dir: Dir8, index: number): FrameRect {
    const def = this.def(action);
    const img = def ? this.sheets.get(def.sheet)?.anim ?? null : null;
    if (!def || !img) {
      const ph = this.assets.placeholder(`#${this.dex} ${action}`, 32, 32);
      return { image: ph, sx: 0, sy: 0, w: 32, h: 32, placeholder: true };
    }
    const cols = Math.max(1, Math.floor(img.naturalWidth / def.frameWidth));
    const rows = Math.max(1, Math.floor(img.naturalHeight / def.frameHeight));
    const c = Math.min(index, cols - 1);
    const r = Math.min(dir, rows - 1);
    return { image: img, sx: c * def.frameWidth, sy: r * def.frameHeight, w: def.frameWidth, h: def.frameHeight, placeholder: false };
  }

  shadowFrame(action: string, dir: Dir8, index: number): FrameRect | null {
    const def = this.def(action);
    const img = def ? this.sheets.get(def.sheet)?.shadow ?? null : null;
    if (!def || !img) return null;
    const cols = Math.max(1, Math.floor(img.width / def.frameWidth));
    const rows = Math.max(1, Math.floor(img.height / def.frameHeight));
    return { image: img, sx: Math.min(index, cols - 1) * def.frameWidth, sy: Math.min(dir, rows - 1) * def.frameHeight, w: def.frameWidth, h: def.frameHeight, placeholder: false };
  }

  private readonly groundCache = new Map<string, [number, number]>();

  /**
   * Where the Pokémon touches the ground in a frame, as an offset from the
   * frame centre in sheet pixels: the centre of the Shadow sheet's shape
   * (its white pixel when there is one). Hops lift the body, not this point.
   */
  ground(action: string, dir: Dir8, index: number): [number, number] {
    const def = this.def(action);
    const g = def ? this.sheets.get(def.sheet)?.ground ?? null : null;
    if (!def || !g) return [0, 0];
    const fw = def.frameWidth;
    const fh = def.frameHeight;
    const col = Math.min(index, Math.max(1, Math.floor(g.w / fw)) - 1);
    const row = Math.min(dir, Math.max(1, Math.floor(g.h / fh)) - 1);
    const key = `${def.sheet}:${row}:${col}`;
    const hit = this.groundCache.get(key);
    if (hit) return hit;
    let wx = 0, wy = 0, wn = 0, ax = 0, ay = 0, an = 0;
    for (let y = row * fh; y < (row + 1) * fh; y++) {
      for (let x = col * fw; x < (col + 1) * fw; x++) {
        const i = (y * g.w + x) * 4;
        if ((g.px[i + 3] ?? 0) < 128) continue;
        ax += x; ay += y; an++;
        if ((g.px[i] ?? 0) > 128 && (g.px[i + 1] ?? 0) > 128 && (g.px[i + 2] ?? 0) > 128) { wx += x; wy += y; wn++; }
      }
    }
    const [cx, cy] = wn ? [wx / wn, wy / wn] : an ? [ax / an, ay / an] : [col * fw + fw / 2 - 0.5, row * fh + fh / 2 - 0.5];
    const out: [number, number] = [cx + 0.5 - col * fw - fw / 2, cy + 0.5 - row * fh - fh / 2];
    this.groundCache.set(key, out);
    return out;
  }

  /** Effect anchor for a frame, as an offset from the frame centre in sheet pixels. */
  anchor(action: string, dir: Dir8, index: number): [number, number] {
    const def = this.def(action);
    if (!def) return [0, 0];
    const [ax, ay] = effectAnchor(this.sheets.get(def.sheet)?.offsets, dir, index, def.frameWidth, def.frameHeight);
    return [ax + 0.5 - def.frameWidth / 2, ay + 0.5 - def.frameHeight / 2];
  }

  /** The HUD portrait: the SpriteCollab portrait, else the first Idle frame facing down. */
  portraitSource(): FrameRect {
    if (this.portrait) return { image: this.portrait, sx: 0, sy: 0, w: this.portrait.naturalWidth, h: this.portrait.naturalHeight, placeholder: false };
    if (this.has('Idle')) return this.frame('Idle', 0, 0);
    const ph = this.assets.placeholder(`#${this.dex}`, 40, 40);
    return { image: ph, sx: 0, sy: 0, w: 40, h: 40, placeholder: true };
  }
}

/** Plays one action of one sprite set with the XML's per-frame timing. */
export class AnimPlayer {
  action = 'Idle';
  frame = 0;
  loop = true;
  done = false;
  dir: Dir8 = 0;
  private elapsed = 0;
  /** Seconds this action has been playing. */
  time = 0;

  constructor(readonly sprites: PokemonSprites) {
    this.play('Idle');
  }

  play(action: string, opts: { loop?: boolean; restart?: boolean } = {}): void {
    const resolved = this.sprites.resolve(action);
    const loop = opts.loop ?? !['Attack', 'Shoot', 'Charge', 'Hurt', 'Faint'].includes(resolved);
    if (resolved === this.action && !opts.restart && (loop === this.loop)) return;
    void this.sprites.ensureSheet(resolved);
    this.action = resolved;
    this.loop = loop;
    this.frame = 0;
    this.elapsed = 0;
    this.time = 0;
    this.done = false;
  }

  update(dt: number): void {
    const def = this.sprites.def(this.action);
    this.time += dt;
    if (!def) return;
    this.elapsed += dt;
    let dur = (def.durations[this.frame] ?? 1) * TICK_SECONDS;
    while (this.elapsed >= dur) {
      this.elapsed -= dur;
      if (this.frame + 1 >= def.durations.length) {
        if (this.loop) this.frame = 0;
        else {
          this.done = true;
          this.frame = def.durations.length - 1;
          this.elapsed = 0;
          break;
        }
      } else this.frame++;
      dur = (def.durations[this.frame] ?? 1) * TICK_SECONDS;
    }
  }

  /** True once a non-looping action has passed its hit frame (or its midpoint when the XML has none). */
  pastHitFrame(): boolean {
    const def = this.sprites.def(this.action);
    if (!def) return true;
    const hit = def.hitFrame ?? Math.floor(def.durations.length / 2);
    return this.frame >= hit;
  }

  current(): FrameRect {
    return this.sprites.frame(this.action, this.dir, this.frame);
  }

  shadow(): FrameRect | null {
    return this.sprites.shadowFrame(this.action, this.dir, this.frame);
  }

  /** The ground point of the current frame (see PokemonSprites.ground). */
  ground(): [number, number] {
    return this.sprites.ground(this.action, this.dir, this.frame);
  }

  anchor(): [number, number] {
    return this.sprites.anchor(this.action, this.dir, this.frame);
  }
}
