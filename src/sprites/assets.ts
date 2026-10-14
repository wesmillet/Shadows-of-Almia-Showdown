/**
 * Image, text and JSON loading with the project's hard rule baked in:
 * nothing is drawn without a file in /assets. A missing or broken file
 * yields `null` plus one console warning, and callers draw a labeled
 * placeholder from `placeholder()` instead. Nothing here ever throws for a
 * missing asset.
 */
export const ASSET_ROOT = 'assets/';

const warned = new Set<string>();

export function warnOnce(key: string, message: string): void {
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(`[nightfall] ${message}`);
}

export class Assets {
  private images = new Map<string, Promise<HTMLImageElement | null>>();
  private placeholders = new Map<string, HTMLCanvasElement>();

  loadImage(path: string): Promise<HTMLImageElement | null> {
    let p = this.images.get(path);
    if (!p) {
      p = new Promise<HTMLImageElement | null>((resolve) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => {
          warnOnce(path, `missing asset: ${path} (drawing a placeholder)`);
          resolve(null);
        };
        img.src = ASSET_ROOT + path;
      });
      this.images.set(path, p);
    }
    return p;
  }

  async text(path: string): Promise<string | null> {
    try {
      const r = await fetch(ASSET_ROOT + path, { cache: 'no-cache' });
      if (!r.ok) throw new Error(String(r.status));
      return await r.text();
    } catch {
      warnOnce(path, `missing asset: ${path}`);
      return null;
    }
  }

  async json<T>(path: string): Promise<T | null> {
    const t = await this.text(path);
    if (t === null) return null;
    try {
      return JSON.parse(t) as T;
    } catch {
      warnOnce(path + '#parse', `asset is not valid JSON: ${path}`);
      return null;
    }
  }

  /** A magenta box with the asset label, cached per label and size. */
  placeholder(label: string, w: number, h: number): HTMLCanvasElement {
    const key = `${label}|${w}x${h}`;
    let c = this.placeholders.get(key);
    if (c) return c;
    c = document.createElement('canvas');
    c.width = Math.max(8, w);
    c.height = Math.max(8, h);
    const g = c.getContext('2d')!;
    g.fillStyle = '#ff2bd6';
    g.fillRect(0, 0, c.width, c.height);
    g.fillStyle = '#1b0b1a';
    for (let i = -c.height; i < c.width; i += 8) {
      g.beginPath();
      g.moveTo(i, c.height);
      g.lineTo(i + c.height, 0);
      g.lineTo(i + c.height + 3, 0);
      g.lineTo(i + 3, c.height);
      g.fill();
    }
    g.strokeStyle = '#fff';
    g.lineWidth = 1;
    g.strokeRect(0.5, 0.5, c.width - 1, c.height - 1);
    g.fillStyle = '#fff';
    g.font = `bold ${Math.max(7, Math.min(11, Math.floor(c.width / 4)))}px sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const lines = label.length > 10 ? [label.slice(0, 10), label.slice(10, 20)] : [label];
    lines.forEach((ln, i) => g.fillText(ln, c.width / 2, c.height / 2 + (i - (lines.length - 1) / 2) * 10, c.width - 2));
    this.placeholders.set(key, c);
    return c;
  }
}

/** Reads a loaded image's pixels (for Offsets sheets). */
export function imagePixels(img: HTMLImageElement): Uint8ClampedArray {
  const c = document.createElement('canvas');
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  const g = c.getContext('2d', { willReadFrequently: true })!;
  g.drawImage(img, 0, 0);
  return g.getImageData(0, 0, c.width, c.height).data;
}
