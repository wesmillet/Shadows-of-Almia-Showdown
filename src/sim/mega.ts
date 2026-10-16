/**
 * Mega Evolution. A Pokémon holding its own Mega Stone (data/items/items.json,
 * effect 'mega', `megaFor` its base dex) can Mega Evolve once per match per
 * trainer: it becomes its Mega form (data/species.json entries with `megaOf`,
 * added by scripts/megas.py) for the rest of the match, with the Mega's types
 * and base stats at its current level. The player presses M; rivals do it on
 * their own once their lead is fighting.
 */
import { SPECIES, type SpeciesDef } from './data';
import type { Mon, Trainer } from './entities';
import { ITEMS } from './items';

/** The plain dex of a Pokémon (shiny folders like '0448-shiny' map to '0448'). */
export function baseDex(dex: string): string {
  return dex.replace(/-shiny$/, '');
}

const MEGA_OF = new Map<string, SpeciesDef>();
for (const s of SPECIES.values()) if (s.megaOf) MEGA_OF.set(s.megaOf, s);

/** The Mega form a species can become, if it has one. */
export function megaFormOf(dex: string): SpeciesDef | null {
  return MEGA_OF.get(baseDex(dex)) ?? null;
}

/** The Mega Stone id for a species, if it has a Mega form. */
export function stoneFor(dex: string): string | null {
  return megaFormOf(dex)?.stone ?? null;
}

/** Every Mega Stone item id. */
export const MEGA_STONES: string[] = Object.values(ITEMS).filter((i) => i.effect === 'mega').map((i) => i.id);

/** True when this trainer's Pokémon can Mega Evolve right now. */
export function canMega(t: Trainer, m: Mon | null): boolean {
  if (!m || t.megaUsed || m.mega || m.evolving || m.fainted || m.captured || m.stowed) return false;
  const form = megaFormOf(m.dex);
  return !!form && !!m.heldItem && m.heldItem === form.stone;
}
