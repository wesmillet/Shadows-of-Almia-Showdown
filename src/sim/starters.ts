/**
 * The starter roll. A new player rolls from a small pool (the tiers named in data/spawns.json
 * starterBaseTiers); every Pokémon they keep in their PC adds the first form of its line to the
 * pool, in the rarity tier it belongs to (its own starter tier if it has one, else by strength:
 * legendaries are Mythic). Three reels each roll a tier by weight (among the tiers the player has
 * any Pokémon in) and then a Pokémon in it, three different ones.
 *
 * The roll screen animates this from a seed; the game server computes the same three from the seed
 * and the pool it handed out, so an online player can only start with one they were offered.
 */
import { Rng } from '../core/rng';
import { SPAWNS, SPECIES, type SpeciesDef } from './data';

export interface StarterTier {
  id: string;
  name: string;
  weight: number;
  color: string;
  dex: string[];
}

/** Every tier with its full list (what the pool grows toward). */
export const STARTER_TIERS = (SPAWNS as unknown as { starterTiers: StarterTier[] }).starterTiers;
/** The tiers a brand-new player has (data/spawns.json starterBaseTiers, default Common and Uncommon). */
export const BASE_TIERS: string[] = (SPAWNS as unknown as { starterBaseTiers?: string[] }).starterBaseTiers ?? ['common', 'uncommon'];

/** How many starters are offered. */
export const STARTER_CHOICES = 3;
/** Card count on each reel (the last card is the result); the filler cards draw from the same rng. */
export const REEL_CARDS = 12;

/** Each species' previous form (from the evolutions in species.json). */
const PREVO = new Map<string, string>();
for (const s of SPECIES.values()) for (const e of s.evolves ?? []) if (!PREVO.has(e.to)) PREVO.set(e.to, s.dex);

function bst(s: SpeciesDef | undefined): number {
  if (!s) return 0;
  const t = s.stats;
  return t.hp + t.atk + t.def + t.spa + t.spd + t.spe;
}

/** The first form of a Pokémon's line (a Mega or another form counts as its base species). */
export function lineBase(dex: string): string | null {
  let d = dex;
  const sp = SPECIES.get(d) as (SpeciesDef & { megaOf?: string }) | undefined;
  if (sp?.megaOf) d = sp.megaOf;
  // Shadow, Unbound and similar forms: the species itself when the game has it.
  if (!SPECIES.has(d) || /-(shadow|unbound|mega.*)$/.test(d)) {
    const plain = d.split('-')[0] as string;
    if (SPECIES.has(plain)) d = plain;
  }
  if (!SPECIES.has(d)) return SPECIES.has(dex) ? dex : null;
  for (let i = 0; i < 4 && PREVO.has(d); i++) d = PREVO.get(d) as string;
  return d;
}

/** The strongest form its line reaches. */
function lineTop(base: string): number {
  let best = bst(SPECIES.get(base));
  const seen = new Set([base]);
  const q = [base];
  while (q.length) {
    const d = q.pop() as string;
    for (const e of SPECIES.get(d)?.evolves ?? []) {
      if (seen.has(e.to)) continue;
      seen.add(e.to);
      best = Math.max(best, bst(SPECIES.get(e.to)));
      q.push(e.to);
    }
  }
  return best;
}

/** The starter tier a line's first form belongs in. */
export function tierOf(base: string): string {
  for (const t of STARTER_TIERS) if (t.dex.includes(base)) return t.id;
  const b = bst(SPECIES.get(base));
  const top = lineTop(base);
  if (b >= 570) return 'mythic';
  if (top >= 600) return 'epic';
  if (top >= 500) return 'rare';
  if (b >= 300) return 'uncommon';
  return 'common';
}

/**
 * What a PC adds to the pool: the first form of each kept Pokémon's line, sorted (the same list on
 * the server and in the browser, so a seed rolls the same three).
 */
export function unlockedFromPc(dexes: Iterable<string>): string[] {
  const base = new Set(STARTER_TIERS.filter((t) => BASE_TIERS.includes(t.id)).flatMap((t) => t.dex));
  const out = new Set<string>();
  for (const d of dexes) {
    const b = lineBase(d);
    if (b && !base.has(b) && SPECIES.has(b)) out.add(b);
  }
  return [...out].sort();
}

/** The tiers a player rolls from: the base tiers in full, plus their unlocked Pokémon in theirs. Empty tiers are left out. */
export function poolTiers(unlocked: readonly string[] = []): StarterTier[] {
  const tiers = STARTER_TIERS.map((t) => ({ ...t, dex: BASE_TIERS.includes(t.id) ? [...t.dex] : [] }));
  for (const d of unlocked) {
    const t = tiers.find((x) => x.id === tierOf(d)) ?? tiers[0];
    if (t && !t.dex.includes(d)) t.dex.push(d);
  }
  return tiers.filter((t) => t.dex.length);
}

/** How many starters the pool holds, out of every one the tiers list. */
export function poolSize(unlocked: readonly string[] = []): number {
  return poolTiers(unlocked).reduce((n, t) => n + t.dex.length, 0);
}

/**
 * The daily Egg (online): a tier by the full starter weights (Common 50, Uncommon 27, Rare 13, Epic 7,
 * Mythic 3), every tier in full whatever the player's pool, then a Pokémon in it.
 */
export function rollEgg(rng: Rng): { tier: StarterTier; dex: string } {
  return rollStarter(rng, STARTER_TIERS.filter((t) => t.dex.length));
}

/** Rolls a tier by weight, then a Pokémon in it. */
export function rollStarter(rng: Rng, tiers: StarterTier[] = poolTiers()): { tier: StarterTier; dex: string } {
  const tier = rng.weighted(tiers, (t) => t.weight);
  return { tier, dex: rng.pick(tier.dex) };
}

/** One reel's result: a Pokémon not offered yet (re-drawn from the same tier, so the tier odds hold). */
export function rollChoice(rng: Rng, taken: Set<string>, tiers: StarterTier[] = poolTiers()): { tier: StarterTier; dex: string } {
  let res = rollStarter(rng, tiers);
  if (taken.has(res.dex)) {
    const fresh = res.tier.dex.filter((d) => !taken.has(d));
    if (fresh.length) res = { tier: res.tier, dex: rng.pick(fresh) };
    else {
      // That tier is used up: any Pokémon not offered yet.
      const any = tiers.flatMap((t) => t.dex.filter((d) => !taken.has(d)).map((d) => ({ tier: t, dex: d })));
      if (any.length) res = rng.pick(any);
    }
  }
  taken.add(res.dex);
  return res;
}

/** The three starters a seed offers from a pool, exactly as the roll screen shows them. */
export function starterChoices(seed: number, unlocked: readonly string[] = []): string[] {
  const tiers = poolTiers(unlocked);
  const rng = new Rng(seed);
  const taken = new Set<string>();
  const out: string[] = [];
  for (let r = 0; r < STARTER_CHOICES; r++) {
    const res = rollChoice(rng, taken, tiers);
    for (let i = 0; i < REEL_CARDS - 1; i++) rollStarter(rng, tiers);
    out.push(res.dex);
  }
  return out;
}
