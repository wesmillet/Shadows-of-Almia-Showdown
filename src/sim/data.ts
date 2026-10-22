/** Typed access to the JSON content under /data. Nothing numeric about species or moves lives in code. */
import speciesJson from '../../data/species.json';
import typesJson from '../../data/types.json';
import spawnsJson from '../../data/spawns.json';
import configJson from '../../data/config.json';
import movesJson from '../../data/moves.json';
import type { Biome } from '../ground/types';

export interface StatBlock {
  hp: number;
  atk: number;
  def: number;
  spa: number;
  spd: number;
  spe: number;
}

export interface SpeciesDef {
  dex: string;
  name: string;
  types: string[];
  stats: StatBlock;
  tier: number;
  biome?: Biome;
  moves: string[];
  /** Pokédex height (or length, see `along`) in metres. */
  heightM: number;
  /** Which sprite extent the Pokédex figure measures: body height (default) or the longest side. */
  along?: 'height' | 'length';
  /** Serpents drawn coiled show this fraction of their length. */
  coil?: number;
  /** Body height override in sprite pixels, when the sprite carries something larger than itself. */
  bodyPx?: number;
  /** Measured opaque extent of the down-facing Idle frames, [width, height] in sprite pixels. */
  body: [number, number];
  /** Evolutions: the species it becomes on reaching `level` (several = one at random). */
  /** Level evolutions, and stone evolutions (`item`: only that stone, used on the Pokémon, evolves it). */
  evolves?: Array<{ to: string; level: number; item?: string }>;
  /** Level-up moves, [level, move id] in level order (scripts/learnsets.py). Without one, `moves` is the fixed kit. */
  learnset?: Array<[number, string]>;
  /**
   * How it fights (scripts/learnsets.py): physical, special or mixed. Its level-up attacks, its kit
   * and the TMs it can use follow this; left out, it is read from Attack against Sp. Atk.
   */
  role?: 'physical' | 'special' | 'mixed';
  /** Mega forms: the base form's dex and the Mega Stone it holds (scripts/megas.py, src/sim/mega.ts). */
  megaOf?: string;
  stone?: string;
}

/** The moves a Pokémon of this species knows at `level`: its signature moves first, then the newest attacks it has reached (MOVE_SLOTS of them). */
/** How many moves a Pokémon knows at once. */
export const MOVE_SLOTS = 2;

/** How a species fights: its `role`, else physical or special by a 10% lead of one attack stat, else mixed. */
export function roleOf(sp: Pick<SpeciesDef, 'role' | 'stats'>): 'physical' | 'special' | 'mixed' {
  if (sp.role) return sp.role;
  const { atk, spa } = sp.stats;
  return atk >= spa * 1.1 ? 'physical' : spa >= atk * 1.1 ? 'special' : 'mixed';
}

/**
 * What an attack is worth to a species: its power, half again with the same type (STAB), and
 * cut when it uses the attack stat the species doesn't fight with. Status moves are worth 0 here.
 */
export function moveValue(sp: Pick<SpeciesDef, 'role' | 'stats' | 'types'>, id: string): number {
  const m = MOVES.get(id);
  if (!m || m.category === 'status' || m.power <= 0) return 0;
  const role = roleOf(sp);
  const fits = role === 'mixed' || role === m.category;
  // The stat it would use, against the better one (a mixed Pokémon loses little either way).
  const stat = m.category === 'physical' ? sp.stats.atk : sp.stats.spa;
  const best = Math.max(sp.stats.atk, sp.stats.spa, 1);
  const statK = fits ? Math.max(0.85, stat / best) : Math.min(0.7, stat / best);
  return m.power * (sp.types.includes(m.type) ? CONFIG.battle.stab : 1) * statK;
}

/**
 * The moves a species knows at a level: a signature move always (Aeroblast, Sacred Fire...), then
 * its best attack (moveValue), then its best attack of another type, so it carries coverage; a
 * status move only fills a slot no attack can.
 */
export function movesAt(sp: SpeciesDef, level: number): string[] {
  const known: string[] = [];
  if (!sp.learnset?.length) known.push(...sp.moves.filter((id) => MOVES.has(id)));
  else {
    for (const [lv, id] of sp.learnset) {
      if (lv > level) break;
      if (!known.includes(id) && MOVES.has(id)) known.push(id);
    }
  }
  return pickMoves(sp, known);
}

/** The MOVE_SLOTS moves to carry out of `known` (see movesAt). Ties go to the move learned later. */
export function pickMoves(sp: SpeciesDef, known: string[]): string[] {
  const pick = known.filter((id) => MOVES.get(id)?.signature).slice(0, MOVE_SLOTS);
  const attacks = known
    .map((id, i) => ({ id, i, v: moveValue(sp, id) }))
    .filter((a) => a.v > 0 && !pick.includes(a.id))
    .sort((a, b) => b.v - a.v || b.i - a.i);
  const top = attacks[0];
  if (top && pick.length < MOVE_SLOTS) pick.push(top.id);
  const types = new Set(pick.map((id) => MOVES.get(id)?.type));
  const other = attacks.find((a) => !types.has(MOVES.get(a.id)?.type)) ?? attacks.find((a) => !pick.includes(a.id));
  if (other && pick.length < MOVE_SLOTS) pick.push(other.id);
  for (let i = known.length - 1; i >= 0 && pick.length < MOVE_SLOTS; i--) if (!pick.includes(known[i] as string)) pick.push(known[i] as string);
  return known.filter((id) => pick.includes(id));
}

/**
 * Can a TM's move be taught to this species? An attack when it is of the kind the species fights
 * with (physical for a physical attacker, special for a special one, either for a mixed one), of
 * any type: a TM is how a Pokémon gets coverage, and a Flamethrower TM is no use to an Infernape
 * that punches. Set-up moves go the same way: Swords Dance, Bulk Up, Agility and Dragon Dance to
 * physical fighters, Nasty Plot and Calm Mind to special ones; other status moves to anyone.
 */
export function canLearnTm(sp: Pick<SpeciesDef, 'role' | 'stats' | 'types'>, id: string): boolean {
  const m = MOVES.get(id);
  if (!m) return false;
  const role = roleOf(sp);
  if (m.category === 'status') {
    if (id === 'nasty-plot' || id === 'calm-mind') return role !== 'physical';
    if (id === 'swords-dance' || id === 'bulk-up' || id === 'agility' || id === 'dragon-dance') return role !== 'special';
    return true;
  }
  return role === 'mixed' || role === m.category;
}

/** Why a Pokémon can't use a TM, in words for the player. */
export function tmRefusal(m: { name: string; species: SpeciesDef }, id: string): string {
  const mv = MOVES.get(id);
  if (!mv) return '';
  const role = roleOf(m.species);
  const how = role === 'physical' ? 'it fights with physical attacks' : 'it fights with special attacks';
  return `${m.name} cannot learn ${mv.name}: ${how}${mv.category === 'status' ? '' : ` and ${mv.name} is a ${mv.category} move`}`;
}

/** Moves this species learns on reaching a level above `from` and up to `to`. */
export function movesLearnedBetween(sp: SpeciesDef, from: number, to: number): string[] {
  return (sp.learnset ?? []).filter(([lv]) => lv > from && lv <= to).map(([, id]) => id);
}

export type MoveShape = 'single' | 'line' | 'cone' | 'ring' | 'self';
export type VfxFamily = 'burst' | 'projectile' | 'beam' | 'ring' | 'cloud';
export type StatusKind = 'sleep' | 'burn' | 'paralysis' | 'poison' | 'freeze' | 'confusion';

/** One Guardian Signs effect in a move's fx list (see data/moves.json `_fx`). */
export interface FxPart {
  id: string;
  /**
   * target: at each Pokémon hit (or the aimed point); attacker: on the user; projectile: flies
   * user -> target, the target parts after it play on arrival; sky: falls onto each target from
   * high above (rocks, icicles), the target parts after it play on landing.
   */
  anchor: 'target' | 'attacker' | 'projectile' | 'sky';
  mode?: 'beam' | 'stream' | 'status';
  fps?: number;
  scale?: number;
  tint?: string;
  /**
   * Which way the artwork points, for projectiles, beams and streams: 'up' or 'down'
   * (the source end is at the bottom or the top of the frame), 'right', or 'none'
   * (never rotated, e.g. upright flames). Left out, it is guessed from the frame shape.
   */
  facing?: 'right' | 'up' | 'down' | 'none';
  /**
   * Where a beam or projectile leaves the user: 'mouth' (the default: breath, beams, spit), 'hands'
   * (punches, Aura Sphere, thrown rocks) or 'body' (dashes and slashes that are the user itself).
   * Read from the sprite's Offsets sheet for the frame being shown.
   */
  origin?: 'mouth' | 'hands' | 'body';
  /** Height above the ground point in tiles (0 for rings and puddles on the ground). */
  lift?: number;
  /** Beams and streams: how long the strip stays up, looping its frames (a crackling bolt). */
  seconds?: number;
  /** Seconds to wait before this part starts (sequencing a wind-up, a strike, an aftershock). */
  delay?: number;
  /** Drawn flat on the ground under the Pokémon (rings, puddles, cracks) instead of over them. */
  ground?: boolean;
  /** Projectiles: tiles per second (default 11). */
  speed?: number;
  /** Projectiles: height of a lobbed arc in tiles (rocks, sludge). */
  arc?: number;
  /** Sky drops: how high above the target the fall starts, in tiles (default 6). */
  height?: number;
  /**
   * Projectiles: one carrier sweeps the whole length of a line move (a twister crossing the
   * field) instead of one per Pokémon hit; each one hit gets its impact as it passes.
   */
  sweep?: boolean;
  /** Projectiles: play the frames once, then loop from this frame (spin up, then spin). */
  loopFrom?: number;
  /** Projectiles: stands on the ground as it travels (a twister) instead of flying at body height. */
  grounded?: boolean;
  /** Projectiles: side-to-side sway in tiles. */
  sway?: number;
  /** Projectiles: seconds it lingers and fades at the end of its path. */
  fadeOut?: number;
}

export interface MoveDef {
  id: string;
  name: string;
  type: string;
  category: 'physical' | 'special' | 'status';
  power: number;
  shape: MoveShape;
  cooldown: number;
  cast?: number;
  vfx: VfxFamily;
  /** The body animation: SpriteCollab action names (Strike, Swing... fall back to Attack where a sprite lacks them). */
  anim: 'Attack' | 'Shoot' | 'Charge' | 'Strike' | 'Swing' | 'Double' | 'Rotate' | 'Hop';
  size?: number;
  status?: { kind: StatusKind; chance: number };
  stages?: { self?: { atk?: number; def?: number; spe?: number }; target?: { atk?: number; def?: number; spe?: number }; chance: number };
  strip?: string;
  /** Effect sheets played when the move resolves; absent = procedural family. */
  fx?: FxPart[];
  /** The attacker leaps and lands on the target over the cast (Body Slam, Heavy Slam). */
  leap?: boolean;
  /** A legendary's signature move: always among the moves its owner knows. */
  signature?: boolean;
  /** Screen shake on impact, 0..1 (heavy moves only). */
  shake?: number;
  /** Override for isContact: false for a physical move that strikes from range (Stone Edge's spikes). */
  contact?: boolean;
  /** The user takes this share of the damage it dealt (Double-Edge, Flare Blitz), once per use. */
  recoil?: number;
}

/**
 * A contact move: physical, aimed at one Pokémon, and not thrown or dropped from the sky. Its user
 * lunges at the target and strikes it (Pokémon Rumble style) instead of hitting from where it stands.
 */
export function isContact(m: MoveDef): boolean {
  if (m.contact !== undefined) return m.contact;
  return m.category === 'physical' && m.shape === 'single' && !m.leap && !(m.fx ?? []).some((p) => p.anchor === 'projectile' || p.anchor === 'sky');
}

export const MOVES = new Map<string, MoveDef>();
for (const m of (movesJson as { moves: MoveDef[] }).moves) MOVES.set(m.id, m);

export function move(id: string): MoveDef {
  const m = MOVES.get(id);
  if (!m) throw new Error(`moves.json has no move ${id}`);
  return m;
}

export const CONFIG = configJson;
export const SPAWNS = spawnsJson;
export const TYPE_CHART = typesJson as { types: string[]; colors: Record<string, string>; chart: Record<string, Record<string, number>> };

export const SPECIES = new Map<string, SpeciesDef>();
for (const s of (speciesJson as unknown as { species: SpeciesDef[] }).species) SPECIES.set(s.dex, s);

export function species(dex: string): SpeciesDef {
  const s = SPECIES.get(dex);
  if (!s) throw new Error(`species.json has no entry for ${dex}`);
  return s;
}

const PX_PER_M = CONFIG.sizes.trainerPx / CONFIG.sizes.trainerHeightM;
const scaleCache = new Map<string, number>();

/**
 * Draw scale of a species' sprite so its body stands at its Pokédex size next to a
 * trainer (1 = the sprite's native pixel size). See scripts/measure_species.py.
 */
/**
 * The height a Pokémon is drawn at. Pokédex sizes hold from 1.2 m up; smaller Pokémon are
 * lifted on a gentle ramp (0.3 m Eevee draws as about 0.8 m, 0.4 m Pikachu as about 0.85 m) so they stay
 * readable next to a 1.6 m trainer while keeping their order: smaller is still smaller.
 */
export function shownHeight(heightM: number): number {
  const { smallFloorM, smallBaseM } = CONFIG.sizes;
  return heightM >= smallFloorM ? heightM : smallBaseM + (heightM / smallFloorM) * (smallFloorM - smallBaseM);
}

/** A Pokémon's draw scale: its species' size, and Alphas bigger still. */
export function monScale(m: { species: SpeciesDef; alpha?: boolean; boss?: boolean }): number {
  // Alphas are drawn alphaScale times bigger; Darkrai, the final boss, towers over everything.
  return drawScale(m.species) * (m.alpha ? CONFIG.wild.alphaScale : 1) * (m.boss ? 1.8 : 1);
}

export function drawScale(s: SpeciesDef): number {
  const hit = scaleCache.get(s.dex);
  if (hit !== undefined) return hit;
  const [w, h] = s.body ?? [24, 24];
  const px = s.bodyPx ?? (s.along === 'length' ? Math.max(w, h) : h);
  const sizes = CONFIG.sizes as typeof CONFIG.sizes & { minDrawnM?: number; maxShownM?: number };
  const shown = Math.min(sizes.maxShownM ?? 99, shownHeight(s.heightM) * (s.coil ?? 1));
  let k = (PX_PER_M * shown) / Math.max(1, px);
  // Nothing drawn shorter than minDrawnM (a long Dratini or a Wurmple measured nose to tail).
  const minPx = PX_PER_M * (sizes.minDrawnM ?? 0);
  if (h * k < minPx) k = minPx / Math.max(1, h);
  scaleCache.set(s.dex, k);
  return k;
}

/** Half the drawn body width, in tiles (16 sprite pixels per tile). */
export function bodyRadius(s: SpeciesDef): number {
  return ((s.body?.[0] ?? 16) * drawScale(s)) / 32;
}

/** Extra reach for hits on a body bigger than a trainer-sized one (0 for ordinary Pokémon). */
export function hitPad(s: SpeciesDef): number {
  return Math.max(0, bodyRadius(s) - 0.35);
}

export function typeColor(type: string): string {
  return TYPE_CHART.colors[type] ?? '#cccccc';
}

/** Product of the chart multipliers against each defending type. */
export function effectiveness(moveType: string, defenderTypes: readonly string[]): number {
  let m = 1;
  const row = TYPE_CHART.chart[moveType] ?? {};
  for (const t of defenderTypes) m *= row[t] ?? 1;
  return m;
}

/**
 * How fast a Pokémon moves, as a multiplier on the normal pace: its species' base Speed (slow
 * bases toward slowMult, fast ones toward fastMult), its Speed stage (Agility) and paralysis.
 */
export function moveSpeed(m: { species: SpeciesDef; stages?: { spe: number }; status?: StatusKind | null }): number {
  const c = CONFIG.battle.speed;
  const f = Math.max(0, Math.min(1, (m.species.stats.spe - c.slowBase) / (c.fastBase - c.slowBase)));
  const stage = 1 + c.stagePerStep * (m.stages?.spe ?? 0);
  const para = m.status === 'paralysis' ? CONFIG.battle.paralysisSpeed : 1;
  return (c.slowMult + (c.fastMult - c.slowMult) * f) * stage * para;
}

/** Actual stats at a level from base stats (flat IV/EV-free formula). */
export function statsAtLevel(base: StatBlock, level: number): StatBlock {
  const other = (b: number) => Math.floor((2 * b * level) / 100) + 5;
  return {
    hp: Math.floor((2 * base.hp * level) / 100) + level + 10,
    atk: other(base.atk),
    def: other(base.def),
    spa: other(base.spa),
    spd: other(base.spd),
    spe: other(base.spe),
  };
}
