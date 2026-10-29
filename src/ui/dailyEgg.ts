/**
 * The daily Egg on the home page (signed-in players, a game server): one a day (UTC). The Egg's
 * spots show its rarity before it hatches (the server rolls today's Egg the first time it is asked).
 * Clicking it hatches it: it wobbles, cracks (Pokémon Emerald's own hatching frames), bursts into
 * shell pieces in a flash, and the Pokémon steps out, sprite and all; it goes to the PC.
 *
 * Pictures: assets/ui/eggs (scripts/eggs.py).
 */
import type { Connection } from '../net/connection';
import type { Assets } from '../sprites/assets';
import { AnimPlayer, type SpriteRegistry } from '../sprites/pokemonSprite';
import { hit, INK, panel, strip, text } from './screens';
import type { View } from '../render/view';

interface EggState {
  ready: boolean;
  nextAt: number;
  tier: string;
  tierName: string;
  color: string;
  today: { dex: string; name: string; shiny: boolean } | null;
  error?: string;
}
interface Hatched {
  dex: string;
  name: string;
  shiny: boolean;
  tier: string;
  tierName: string;
  color: string;
  nextAt: number;
  error?: string;
}

/** Seconds per cracking frame, then the burst. */
const CRACK_STEP = 0.7;
const BURST_AT = CRACK_STEP * 4;

export class DailyEgg {
  private state: EggState | null = null;
  private signedIn = false;
  private eggs = new Map<string, HTMLImageElement | null>();
  private shards: HTMLImageElement | null = null;
  /** Hatching: seconds since the click (-1: not hatching). */
  private t = -1;
  private result: Hatched | null = null;
  private failed: string | null = null;
  private pieces: Array<{ x: number; y: number; vx: number; vy: number; i: number; spin: number }> = [];
  private flash = 0;
  private mon: AnimPlayer | null = null;
  private clock = 0;

  constructor(
    private readonly net: Connection,
    private readonly assets: Assets,
    private readonly sprites: SpriteRegistry,
    /** Not signed in: a click takes the player online (to sign in). */
    private readonly onSignIn: () => void,
  ) {
    void assets.loadImage('ui/eggs/egg_shards.png').then((im) => (this.shards = im));
    void this.refresh();
  }

  private async refresh(): Promise<void> {
    const me = await this.net.refreshMe().catch(() => null);
    this.signedIn = !!me?.signedIn;
    if (!this.signedIn) return;
    const st = await this.net.api<EggState>('/api/egg').catch(() => null);
    if (!st || st.error) return;
    this.state = st;
    if (st.today) this.showMon(st.today.dex, st.today.shiny);
  }

  private egg(tier: string, hatch: boolean): HTMLImageElement | null {
    const key = `${tier}${hatch ? '_hatch' : ''}`;
    if (!this.eggs.has(key)) {
      this.eggs.set(key, null);
      void this.assets.loadImage(`ui/eggs/egg_${key}.png`).then((im) => this.eggs.set(key, im));
    }
    return this.eggs.get(key) ?? null;
  }

  private showMon(dex: string, shiny: boolean): void {
    const a = new AnimPlayer(this.sprites.get(dex, shiny));
    a.dir = 0;
    a.play('Idle', { loop: true, restart: true });
    this.mon = a;
  }

  /** The card, bottom left of the home page. */
  rect(v: View): { x: number; y: number; w: number; h: number } {
    const s = v.baseScale;
    const w = Math.round(210 * s);
    const h = Math.round(232 * s);
    return { x: Math.round(20 * s), y: Math.round(v.height - h - 20 * s), w, h };
  }

  /** A click on the home page: true when it was the Egg's. */
  click(v: View, x: number, y: number): boolean {
    const r = this.rect(v);
    if (!hit(x, y, r.x, r.y, r.w, r.h)) return false;
    if (!this.signedIn) {
      this.onSignIn();
      return true;
    }
    if (this.state?.ready && this.t < 0) {
      this.t = 0;
      this.failed = null;
      void this.net.api<Hatched>('/api/egg/hatch', {}).then((r) => {
        if (r.error) {
          this.failed = r.error;
          this.t = -1;
          void this.refresh();
          return;
        }
        this.result = r;
        this.showMon(r.dex, r.shiny);
      });
    }
    return true;
  }

  step(dt: number): void {
    this.clock += dt;
    this.mon?.update(dt);
    this.flash = Math.max(0, this.flash - dt * 2.5);
    for (const p of this.pieces) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 260 * dt;
      p.spin += dt * 8;
    }
    if (this.t < 0) return;
    const before = this.t;
    // Cracked all the way and still waiting on the server: it keeps shaking.
    if (this.t + dt >= BURST_AT && !this.result) {
      this.t = Math.min(this.t + dt, BURST_AT - 0.001);
      return;
    }
    this.t += dt;
    if (before < BURST_AT && this.t >= BURST_AT) {
      // The shell flies apart in a flash.
      this.flash = 1;
      this.pieces = [0, 1, 2, 3].map((i) => ({ x: 0, y: -10, vx: [-90, -40, 40, 90][i] as number, vy: -150 - (i % 2) * 40, i, spin: 0 }));
    }
    if (this.t >= BURST_AT + 1.2 && this.result) {
      // Done: today's Egg has hatched.
      const r = this.result;
      this.state = { ready: false, nextAt: r.nextAt, tier: r.tier, tierName: r.tierName, color: r.color, today: { dex: r.dex, name: r.name, shiny: r.shiny } };
      this.t = -1;
      this.result = null;
      this.pieces = [];
    }
  }

  draw(v: View, mx: number, my: number): void {
    const s = v.baseScale;
    const h = v.hud;
    const r = this.rect(v);
    const over = hit(mx, my, r.x, r.y, r.w, r.h);
    panel(v, r.x, r.y, r.w, r.h, 14);
    const cx = r.x + r.w / 2;
    text(v, 'Daily Egg', cx, r.y + 30 * s, 17, { align: 'center', color: INK.text, shadow: false });
    const st = this.state;
    const tier = st?.tier ?? 'common';
    const floor = r.y + 150 * s; // where the Egg (and the Pokémon) stand
    const k = Math.max(2, Math.round(3 * s));
    const hatching = this.t >= 0;
    const hatched = !hatching && st && !st.ready && st.today;
    if (hatching && this.t >= BURST_AT) this.drawMon(v, cx, floor, k);
    else if (hatched) this.drawMon(v, cx, floor, k);
    else {
      // The Egg: a gentle rock while it waits, a hard shake while it hatches.
      const frame = hatching ? Math.min(3, Math.floor(this.t / CRACK_STEP)) : 0;
      const img = hatching ? this.egg(tier, true) : this.egg(tier, false);
      const ready = !!st?.ready && this.signedIn;
      const shake = hatching ? Math.sin(this.t * (18 + frame * 6)) * (0.1 + frame * 0.05) : ready ? Math.sin(this.clock * 2.2) * 0.06 * (Math.sin(this.clock * 0.7) > 0.3 ? 1 : 0) : 0;
      if (img) {
        h.save();
        h.imageSmoothingEnabled = false;
        h.translate(Math.round(cx), Math.round(floor));
        h.rotate(shake);
        if (!this.signedIn) h.globalAlpha = 0.55;
        h.drawImage(img, hatching ? frame * 32 : 0, 0, 32, 32, -16 * k, -30 * k, 32 * k, 32 * k);
        h.restore();
      }
    }
    // The shell pieces and the flash.
    if (this.shards && this.pieces.length) {
      h.save();
      h.imageSmoothingEnabled = false;
      for (const p of this.pieces) {
        h.save();
        h.translate(cx + p.x * s, floor - 14 * k + p.y * s);
        h.rotate(p.spin * (p.i < 2 ? -1 : 1));
        h.drawImage(this.shards, p.i * 8, 0, 8, 8, -4 * k, -4 * k, 8 * k, 8 * k);
        h.restore();
      }
      h.restore();
    }
    if (this.flash > 0) {
      h.save();
      h.globalAlpha = this.flash;
      h.fillStyle = '#fffbe8';
      h.beginPath();
      h.arc(cx, floor - 14 * k, (60 + (1 - this.flash) * 50) * s, 0, Math.PI * 2);
      h.fill();
      h.restore();
    }
    // The words under it.
    const line1 = r.y + 178 * s;
    const line2 = r.y + 200 * s;
    if (!this.signedIn) {
      text(v, 'Sign in online for an Egg', cx, line1, 12, { align: 'center', color: INK.dim, shadow: false, maxWidth: r.w - 20 * s });
      text(v, 'every day', cx, line2, 12, { align: 'center', color: INK.dim, shadow: false });
      return;
    }
    if (!st) {
      text(v, this.failed ?? 'Loading...', cx, line1, 12, { align: 'center', color: INK.dim, shadow: false, maxWidth: r.w - 20 * s });
      return;
    }
    if (hatching) {
      if (this.t < BURST_AT) text(v, 'Oh? The Egg is hatching...', cx, line1, 12, { align: 'center', color: INK.text, shadow: false, maxWidth: r.w - 20 * s });
      else if (this.result) {
        text(v, `${this.result.shiny ? '★ ' : ''}${this.result.name} hatched!`, cx, line1, 14, { align: 'center', color: this.result.shiny ? INK.gold : INK.text, shadow: false, maxWidth: r.w - 20 * s });
        strip(v, this.result.tierName, cx, line2 - 4 * s, 11, ink(this.result.color));
      }
      return;
    }
    if (st.ready) {
      strip(v, `${st.tierName} Egg`, cx, r.y + 158 * s, 11, ink(st.color));
      text(v, over ? 'Click to hatch it!' : 'Click to hatch', cx, line2 + 2 * s, 13, { align: 'center', color: over ? INK.accent : INK.text, shadow: false });
      return;
    }
    if (st.today) {
      text(v, `${st.today.shiny ? '★ ' : ''}${st.today.name} · in your PC`, cx, line1, 12, { align: 'center', color: st.today.shiny ? INK.gold : INK.text, shadow: false, maxWidth: r.w - 20 * s });
    }
    text(v, `Next Egg in ${until(st.nextAt)}`, cx, line2, 12, { align: 'center', color: INK.dim, shadow: false, maxWidth: r.w - 20 * s });
  }

  /** The Pokémon standing where the Egg was, in its own idle animation. */
  private drawMon(v: View, cx: number, floor: number, k: number): void {
    const a = this.mon;
    if (!a) return;
    const f = a.current();
    if (f.placeholder) return;
    const h = v.hud;
    // Sprite frames are anchored bottom-centre with some empty margin: stand it on the floor line.
    const sc = Math.max(1, Math.min(k, Math.floor((150 * v.baseScale) / Math.max(f.w, f.h))));
    h.save();
    h.imageSmoothingEnabled = false;
    h.drawImage(f.image, f.sx, f.sy, f.w, f.h, Math.round(cx - (f.w * sc) / 2), Math.round(floor - f.h * sc * 0.82), f.w * sc, f.h * sc);
    h.restore();
  }
}

/** A tier's colour dark enough to read on the cream panels (the tiers' own colours are light). */
function ink(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const f = (v: number) => Math.round(v * 0.62).toString(16).padStart(2, '0');
  return `#${f((n >> 16) & 255)}${f((n >> 8) & 255)}${f(n & 255)}`;
}

/** "5 h 12 min" until `at`. */
function until(at: number): string {
  const m = Math.max(1, Math.ceil((at - Date.now()) / 60000));
  return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`;
}
