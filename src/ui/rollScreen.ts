/**
 * Starter roll: first a rarity tier is rolled (Common 55%, Uncommon 27%,
 * Rare 13%, Epic 4%, Mythic 1%; data/spawns.json starterTiers), then one
 * Pokémon from that tier. A reel spins through a handful of rolls and stops
 * on the result. Start (Enter or Space) begins the match.
 */
import type { Input } from '../core/input';
import { easeOutCubic } from '../core/math';
import { Rng } from '../core/rng';
import { CONFIG, movesAt, move, species, SPAWNS, SPECIES, type SpeciesDef } from '../sim/data';
import { AnimPlayer, type SpriteRegistry } from '../sprites/pokemonSprite';
import { button, hit, panel, text, type GameContext, type Screen } from './screens';
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

/** Seconds the reel spins before it settles. */
const SPIN = 2.6;
/** Cards on the reel (the last is the result). */
const REEL = 14;

export class RollScreen implements Screen {
  private readonly reel: Card[];
  private readonly pick: Card;
  /** Seconds left of spinning. */
  private spin = SPIN;
  /** Reel position in cards; it eases to rest exactly on the pick. */
  private pos = 0;
  private readonly endPos: number;
  private t = 0;
  /** Sprites for the reel load before it spins. */
  private loaded = false;
  /** Seconds since the reel stopped (for the reveal flash). */
  private since = 0;

  constructor(
    private readonly ctx: GameContext,
    private readonly sprites: SpriteRegistry,
    seed: number,
    private readonly onConfirm: (dex: string) => void,
  ) {
    const rng = new Rng(seed);
    const result = rollStarter(rng);
    // The reel shows other rolls on the way, with the result last.
    this.reel = [];
    for (let i = 0; i < REEL - 1; i++) {
      const r = rollStarter(rng);
      this.reel.push({ def: species(r.dex), tier: r.tier, anim: null });
    }
    this.pick = { def: species(result.dex), tier: result.tier, anim: null };
    this.reel.push(this.pick);
    this.endPos = this.reel.length - 1;
    void this.sprites.preload(this.reel.map((c) => c.def.dex)).then(() => {
      for (const c of this.reel) c.anim = new AnimPlayer(this.sprites.get(c.def.dex));
      this.loaded = true;
    });
  }

  private card(): { x: number; y: number; w: number; h: number } {
    const v = this.ctx.view;
    const s = v.baseScale;
    const w = Math.min(v.width - 40 * s, 560 * s);
    const h = 300 * s;
    return { x: v.width / 2 - w / 2, y: v.height / 2 - h / 2 - 10 * s, w, h };
  }

  private startRect(): { x: number; y: number; w: number; h: number } {
    const v = this.ctx.view;
    const s = v.baseScale;
    const c = this.card();
    return { x: v.width / 2 - 120 * s, y: c.y + c.h + 24 * s, w: 240 * s, h: 54 * s };
  }

  step(dt: number, input: Input): void {
    this.t += dt;
    if (this.loaded && this.spin > 0) {
      this.spin = Math.max(0, this.spin - dt);
      this.pos = this.endPos * easeOutCubic(1 - this.spin / SPIN);
    } else if (this.loaded) this.since += dt;
    for (const c of this.reel) c.anim?.update(dt);
    const b = this.startRect();
    for (const c of input.takeClicks()) if (hit(c.x, c.y, b.x, b.y, b.w, b.h)) this.confirm();
    if (input.pressed('Enter') || input.pressed('Space')) this.confirm();
  }

  private confirm(): void {
    if (!this.loaded || this.spin > 0) return;
    this.onConfirm(this.pick.def.dex);
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
    const spinning = !this.loaded || this.spin > 0;
    text(v, 'STARTER ROLL', v.width / 2, 58 * s, 34, { align: 'center', color: '#e9ddff' });
    text(v, spinning ? 'Rolling…' : `${this.pick.tier.name} starter!`, v.width / 2, 86 * s, 14, { align: 'center', color: spinning ? '#b9b4cc' : this.pick.tier.color });
    const c = this.card();
    h.save();
    h.beginPath();
    h.roundRect(c.x, c.y, c.w, c.h, 18 * s);
    h.clip();
    if (spinning) {
      // The reel slides cards up through the window and settles on the pick.
      const base = Math.floor(this.pos);
      const frac = this.pos - base;
      for (let k = -1; k <= 1; k++) {
        const card = this.reel[base + k];
        if (card) this.drawCard(card, c.x, c.y + (k - frac) * c.h, c.w, c.h, true);
      }
    } else this.drawCard(this.pick, c.x, c.y, c.w, c.h, false);
    h.restore();
    if (!spinning) this.drawReveal(c);
    // The odds, each in its tier colour.
    const odds = STARTER_TIERS.map((t) => ({ t, label: `${t.name} ${t.weight}%` }));
    h.save();
    h.font = `${Math.round(12 * s * 1.3)}px BoldPixels, sans-serif`;
    const gap = 18 * s;
    const widths = odds.map((o) => h.measureText(o.label).width);
    let ox = v.width / 2 - (widths.reduce((a, b) => a + b, 0) + gap * (odds.length - 1)) / 2;
    h.restore();
    odds.forEach((o, i) => {
      text(v, o.label, ox, v.height - 44 * s, 12, { color: o.t.color });
      ox += (widths[i] ?? 0) + gap;
    });
    const b = this.startRect();
    button(v, spinning ? 'Rolling…' : `Start with ${this.pick.def.name}`, b.x, b.y, b.w, b.h, !spinning && hit(this.ctx.input.mouseX, this.ctx.input.mouseY, b.x, b.y, b.w, b.h), spinning ? '#44405a' : '#8a6cff');
    text(v, 'Enter or Space to start', v.width / 2, v.height - 18 * s, 12, { align: 'center', color: '#9f97bb' });
  }

  /** On landing: a burst of light in the tier colour, bigger for rarer tiers. */
  private drawReveal(c: { x: number; y: number; w: number; h: number }): void {
    const v = this.ctx.view;
    const s = v.baseScale;
    const h = v.hud;
    const rank = STARTER_TIERS.indexOf(this.pick.tier);
    const k = Math.max(0, 1 - this.since / (0.6 + rank * 0.25));
    const pulse = rank >= 3 ? 0.35 + 0.25 * Math.sin(this.t * 4) : 0;
    h.save();
    h.strokeStyle = this.pick.tier.color;
    h.lineWidth = (3 + rank) * s;
    h.globalAlpha = Math.min(1, 0.35 + k + pulse);
    h.beginPath();
    h.roundRect(c.x - 4 * s, c.y - 4 * s, c.w + 8 * s, c.h + 8 * s, 20 * s);
    h.stroke();
    if (k > 0) {
      h.globalAlpha = k * 0.5;
      h.fillStyle = this.pick.tier.color;
      h.beginPath();
      h.roundRect(c.x, c.y, c.w, c.h, 18 * s);
      h.fill();
    }
    h.restore();
  }

  private drawCard(card: Card, x: number, y: number, w: number, h: number, dim: boolean): void {
    const v = this.ctx.view;
    const s = v.baseScale;
    const ctx = v.hud;
    panel(v, x, y, w, h, 18, dim ? 'rgba(20,16,36,0.85)' : 'rgba(30,22,58,0.95)');
    // Tier ribbon along the top of the card.
    ctx.fillStyle = card.tier.color;
    ctx.globalAlpha = dim ? 0.55 : 1;
    ctx.fillRect(x + 14 * s, y + 12 * s, w - 28 * s, 6 * s);
    ctx.globalAlpha = 1;
    text(v, card.tier.name.toUpperCase(), x + w - 22 * s, y + 40 * s, 13, { align: 'right', color: card.tier.color });
    if (!card.anim) return;
    // The sprite fills a fixed box whatever its size in the Pokédex, so small starters read as well as big ones.
    const f = card.anim.current();
    const body = card.def.body ?? [24, 24];
    const box = 150 * s;
    const sc = Math.max(1, Math.floor(box / Math.max(body[0], body[1], 1)));
    ctx.imageSmoothingEnabled = false;
    const cx = x + 110 * s;
    const cy = y + h / 2;
    ctx.drawImage(f.image, f.sx, f.sy, f.w, f.h, Math.round(cx - (f.w * sc) / 2), Math.round(cy - (f.h * sc) / 2), f.w * sc, f.h * sc);
    const tx = x + 220 * s;
    text(v, card.def.name, tx, y + 56 * s, 30, {});
    card.def.types.forEach((t, i) => {
      const bx = tx + i * 84 * s;
      const by = y + 72 * s;
      ctx.fillStyle = typeColor(t);
      ctx.beginPath();
      ctx.roundRect(bx, by, 76 * s, 22 * s, 6 * s);
      ctx.fill();
      text(v, t.toUpperCase(), bx + 38 * s, by + 16 * s, 11, { align: 'center', color: '#ffffff' });
    });
    const st = card.def.stats;
    text(v, `HP ${st.hp}  ATK ${st.atk}  DEF ${st.def}`, tx, y + 128 * s, 13, { color: '#cfc6ea' });
    text(v, `SPA ${st.spa}  SPD ${st.spd}  SPE ${st.spe}`, tx, y + 148 * s, 13, { color: '#cfc6ea' });
    const moves = movesAt(card.def, CONFIG.player.level).map((id) => move(id).name);
    text(v, `Starts with: ${moves.join(', ')}`, tx, y + 184 * s, 13, { color: '#bfe3ff' });
    text(v, evolutionLine(card.def), tx, y + 206 * s, 13, { color: '#ffe27a' });
  }
}

/** "Evolves: Lv 18 Grotle · Lv 32 Torterra" (Eevee: "Lv 22 one of 8 Eeveelutions"). */
function evolutionLine(def: SpeciesDef): string {
  const parts: string[] = [];
  let cur: SpeciesDef | undefined = def;
  for (let guard = 0; cur && guard < 4; guard++) {
    const evo: Array<{ to: string; level: number }> = cur.evolves ?? [];
    if (!evo.length) break;
    const first = evo[0] as { to: string; level: number };
    if (evo.length > 1) {
      parts.push(`Lv ${first.level} one of ${evo.length} forms`);
      break;
    }
    cur = SPECIES.get(first.to);
    parts.push(`Lv ${first.level} ${cur?.name ?? first.to}`);
  }
  return parts.length ? `Evolves: ${parts.join(' · ')}` : 'Does not evolve';
}
