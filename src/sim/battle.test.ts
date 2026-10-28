import { describe, expect, it } from 'vitest';
import { Rng } from '../core/rng';
import { dirFromVector } from '../core/math';
import { BattleSystem, areaContains, computeDamage, makeArea, moveScore, R } from './battle';
import { isContact, move, moveSpeed, species, statsAtLevel } from './data';
import type { Mon } from './entities';

function mon(dex: string, x = 0, y = 0): Mon {
  const sp = species(dex);
  const stats = statsAtLevel(sp.stats, 15);
  return {
    id: 1, dex, species: sp, name: sp.name, level: 15, hp: stats.hp, maxHp: stats.hp, stats, stages: { atk: 0, def: 0, spe: 0 },
    types: sp.types, moves: sp.moves, cooldowns: [0, 0, 0, 0], x, y, px: x, py: y, dir: 0,
    anim: null as unknown as Mon['anim'], sprites: null as unknown as Mon['sprites'], owner: null, wild: true, boss: false,
    fainted: false, status: null, statusTimer: 0, flash: 0, homeX: x, homeY: y, targetX: x, targetY: y, idleTimer: 0,
    moving: false, inDark: false, drowsy: 0, outsideDark: 0, aura: false, heldItem: null, busy: 0, casting: null, target: null, captured: false, behavior: 'guard', xp: 0, wander: null, wanderPause: 0, roamTarget: null, recall: false, sinceHit: 999, visual: { scale: 1, alpha: 1, flash: 0 }, evolving: null,
  };
}

describe('areas', () => {
  it('line reaches three tiles ahead and cone widens (in range-scaled tiles)', () => {
    const k = R();
    const caster = mon('0025', 5, 5);
    const line = makeArea(move('thunder-shock'), caster, 8, 5);
    expect(areaContains(line, 5 + 2 * k, 5)).toBe(true);
    expect(areaContains(line, 5 + 2 * k, 5 + 1.2 * k)).toBe(false);
    expect(areaContains(line, 5 + 4.2 * k, 5)).toBe(false);
    const cone = makeArea(move('razor-leaf'), caster, 5, 8);
    expect(areaContains(cone, 5, 5 + 2 * k)).toBe(true);
    expect(areaContains(cone, 5 + 1.2 * k, 5 + 2.5 * k)).toBe(true);
    expect(areaContains(cone, 5 + 1.2 * k, 5 + 0.5 * k)).toBe(false);
    const ring = makeArea(move('discharge'), caster, 5, 5);
    expect(areaContains(ring, 5 + 1.5 * k, 5)).toBe(true);
    expect(areaContains(ring, 5, 5)).toBe(false);
    expect(areaContains(ring, 5 + 3 * k, 5)).toBe(false);
  });
});

describe('damage', () => {
  it('applies STAB and the type chart', () => {
    const rng = new Rng(1);
    const pika = mon('0025');
    const karp = mon('0129');
    const shock = computeDamage(rng, pika, karp, move('thunder-shock'));
    expect(shock.effectiveness).toBe(2);
    expect(shock.damage).toBeGreaterThan(computeDamage(new Rng(1), pika, karp, move('quick-attack')).damage);
    const ground = computeDamage(rng, pika, mon('0074'), move('thunder-shock'));
    expect(ground.damage).toBe(0);
    expect(ground.effectiveness).toBe(0);
  });

  it('scores super-effective moves higher for the AI', () => {
    const pika = mon('0025');
    const karp = mon('0129');
    expect(moveScore(pika, karp, move('thunder-shock'))).toBeGreaterThan(moveScore(pika, karp, move('quick-attack')));
    expect(moveScore(pika, mon('0074'), move('thunder-shock'))).toBeLessThan(moveScore(pika, mon('0074'), move('quick-attack')));
  });
});

describe('statuses', () => {
  const quiet = { play: () => {}, dir: 0 } as unknown as Mon['anim'];
  it('poison ticks, freeze holds then thaws, and types are immune', async () => {
    const { BattleSystem } = await import('./battle');
    const b = new BattleSystem(new Rng(2));
    const a = mon('0025');
    a.anim = quiet;
    b.applyStatus(a, 'poison');
    expect(a.status).toBe('poison');
    const hp = a.hp;
    b.stepMon(a, 2.1, () => []);
    expect(a.hp).toBeLessThan(hp);
    // Steel and Poison types shrug poison off; Ice types cannot freeze.
    const steel = mon('0208');
    steel.anim = quiet;
    b.applyStatus(steel, 'poison');
    expect(steel.status).toBeNull();
    const ice = mon('0459');
    ice.anim = quiet;
    b.applyStatus(ice, 'freeze');
    expect(ice.status).toBeNull();
    const f = mon('0387');
    f.anim = quiet;
    b.applyStatus(f, 'freeze');
    expect(f.status).toBe('freeze');
    expect(b.tryCast(f, 0, 0, 0, null)).toBe(false);
    b.stepMon(f, 5, () => []);
    expect(f.status).toBeNull();
  });
});

describe('contact moves and speed', () => {
  it('marks touching physical moves as contact, not thrown, falling or ranged ones', () => {
    expect(isContact(move('tackle'))).toBe(true);
    expect(isContact(move('close-combat'))).toBe(true);
    expect(isContact(move('bite'))).toBe(true);
    expect(isContact(move('rock-throw'))).toBe(false); // thrown
    expect(isContact(move('icicle-crash'))).toBe(false); // falls from the sky
    expect(isContact(move('stone-edge'))).toBe(false); // spikes from the ground
    expect(isContact(move('body-slam'))).toBe(false); // has its own leap
    expect(isContact(move('ember'))).toBe(false); // special
    expect(isContact(move('earthquake'))).toBe(false); // ring
  });

  it('turns base Speed into movement speed, with stages and paralysis', () => {
    const slow = mon('0143'); // Snorlax, base 30
    const fast = mon('0135'); // Jolteon, base 130
    expect(moveSpeed(slow)).toBeLessThan(0.8);
    expect(moveSpeed(fast)).toBeGreaterThan(1.25);
    const agile = { ...fast, stages: { atk: 0, def: 0, spe: 2 } };
    expect(moveSpeed(agile)).toBeCloseTo(moveSpeed(fast) * 1.2, 5);
    expect(moveSpeed({ ...fast, status: 'paralysis' as const })).toBeCloseTo(moveSpeed(fast) * 0.5, 5);
  });

  it('a contact cast sets up a lunge that ends just short of the target', () => {
    const bs = new BattleSystem(new Rng(3));
    const a = mon('0025', 0, 0);
    a.moves = ['tackle', 'thunder-shock'];
    a.anim = { play() {}, sprites: { def: () => undefined }, action: 'Attack', dir: 0 } as unknown as Mon['anim'];
    a.dir = dirFromVector(1, 0, 0);
    const t = mon('0129', 4, 0);
    t.id = 2;
    t.owner = { isPlayer: false } as unknown as Mon['owner'];
    expect(bs.castAt(a, 0, [a, t], 6)).toBe(true);
    expect(a.lunge).toBeTruthy();
    expect(a.lunge?.target).toBe(t);
    expect(a.lunge!.stop).toBeGreaterThan(0.3);
    expect(a.lunge!.stop).toBeLessThan(2);
    // The cast resolves as the lunge arrives.
    expect(a.casting!.t).toBeCloseTo(a.lunge!.dur + 0.04, 5);
    // A ranged move does not lunge.
    const b = mon('0025', 0, 0);
    b.moves = ['thunder-shock'];
    b.anim = a.anim;
    bs.castAt(b, 0, [b, t], 6);
    expect(b.lunge ?? null).toBeNull();
  });
});

describe('contact reach, shots in flight and line of fire (move audit, 28 October)', () => {
  const anim = { play() {}, sprites: { def: () => undefined }, action: 'Attack', dir: 0, done: false } as unknown as Mon['anim'];
  const foe = (dex: string, x: number, y: number): Mon => {
    const t = mon(dex, x, y);
    t.id = 2;
    t.anim = anim;
    t.owner = { isPlayer: false } as unknown as Mon['owner'];
    return t;
  };
  const caster = (moves: string[]): Mon => {
    const a = mon('0025', 0, 0);
    a.moves = moves;
    a.anim = anim;
    a.dir = dirFromVector(1, 0, 0);
    return a;
  };
  const run = (b: BattleSystem, a: Mon, t: Mon, seconds: number): void => {
    for (let i = 0; i < seconds * 60; i++) {
      b.stepMon(a, 1 / 60, () => [a, t]);
      b.stepFlights(1 / 60);
    }
  };

  it('a contact move lands when its user reaches the target, and misses when it never gets there', () => {
    // Close by: the bodies touch, Tackle lands.
    const b1 = new BattleSystem(new Rng(4));
    const a1 = caster(['tackle']);
    const t1 = foe('0129', 0.9, 0);
    const hp1 = t1.hp;
    expect(b1.tryCast(a1, 0, t1.x, t1.y, t1.id, t1)).toBe(true);
    run(b1, a1, t1, 1);
    expect(t1.hp).toBeLessThan(hp1);
    // Far off, and the lunge does not move it (as when a wall stops it): no damage at range.
    const b2 = new BattleSystem(new Rng(4));
    const a2 = caster(['tackle']);
    const t2 = foe('0129', 3, 0);
    const hp2 = t2.hp;
    expect(b2.tryCast(a2, 0, t2.x, t2.y, t2.id, t2)).toBe(true);
    a2.lunge = null; // the lunge never carries it
    run(b2, a2, t2, 1);
    expect(t2.hp).toBe(hp2);
  });

  it('a lunge covers at most lunge.maxTiles (a priority dash further)', () => {
    const b = new BattleSystem(new Rng(5));
    const a = caster(['tackle', 'quick-attack']);
    const t = foe('0129', 9, 0);
    b.tryCast(a, 0, t.x, t.y, t.id, t);
    expect(a.lunge).toBeTruthy();
    expect((a.lunge!.speed ?? 0) * a.lunge!.dur).toBeLessThan(3 * 1.2);
    const q = caster(['quick-attack']);
    b.tryCast(q, 0, t.x, t.y, t.id, t);
    expect((q.lunge!.speed ?? 0) * q.lunge!.dur).toBeGreaterThan((a.lunge!.speed ?? 0) * a.lunge!.dur);
  });

  it('the AI does not pick a contact move for a target beyond its lunge', () => {
    const b = new BattleSystem(new Rng(6));
    const a = caster(['tackle']);
    expect(b.chooseMove(a, foe('0129', 8, 0))).toBe(-1);
    expect(b.chooseMove(a, foe('0129', 1.5, 0))).toBe(0);
  });

  it('a thrown move misses a target that has moved well clear of where it was thrown', () => {
    const b = new BattleSystem(new Rng(7));
    const a = caster(['rock-throw']);
    const t = foe('0129', 5, 0);
    const hp = t.hp;
    expect(b.tryCast(a, 0, t.x, t.y, t.id, t)).toBe(true);
    // Run until the cast resolves and the rock is in the air, then step aside.
    for (let i = 0; i < 120 && !b.inFlight.length; i++) b.stepMon(a, 1 / 60, () => [a, t]);
    expect(b.inFlight.length).toBe(1);
    t.y += 3;
    run(b, a, t, 1);
    expect(t.hp).toBe(hp);
    // Standing still, it is hit.
    const t2 = foe('0129', 5, 0);
    const a2 = caster(['rock-throw']);
    b.tryCast(a2, 0, t2.x, t2.y, t2.id, t2);
    run(b, a2, t2, 1.5);
    expect(t2.hp).toBeLessThan(hp);
  });

  it('a wall between them stops a shot but not a move falling from the sky', () => {
    const wall = (ax: number, _ay: number, bx: number) => !(Math.min(ax, bx) < 2.5 && Math.max(ax, bx) > 2.5);
    const b = new BattleSystem(new Rng(8));
    b.shotLine = (ax, ay, bx, by) => wall(ax, ay, bx) || by > 99;
    const a = caster(['ember', 'icicle-crash']);
    const t = foe('0129', 4, 0);
    const hp = t.hp;
    b.tryCast(a, 0, t.x, t.y, t.id, t);
    run(b, a, t, 1.5);
    expect(t.hp).toBe(hp);
    b.tryCast(a, 1, t.x, t.y, t.id, t);
    run(b, a, t, 1.5);
    expect(t.hp).toBeLessThan(hp);
  });
});
