/**
 * Overworld sheets for the humans (player, AI trainers, host, outpost
 * staff) from assets/rangers/manifest.json: one packed PNG per character,
 * frames left to right in a uniform cell, sprite anchored bottom-centre.
 * The manifest's shared `animations` table names the frame indices of
 * idle_down / idle_left / idle_up and the walk cycles; `mirror` says which
 * right-facing animations are the left-facing ones flipped.
 *
 * Roles (player, trainer_a, …) map to manifest characters in
 * data/characters.json. A role whose character has no sheet draws the
 * labeled placeholder.
 */
import charactersJson from '../../data/characters.json';
import { Assets, warnOnce } from './assets';

export type Facing4 = 'up' | 'down' | 'left' | 'right';

export interface AlmiaCharacter {
  file: string;
  frame_w: number;
  frame_h: number;
  frames: number;
  anchor?: string;
}

export interface AlmiaManifest {
  source?: string;
  animations: Record<string, number[]>;
  mirror?: Record<string, string>;
  characters: Record<string, AlmiaCharacter>;
}

export interface SheetRect {
  image: CanvasImageSource;
  sx: number;
  sy: number;
  w: number;
  h: number;
  /** Pixel row of the feet inside the frame (frame height: bottom-centre anchor). */
  footY: number;
  /** Draw mirrored horizontally. */
  flip: boolean;
  placeholder: boolean;
}

const ROLES = (charactersJson as { roles: Record<string, { character: string; name: string }> }).roles;

export class RangerSheet {
  constructor(
    readonly role: string,
    readonly name: string,
    readonly character: string,
    private readonly def: AlmiaCharacter | null,
    private readonly image: HTMLImageElement | null,
    private readonly manifest: AlmiaManifest | null,
    private readonly assets: Assets,
  ) {}

  /** Frame indices for an animation, resolving mirrored right-facing entries. */
  private clip(name: string): { frames: number[]; flip: boolean } {
    const m = this.manifest;
    if (!m) return { frames: [0], flip: false };
    const direct = m.animations[name];
    if (direct && direct.length) return { frames: direct, flip: false };
    const mirrored = m.mirror?.[name];
    const alt = mirrored ? m.animations[mirrored] : undefined;
    if (alt && alt.length) return { frames: alt, flip: true };
    const fallback = m.animations.idle_down ?? [0];
    return { frames: fallback, flip: false };
  }

  /** Frame for a facing and a walk-cycle phase in [0, 1); `moving` false gives the idle pose. */
  frame(facing: Facing4, phase: number, moving: boolean): SheetRect {
    const def = this.def;
    if (!def || !this.image) {
      const w = def?.frame_w ?? 22;
      const h = def?.frame_h ?? 34;
      const ph = this.assets.placeholder(this.role, w, h);
      return { image: ph, sx: 0, sy: 0, w, h, footY: h, flip: false, placeholder: true };
    }
    const clip = this.clip(`${moving ? 'walk' : 'idle'}_${facing}`);
    const flip = clip.flip;
    // Three-frame walks (step, stand, step) play as a four-beat cycle: step, stand, other step, stand.
    const frames = clip.frames.length === 3 ? [clip.frames[0], clip.frames[1], clip.frames[2], clip.frames[1]] as number[] : clip.frames;
    const idx = frames[Math.floor(((phase % 1) + 1) % 1 * frames.length) % frames.length] ?? 0;
    const cellW = def.frame_w || Math.floor(this.image.naturalWidth / Math.max(1, def.frames));
    const cellH = def.frame_h || this.image.naturalHeight;
    const col = Math.min(idx, Math.max(0, def.frames - 1));
    return { image: this.image, sx: col * cellW, sy: 0, w: cellW, h: cellH, footY: cellH, flip, placeholder: false };
  }
}

export class RangerSprites {
  private sheets = new Map<string, RangerSheet>();
  private manifest: AlmiaManifest | null = null;

  private constructor(private readonly assets: Assets) {}

  static async load(assets: Assets): Promise<RangerSprites> {
    const rs = new RangerSprites(assets);
    rs.manifest = await assets.json<AlmiaManifest>('rangers/manifest.json');
    if (!rs.manifest) return rs;
    const jobs: Promise<void>[] = [];
    for (const [role, entry] of Object.entries(ROLES)) {
      const def = rs.manifest.characters[entry.character] ?? null;
      if (!def) {
        warnOnce(`rangers/${role}`, `rangers/manifest.json has no character "${entry.character}" for role ${role} (drawing a placeholder)`);
        rs.sheets.set(role, new RangerSheet(role, entry.name, entry.character, null, null, rs.manifest, assets));
        continue;
      }
      jobs.push(assets.loadImage(`rangers/${def.file}`).then((img) => {
        rs.sheets.set(role, new RangerSheet(role, entry.name, entry.character, def, img, rs.manifest, assets));
      }));
    }
    await Promise.all(jobs);
    return rs;
  }

  get(role: string): RangerSheet {
    let s = this.sheets.get(role);
    if (!s) {
      warnOnce(`rangers/${role}`, `data/characters.json has no role "${role}" (drawing a placeholder)`);
      s = new RangerSheet(role, role, role, null, null, this.manifest, this.assets);
      this.sheets.set(role, s);
    }
    return s;
  }

  /** Display name for a role from data/characters.json. */
  roleName(role: string): string {
    return ROLES[role]?.name ?? role;
  }
}
