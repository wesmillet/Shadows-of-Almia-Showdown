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
}

/** The moves a Pokémon of this species knows at `level`: the last four it has reached. */
/** How many moves a Pokémon knows at once. */
export const MOVE_SLOTS = 2;

/**
 * The moves a species knows at a level: the newest two it has reached, preferring moves that
 * deal damage (a status move only fills a slot no attack can).
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
  const pick = known.filter((id) => (MOVES.get(id)?.power ?? 0) > 0).slice(-MOVE_SLOTS);
  for (let i = known.length - 1; i >= 0 && pick.length < MOVE_SLOTS; i--) if (!pick.includes(known[i] as string)) pick.push(known[i] as string);
  return known.filter((id) => pick.includes(id));
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
  anim: 'Attack' | 'Shoot' | 'Charge';
  size?: number;
  status?: { kind: StatusKind; chance: number };
  stages?: { self?: { atk?: number; def?: number; spe?: number }; target?: { atk?: number; def?: number; spe?: number }; chance: number };
  strip?: string;
  /** Effect sheets played when the move resolves; absent = procedural family. */
  fx?: FxPart[];
  /** The attacker leaps and lands on the target over the cast (Body Slam, Heavy Slam). */
  leap?: boolean;
  /** Screen shake on impact, 0..1 (heavy moves only). */
  shake?: number;
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
export function monScale(m: { species: SpeciesDef; alpha?: boolean }): number {
  return drawScale(m.species) * (m.alpha ? CONFIG.wild.alphaScale : 1);
}

export function drawScale(s: SpeciesDef): number {
  const hit = scaleCache.get(s.dex);
  if (hit !== undefined) return hit;
  const [w, h] = s.body ?? [24, 24];
  const px = s.bodyPx ?? (s.along === 'length' ? Math.max(w, h) : h);
  const k = (PX_PER_M * shownHeight(s.heightM) * (s.coil ?? 1)) / Math.max(1, px);
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
