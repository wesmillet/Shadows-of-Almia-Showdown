/**
 * The pure parts of wild spawning (data/spawns.json): rotation picks and the stronger encounters.
 * Match.spawnWilds and Match.spawnStrong place what these choose.
 */
import type { Rng } from '../core/rng';

/** A spawn table entry: species, relative weight, its own level range, and a habitat it keeps to. */
export interface SpawnRow {
  dex: string;
  weight: number;
  levels?: number[];
  habitat?: string;
}

/** One land's stronger-encounter pool: ordinary candidates and its pseudo-legendary selection. */
export interface StrongPool {
  candidates: SpawnRow[];
  pseudo: SpawnRow[];
}

export interface StrongConfig {
  /** Probability of 1, 2 or 3 stronger encounters per land, keyed by the count. */
  count: Record<string, number>;
  /** Chance, per stronger encounter, that it comes from the land's pseudo-legendary selection. */
  pseudoChance: number;
  pools: Record<string, StrongPool>;
}

/** `n` rows drawn by weight without repeats (fewer when the pool runs out). */
export function weightedPicks<T extends { weight: number }>(rng: Rng, pool: readonly T[], n: number): T[] {
  const left = [...pool];
  const out: T[] = [];
  while (out.length < n && left.length) {
    const r = rng.weighted(left, (x) => x.weight);
    out.push(r);
    left.splice(left.indexOf(r), 1);
  }
  return out;
}

/**
 * The species of a land's `n` stronger encounters, without repeats. Each one is a pseudo-legendary
 * (split between them by weight: two of equal weight get pseudoChance / 2 each) with pseudoChance,
 * else one of the candidates by weight. When one side has nothing left the other is used.
 */
export function pickStrong(rng: Rng, pool: StrongPool, n: number, pseudoChance: number): SpawnRow[] {
  const cands = [...pool.candidates];
  const pseudo = [...pool.pseudo];
  const out: SpawnRow[] = [];
  for (let i = 0; i < n && (cands.length || pseudo.length); i++) {
    const roll = rng.next();
    const from = (pseudo.length && roll < pseudoChance) || !cands.length ? pseudo : cands;
    const r = rng.weighted(from, (x) => x.weight);
    from.splice(from.indexOf(r), 1);
    out.push(r);
  }
  return out;
}
