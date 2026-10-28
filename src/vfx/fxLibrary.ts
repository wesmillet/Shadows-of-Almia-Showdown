/**
 * Guardian Signs attack effects (assets/fx/guardian_signs/). The manifest
 * lists each effect's frame size and count; frames are packed left to
 * right in one PNG. Sheets load lazily, are tinted on demand, and expose a
 * dominant colour so an effect can light the scene with its own hue.
 */
import { imagePixels, warnOnce, type Assets } from '../sprites/assets';

export interface FxMeta {
  file: string;
  frame_w: number;
  frame_h: number;
  frames: number;
  /** Leading frames showing under a quarter of the fullest frame (scripts/fx_lead_in.py). */
  lead_in?: number;
}

export const FX_MANIFEST_PATH = 'fx/guardian_signs/manifest.json';

export interface FxSheet {
  id: string;
  img: HTMLImageElement;
  fw: number;
  fh: number;
  frames: number;
  /** Leading frames an impact on a hit Pokémon skips (still a speck: scripts/fx_lead_in.py). */
  leadIn: number;
  /** Dominant opaque colour, for the lighting layer. */
  color: string;
  tinted: Map<string, HTMLCanvasElement>;
}

export type FxState = FxSheet | 'loading' | 'missing';

export class FxLibrary {
  private sheets = new Map<string, FxState>();
  /** The manifest once fetched; ids asked for before that wait in `wanted`. */
  private manifest: Record<string, FxMeta> | null = null;
  private manifestMissing = false;
  private wanted = new Set<string>();

  constructor(private readonly assets: Assets) {
    void assets.json<{ effects: Record<string, FxMeta> }>(FX_MANIFEST_PATH).then((m) => {
      if (!m?.effects) {
        this.manifestMissing = true;
        return;
      }
      this.manifest = m.effects;
      for (const id of this.wanted) this.get(id);
      this.wanted.clear();
    });
  }

  /** Starts loading a set of effects (call once with every id a match can use). */
  preload(ids: Iterable<string>): void {
    for (const id of ids) this.get(id);
  }

  /** The loaded sheet, or its load state. Missing ids warn once and never crash. */
  get(id: string): FxState {
    const cur = this.sheets.get(id);
    if (cur) return cur;
    if (!this.manifest) {
      if (this.manifestMissing) return 'missing';
      this.wanted.add(id);
      return 'loading';
    }
    const meta = this.manifest[id];
    if (!meta) {
      warnOnce(`fx:${id}`, `fx manifest has no effect ${id} (procedural fallback)`);
      this.sheets.set(id, 'missing');
      return 'missing';
    }
    this.sheets.set(id, 'loading');
    void this.assets.loadImage(`fx/guardian_signs/${meta.file}`).then((img) => {
      if (!img) {
        this.sheets.set(id, 'missing');
        return;
      }
      this.sheets.set(id, { id, img, fw: meta.frame_w, fh: meta.frame_h, frames: Math.max(1, meta.frames), leadIn: Math.max(0, Math.min(meta.frames - 1, meta.lead_in ?? 0)), color: dominantColor(img), tinted: new Map() });
    });
    return 'loading';
  }

  /** The sheet when it is loaded, else null. */
  sheet(id: string): FxSheet | null {
    const s = this.get(id);
    return typeof s === 'string' ? null : s;
  }

  /** True when every id is loaded (a missing one counts as not ready, so the move falls back). */
  ready(ids: string[]): boolean {
    return ids.every((id) => this.sheet(id) !== null);
  }
}

/** Average colour of the sheet's opaque pixels, weighted toward saturated ones, lifted so it reads as light. */
export function dominantColor(img: HTMLImageElement): string {
  let px: Uint8ClampedArray;
  try {
    px = imagePixels(img);
  } catch {
    return '#ffffff';
  }
  let r = 0;
  let g = 0;
  let b = 0;
  let wsum = 0;
  for (let i = 0; i < px.length; i += 4) {
    const a = px[i + 3] as number;
    if (a < 100) continue;
    const pr = px[i] as number;
    const pg = px[i + 1] as number;
    const pb = px[i + 2] as number;
    const max = Math.max(pr, pg, pb);
    const min = Math.min(pr, pg, pb);
    const sat = max === 0 ? 0 : (max - min) / max;
    const w = 0.08 + sat * sat;
    r += pr * w;
    g += pg * w;
    b += pb * w;
    wsum += w;
  }
  if (wsum === 0) return '#ffffff';
  r /= wsum;
  g /= wsum;
  b /= wsum;
  // Lift toward white a little so dark effects (clouds) still cast a visible glow.
  const lift = (c: number) => Math.round(Math.min(255, c * 0.85 + 60));
  return `#${[lift(r), lift(g), lift(b)].map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}

/** A copy of the sheet with the tint multiplied over its opaque pixels (cached per tint). */
export function tintedSheet(sheet: FxSheet, tint: string): HTMLCanvasElement {
  let c = sheet.tinted.get(tint);
  if (c) return c;
  c = document.createElement('canvas');
  c.width = sheet.img.naturalWidth;
  c.height = sheet.img.naturalHeight;
  const ctx = c.getContext('2d') as CanvasRenderingContext2D;
  ctx.drawImage(sheet.img, 0, 0);
  ctx.globalCompositeOperation = 'multiply';
  ctx.fillStyle = tint;
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.globalCompositeOperation = 'destination-in';
  ctx.drawImage(sheet.img, 0, 0);
  ctx.globalCompositeOperation = 'source-over';
  sheet.tinted.set(tint, c);
  return c;
}
