/**
 * When each Pokémon's attack animations strike, read from the SpriteCollab AnimData files at build
 * time (scripts/strike-times.ts writes data/strike-times.json; strikeTimes.test.ts checks it is up
 * to date). The simulation times every move from this table, never from sprites that happen to
 * have loaded, so the server, the offline browser and the test harness strike on the same frame.
 *
 * The table lists, per sprite folder, each attack action its AnimData has, with the 60 fps ticks to
 * its strike frame (HitFrame), or null for an action drawn without one.
 */
import TABLE from '../../data/strike-times.json';

/** When an action's sheet is absent, the next one in its chain plays instead (pokemonSprite.ts too). */
export const ANIM_FALLBACKS: Record<string, string[]> = {
  Sleep: ['Idle'],
  Charge: ['Shoot', 'Attack', 'Idle'],
  Shoot: ['Attack', 'Idle'],
  Attack: ['Shoot', 'Idle'],
  // The swings, strikes and spins most sprites have; any that lack one lunge with Attack.
  Strike: ['Attack', 'Idle'],
  Swing: ['Attack', 'Idle'],
  Double: ['Attack', 'Idle'],
  Rotate: ['Attack', 'Idle'],
  Hop: ['Attack', 'Idle'],
  Hurt: ['Idle'],
  Faint: ['Hurt', 'Idle'],
  // A set drawn without a Walk (Iron Treads) rolls along on its Rotate sheet, looped.
  Walk: ['Rotate', 'Idle'],
};

/** The actions moves play (and the ones they fall back to): the ones the table records. */
export const STRIKE_ACTIONS = ['Attack', 'Shoot', 'Charge', 'Strike', 'Swing', 'Double', 'Rotate', 'Hop'] as const;

const STRIKES = TABLE as unknown as Record<string, Record<string, number | null>>;

/** Does this sprite folder have this action? (The shiny marker `*` is the same folder.) */
export function hasAction(dex: string, action: string): boolean {
  const row = STRIKES[dex.replace(/\*$/, '')];
  return !!row && action in row;
}

/**
 * The action that plays for a requested one (its fallback chain, by what the folder has), and the
 * seconds from its start to its strike frame: null when it has none (or the folder is missing),
 * in which case the move keeps the standard cast time.
 */
export function strikeTime(dex: string, action: string): { action: string; seconds: number | null } {
  const row = STRIKES[dex.replace(/\*$/, '')];
  if (!row) return { action, seconds: null };
  const secs = (a: string) => (row[a] === null || row[a] === undefined ? null : (row[a] as number) / 60);
  if (action in row) return { action, seconds: secs(action) };
  for (const alt of ANIM_FALLBACKS[action] ?? ['Idle']) if (alt in row) return { action: alt, seconds: secs(alt) };
  return { action, seconds: null };
}
