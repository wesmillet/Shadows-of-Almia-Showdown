/**
 * Starter roll: three reels, each rolling its own rarity tier (Common 50%,
 * Uncommon 27%, Rare 13%, Epic 7%, Mythic 3%; data/spawns.json starterTiers)
 * and then a Pokémon of that tier. The reels stop one after another; pick one
 * of the three (click its card or button, or press 1-3) to begin the match.
 */
import type { Input } from '../core/input';
import { easeOutCubic } from '../core/math';
import { Rng } from '../core/rng';
import { CONFIG, movesAt, move, species, SPECIES, type SpeciesDef } from '../sim/data';
import { AnimPlayer, type SpriteRegistry } from '../sprites/pokemonSprite';
import { backdrop, button, heading, hit, INK, panel, skinPx, text, wrapText, type GameContext, type Screen } from './screens';
import { typeColor } from '../sim/data';

import { poolSize, poolTiers, REEL_CARDS, rollChoice, rollStarter, STARTER_CHOICES, STARTER_TIERS, type StarterTier } from '../sim/starters';

export { rollStarter, STARTER_TIERS, type StarterTier };

/** The box round a frame's visible pixels (cached; frames don't change). */
const boxes = new Map<string, { x0: number; y0: number; x1: number; y1: number }>();
let scratch: HTMLCanvasElement | null = null;
const ids = new WeakMap<object, number>();
let nextId = 1;
function opaqueBox(img: CanvasImageSource, sx: number, sy: number, w: number, h: number): { x0: number; y0: number; x1: number; y1: number } {
  let id = ids.get(img as object);
  if (!id) ids.set(img as object, (id = nextId++));
  const key = `${id}:${sx}:${sy}:${w}:${h}`;
  const hit = boxes.get(key);
  if (hit) return hit;
  scratch ??= document.createElement('canvas');
  scratch.width = w;
  scratch.height = h;
  const c = scratch.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D;
  c.clearRect(0, 0, w, h);
  c.drawImage(img, sx, sy, w, h, 0, 0, w, h);
  const px = c.getImageData(0, 0, w, h).data;
  let x0 = w, y0 = h, x1 = 0, y1 = 0;
  for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) {
    if ((px[(yy * w + xx) * 4 + 3] ?? 0) < 40) continue;
    if (xx < x0) x0 = xx;
    if (yy < y0) y0 = yy;
    if (xx + 1 > x1) x1 = xx + 1;
    if (yy + 1 > y1) y1 = yy + 1;
  }
  const box = x1 > x0 ? { x0, y0, x1, y1 } : { x0: 0, y0: 0, x1: w, y1: h };
  boxes.set(key, box);
  return box;
}

interface Card {
  def: SpeciesDef;
  tier: StarterTier;
  anim: AnimPlayer | null;
}

interface Reel {
  cards: Card[];
  /** The result: the reel's last card. */
  pick: Card;
  spinFor: number;
  spin: number;
  pos: number;
  /** Seconds since this reel stopped (for the reveal flash). */
  since: number;
}

/** How many starters are offered. */
const CHOICES = STARTER_CHOICES;
/** Seconds the first reel spins; each next one runs a little longer. */
const SPIN = 2.0;
const STAGGER = 0.55;
/** Cards on each reel (the last is the result). */
const REEL = REEL_CARDS;

export class RollScreen implements Screen {
  private readonly reels: Reel[] = [];
  private readonly tiers: StarterTier[];
  private t = 0;

  constructor(
    private readonly ctx: GameContext,
    private readonly sprites: SpriteRegistry,
    seed: number,
    private readonly onConfirm: (dex: string) => void,
    /** Rolls a fresh set of three (the Reroll button or R); for testing while the PC starters are planned. */
    private readonly onReroll: (() => void) | null = null,
    /** Starters this player has unlocked through their PC (src/sim/starters.ts). */
    private readonly unlocked: readonly string[] = [],
  ) {
    const rng = new Rng(seed);
    const tiers = poolTiers(unlocked);
    this.tiers = tiers;
    const taken = new Set<string>();
    for (let r = 0; r < CHOICES; r++) {
      // Three different Pokémon (the same tier can come up twice): src/sim/starters.ts, which the
      // game server also uses to know what a seed offered.
      const res = rollChoice(rng, taken, tiers);
      const cards: Card[] = [];
      for (let i = 0; i < REEL - 1; i++) {
        const o = rollStarter(rng, tiers);
        cards.push({ def: species(o.dex), tier: o.tier, anim: null });
      }
      const pick: Card = { def: species(res.dex), tier: res.tier, anim: null };
      cards.push(pick);
      const spinFor = SPIN + r * STAGGER;
      this.reels.push({ cards, pick, spinFor, spin: spinFor, pos: 0, since: 0 });
    }
    // The three picks load first (the reels settle on them), then the cards that fly past.
    // The reels spin straight away; a card whose sprite is not in yet shows its name.
    const picks = this.reels.map((r) => r.pick.def.dex);
    void this.sprites.preload(picks, undefined, true);
    void this.sprites.preload(this.reels.flatMap((r) => r.cards.map((c) => c.def.dex)), undefined, true);
    for (const c of this.reels.flatMap((r) => r.cards)) c.anim = new AnimPlayer(this.sprites.get(c.def.dex));
  }

  private get done(): boolean {
    return this.reels.every((r) => r.spin <= 0);
  }

  /** Card rectangles, side by side. */
  private card(i: number): { x: number; y: number; w: number; h: number } {
    const v = this.ctx.view;
    const s = v.baseScale;
    const gap = 18 * s;
    const w = Math.min((v.width - 48 * s - gap * (CHOICES - 1)) / CHOICES, 300 * s);
    const h = 400 * s;
    const total = w * CHOICES + gap * (CHOICES - 1);
    return { x: v.width / 2 - total / 2 + i * (w + gap), y: 112 * s, w, h };
  }

  private pickRect(i: number): { x: number; y: number; w: number; h: number } {
    const s = this.ctx.view.baseScale;
    const c = this.card(i);
    return { x: c.x + 16 * s, y: c.y + c.h + 16 * s, w: c.w - 32 * s, h: 50 * s };
  }

  step(dt: number, input: Input): void {
    this.t += dt;
    for (const r of this.reels) {
      if (r.spin > 0) {
        r.spin = Math.max(0, r.spin - dt);
        r.pos = (r.cards.length - 1) * easeOutCubic(1 - r.spin / r.spinFor);
      } else r.since += dt;
    }
    for (const r of this.reels) for (const c of r.cards) c.anim?.update(dt);
    if (this.onReroll && input.pressed('KeyR')) return this.onReroll();
    for (const c of input.takeClicks()) {
      const rr = this.rerollRect();
      if (this.onReroll && hit(c.x, c.y, rr.x, rr.y, rr.w, rr.h)) return this.onReroll();
      for (let i = 0; i < CHOICES; i++) {
        const b = this.pickRect(i);
        const k = this.card(i);
        if (hit(c.x, c.y, b.x, b.y, b.w, b.h) || hit(c.x, c.y, k.x, k.y, k.w, k.h)) this.confirm(i);
      }
    }
    for (let i = 0; i < CHOICES; i++) if (input.pressed(`Digit${i + 1}`)) this.confirm(i);
  }

  /** The Reroll button, top right. */
  private rerollRect(): { x: number; y: number; w: number; h: number } {
    const v = this.ctx.view;
    const s = v.baseScale;
    return { x: v.width - 190 * s, y: 30 * s, w: 170 * s, h: 44 * s };
  }

  private confirm(i: number): void {
    const r = this.reels[i];
    if (!r) return;
    if (!this.done) {
      // Impatient: a click or key while the reels spin stops them all on their picks.
      for (const q of this.reels) {
        q.spin = 0;
        q.pos = q.cards.length - 1;
      }
      return;
    }
    this.onConfirm(r.pick.def.dex);
  }

  render(): void {
    const v = this.ctx.view;
    const s = v.baseScale;
    const h = v.hud;
    h.clearRect(0, 0, v.width, v.height);
    backdrop(v);
    heading(v, 'STARTER ROLL', this.done ? 'Pick your starter' : 'Rolling…', 52 * s);
    const mx = this.ctx.input.mouseX;
    const my = this.ctx.input.mouseY;
    this.reels.forEach((r, i) => {
      const c = this.card(i);
      const spinning = r.spin > 0;
      h.save();
      h.beginPath();
      h.rect(c.x, c.y, c.w, c.h);
      h.clip();
      if (spinning) {
        // The reel slides cards up through the window and settles on the pick.
        const base = Math.floor(r.pos);
        const frac = r.pos - base;
        for (let k = -1; k <= 1; k++) {
          const card = r.cards[base + k];
          if (card) this.drawCard(card, c.x, c.y + (k - frac) * c.h, c.w, c.h, true);
        }
      } else this.drawCard(r.pick, c.x, c.y, c.w, c.h, false);
      h.restore();
      if (!spinning) this.drawReveal(r, c);
      const b = this.pickRect(i);
      const hover = this.done && (hit(mx, my, b.x, b.y, b.w, b.h) || hit(mx, my, c.x, c.y, c.w, c.h));
      button(v, this.done ? `${i + 1}  ${r.pick.def.name}` : 'Rolling…', b.x, b.y, b.w, b.h, hover, this.done ? undefined : '#44405a');
    });
    // The odds of this player's pool, each in its tier colour (tiers they have nothing in yet are left out).
    const total = this.tiers.reduce((n, t) => n + t.weight, 0) || 1;
    const odds = [{ t: { color: '#9f97bb' } as StarterTier, label: 'Odds per reel:' }, ...this.tiers.map((t) => ({ t, label: `${t.name} ${Math.round((t.weight / total) * 100)}%` }))];
    h.save();
    h.font = `${Math.round(12 * s * 1.3)}px BoldPixels, sans-serif`;
    const gap = 18 * s;
    const widths = odds.map((o) => h.measureText(o.label).width);
    let ox = v.width / 2 - (widths.reduce((a, b) => a + b, 0) + gap * (odds.length - 1)) / 2;
    h.restore();
    odds.forEach((o, i) => {
      text(v, o.label, ox, v.height - 40 * s, 12, { color: o.t.color });
      ox += (widths[i] ?? 0) + gap;
    });
    const all = STARTER_TIERS.reduce((n, t) => n + t.dex.length, 0);
    text(v, `Click a card or press 1-3 · ${poolSize(this.unlocked)} starters in your pool: every Pokémon you keep in your PC adds its line (${all}+ to find)`, v.width / 2, v.height - 16 * s, 12, { align: 'center', color: '#cdbfe6', maxWidth: v.width - 30 * s });
    if (this.onReroll) {
      const rr = this.rerollRect();
      button(v, 'Reroll (R)', rr.x, rr.y, rr.w, rr.h, hit(this.ctx.input.mouseX, this.ctx.input.mouseY, rr.x, rr.y, rr.w, rr.h), '#f4e6c8');
    }
  }

  /** On landing: a frame and a burst of light in the tier colour, bigger for rarer tiers. */
  private drawReveal(r: Reel, c: { x: number; y: number; w: number; h: number }): void {
    const v = this.ctx.view;
    const s = v.baseScale;
    const h = v.hud;
    const rank = STARTER_TIERS.findIndex((t) => t.id === r.pick.tier.id);
    const k = Math.max(0, 1 - r.since / (0.6 + rank * 0.25));
    const pulse = rank >= 3 ? 0.35 + 0.25 * Math.sin(this.t * 4) : 0;
    h.save();
    h.strokeStyle = r.pick.tier.color;
    h.lineWidth = (3 + rank) * s;
    h.globalAlpha = Math.min(1, 0.35 + k + pulse);
    h.strokeRect(c.x - 4 * s, c.y - 4 * s, c.w + 8 * s, c.h + 8 * s);
    if (k > 0) {
      h.globalAlpha = k * 0.5;
      h.fillStyle = r.pick.tier.color;
      h.fillRect(c.x, c.y, c.w, c.h);
    }
    h.restore();
  }

  /** One card, top to bottom: tier, sprite, name, types, stats, first moves, evolutions. */
  private drawCard(card: Card, x: number, y: number, w: number, h: number, dim: boolean): void {
    const v = this.ctx.view;
    const s = v.baseScale;
    const ctx = v.hud;
    const cx = x + w / 2;
    const inner = w - 36 * s;
    panel(v, x, y, w, h, 18, dim ? 'rgba(20,16,36,0.85)' : 'rgba(30,22,58,0.95)');
    // The tier as a chip in its colour across the top.
    const k = skinPx(v);
    const chipH = Math.round(24 * s);
    const chipX = Math.round(x + 4 * k);
    const chipY = Math.round(y + 4 * k);
    const tierW = Math.round(w - 8 * k);
    ctx.globalAlpha = dim ? 0.6 : 1;
    ctx.fillStyle = '#2a1a10';
    ctx.fillRect(chipX, chipY, tierW, chipH);
    ctx.fillStyle = card.tier.color;
    ctx.fillRect(chipX + k / 1.5, chipY + k / 1.5, tierW - (2 * k) / 1.5, chipH - (2 * k) / 1.5);
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    ctx.fillRect(chipX + k / 1.5, chipY + k / 1.5, tierW - (2 * k) / 1.5, Math.max(1, Math.round(k / 1.5)));
    ctx.globalAlpha = 1;
    text(v, card.tier.name.toUpperCase(), cx, chipY + chipH / 2 + 5 * s, 13, { align: 'center', color: '#ffffff', shadowColor: 'rgba(20,10,4,0.75)', maxWidth: inner });
    if (card.anim && !card.anim.sprites.loaded) {
      text(v, '?', cx, y + 136 * s, 48, { align: 'center', color: 'rgba(138,106,74,0.4)', shadow: false });
    } else if (card.anim) {
      // Every Pokémon stands on the same line and is scaled to fit the space between the tier label and
      // its name: measured from the visible pixels of its frame, so no two stand at different heights.
      const f = card.anim.current();
      const bb = opaqueBox(f.image, f.sx, f.sy, f.w, f.h);
      const bw = Math.max(1, bb.x1 - bb.x0);
      const bh = Math.max(1, bb.y1 - bb.y0);
      const sc = Math.max(1, Math.floor(Math.min((inner * 0.92) / bw, (100 * s) / bh)));
      ctx.imageSmoothingEnabled = false;
      const feet = y + 170 * s;
      ctx.save();
      ctx.beginPath();
      ctx.rect(x, y + 46 * s, w, 132 * s);
      ctx.clip();
      ctx.drawImage(f.image, f.sx, f.sy, f.w, f.h, Math.round(cx - ((bb.x0 + bb.x1) / 2) * sc), Math.round(feet - bb.y1 * sc), f.w * sc, f.h * sc);
      ctx.restore();
    }
    text(v, card.def.name, cx, y + 200 * s, 24, { align: 'center', color: INK.text, shadow: false, maxWidth: inner });
    // Type chips, centred.
    const chipW = Math.min(76 * s, (inner - 8 * s) / 2);
    const types = card.def.types;
    const tw = types.length * chipW + (types.length - 1) * 8 * s;
    types.forEach((t, i) => {
      const bx = cx - tw / 2 + i * (chipW + 8 * s);
      const by = y + 214 * s;
      ctx.fillStyle = '#2a1a10';
      ctx.fillRect(Math.round(bx), Math.round(by), Math.round(chipW), Math.round(22 * s));
      ctx.fillStyle = typeColor(t);
      ctx.fillRect(Math.round(bx + s), Math.round(by + s), Math.round(chipW - 2 * s), Math.round(20 * s));
      text(v, t.toUpperCase(), bx + chipW / 2, by + 16 * s, 11, { align: 'center', color: '#ffffff', shadowColor: 'rgba(20,10,4,0.7)', maxWidth: chipW - 8 * s });
    });
    const st = card.def.stats;
    text(v, `HP ${st.hp}  ATK ${st.atk}  DEF ${st.def}`, cx, y + 264 * s, 12, { align: 'center', color: INK.dim, shadow: false, maxWidth: inner });
    text(v, `SPA ${st.spa}  SPD ${st.spd}  SPE ${st.spe}`, cx, y + 282 * s, 12, { align: 'center', color: INK.dim, shadow: false, maxWidth: inner });
    const moves = movesAt(card.def, CONFIG.player.level).map((id) => move(id).name);
    wrapText(v, `Moves: ${moves.join(', ')}`, cx, y + 312 * s, 12, inner, 18 * s, 2, { align: 'center', color: INK.blue, shadow: false });
    wrapText(v, evolutionLine(card.def), cx, y + 358 * s, 12, inner, 18 * s, 2, { align: 'center', color: INK.gold, shadow: false });
  }
}

/** "Evolves: Lv 18 Grotle, Lv 32 Torterra" (Eevee: "Lv 22 one of 8 forms"). */
function evolutionLine(def: SpeciesDef): string {
  const parts: string[] = [];
  let cur: SpeciesDef | undefined = def;
  for (let guard = 0; cur && guard < 4; guard++) {
    const all: Array<{ to: string; level: number; item?: string }> = cur.evolves ?? [];
    const stones = all.filter((e) => e.item);
    const evo = all.filter((e) => !e.item);
    if (stones.length && !evo.length && stones.length === 1) {
      const st = stones[0] as { to: string; item?: string };
      parts.push(`${(st.item ?? '').replace('-', ' ').replace(/\b\w/g, (c) => c.toUpperCase())} ${SPECIES.get(st.to)?.name ?? st.to}`);
      break;
    }
    if (stones.length) {
      parts.push(`stones and levels, ${all.length} forms`);
      break;
    }
    if (!evo.length) break;
    const first = evo[0] as { to: string; level: number };
    if (evo.length > 1) {
      parts.push(`Lv ${first.level} one of ${evo.length} forms`);
      break;
    }
    cur = SPECIES.get(first.to);
    parts.push(`Lv ${first.level} ${cur?.name ?? first.to}`);
  }
  return parts.length ? `Evolves: ${parts.join(', ')}` : 'Does not evolve';
}
