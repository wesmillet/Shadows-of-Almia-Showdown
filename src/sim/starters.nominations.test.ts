import { describe, expect, it } from 'vitest';
import { commonTier, MYTHIC_REEL_CAP, NOMINATION_BUDGET, nominationBase, nominationCost, nominationProblem, slot3Odds, starterChoices, starterReels, tierOf, typeClash, usableNominations } from './starters';
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

  it('slot 3 odds follow the tier weights, Mythics held to the cap', () => {
    const odds = slot3Odds(['0249', '0255', '0133', '0403', '0129']);
    const by = Object.fromEntries(odds.map((o) => [o.dex, Math.round(o.chance * 1000) / 10]));
    expect(by['0249']).toBeCloseTo(MYTHIC_REEL_CAP * 100, 1);
    expect(odds.reduce((n, o) => n + o.chance, 0)).toBeCloseTo(1, 6);
    // Rolled for real, Lugia comes up about that often.
    let n = 0;
    const N = 20000;
    for (let seed = 1; seed <= N; seed++) if (starterChoices(seed, ['0249', '0255', '0133', '0403', '0129'])[2] === '0249') n++;
    expect(n / N).toBeGreaterThan(MYTHIC_REEL_CAP * 0.6);
    expect(n / N).toBeLessThan(MYTHIC_REEL_CAP * 1.4);
  });

  it('a PC full of legendaries still rolls one at most the cap per reel', () => {
    const pc = ['0151', '0251', '0385', '0490', '0492', '0494', '0802', '0808', '0025', '0129'];
    const odds = slot3Odds(pc);
    expect(odds.filter((o) => o.tier === 'mythic').reduce((n, o) => n + o.chance, 0)).toBeCloseTo(MYTHIC_REEL_CAP, 6);
    let n = 0;
    const N = 10000;
    for (let seed = 1; seed <= N; seed++) if (starterChoices(seed, [], pc).slice(0, 2).some((d) => tierOf(d) === 'mythic')) n++;
    expect(n / N).toBeLessThan(MYTHIC_REEL_CAP * 2 + 0.01);
  });
});

describe('nominations', () => {
  it('cost by tier, within the budget, nothing excluded by tier', () => {
    expect(tierOf('0249')).toBe('mythic');
    expect(tierOf('0443')).toBe('epic');
    expect(nominationCost(['0249', '0255', '0133', '0403', '0129'])).toBe(15);
    expect(nominationProblem(['0249', '0255', '0133', '0403', '0129'], ['0249', '0255', '0133', '0403', '0129'])).toBeNull();
    expect(nominationProblem(['0249', '0443', '0255', '0403', '0129'], ['0249', '0443', '0255', '0403', '0129'])).toMatch(String(NOMINATION_BUDGET));
    // Three Epics and two empty spots (Commons): 17 points.
    expect(nominationProblem(['0147', '0246', '0374'], ['0147', '0246', '0374'])).toMatch('budget');
    expect(nominationCost(['0249'])).toBe(12);
    expect(nominationCost([])).toBe(5);
    expect(nominationProblem(['0255'], [])).toMatch('not one you can star');
  });

  it('one star per type', () => {
    expect(nominationProblem(['0025', '0403'], ['0025', '0403'])).toMatch('one star per type');
    // Dual types count both: Gastly (Ghost/Poison) clashes with Bulbasaur (Grass/Poison).
    expect(typeClash(['0001', '0092'])?.type).toBe('poison');
    expect(typeClash(['0004', '0007', '0025'])).toBeNull();
    // Saved stars that clash: the later one is dropped.
    expect(usableNominations(['0004', '0255', '0007'], ['0004', '0255', '0007'])).toEqual(['0004', '0007']);
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
