/**
 * Starter roll: one reel spins through the starter pool and stops on a single
 * Pokémon. That one is your starter; Start (Enter or Space) begins the match.
 */
import type { Input } from '../core/input';
import { easeOutCubic } from '../core/math';
import { Rng } from '../core/rng';
import { CONFIG, movesAt, move, species, SPAWNS, SPECIES, type SpeciesDef } from '../sim/data';
import { AnimPlayer, type SpriteRegistry } from '../sprites/pokemonSprite';
import { button, hit, panel, text, type GameContext, type Screen } from './screens';
import { typeColor } from '../sim/data';

interface Card {
  def: SpeciesDef;
  anim: AnimPlayer;
}

/** Seconds the reel spins before it settles. */
const SPIN = 2.2;

export class RollScreen implements Screen {
  private readonly reel: Card[];
  private readonly pick: Card;
  /** Seconds left of spinning. */
  private spin = SPIN;
  /** Reel position in cards; it eases to rest exactly on the pick. */
  private pos = 0;
  private readonly endPos: number;
  private t = 0;

  constructor(
    private readonly ctx: GameContext,
    private readonly sprites: SpriteRegistry,
    seed: number,
    private readonly onConfirm: (dex: string) => void,
  ) {
    const rng = new Rng(seed ^ 0x5eed);
    const pool = SPAWNS.starterPool.map((d) => species(d));
    this.reel = rng.shuffle([...pool]).map((def) => ({ def, anim: new AnimPlayer(this.sprites.get(def.dex)) }));
    const i = rng.int(0, this.reel.length - 1);
    this.pick = this.reel[i] as Card;
    // Three full turns of the reel, then on to the pick.
    this.endPos = this.reel.length * 3 + i;
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
    if (this.spin > 0) {
      this.spin = Math.max(0, this.spin - dt);
      this.pos = this.endPos * easeOutCubic(1 - this.spin / SPIN);
    }
    for (const c of this.reel) c.anim.update(dt);
    const b = this.startRect();
    for (const c of input.takeClicks()) if (hit(c.x, c.y, b.x, b.y, b.w, b.h)) this.confirm();
    if (input.pressed('Enter') || input.pressed('Space')) this.confirm();
  }

  private confirm(): void {
    if (this.spin > 0) return;
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
    const spinning = this.spin > 0;
    text(v, 'STARTER ROLL', v.width / 2, 58 * s, 34, { align: 'center', color: '#e9ddff' });
    text(v, spinning ? 'Rolling…' : 'Your starter', v.width / 2, 86 * s, 14, { align: 'center', color: '#b9b4cc' });
    const c = this.card();
    h.save();
    h.beginPath();
    h.roundRect(c.x, c.y, c.w, c.h, 18 * s);
    h.clip();
    if (spinning) {
      // The reel slides cards up through the window and settles on the pick.
      const n = this.reel.length;
      const base = Math.floor(this.pos);
      const frac = this.pos - base;
      for (let k = -1; k <= 1; k++) {
        const card = this.reel[(((base + k) % n) + n) % n] as Card;
        this.drawCard(card, c.x, c.y + (k - frac) * c.h, c.w, c.h, true);
      }
    } else this.drawCard(this.pick, c.x, c.y, c.w, c.h, false);
    h.restore();
    if (!spinning) {
      h.save();
      h.strokeStyle = 'rgba(215,198,255,0.9)';
      h.lineWidth = 2.5 * s;
      h.beginPath();
      h.roundRect(c.x, c.y, c.w, c.h, 18 * s);
      h.stroke();
      h.restore();
    }
    const b = this.startRect();
    button(v, spinning ? 'Rolling…' : `Start with ${this.pick.def.name}`, b.x, b.y, b.w, b.h, !spinning && hit(this.ctx.input.mouseX, this.ctx.input.mouseY, b.x, b.y, b.w, b.h), spinning ? '#44405a' : '#8a6cff');
    text(v, 'Enter or Space to start', v.width / 2, v.height - 18 * s, 12, { align: 'center', color: '#9f97bb' });
  }

  private drawCard(card: Card, x: number, y: number, w: number, h: number, dim: boolean): void {
    const v = this.ctx.view;
    const s = v.baseScale;
    const ctx = v.hud;
    panel(v, x, y, w, h, 18, dim ? 'rgba(20,16,36,0.85)' : 'rgba(30,22,58,0.95)');
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
