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
import { SPAWNS, SPECIES, movesAt, type SpeciesDef } from './data';

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
 * The daily Egg (online): Uncommon or better, a tier by the starter weights (Uncommon 27, Rare 13,
 * Epic 7, Mythic 3: about 54%, 26%, 14% and 6%), every tier in full whatever the player's pool, then
 * a Pokémon in it.
 */
export function rollEgg(rng: Rng): { tier: StarterTier; dex: string } {
  return rollStarter(rng, STARTER_TIERS.filter((t) => t.dex.length && t.id !== 'common'));
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

// ------------------------------------------------------------------ nominations (slot 3)

/** How many Pokémon a player nominates for the third starter slot, and the points they may spend. */
export const NOMINATION_SLOTS = 5;
export const NOMINATION_BUDGET = 15;
/** What a nomination costs, by its line's tier: stronger tiers cost more. */
export const TIER_COST: Record<string, number> = { common: 1, uncommon: 2, rare: 3, epic: 5, mythic: 8 };
/** Each nomination's weight in the third slot's roll, by tier: stronger tiers come up less often. */
export const SLOT3_WEIGHT: Record<string, number> = { common: 30, uncommon: 24, rare: 18, epic: 10, mythic: 5 };

/**
 * The Pokémon a PC Pokémon (or an unlock) nominates: the first form of its line, in its normal
 * form (a Mega, Shadow, Unbound or final form counts as its plain species), or null when the game
 * has no plain form for it.
 */
export function nominationBase(dex: string): string | null {
  const special = /-(shadow|unbound|final|shiny|mega.*)$/;
  let d = dex;
  if (special.test(d)) {
    const plain = d.replace(special, '');
    if (!SPECIES.has(plain)) return null;
    d = plain;
  }
  const b = lineBase(d);
  return b && SPECIES.has(b) && !special.test(b) ? b : null;
}

/**
 * The form a Pokémon is kept in in the PC: the first stage of its evolution line (a Charizard is
 * kept as a Charmander; a Mega as its base species's first stage). Shadow, Unbound and final forms
 * stay as they are: they are forms, not evolution stages.
 */
export function pcBase(dex: string): string {
  if (/-(shadow|unbound|final)$/.test(dex)) return dex;
  let d = dex;
  const sp = SPECIES.get(d) as (SpeciesDef & { megaOf?: string }) | undefined;
  if (sp?.megaOf) d = sp.megaOf;
  else if (/-mega.*$/.test(d)) d = d.replace(/-mega.*$/, '');
  if (!SPECIES.has(d)) return dex;
  for (let i = 0; i < 4 && PREVO.has(d); i++) d = PREVO.get(d) as string;
  return SPECIES.has(d) ? d : dex;
}

/** What a player may nominate: their PC's lines and their unlocks, sorted. */
export function eligibleNominations(pcDexes: Iterable<string>, unlocks: Iterable<string> = []): string[] {
  const out = new Set<string>();
  for (const d of [...pcDexes, ...unlocks]) {
    const b = nominationBase(d);
    if (b) out.add(b);
  }
  return [...out].sort();
}

/**
 * Points a set of nominations uses: each one's tier cost, and a Common's cost for every spot left
 * empty (an empty spot rolls a Common, so leaving spots empty is no cheaper than filling them).
 */
export function nominationCost(dexes: readonly string[]): number {
  const empty = Math.max(0, NOMINATION_SLOTS - dexes.length);
  return dexes.reduce((n, d) => n + (TIER_COST[tierOf(d)] ?? 1), 0) + empty * (TIER_COST.common ?? 1);
}

/** Why a set of nominations is not allowed, or null. */
export function nominationProblem(dexes: readonly string[], eligible: readonly string[]): string | null {
  if (dexes.length > NOMINATION_SLOTS) return `Nominate at most ${NOMINATION_SLOTS}`;
  if (new Set(dexes).size !== dexes.length) return 'Each nomination must be a different Pokémon';
  const ok = new Set(eligible);
  for (const d of dexes) if (!ok.has(d)) return `${SPECIES.get(d)?.name ?? d} is not one you can nominate`;
  const cost = nominationCost(dexes);
  if (cost > NOMINATION_BUDGET) return `That costs ${cost} points; the budget is ${NOMINATION_BUDGET}`;
  return null;
}

/** Saved nominations made legal again (a Pokémon no longer owned dropped; the dearest dropped while over budget). */
export function usableNominations(saved: readonly string[], eligible: readonly string[]): string[] {
  const ok = new Set(eligible);
  const out = [...new Set(saved.filter((d) => ok.has(d)))].slice(0, NOMINATION_SLOTS);
  while (nominationCost(out) > NOMINATION_BUDGET) {
    let worst = 0;
    out.forEach((d, i) => {
      if ((TIER_COST[tierOf(d)] ?? 1) > (TIER_COST[tierOf(out[worst] as string)] ?? 1)) worst = i;
    });
    out.splice(worst, 1);
  }
  return out;
}

function tierById(id: string): StarterTier {
  return (STARTER_TIERS.find((t) => t.id === id) ?? STARTER_TIERS[0]) as StarterTier;
}

/** The common tier (the first two slots roll only from it). */
export function commonTier(): StarterTier {
  return tierById('common');
}

/**
 * The third slot's five: the nominations, then random Commons for any spot left empty (a new
 * player's third slot is all Common, like the other two).
 */
export function slot3Pool(nominations: readonly string[], rng: Rng): string[] {
  const out = nominations.slice(0, NOMINATION_SLOTS);
  const commons = commonTier().dex.filter((d) => !out.includes(d));
  while (out.length < NOMINATION_SLOTS && commons.length) out.push(commons.splice(rng.int(0, commons.length - 1), 1)[0] as string);
  return out;
}

/** Each of the third slot's five with its chance (0..1), in pool order. */
export function slot3Odds(pool: readonly string[]): Array<{ dex: string; tier: string; chance: number }> {
  const w = pool.map((d) => SLOT3_WEIGHT[tierOf(d)] ?? 1);
  const total = w.reduce((a, b) => a + b, 0) || 1;
  return pool.map((d, i) => ({ dex: d, tier: tierOf(d), chance: (w[i] as number) / total }));
}

export interface StarterReel {
  /** The cards that fly past, the last one being the result. */
  cards: Array<{ dex: string; tier: StarterTier }>;
  pick: { dex: string; tier: StarterTier };
}

/**
 * The three reels a seed rolls, exactly as the roll screen shows them (the game server uses the
 * same to know what a seed offered): the third slot first, from the player's nominations, then the
 * first two from the Common tier, three different Pokémon.
 */
export function starterReels(seed: number, nominations: readonly string[] = []): StarterReel[] {
  const rng = new Rng(seed);
  const pool = slot3Pool(nominations, rng);
  const weighted = slot3Odds(pool);
  const draw3 = (): { dex: string; tier: StarterTier } => {
    const o = rng.weighted(weighted, (x) => x.chance);
    return { dex: o.dex, tier: tierById(o.tier) };
  };
  const third = draw3();
  const common = commonTier();
  const taken = new Set([third.dex]);
  const drawCommon = (): { dex: string; tier: StarterTier } => ({ dex: rng.pick(common.dex), tier: common });
  const reels: StarterReel[] = [];
  for (let r = 0; r < 2; r++) {
    const fresh = common.dex.filter((d) => !taken.has(d));
    const dex = fresh.length ? rng.pick(fresh) : rng.pick(common.dex);
    taken.add(dex);
    const cards = Array.from({ length: REEL_CARDS - 1 }, drawCommon);
    const pick = { dex, tier: common };
    reels.push({ cards: [...cards, pick], pick });
  }
  const cards3 = Array.from({ length: REEL_CARDS - 1 }, draw3);
  reels.push({ cards: [...cards3, third], pick: third });
  return reels;
}

/** The three starters a seed offers (see starterReels). */
export function starterChoices(seed: number, nominations: readonly string[] = []): string[] {
  return starterReels(seed, nominations).map((r) => r.pick.dex);
}

/**
 * A Pokémon as the PC keeps it: the first stage of its line (pcBase), with that
 * species' name and the moves it knows at the Pokémon's level; `from` is what it was, if different.
 */
export function firstForm(m: { dex: string; name: string; level: number; moves: string[] }): { dex: string; name: string; moves: string[]; from?: string } {
  const dex = pcBase(m.dex);
  if (dex === m.dex) return { dex, name: m.name, moves: m.moves };
  const sp = SPECIES.get(dex);
  if (!sp) return { dex: m.dex, name: m.name, moves: m.moves };
  const oldName = SPECIES.get(m.dex)?.name;
  // A name that was just the species' name becomes the first form's; any other name is kept.
  return { dex, name: !oldName || m.name === oldName ? sp.name : m.name, moves: movesAt(sp, m.level), from: m.dex };
}
