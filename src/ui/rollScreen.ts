/**
 * Starter roll: a vertical reel of four candidates playing Idle spins and
 * stops. Up to three rerolls, each removing the highest remaining tier from
 * the pool. Click a candidate, then Confirm.
 */
import type { Input } from '../core/input';
import { easeOutCubic } from '../core/math';
import { Rng } from '../core/rng';
import { CONFIG, species, SPAWNS, SPECIES, type SpeciesDef } from '../sim/data';
import { AnimPlayer, type SpriteRegistry } from '../sprites/pokemonSprite';
import { button, hit, panel, text, type GameContext, type Screen } from './screens';
import { typeColor } from '../sim/data';

interface Card {
  def: SpeciesDef;
  anim: AnimPlayer;
}

const MAX_REROLLS = 3;

export class RollScreen implements Screen {
  private pool: SpeciesDef[];
  private cards: Card[] = [];
  private spin = 0; // seconds left of spinning
  private spinOffset = 0;
  private spinSpeed = 0;
  private selected = -1;
  private rerolls = 0;
  private readonly rng: Rng;
  private t = 0;
  private cycle: Card[] = [];

  constructor(
    private readonly ctx: GameContext,
    private readonly sprites: SpriteRegistry,
    seed: number,
    private readonly onConfirm: (dex: string) => void,
  ) {
    this.rng = new Rng(seed ^ 0x5eed);
    this.pool = SPAWNS.starterPool.map((d) => species(d));
    this.buildCycle();
    this.roll();
  }

  private buildCycle(): void {
    this.cycle = this.rng.shuffle([...this.pool]).map((def) => ({ def, anim: new AnimPlayer(this.sprites.get(def.dex)) }));
  }

  private roll(): void {
    const picks = this.rng.shuffle([...this.pool]).slice(0, 4);
    this.cards = picks.map((def) => ({ def, anim: new AnimPlayer(this.sprites.get(def.dex)) }));
    this.spin = 1.6;
    this.spinSpeed = 14;
    this.spinOffset = 0;
    this.selected = -1;
  }

  private reroll(): void {
    if (this.rerolls >= MAX_REROLLS || this.spin > 0) return;
    this.rerolls++;
    const maxTier = Math.max(...this.pool.map((p) => p.tier));
    const trimmed = this.pool.filter((p) => p.tier < maxTier);
    if (trimmed.length >= 4) this.pool = trimmed;
    this.buildCycle();
    this.roll();
  }

  private layout(): { x: number; y: number; w: number; h: number; gap: number } {
    const v = this.ctx.view;
    const s = v.baseScale;
    const h = 118 * s;
    const gap = 10 * s;
    return { x: v.width / 2 - 230 * s, y: v.height / 2 - (4 * h + 3 * gap) / 2 + 20 * s, w: 460 * s, h, gap };
  }

  private buttons(): { reroll: { x: number; y: number; w: number; h: number }; confirm: { x: number; y: number; w: number; h: number } } {
    const v = this.ctx.view;
    const s = v.baseScale;
    const L = this.layout();
    const y = L.y + 4 * L.h + 3 * L.gap + 18 * s;
    return { reroll: { x: v.width / 2 - 250 * s, y, w: 220 * s, h: 50 * s }, confirm: { x: v.width / 2 + 30 * s, y, w: 220 * s, h: 50 * s } };
  }

  step(dt: number, input: Input): void {
    this.t += dt;
    if (this.spin > 0) {
      this.spin -= dt;
      this.spinSpeed = 14 * easeOutCubic(this.spin / 1.6) + 0.5;
      this.spinOffset += this.spinSpeed * dt;
      if (this.spin <= 0) this.spinOffset = 0;
    }
    for (const c of this.cards) c.anim.update(dt);
    for (const c of this.cycle) c.anim.update(dt);
    const L = this.layout();
    const B = this.buttons();
    for (const c of input.takeClicks()) {
      if (this.spin <= 0) {
        for (let i = 0; i < 4; i++) {
          if (hit(c.x, c.y, L.x, L.y + i * (L.h + L.gap), L.w, L.h)) this.selected = i;
        }
      }
      if (hit(c.x, c.y, B.reroll.x, B.reroll.y, B.reroll.w, B.reroll.h)) this.reroll();
      if (hit(c.x, c.y, B.confirm.x, B.confirm.y, B.confirm.w, B.confirm.h)) this.confirm();
    }
    if (input.pressed('KeyR')) this.reroll();
    if (input.pressed('Enter') || input.pressed('Space')) this.confirm();
    for (let i = 0; i < 4; i++) if (input.pressed(`Digit${i + 1}`) && this.spin <= 0) this.selected = i;
  }

  private confirm(): void {
    if (this.spin > 0) return;
    const pick = this.cards[this.selected >= 0 ? this.selected : 0];
    if (pick) this.onConfirm(pick.def.dex);
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
    text(v, 'STARTER ROLL', v.width / 2, 58 * s, 34, { align: 'center', weight: '900', color: '#e9ddff' });
    text(v, `Rerolls left: ${MAX_REROLLS - this.rerolls}  ·  each reroll removes the strongest tier`, v.width / 2, 84 * s, 13, { align: 'center', weight: '500', color: '#b9b4cc' });
    const L = this.layout();
    h.save();
    h.beginPath();
    h.roundRect(L.x, L.y - 4 * s, L.w, 4 * L.h + 3 * L.gap + 8 * s, 18);
    h.clip();
    const spinning = this.spin > 0;
    const slotH = L.h + L.gap;
    if (spinning && this.cycle.length) {
      // The reel scrolls through the pool and settles on the four picks.
      const n = this.cycle.length;
      const off = this.spinOffset % n;
      for (let i = -1; i < 6; i++) {
        const idx = ((Math.floor(off) + i) % n + n) % n;
        const card = this.cycle[idx] as Card;
        const y = L.y + (i - (off - Math.floor(off))) * slotH;
        this.drawCard(card, L.x, y, L.w, L.h, false, i + 1, true);
      }
    } else {
      this.cards.forEach((card, i) => this.drawCard(card, L.x, L.y + i * slotH, L.w, L.h, this.selected === i, i + 1, false));
    }
    h.restore();
    const B = this.buttons();
    const mx = this.ctx.input.mouseX;
    const my = this.ctx.input.mouseY;
    const canReroll = this.rerolls < MAX_REROLLS && !spinning;
    button(v, `Reroll (${MAX_REROLLS - this.rerolls})`, B.reroll.x, B.reroll.y, B.reroll.w, B.reroll.h, canReroll && hit(mx, my, B.reroll.x, B.reroll.y, B.reroll.w, B.reroll.h), canReroll ? '#5a6cff' : '#44405a');
    button(v, spinning ? 'Rolling…' : this.selected >= 0 ? 'Confirm' : 'Confirm top pick', B.confirm.x, B.confirm.y, B.confirm.w, B.confirm.h, !spinning && hit(mx, my, B.confirm.x, B.confirm.y, B.confirm.w, B.confirm.h), spinning ? '#44405a' : '#8a6cff');
    text(v, 'Click a card or press 1-4 · R to reroll · Enter to confirm', v.width / 2, v.height - 18 * s, 12, { align: 'center', weight: '500', color: '#9f97bb' });
  }

  private drawCard(card: Card, x: number, y: number, w: number, h: number, selected: boolean, index: number, dim: boolean): void {
    const v = this.ctx.view;
    const s = v.baseScale;
    const ctx = v.hud;
    panel(v, x, y, w, h, 16, selected ? 'rgba(90,60,170,0.85)' : dim ? 'rgba(20,16,36,0.75)' : 'rgba(22,18,40,0.9)');
    if (selected) {
      ctx.strokeStyle = '#d7c6ff';
      ctx.lineWidth = 2.5 * s;
      ctx.beginPath();
      ctx.roundRect(x, y, w, h, 16);
      ctx.stroke();
    }
    // Sprite: Idle facing down at 3x.
    const f = card.anim.current();
    const sc = v.spriteScale;
    ctx.imageSmoothingEnabled = false;
    const cx = x + 70 * s;
    const cy = y + h / 2 + 8 * s;
    ctx.drawImage(f.image, f.sx, f.sy, f.w, f.h, Math.round(cx - (f.w * sc) / 2), Math.round(cy - (f.h * sc) / 2), f.w * sc, f.h * sc);
    text(v, card.def.name, x + 140 * s, y + 42 * s, 24, { weight: '800' });
    card.def.types.forEach((t, i) => {
      const bx = x + 140 * s + i * 78 * s;
      const by = y + 56 * s;
      ctx.fillStyle = typeColor(t);
      ctx.beginPath();
      ctx.roundRect(bx, by, 70 * s, 20 * s, 10);
      ctx.fill();
      text(v, t.toUpperCase(), bx + 35 * s, by + 14.5 * s, 11, { align: 'center', weight: '800', color: '#1a1028', shadow: false });
    });
    const st = card.def.stats;
    text(v, `HP ${st.hp}  ATK ${st.atk}  DEF ${st.def}  SPA ${st.spa}  SPD ${st.spd}  SPE ${st.spe}`, x + 140 * s, y + 96 * s, 12, { weight: '500', color: '#cfc6ea' });
    text(v, evolutionLine(card.def), x + 140 * s, y + 118 * s, 12, { weight: '600', color: '#ffe27a' });
    text(v, `Tier ${card.def.tier}`, x + w - 16 * s, y + 30 * s, 13, { align: 'right', weight: '800', color: card.def.tier >= 3 ? '#ffd36b' : card.def.tier === 2 ? '#9be7ff' : '#b9b4cc' });
    text(v, String(index), x + 14 * s, y + 22 * s, 12, { weight: '700', color: '#9f97bb' });
    void CONFIG;
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
