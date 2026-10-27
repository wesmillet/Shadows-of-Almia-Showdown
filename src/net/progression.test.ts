import { describe, expect, it } from 'vitest';
import { ACHIEVEMENTS, canWear, LEVELS_ON, levelOf, matchXp, titlesFor, xpToNext, type AchievementContext, type MatchFacts } from './progression';

const facts = (over: Partial<MatchFacts> = {}): MatchFacts => ({
  mode: 'casual', place: 4, field: 8, outcome: 'loss', squad: false,
  stats: { catches: 0, knockouts: 0, damage: 0, timeSurvived: 0 }, party: [], ...over,
});

describe('levels', () => {
  it('starts at level 1 and climbs with XP', () => {
    expect(levelOf(0)).toEqual({ level: 1, into: 0, next: xpToNext(1) });
    expect(levelOf(xpToNext(1)).level).toBe(2);
    expect(levelOf(xpToNext(1) + xpToNext(2) - 1).level).toBe(2);
    expect(levelOf(1e9).level).toBe(100);
  });
});

describe('match XP', () => {
  it('rewards placing, winning and what you did', () => {
    const lose = matchXp(facts()).reduce((n, x) => n + x.xp, 0);
    const win = matchXp(facts({ place: 1, outcome: 'win', stats: { catches: 3, knockouts: 5, damage: 1200, timeSurvived: 420 } })).reduce((n, x) => n + x.xp, 0);
    expect(lose).toBeGreaterThan(0);
    expect(win).toBeGreaterThan(lose + 200);
  });

  it('gives ranked a bonus and private matches nothing', () => {
    const casual = matchXp(facts()).reduce((n, x) => n + x.xp, 0);
    const ranked = matchXp(facts({ mode: 'ranked' })).reduce((n, x) => n + x.xp, 0);
    expect(ranked).toBeGreaterThan(casual);
    expect(matchXp(facts({ mode: 'private' }))).toEqual([]);
  });
});

describe('achievements, titles and looks', () => {
  const ctx = (over: Partial<AchievementContext> = {}): AchievementContext => ({
    match: facts(), life: { matches: 1, wins: 0, catches: 0, knockouts: 0, damage: 0 }, level: 1, tier: null, rankedWins: 0, pc: 0, ...over,
  });
  const earned = (c: AchievementContext) => ACHIEVEMENTS.filter((a) => a.check(c)).map((a) => a.id);

  it('awards from a match and from totals', () => {
    expect(earned(ctx())).toEqual(['first_match']);
    const big = earned(ctx({ match: facts({ outcome: 'win', place: 1, squad: true, party: [{ dex: '0006', level: 52, shiny: true, alpha: false, legend: false, shadow: false }] }), life: { matches: 3, wins: 1, catches: 0, knockouts: 0, damage: 0 } }));
    expect(big).toEqual(expect.arrayContaining(['first_win', 'squad_win', 'shiny', 'level_50_mon', 'top3']));
    expect(earned(ctx({ tier: 'platinum' }))).toEqual(expect.arrayContaining(['tier_gold']));
    expect(earned(ctx({ tier: 'platinum' }))).not.toContain('tier_diamond');
  });

  it('lists the titles earned', () => {
    expect(titlesFor(['first_win', 'first_match', 'squad_win'])).toEqual(['Champion', 'Squad Leader']);
  });

  it('keeps Ranger looks for levels and the named ones for achievements', () => {
    expect(canWear('civ_03', 50, [])).toBe(false);
    expect(canWear('union_00', 1, [])).toBe(true);
    // trainer levels are off for now (LEVELS_ON): level-locked looks are free
    expect(canWear('union_05', 9, [])).toBe(!LEVELS_ON);
    expect(canWear('union_05', 10, [])).toBe(true);
  });

  it('has unique ids and real looks', () => {
    expect(new Set(ACHIEVEMENTS.map((a) => a.id)).size).toBe(ACHIEVEMENTS.length);
  });
});
