/**
 * A Pokémon's SpriteCollab folder in memory, and the animation player that
 * steps through an action with the XML's per-frame timing.
 */
import type { Dir8 } from '../core/math';
import { Assets, imagePixels, warnOnce } from './assets';
import shinyJson from '../../data/shiny.json';

/**
 * Sprite sets by dex number, loaded on demand through a small queue so the
 * browser is never asked for thousands of sheets at once. `get()` never
 * blocks: an unloaded species comes back empty (drawn as nothing) and fills
 * in when its sheets arrive. Urgent requests (what is on screen now) jump the
 * queue ahead of the background preload.
 */
export class SpriteRegistry {
  private sets = new Map<string, PokemonSprites>();
  private urgent: Array<() => Promise<void>> = [];
  private normal: Array<() => Promise<void>> = [];
  private active = 0;
  private activeBg = 0;
  private static readonly LIMIT = 6;
  /** Background loads at once: they decode sheets on the main thread, so only a couple at a time. */
  private static readonly BG_LIMIT = 2;

  constructor(private readonly assets: Assets) {}

  /** Loads species (and calls back as each is ready). Urgent ones go ahead of everything queued. */
  preload(dexes: Iterable<string>, onProgress?: (done: number, total: number) => void, urgent = false): Promise<void> {
    const list = [...new Set(dexes)];
    let done = 0;
    return Promise.all(list.map((dex) => this.request(dex, urgent).then(() => {
      done++;
      onProgress?.(done, list.length);
    }))).then(() => undefined);
  }

  /** True once a species' first sheet (Idle) has loaded. */
  has(dex: string): boolean {
    return this.sets.get(dex)?.loaded ?? false;
  }

  /**
   * The sprite set for a species, starting an urgent load when it has not been asked for yet.
   * `shiny` recolours the species' sheets with its shiny palette (data/shiny.json).
   */
  get(dex: string, shiny = false): PokemonSprites {
    const pal = shiny ? SHINY[dex] : undefined;
    const key = pal ? `${dex}*` : dex;
    void this.request(key, true);
    return this.sets.get(key) as PokemonSprites;
  }

  /** True when a species has a shiny palette. */
  static hasShiny(dex: string): boolean {
    return !!SHINY[dex];
  }

  private request(key: string, urgent: boolean): Promise<void> {
    let s = this.sets.get(key);
    if (!s) {
      const shiny = key.endsWith('*');
      const dex = shiny ? key.slice(0, -1) : key;
      s = PokemonSprites.create(this.assets, dex, shiny ? SHINY[dex] : undefined);
      this.sets.set(key, s);
    }
    const set = s;
    if (urgent) set.urgent = true;
    if (set.state === 'idle') {
      set.state = 'queued';
      // First the Idle sheet and portrait (enough to draw it), then the rest of its core sheets.
      const first = async (): Promise<void> => {
        await set.loadFirst();
        this.normal.push(() => set.loadRest());
        this.pump();
      };
      set.job = first;
      (urgent ? this.urgent : this.normal).push(first);
      this.pump();
    } else if (urgent && set.state === 'queued' && set.job) {
      const i = this.normal.indexOf(set.job);
      if (i >= 0) {
        this.normal.splice(i, 1);
        this.urgent.push(set.job);
      }
    }
    return set.ready;
  }

  private pump(): void {
    while (this.active < SpriteRegistry.LIMIT) {
      const bg = !this.urgent.length;
      if (bg && this.activeBg >= SpriteRegistry.BG_LIMIT) return;
      const job = this.urgent.shift() ?? this.normal.shift();
      if (!job) return;
      this.active++;
      if (bg) this.activeBg++;
      void job().catch((e) => console.warn('[showdown] sprite load failed', e)).finally(() => {
        this.active--;
        if (bg) this.activeBg--;
        this.pump();
      });
    }
  }
}
import { parseAnimData, type AnimData, type AnimDef, TICK_SECONDS } from './animData';
import { bodyPoint, decodeOffsets, effectAnchor, type OffsetTable } from './offsets';

/** Actions loaded up front; anything else in AnimData.xml loads on first use. */
export const CORE_ACTIONS = ['Idle', 'Walk', 'Attack', 'Hurt', 'Sleep', 'Charge', 'Shoot', 'Faint'] as const;

/** When an action's sheet is absent, the next one in its chain plays instead (with one warning). */
/** Actions that play once and hold their last frame (an attack, a hit, a faint); everything else loops. */
const ONE_SHOT = new Set(['Attack', 'Shoot', 'Charge', 'Strike', 'Swing', 'Double', 'Rotate', 'Hop', 'Hurt', 'Faint']);

const FALLBACKS: Record<string, string[]> = {
  Sleep: ['Idle'],
  Charge: ['Shoot', 'Attack', 'Idle'],
  Shoot: ['Attack', 'Idle'],
  Attack: ['Shoot', 'Idle'],
  // The swings, strikes and spins most sprites have; any that lack one lunge with Attack.
  Strike: ['Attack', 'Idle'],
  Swing: ['Attack', 'Idle'],
  Double: ['Attack', 'Idle'],
  Rotate: ['Attack', 'Idle'],
  Hop: ['Attack', 'Idle'],
  Hurt: ['Idle'],
  Faint: ['Hurt', 'Idle'],
  // A set drawn without a Walk (Iron Treads) rolls along on its Rotate sheet, looped.
  Walk: ['Rotate', 'Idle'],
};

interface Sheet {
  anim: HTMLImageElement | HTMLCanvasElement | null;
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
export function bakeShadow(img: HTMLImageElement, shadowSize: number, pixels?: Uint8ClampedArray): HTMLCanvasElement {
  const px = pixels ?? imagePixels(img);
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
  portrait: HTMLImageElement | HTMLCanvasElement | null = null;
  data: AnimData | null = null;
  /** idle: not asked for; queued: waiting or loading; the `ready` promise settles once Idle can be drawn. */
  state: 'idle' | 'queued' = 'idle';
  /** True once the AnimData and the Idle sheet are in (or known to be missing). */
  loaded = false;
  job: (() => Promise<void>) | null = null;
  /** Something wants it drawn now: its Idle sheet decodes straight away instead of in idle time. */
  urgent = false;
  readonly ready: Promise<void>;
  private markReady!: () => void;

  private constructor(readonly dex: string, private readonly assets: Assets, readonly palette?: ShinyPalette) {
    this.ready = new Promise((res) => (this.markReady = res));
  }

  /** An empty set that fills in as its sheets load (recoloured when a shiny palette is given). */
  static create(assets: Assets, dex: string, palette?: ShinyPalette): PokemonSprites {
    return new PokemonSprites(dex, assets, palette);
  }

  /** AnimData, the Idle sheet and the portrait: enough to draw the Pokémon standing. */
  async loadFirst(): Promise<void> {
    try {
      const xml = await this.assets.text(`pokemon/${this.dex}/AnimData.xml`);
      if (xml !== null) {
        try {
          this.data = parseAnimData(xml);
        } catch (e) {
          warnOnce(`${this.dex}/AnimData#parse`, `pokemon/${this.dex}/AnimData.xml failed to parse: ${(e as Error).message}`);
        }
      } else warnOnce(`pokemon/${this.dex}#missing`, `no sprite folder for pokemon/${this.dex} (drawing placeholders)`);
      await Promise.all([
        this.ensureSheet('Idle', this.urgent),
        this.assets.loadImage(`portraits/${this.dex}/Normal.png`).then((img) => (this.portrait = img && this.palette?.portrait ? recolor(img, this.palette.portrait) : img)),
      ]);
    } finally {
      this.loaded = true;
      this.markReady();
    }
  }

  /** The other core sheets (walk, attack, hurt...). */
  async loadRest(): Promise<void> {
    await Promise.all(CORE_ACTIONS.filter((a) => a !== 'Idle' && this.data?.anims.has(a)).map((a) => this.ensureSheet(a)));
  }

  /**
   * Loads the Anim, Shadow and Offsets PNGs behind an action once. Reading their pixels (offsets,
   * shadow, shiny recolour) is main-thread work, so a background load waits for idle time first
   * and the match keeps a steady frame rate while the rest of the island's Pokémon load.
   */
  ensureSheet(action: string, now = false): Promise<void> {
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
    ]).then(async ([anim, shadow, offsets]) => {
      if (!now) await idleSlot();
      let table: OffsetTable | undefined;
      if (offsets && anim) {
        table = decodeOffsets(imagePixels(offsets), offsets.naturalWidth, offsets.naturalHeight, def.frameWidth, def.frameHeight);
      }
      this.sheets.set(name, {
        anim: anim && this.palette ? recolor(anim, this.palette.sprite) : anim,
        ...(() => {
          if (!shadow) return { shadow: null, ground: null };
          const spx = imagePixels(shadow);
          return { shadow: bakeShadow(shadow, this.data?.shadowSize ?? 1, spx), ground: { px: spx, w: shadow.naturalWidth, h: shadow.naturalHeight } };
        })(),
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
    // A sheet still on its way: start it and stand in with the next one that is here.
    const def = this.data?.anims.get(action);
    if (def && !this.sheets.has(def.sheet)) {
      void this.ensureSheet(action);
      for (const alt of FALLBACKS[action] ?? ['Idle']) if (this.has(alt)) return alt;
      return this.has('Idle') ? 'Idle' : action;
    }
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
    let def = this.def(action);
    let img = def ? this.sheets.get(def.sheet)?.anim ?? null : null;
    if ((!def || !img) && action !== 'Idle' && this.has('Idle')) {
      // The requested sheet is still loading: stand idle meanwhile.
      def = this.def('Idle');
      img = def ? this.sheets.get(def.sheet)?.anim ?? null : null;
      index = 0;
    }
    if (!def || !img) {
      // Still loading: draw nothing rather than an error box.
      if (!this.loaded || (def && !this.sheets.has(def.sheet))) return { image: blankCanvas(), sx: 0, sy: 0, w: 1, h: 1, placeholder: true };
      const ph = this.assets.placeholder(`#${this.dex} ${action}`, 32, 32);
      return { image: ph, sx: 0, sy: 0, w: 32, h: 32, placeholder: true };
    }
    const cols = Math.max(1, Math.floor(img.width / def.frameWidth));
    const rows = Math.max(1, Math.floor(img.height / def.frameHeight));
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

  /** A marked body point (head or hands) for a frame, as an offset from the frame centre in sheet pixels; null when unmarked. */
  point(action: string, dir: Dir8, index: number, kind: 'head' | 'hands'): [number, number] | null {
    const def = this.def(action);
    if (!def) return null;
    const pt = bodyPoint(this.sheets.get(def.sheet)?.offsets, dir, index, kind);
    return pt ? [pt[0] + 0.5 - def.frameWidth / 2, pt[1] + 0.5 - def.frameHeight / 2] : null;
  }

  /** The HUD portrait: the SpriteCollab portrait, else the first Idle frame facing down. */
  portraitSource(): FrameRect {
    if (this.portrait) return { image: this.portrait, sx: 0, sy: 0, w: this.portrait.width, h: this.portrait.height, placeholder: false };
    if (this.has('Idle')) return this.frame('Idle', 0, 0);
    if (!this.loaded) return { image: blankCanvas(), sx: 0, sy: 0, w: 1, h: 1, placeholder: true };
    const ph = this.assets.placeholder(`#${this.dex}`, 40, 40);
    return { image: ph, sx: 0, sy: 0, w: 40, h: 40, placeholder: true };
  }
}

/** Resolves in the browser's idle time (or soon, if it never gets any). */
function idleSlot(): Promise<void> {
  const w = globalThis as unknown as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number };
  return new Promise((res) => (w.requestIdleCallback ? w.requestIdleCallback(() => res(), { timeout: 1500 }) : setTimeout(res, 20)));
}

export type ShinyPalette = { sprite: Array<[number, number]>; portrait?: Array<[number, number]> };
const SHINY = shinyJson as unknown as Record<string, ShinyPalette>;

/** A copy of an image with its colours swapped (0xRRGGBB pairs); alpha is kept. */
function recolor(img: HTMLImageElement, pairs: Array<[number, number]>): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  const g = c.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D;
  g.drawImage(img, 0, 0);
  const map = new Map<number, number>(pairs);
  const data = g.getImageData(0, 0, c.width, c.height);
  const px = data.data;
  for (let i = 0; i < px.length; i += 4) {
    if ((px[i + 3] ?? 0) === 0) continue;
    const to = map.get(((px[i] ?? 0) << 16) | ((px[i + 1] ?? 0) << 8) | (px[i + 2] ?? 0));
    if (to === undefined) continue;
    px[i] = (to >> 16) & 255;
    px[i + 1] = (to >> 8) & 255;
    px[i + 2] = to & 255;
  }
  g.putImageData(data, 0, 0);
  return c;
}

/** A Pokémon's portrait as a picture for the page (HTML dialogs), in its shiny colours when asked. */
export function portraitPicture(root: string, dex: string, shiny: boolean): Promise<HTMLImageElement | HTMLCanvasElement | null> {
  return new Promise((res) => {
    const img = new Image();
    img.onload = () => {
      const pal = shiny ? SHINY[dex]?.portrait : undefined;
      res(pal ? recolor(img, pal) : img);
    };
    img.onerror = () => res(null);
    img.src = `${root}portraits/${dex}/Normal.png`;
  });
}

let blank: HTMLCanvasElement | null = null;
/** A 1x1 transparent canvas: what a Pokémon whose sheets are still loading draws. */
function blankCanvas(): HTMLCanvasElement {
  if (!blank) {
    blank = document.createElement('canvas');
    blank.width = blank.height = 1;
  }
  return blank;
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
    // Walking always loops, whatever sheet stands in for it.
    const loop = opts.loop ?? (action === 'Walk' ? true : !ONE_SHOT.has(resolved));
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

  /** The current frame's head or hands (offset from the frame centre, sheet pixels), if the sheet marks it. */
  point(kind: 'head' | 'hands'): [number, number] | null {
    return this.sprites.point(this.action, this.dir, this.frame, kind);
  }
}
