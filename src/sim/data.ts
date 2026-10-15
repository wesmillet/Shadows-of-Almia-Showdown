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
}

export type MoveShape = 'single' | 'line' | 'cone' | 'ring' | 'self';
export type VfxFamily = 'burst' | 'projectile' | 'beam' | 'ring' | 'cloud';
export type StatusKind = 'sleep' | 'burn' | 'paralysis';

/** One Guardian Signs effect in a move's fx list (see data/moves.json `_fx`). */
export interface FxPart {
  id: string;
  anchor: 'target' | 'attacker' | 'projectile';
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
  stages?: { self?: { atk?: number; def?: number }; target?: { atk?: number; def?: number }; chance: number };
  strip?: string;
  /** Effect sheets played when the move resolves; absent = procedural family. */
  fx?: FxPart[];
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
for (const s of (speciesJson as { species: SpeciesDef[] }).species) SPECIES.set(s.dex, s);

export function species(dex: string): SpeciesDef {
  const s = SPECIES.get(dex);
  if (!s) throw new Error(`species.json has no entry for ${dex}`);
  return s;
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
