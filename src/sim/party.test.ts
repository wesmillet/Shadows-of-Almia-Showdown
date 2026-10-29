import { describe, expect, it } from 'vitest';
import { formationOffset, gainXp, joinBehavior, nextBehavior, shareKnockoutXp, xpForKnockout, xpToNext } from './party';
import { species, statsAtLevel } from './data';
import type { Mon } from './entities';

function mon(dex: string, x: number, y: number, behavior: Mon['behavior'] = 'guard'): Mon {
  const sp = species(dex);
  const stats = statsAtLevel(sp.stats, 10);
  return { dex, species: sp, level: 10, xp: 0, hp: stats.hp, maxHp: stats.hp, stats, fainted: false, boss: false, x, y, behavior } as Mon;
}

describe('formation', () => {
  it('puts the lead beside the trainer and the rest behind, alternating sides', () => {
    const lead = formationOffset(0, 4); // facing up
    expect(Math.hypot(lead.x, lead.y)).toBeLessThan(1);
    const a = formationOffset(1, 4);
    const b = formationOffset(2, 4);
    expect(a.y).toBeGreaterThan(0); // behind when facing up means +y
    expect(Math.sign(a.x)).not.toBe(Math.sign(b.x));
    expect(Math.hypot(formationOffset(3, 4).x, formationOffset(3, 4).y)).toBeGreaterThan(Math.hypot(a.x, a.y));
  });
});

describe('xp', () => {
  it('levels up and recomputes stats', () => {
    const m = mon('0025', 0, 0);
    const hp = m.maxHp;
    const levels = gainXp(m, xpToNext(10) + 5);
    expect(levels).toBe(1);
    expect(m.level).toBe(11);
    expect(m.maxHp).toBeGreaterThan(hp);
    expect(m.xp).toBe(5);
  });

  it('shares half to nearby non-roaming members, nothing from a roamer', () => {
    const target = mon('0129', 5, 5);
    const dealer = mon('0025', 5, 6);
    const near = mon('0387', 6, 6);
    const far = mon('0133', 30, 30);
    const roamer = mon('0447', 5, 7, 'roam');
    const total = xpForKnockout(target);
    const out = shareKnockoutXp(dealer, target, [dealer, near, far, roamer], 8);
    expect(out.map((o) => [o.mon.dex, o.xp])).toEqual([
      ['0025', total],
      ['0387', Math.floor(total / 2)],
    ]);
    const solo = shareKnockoutXp(roamer, target, [dealer, near, roamer], 8);
    expect(solo).toHaveLength(1);
    expect(solo[0]?.mon).toBe(roamer);
  });
});

describe('the player\'s behaviour choices', () => {
  it('cycle Attack, Catch, Passive; Guard is not one of them', () => {
    expect(nextBehavior('aggressive')).toBe('catch');
    expect(nextBehavior('catch')).toBe('passive');
    expect(nextBehavior('passive')).toBe('aggressive');
    // a Pokémon left on Guard (a computer trainer's, say) moves on to Attack
    expect(nextBehavior('guard')).toBe('aggressive');
  });
  it('a Pokémon joining a player starts on Attack, joining anyone else on Guard', () => {
    expect(joinBehavior({ isPlayer: true })).toBe('aggressive');
    expect(joinBehavior({ isPlayer: false })).toBe('guard');
    expect(joinBehavior(null)).toBe('guard');
  });
});
