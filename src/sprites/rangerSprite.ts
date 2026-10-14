/**
 * Overworld walking sheets for the humans (player, AI trainers, Rangers,
 * host), sliced per character from assets/rangers/manifest.json because
 * frame sizes differ between sheets.
 *
 * Manifest shape (one entry per character):
 *   {
 *     "file": "player.png", "name": "Ranger (male)",
 *     "frameWidth": 20, "frameHeight": 38,
 *     "layout": "grid" | "column",   grid: one row per facing; column: all frames stacked
 *     "origin": [0, 0], "gap": 0,
 *     "facings": ["down", "left", "right", "up"],   row order in the sheet
 *     "framesPerFacing": 3, "walkCycle": [0, 1, 2, 1], "idleFrame": 1,
 *     "footY": 36                                  pixel row the feet stand on (default frameHeight)
 *   }
 */
import { Assets, warnOnce } from './assets';

export type Facing4 = 'up' | 'down' | 'left' | 'right';

export interface CharacterSlice {
  file: string;
  name: string;
  frameWidth: number;
  frameHeight: number;
  layout: 'grid' | 'column';
  origin: [number, number];
  gap: number;
  facings: Facing4[];
  framesPerFacing: number;
  walkCycle: number[];
  idleFrame: number;
  footY: number;
  standIn?: boolean;
}

export interface RangerManifest {
  characters: Record<string, Partial<CharacterSlice>>;
}

export interface SheetRect {
  image: CanvasImageSource;
  sx: number;
  sy: number;
  w: number;
  h: number;
  footY: number;
  placeholder: boolean;
}

const DEFAULTS: Omit<CharacterSlice, 'file' | 'name'> = {
  frameWidth: 32,
  frameHeight: 32,
  layout: 'column',
  origin: [0, 0],
  gap: 0,
  facings: ['up', 'down', 'left', 'right'],
  framesPerFacing: 4,
  walkCycle: [0, 1, 2, 3],
  idleFrame: 0,
  footY: 32,
};

export class RangerSheet {
  constructor(readonly key: string, readonly slice: CharacterSlice, readonly image: HTMLImageElement | null, private readonly assets: Assets) {}

  /** Frame for a facing and a walk-cycle phase in [0, 1); `moving` false gives the idle frame. */
  frame(facing: Facing4, phase: number, moving: boolean): SheetRect {
    const s = this.slice;
    if (!this.image) {
      const ph = this.assets.placeholder(this.key, s.frameWidth, s.frameHeight);
      return { image: ph, sx: 0, sy: 0, w: s.frameWidth, h: s.frameHeight, footY: s.frameHeight, placeholder: true };
    }
    let row = s.facings.indexOf(facing);
    if (row < 0) row = 0;
    const cycle = s.walkCycle.length ? s.walkCycle : [0];
    const idx = moving ? (cycle[Math.floor(phase * cycle.length) % cycle.length] ?? 0) : s.idleFrame;
    const col = Math.min(idx, s.framesPerFacing - 1);
    let sx: number;
    let sy: number;
    if (s.layout === 'grid') {
      sx = s.origin[0] + col * (s.frameWidth + s.gap);
      sy = s.origin[1] + row * (s.frameHeight + s.gap);
    } else {
      sx = s.origin[0];
      sy = s.origin[1] + (row * s.framesPerFacing + col) * (s.frameHeight + s.gap);
    }
    return { image: this.image, sx, sy, w: s.frameWidth, h: s.frameHeight, footY: s.footY, placeholder: false };
  }
}

export class RangerSprites {
  private sheets = new Map<string, RangerSheet>();

  private constructor(private readonly assets: Assets) {}

  static async load(assets: Assets): Promise<RangerSprites> {
    const rs = new RangerSprites(assets);
    const manifest = await assets.json<RangerManifest>('rangers/manifest.json');
    if (!manifest) return rs;
    const jobs: Promise<void>[] = [];
    for (const [key, partial] of Object.entries(manifest.characters ?? {})) {
      const slice: CharacterSlice = { ...DEFAULTS, file: partial.file ?? `${key}.png`, name: partial.name ?? key, ...partial } as CharacterSlice;
      jobs.push(assets.loadImage(`rangers/${slice.file}`).then((img) => {
        rs.sheets.set(key, new RangerSheet(key, slice, img, assets));
      }));
    }
    await Promise.all(jobs);
    return rs;
  }

  get(key: string): RangerSheet {
    let s = this.sheets.get(key);
    if (!s) {
      warnOnce(`rangers/${key}`, `rangers/manifest.json has no character "${key}" (drawing a placeholder)`);
      s = new RangerSheet(key, { ...DEFAULTS, file: '', name: key }, null, this.assets);
      this.sheets.set(key, s);
    }
    return s;
  }
}
