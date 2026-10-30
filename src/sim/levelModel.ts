/**
 * PROTOTYPE (scaling-lab branch, not for merging as is): which level scaling stats and damage use.
 *
 *   current: effective level = L
 *   p:       effective level = 25 x (L / 25) to the power 0.75 (equal to L at level 25)
 *
 * Only a Pokémon's stats (statsAtLevel) and the damage formula's level term use it. Shown levels,
 * XP, evolution, move learning and every other rule keep the real level. Set once before a match
 * starts (URL ?scaling=p in the browser, LEVEL_MODEL=p for node tools); switching mid-match would
 * leave Pokémon made under the other model.
 */
export type LevelModel = 'current' | 'p';

let model: LevelModel = (() => {
  const env = typeof process !== 'undefined' ? process.env?.LEVEL_MODEL : undefined;
  return env === 'p' ? 'p' : 'current';
})();

export function setLevelModel(m: LevelModel): void {
  model = m;
}

export function levelModel(): LevelModel {
  return model;
}

/** The level stats and damage are computed from. */
export function effLevel(level: number): number {
  return model === 'p' ? 25 * Math.pow(level / 25, 0.75) : level;
}

/** Prototype toggles for side-by-side playtests (scenario mode: &sleep=old). */
export const LAB = {
  /** Sleep ends on the first damaging hit (the combat-fixes behaviour); false: the old sleep. */
  sleepBreaks: typeof process !== 'undefined' && process.env?.LAB_SLEEP === 'old' ? false : true,
  /**
   * Owned teammates (party members fighting on their own): after each move they wait 0.8 to 1.6 s
   * before considering the next even when one is ready ('pause', today). 'quick': 0.45 s, the beat
   * the player's lead already has on auto-battle, so cooldowns set the pace and no bot team acts
   * quicker than the player's lead. Wild Pokémon, challengers, bosses and trainer battles keep
   * their own timing either way.
   */
  teammates: (typeof process !== 'undefined' && process.env?.LAB_TEAMMATES === 'quick' ? 'quick' : 'pause') as 'pause' | 'quick',
};
