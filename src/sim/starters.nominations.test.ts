import { describe, expect, it } from 'vitest';
import { commonTier, NOMINATION_BUDGET, nominationBase, nominationCost, nominationProblem, slot3Odds, starterChoices, starterReels, tierOf, usableNominations } from './starters';
import { SPECIES, starterMoves } from './data';

describe('three-slot starter roll', () => {
  it('slots 1 and 2 are Common, slot 3 comes from the nominations, three different', () => {
    const noms = ['0252', '0133', '0147'];
    const common = new Set(commonTier().dex);
    for (let seed = 1; seed < 300; seed++) {
      const c = starterChoices(seed, noms);
      expect(new Set(c).size).toBe(3);
      expect(common.has(c[0] as string) && common.has(c[1] as string)).toBe(true);
      const pool = new Set([...noms, ...commonTier().dex]);
      expect(pool.has(c[2] as string)).toBe(true);
      // The roll screen's reels end on the same three.
      expect(starterReels(seed, noms).map((r) => r.pick.dex)).toEqual(c);
    }
  });

  it('a player with no nominations gets only Commons', () => {
    const common = new Set(commonTier().dex);
    for (let seed = 1; seed < 200; seed++) for (const d of starterChoices(seed)) expect(common.has(d)).toBe(true);
  });

  it('slot 3 odds follow the tier weights', () => {
    const odds = slot3Odds(['0249', '0255', '0133', '0403', '0025']);
    const by = Object.fromEntries(odds.map((o) => [o.dex, Math.round(o.chance * 1000) / 10]));
    expect(by['0249']).toBeCloseTo(4.7, 1);
    expect(by['0255']).toBeCloseTo(16.8, 1);
    // Rolled for real, Lugia comes up about that often.
    let n = 0;
    const N = 20000;
    for (let seed = 1; seed <= N; seed++) if (starterChoices(seed, ['0249', '0255', '0133', '0403', '0025'])[2] === '0249') n++;
    expect(n / N).toBeGreaterThan(0.035);
    expect(n / N).toBeLessThan(0.06);
  });
});

describe('nominations', () => {
  it('cost by tier, within the budget, nothing excluded by tier', () => {
    expect(tierOf('0249')).toBe('mythic');
    expect(tierOf('0443')).toBe('epic');
    expect(nominationCost(['0249', '0255', '0133', '0403', '0025'])).toBe(15);
    expect(nominationProblem(['0249', '0255', '0133', '0403', '0025'], ['0249', '0255', '0133', '0403', '0025'])).toBeNull();
    expect(nominationProblem(['0249', '0443', '0255', '0403', '0025'], ['0249', '0443', '0255', '0403', '0025'])).toMatch(String(NOMINATION_BUDGET));
    // Three Epics and two empty spots (Commons): 17 points.
    expect(nominationProblem(['0443', '0371', '0147'], ['0443', '0371', '0147'])).toMatch('budget');
    expect(nominationCost(['0249'])).toBe(12);
    expect(nominationCost([])).toBe(5);
    expect(nominationProblem(['0255'], [])).toMatch('not one you can star');
  });

  it('forms and evolutions nominate their plain first form; Shadow Mewtwo has none', () => {
    expect(nominationBase('0445')).toBe('0443');
    expect(nominationBase('0249-shadow')).toBe('0249');
    expect(nominationBase('0491-final')).toBe('0491');
    if (SPECIES.has('0006-mega_x')) expect(nominationBase('0006-mega_x')).toBe('0004');
    expect(nominationBase('0150-shadow')).toBeNull();
  });

  it('saved nominations no longer owned or over budget are dropped for the roll', () => {
    expect(usableNominations(['0255', '0249', '0443', '0371'], ['0255', '0249', '0443', '0371'])).not.toContain('0249');
    expect(usableNominations(['0255', '0258'], ['0258'])).toEqual(['0258']);
  });

  it('a starting legendary has no signature move until level 30', () => {
    const lugia = SPECIES.get('0249');
    if (!lugia) return;
    expect(starterMoves(lugia, 5)).not.toContain('aeroblast');
    expect(starterMoves(lugia, 30)).toContain('aeroblast');
  });
});
