/**
 * The starter roll's results, from a seed: three different Pokémon, each reel rolling its own
 * rarity tier at the full odds (data/spawns.json starterTiers). The roll screen animates this; the
 * game server computes the same three from the seed it handed out, so an online player can only
 * ever start with one of the Pokémon they were actually offered.
 */
import { Rng } from '../core/rng';
import { SPAWNS } from './data';

export interface StarterTier {
  id: string;
  name: string;
  weight: number;
  color: string;
  dex: string[];
}

export const STARTER_TIERS = (SPAWNS as unknown as { starterTiers: StarterTier[] }).starterTiers;

/** How many starters are offered. */
export const STARTER_CHOICES = 3;

/** Rolls a tier by weight, then a Pokémon in it. */
export function rollStarter(rng: Rng): { tier: StarterTier; dex: string } {
  const tier = rng.weighted(STARTER_TIERS, (t) => t.weight);
  return { tier, dex: rng.pick(tier.dex) };
}

/** The reel's result for choice `r` given the rng state the roll screen uses (see RollScreen). */
export function rollChoice(rng: Rng, taken: Set<string>): { tier: StarterTier; dex: string } {
  // A repeat Pokémon is re-drawn from the same tier, so each reel's tier odds stay as listed.
  let res = rollStarter(rng);
  const fresh = res.tier.dex.filter((d) => !taken.has(d));
  if (taken.has(res.dex) && fresh.length) res = { tier: res.tier, dex: rng.pick(fresh) };
  taken.add(res.dex);
  return res;
}

/** Card count on each reel (the last card is the result); the filler cards draw from the same rng. */
export const REEL_CARDS = 12;

/** The three starters a seed offers, exactly as the roll screen shows them. */
export function starterChoices(seed: number): string[] {
  const rng = new Rng(seed);
  const taken = new Set<string>();
  const out: string[] = [];
  for (let r = 0; r < STARTER_CHOICES; r++) {
    const res = rollChoice(rng, taken);
    for (let i = 0; i < REEL_CARDS - 1; i++) rollStarter(rng);
    out.push(res.dex);
  }
  return out;
}
