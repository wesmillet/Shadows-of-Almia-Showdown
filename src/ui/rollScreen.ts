/**
 * Starter roll: three reels, each rolling its own rarity tier (Common 50%,
 * Uncommon 27%, Rare 13%, Epic 7%, Mythic 3%; data/spawns.json starterTiers)
 * and then a Pokémon of that tier. The reels stop one after another; pick one
 * of the three (click its card or button, or press 1-3) to begin the match.
 */
import type { Input } from '../core/input';
import { easeOutCubic } from '../core/math';
import { Rng } from '../core/rng';
import { CONFIG, movesAt, move, species, SPAWNS, SPECIES, type SpeciesDef } from '../sim/data';
import { AnimPlayer, type SpriteRegistry } from '../sprites/pokemonSprite';
import { button, hit, panel, text, wrapText, type GameContext, type Screen } from './screens';
import { typeColor } from '../sim/data';

export interface StarterTier {
  id: string;
  name: string;
  weight: number;
  color: string;
  dex: string[];
}

export const STARTER_TIERS = (SPAWNS as unknown as { starterTiers: StarterTier[] }).starterTiers;

/** Rolls a tier by weight, then a Pokémon in it. */
export function rollStarter(rng: Rng): { tier: StarterTier; dex: string } {
  const tier = rng.weighted(STARTER_TIERS, (t) => t.weight);
  return { tier, dex: rng.pick(tier.dex) };
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
const CHOICES = 3;
/** Seconds the first reel spins; each next one runs a little longer. */
const SPIN = 2.0;
const STAGGER = 0.55;
/** Cards on each reel (the last is the result). */
const REEL = 12;

export class RollScreen implements Screen {
  private readonly reels: Reel[] = [];
  private t = 0;

  constructor(
    private readonly ctx: GameContext,
    private readonly sprites: SpriteRegistry,
    seed: number,
    private readonly onConfirm: (dex: string) => void,
  ) {
    const rng = new Rng(seed);
    const taken = new Set<string>();
    for (let r = 0; r < CHOICES; r++) {
      // Three different Pokémon (the same tier can come up twice).
      // Every reel rolls its own tier at the full odds; a repeat Pokémon is re-drawn from the
      // same tier, so the tier odds of each reel stay exactly as listed.
      let res = rollStarter(rng);
      const fresh = res.tier.dex.filter((d) => !taken.has(d));
      if (taken.has(res.dex) && fresh.length) res = { tier: res.tier, dex: rng.pick(fresh) };
      taken.add(res.dex);
      const cards: Card[] = [];
      for (let i = 0; i < REEL - 1; i++) {
        const o = rollStarter(rng);
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
    for (const c of input.takeClicks()) {
      for (let i = 0; i < CHOICES; i++) {
        const b = this.pickRect(i);
        const k = this.card(i);
        if (hit(c.x, c.y, b.x, b.y, b.w, b.h) || hit(c.x, c.y, k.x, k.y, k.w, k.h)) this.confirm(i);
      }
    }
    for (let i = 0; i < CHOICES; i++) if (input.pressed(`Digit${i + 1}`)) this.confirm(i);
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
    h.fillStyle = '#100c1e';
    h.fillRect(0, 0, v.width, v.height);
    const grad = h.createRadialGradient(v.width / 2, v.height / 2, 0, v.width / 2, v.height / 2, v.height);
    grad.addColorStop(0, 'rgba(90,50,160,0.35)');
    grad.addColorStop(1, 'rgba(10,6,24,0)');
    h.fillStyle = grad;
    h.fillRect(0, 0, v.width, v.height);
    text(v, 'STARTER ROLL', v.width / 2, 52 * s, 32, { align: 'center', color: '#e9ddff' });
    text(v, this.done ? 'Pick your starter' : 'Rolling…', v.width / 2, 82 * s, 14, { align: 'center', color: '#b9b4cc' });
    const mx = this.ctx.input.mouseX;
    const my = this.ctx.input.mouseY;
    this.reels.forEach((r, i) => {
      const c = this.card(i);
      const spinning = r.spin > 0;
      h.save();
      h.beginPath();
      h.roundRect(c.x, c.y, c.w, c.h, 18 * s);
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
      button(v, this.done ? `${i + 1}  ${r.pick.def.name}` : 'Rolling…', b.x, b.y, b.w, b.h, hover, this.done ? '#8a6cff' : '#44405a');
    });
    // The odds, each in its tier colour.
    const odds = [{ t: { color: '#9f97bb' } as StarterTier, label: 'Odds per reel:' }, ...STARTER_TIERS.map((t) => ({ t, label: `${t.name} ${t.weight}%` }))];
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
    text(v, 'Click a card or press 1-3', v.width / 2, v.height - 16 * s, 12, { align: 'center', color: '#9f97bb' });
  }

  /** On landing: a frame and a burst of light in the tier colour, bigger for rarer tiers. */
  private drawReveal(r: Reel, c: { x: number; y: number; w: number; h: number }): void {
    const v = this.ctx.view;
    const s = v.baseScale;
    const h = v.hud;
    const rank = STARTER_TIERS.indexOf(r.pick.tier);
    const k = Math.max(0, 1 - r.since / (0.6 + rank * 0.25));
    const pulse = rank >= 3 ? 0.35 + 0.25 * Math.sin(this.t * 4) : 0;
    h.save();
    h.strokeStyle = r.pick.tier.color;
    h.lineWidth = (3 + rank) * s;
    h.globalAlpha = Math.min(1, 0.35 + k + pulse);
    h.beginPath();
    h.roundRect(c.x - 4 * s, c.y - 4 * s, c.w + 8 * s, c.h + 8 * s, 20 * s);
    h.stroke();
    if (k > 0) {
      h.globalAlpha = k * 0.5;
      h.fillStyle = r.pick.tier.color;
      h.beginPath();
      h.roundRect(c.x, c.y, c.w, c.h, 18 * s);
      h.fill();
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
    ctx.fillStyle = card.tier.color;
    ctx.globalAlpha = dim ? 0.55 : 1;
    ctx.fillRect(x + 14 * s, y + 12 * s, w - 28 * s, 6 * s);
    ctx.globalAlpha = 1;
    text(v, card.tier.name.toUpperCase(), cx, y + 40 * s, 13, { align: 'center', color: card.tier.color, maxWidth: inner });
    if (card.anim && !card.anim.sprites.loaded) {
      text(v, '?', cx, y + 136 * s, 48, { align: 'center', color: 'rgba(205,191,255,0.35)' });
    } else if (card.anim) {
      // The sprite fills a fixed box whatever its size in the Pokédex, so small starters read as well as big ones.
      const f = card.anim.current();
      const body = card.def.body ?? [24, 24];
      const box = Math.min(100 * s, inner);
      const sc = Math.max(1, Math.floor(box / Math.max(body[0], body[1], 1)));
      ctx.imageSmoothingEnabled = false;
      const sy = y + 122 * s;
      // Kept between the tier label and the name.
      ctx.save();
      ctx.beginPath();
      ctx.rect(x, y + 50 * s, w, 128 * s);
      ctx.clip();
      ctx.drawImage(f.image, f.sx, f.sy, f.w, f.h, Math.round(cx - (f.w * sc) / 2), Math.round(sy - (f.h * sc) / 2), f.w * sc, f.h * sc);
      ctx.restore();
    }
    text(v, card.def.name, cx, y + 200 * s, 24, { align: 'center', maxWidth: inner });
    // Type chips, centred.
    const chipW = Math.min(76 * s, (inner - 8 * s) / 2);
    const types = card.def.types;
    const tw = types.length * chipW + (types.length - 1) * 8 * s;
    types.forEach((t, i) => {
      const bx = cx - tw / 2 + i * (chipW + 8 * s);
      const by = y + 214 * s;
      ctx.fillStyle = typeColor(t);
      ctx.beginPath();
      ctx.roundRect(bx, by, chipW, 22 * s, 6 * s);
      ctx.fill();
      text(v, t.toUpperCase(), bx + chipW / 2, by + 16 * s, 11, { align: 'center', color: '#ffffff', maxWidth: chipW - 8 * s });
    });
    const st = card.def.stats;
    text(v, `HP ${st.hp}  ATK ${st.atk}  DEF ${st.def}`, cx, y + 264 * s, 12, { align: 'center', color: '#cfc6ea', maxWidth: inner });
    text(v, `SPA ${st.spa}  SPD ${st.spd}  SPE ${st.spe}`, cx, y + 282 * s, 12, { align: 'center', color: '#cfc6ea', maxWidth: inner });
    const moves = movesAt(card.def, CONFIG.player.level).map((id) => move(id).name);
    wrapText(v, `Moves: ${moves.join(', ')}`, cx, y + 312 * s, 12, inner, 18 * s, 2, { align: 'center', color: '#bfe3ff' });
    wrapText(v, evolutionLine(card.def), cx, y + 358 * s, 12, inner, 18 * s, 2, { align: 'center', color: '#ffe27a' });
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
