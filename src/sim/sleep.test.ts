import { describe, expect, it } from 'vitest';
import { Rng } from '../core/rng';
import { dirFromVector } from '../core/math';
import { BattleSystem, type BattleEvent } from './battle';
import { species, statsAtLevel } from './data';
import type { Mon } from './entities';

const anim = { play() {}, sprites: { def: () => undefined }, action: 'Idle', dir: 0, done: false } as unknown as Mon['anim'];
let nextId = 100;
function mon(dex: string, level: number, x: number, owner: object | null): Mon {
  const sp = species(dex);
  const stats = statsAtLevel(sp.stats, level);
  return {
    id: nextId++, dex, species: sp, name: sp.name, level, hp: stats.hp, maxHp: stats.hp, stats, stages: { atk: 0, def: 0, spe: 0 },
    types: sp.types, moves: [], cooldowns: [0, 0], x, y: 0, px: x, py: 0, dir: dirFromVector(1, 0, 0),
    anim, sprites: null as unknown as Mon['sprites'], owner: owner as Mon['owner'], wild: !owner, boss: false,
    fainted: false, status: null, statusTimer: 0, flash: 0, homeX: x, homeY: 0, targetX: x, targetY: 0, idleTimer: 0,
    moving: false, inDark: false, drowsy: 0, outsideDark: 0, aura: false, heldItem: null, busy: 0, casting: null, target: null, captured: false, behavior: 'guard', xp: 0, wander: null, wanderPause: 0, roamTarget: null, recall: false, sinceHit: 999, visual: { scale: 1, alpha: 1, flash: 0 }, evolving: null,
  } as Mon;
}
const me = { isPlayer: false, id: 1, stats: { damage: 0 } };
const them = { isPlayer: false, id: 2, stats: { damage: 0 } };

/** Casts `moveId` from a level-30 attacker at `target` and runs 3 s; returns the events. */
function hitWith(b: BattleSystem, dex: string, moveId: string, target: Mon, level = 30): BattleEvent[] {
  const a = mon(dex, level, 0, me);
  a.moves = [moveId];
  a.cooldowns = [0];
  const log: BattleEvent[] = [];
  b.tryCast(a, 0, target.x, target.y, target.id, target);
  for (let i = 0; i < 180; i++) {
    b.stepMon(a, 1 / 60, () => [a, target]);
    b.stepFlights(1 / 60);
    log.push(...b.events);
    b.events.length = 0;
  }
  return log;
}

function asleep(b: BattleSystem, t: Mon): void {
  b.applyStatus(t, 'sleep');
  b.events.length = 0;
  t.statusTimer = 99; // long enough that only a hit could end it within the test
}

describe('sleep breaks on damage (round 3, for review)', () => {
  it('the first move hit that deals damage wakes it', () => {
    const b = new BattleSystem(new Rng(1));
    const t = mon('0143', 30, 2, them);
    asleep(b, t);
    const log = hitWith(b, '0025', 'thunder-shock', t);
    expect(t.status).toBe(null);
    const hit = log.findIndex((e) => e.type === 'hit' && e.damage > 0);
    const wake = log.findIndex((e) => e.type === 'wake');
    expect(hit).toBeGreaterThanOrEqual(0);
    // (The wake is announced as the hit lands, just before the hit's own event.)
    expect(wake).toBe(hit - 1);
  });

  it('a hit that deals nothing does not: an immune target, a status move', () => {
    const b = new BattleSystem(new Rng(2));
    const ground = mon('0074', 30, 2, them);
    asleep(b, ground);
    hitWith(b, '0025', 'thunder-shock', ground); // Electric on Ground: 0
    expect(ground.status).toBe('sleep');
    const t = mon('0143', 30, 2, them);
    asleep(b, t);
    hitWith(b, '0052', 'growl', t);
    expect(t.status).toBe('sleep');
  });

  it('burn and poison ticks, recoil and Bad Dreams do not', () => {
    const b = new BattleSystem(new Rng(3));
    const t = mon('0143', 30, 2, them);
    asleep(b, t);
    // The damage those deal goes straight to applyDamage, as burn, poison, recoil and Bad Dreams do.
    b.applyDamage(t, 3, null);
    b.applyDamage(t, 3, mon('0491', 50, 9, null));
    expect(t.status).toBe('sleep');
  });

  it('a beam pulse wakes it only when the pulse deals at least 1', () => {
    // A resisted beam from a low level: many pulses round to 0 before the first whole point.
    const b = new BattleSystem(new Rng(4));
    const t = mon('0076', 40, 2, them); // Golem resists Fire
    t.maxHp = t.hp = 9999;
    asleep(b, t);
    const log = hitWith(b, '0004', 'flamethrower', t, 8);
    const hits = log.filter((e) => e.type === 'hit' && e.target === t) as Array<Extract<BattleEvent, { type: 'hit' }>>;
    const firstReal = hits.findIndex((h) => h.damage > 0);
    expect(hits[0]!.damage).toBe(0);
    expect(firstReal).toBeGreaterThan(0);
    // It woke on that pulse, not before (the wake comes just before that pulse's hit event).
    const order = log.filter((e) => (e.type === 'hit' && e.target === t) || e.type === 'wake');
    expect(order.findIndex((e) => e.type === 'wake')).toBe(firstReal);
  });

  it('the storm keeps its hold: no waking in the darkness, and the darkness\'s own sleep ends only in the light', () => {
    const b = new BattleSystem(new Rng(5));
    const inDark = mon('0143', 30, 2, them);
    asleep(b, inDark);
    inDark.inDark = true;
    hitWith(b, '0025', 'thunder-shock', inDark);
    expect(inDark.status).toBe('sleep');
    // Put to sleep by the darkness (match.ts marks it with a timer of 1e9), now standing in the light.
    const lulled = mon('0143', 30, 2, them);
    asleep(b, lulled);
    lulled.statusTimer = 1e9;
    hitWith(b, '0025', 'thunder-shock', lulled);
    expect(lulled.status).toBe('sleep');
  });

  it('two hits in the same moment: the first wakes it, the second lands on a waking Pokémon', () => {
    const b = new BattleSystem(new Rng(6));
    const t = mon('0143', 30, 2, them);
    asleep(b, t);
    const a1 = mon('0025', 30, 0, me);
    const a2 = mon('0025', 30, 0.2, me);
    for (const a of [a1, a2]) {
      a.moves = ['thunder-shock'];
      a.cooldowns = [0];
      b.tryCast(a, 0, t.x, t.y, t.id, t);
    }
    const log: BattleEvent[] = [];
    for (let i = 0; i < 120; i++) {
      b.stepMon(a1, 1 / 60, () => [a1, a2, t]);
      b.stepMon(a2, 1 / 60, () => [a1, a2, t]);
      b.stepFlights(1 / 60);
      log.push(...b.events);
      b.events.length = 0;
    }
    expect(log.filter((e) => e.type === 'wake')).toHaveLength(1);
    expect(log.filter((e) => e.type === 'hit' && e.damage > 0)).toHaveLength(2);
  });
});
