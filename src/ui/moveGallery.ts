/**
 * Move Gallery: every move in the game played one after another on an open
 * meadow. A Pokémon that learns the move casts it at a practice dummy that
 * never faints. Left/Right step through the list, Space replays, P pauses the
 * slideshow, T filters by type, Escape goes back to the title.
 */
import type { Input } from '../core/input';
import type { View } from '../render/view';
import { MOVES, SPECIES, species, typeColor, type MoveDef } from '../sim/data';
import type { Mon } from '../sim/entities';
import type { Match } from '../sim/match';
import type { Assets } from '../sprites/assets';
import type { RangerSprites } from '../sprites/rangerSprite';
import type { SpriteRegistry } from '../sprites/pokemonSprite';
import { MatchScreen } from './matchScreen';
import type { PixelUi } from './pixelUi';
import { panel, text, type GameContext } from './screens';

/** Seconds each move stays on screen in the slideshow. */
const HOLD = 2.6;
/** The caster when no loaded species learns a move. */
const FALLBACK = '0026';
const DUMMY = '0586';
/** Half the gap between caster and dummy, in tiles: close enough for rings and cones to reach. */
const HALF = 1.6;
const SHAPE: Record<string, string> = { single: 'One target', line: 'Line', cone: 'Cone', ring: 'Ring around the user', self: 'Self' };

export class MoveGallery extends MatchScreen {
  private readonly all: MoveDef[];
  private list: MoveDef[];
  private index = 0;
  private timer = 0.4;
  private auto = true;
  private typeFilter = '';
  private readonly types: string[];
  private caster: Mon | null = null;
  private dummy: Mon | null = null;
  private readonly spot: { x: number; y: number };

  constructor(
    ctx: GameContext,
    match: Match,
    rangers: RangerSprites,
    assets: Assets,
    ui: PixelUi,
    private readonly registry: SpriteRegistry,
    private readonly onBack: () => void,
  ) {
    super(ctx, match, rangers, assets, ui);
    this.showHud = false;
    this.debugZoom = 1.7;
    this.all = [...MOVES.values()];
    this.list = this.all;
    this.types = [...new Set(this.all.map((m) => m.type))];
    // An empty stage: no rivals, wild Pokémon, items or darkness.
    match.trainers = [];
    match.wilds = [];
    match.items = [];
    match.darkness.nextPulseIn = 1e9;
    this.spot = { x: match.centerX - 20, y: match.centerY + 13 };
    const p = match.player;
    p.x = p.px = this.spot.x - 12;
    p.y = p.py = this.spot.y;
    for (const m of p.party) m.stowed = true;
    this.dummy = match.makeMon(DUMMY, 30, null, this.spot.x + HALF, this.spot.y);
    this.dummy.dir = 6;
    match.wilds.push(this.dummy);
  }

  /** A loaded species that learns the move (the earliest learner), else the fallback caster. */
  private casterFor(m: MoveDef): string {
    for (const s of SPECIES.values()) {
      if (!this.registry.has(s.dex)) continue;
      if (s.learnset?.some(([, id]) => id === m.id) || (!s.learnset && s.moves.includes(m.id))) return s.dex;
    }
    return FALLBACK;
  }

  private cast(): void {
    const mv = this.list[this.index];
    const match = this.match;
    if (!mv) return;
    const dex = this.casterFor(mv);
    const p = match.player;
    if (!this.caster || this.caster.dex !== dex) {
      // A fresh caster for this move, standing left of the dummy and facing it.
      p.party = p.party.filter((m) => m !== this.caster);
      // Level 1, so no caster evolves mid-show; the dummy's numbers do not matter here.
      this.caster = match.makeMon(dex, 1, p, this.spot.x - HALF, this.spot.y);
      this.caster.behavior = 'hold';
      p.party.unshift(this.caster);
    }
    const c = this.caster;
    c.x = c.px = this.spot.x - HALF;
    c.y = c.py = this.spot.y;
    c.dir = 2;
    c.anim.dir = 2;
    c.moves = [mv.id];
    c.cooldowns = [0];
    c.casting = null;
    c.status = null;
    c.stages = { atk: 0, def: 0, spe: 0 };
    c.hp = c.maxHp;
    match.battle.castAt(c, 0, match.mons(), 8);
  }

  private go(delta: number): void {
    const n = this.list.length;
    this.index = (this.index + delta + n) % n;
    this.timer = HOLD;
    this.cast();
  }

  override step(dt: number, input: Input): void {
    if (input.pressed('Escape')) {
      this.ctx.view.zoom = 1;
      this.onBack();
      return;
    }
    if (input.pressed('ArrowRight') || input.pressed('KeyD')) this.go(1);
    if (input.pressed('ArrowLeft') || input.pressed('KeyA')) this.go(-1);
    if (input.pressed('Space') || input.pressed('Enter')) this.go(0);
    if (input.pressed('KeyP')) this.auto = !this.auto;
    if (input.pressed('KeyT')) {
      // Cycle the type filter: all types, then each type in turn.
      const i = this.typeFilter ? this.types.indexOf(this.typeFilter) + 1 : 0;
      this.typeFilter = i < this.types.length ? (this.types[i] as string) : '';
      this.list = this.typeFilter ? this.all.filter((m) => m.type === this.typeFilter) : this.all;
      this.index = 0;
      this.timer = HOLD;
      this.cast();
    }
    input.takeClicks();
    // The dummy never wanders, fights back or faints.
    const d = this.dummy;
    if (d) {
      d.hp = d.maxHp = 99999;
      d.x = d.px = this.spot.x + HALF;
      d.y = d.py = this.spot.y;
      d.busy = 1e9;
      d.idleTimer = 1e9;
      d.moving = false;
      d.status = null;
      d.stages = { atk: 0, def: 0, spe: 0 };
      d.dir = 6;
    }
    if (this.auto) {
      this.timer -= dt;
      if (this.timer <= 0) this.go(1);
    }
    // Run the world without player input so the trainer stays put.
    this.match.step(dt, { moveAxis: () => ({ x: 0, y: 0 }) } as unknown as Input);
    this.consumeEvents();
  }

  protected override cameraFocus(): { x: number; y: number } {
    return { x: this.spot.x, y: this.spot.y - 0.6 };
  }

  protected override drawOverlay(v: View): void {
    const mv = this.list[this.index];
    if (!mv) return;
    const h = v.hud;
    const s = v.baseScale;
    const w = Math.min(v.width - 32 * s, 640 * s);
    const x = v.width / 2 - w / 2;
    const y = 16 * s;
    panel(v, x, y, w, 100 * s);
    const color = typeColor(mv.type);
    text(v, mv.name, v.width / 2, y + 36 * s, 26, { align: 'center', color: '#f4f1ff', maxWidth: w - 40 * s });
    // Type chip
    h.save();
    h.font = `${Math.round(14 * s)}px BoldPixels, sans-serif`;
    const label = mv.type.toUpperCase();
    const cw = h.measureText(label).width + 16 * s;
    h.fillStyle = color;
    h.beginPath();
    h.roundRect(v.width / 2 - cw / 2, y + 46 * s, cw, 20 * s, 5 * s);
    h.fill();
    h.restore();
    text(v, label, v.width / 2, y + 61 * s, 11, { align: 'center', color: '#ffffff' });
    const facts = [
      mv.category[0]?.toUpperCase() + mv.category.slice(1),
      mv.power > 0 ? `Power ${mv.power}` : 'No damage',
      SHAPE[mv.shape] ?? mv.shape,
      `${mv.cooldown}s cooldown`,
    ];
    if (mv.status) facts.push(`${Math.round(mv.status.chance * 100)}% ${mv.status.kind}`);
    text(v, facts.join('  ·  '), v.width / 2, y + 86 * s, 12, { align: 'center', color: '#cfc6ea', maxWidth: w - 40 * s });
    const caster = this.caster ? species(this.caster.dex).name : '';
    const where = `${this.index + 1} / ${this.list.length}${this.typeFilter ? `  (${this.typeFilter} only)` : ''}  ·  cast by ${caster}`;
    text(v, where, v.width / 2, v.height - 44 * s, 13, { align: 'center', color: '#e9ddff', maxWidth: v.width - 40 * s });
    text(v, `← → browse  ·  Space replay  ·  P ${this.auto ? 'pause' : 'play'}  ·  T type filter  ·  Esc back to title`, v.width / 2, v.height - 20 * s, 12, { align: 'center', color: '#9f97bb', maxWidth: v.width - 40 * s });
  }
}
