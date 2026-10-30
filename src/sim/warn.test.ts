import { describe, expect, it } from 'vitest';
import { Rng } from '../core/rng';
import { dirFromVector } from '../core/math';
import { BattleSystem, type BattleEvent } from './battle';
import { move, species, statsAtLevel } from './data';
import type { Mon } from './entities';

const anim = { play() {}, sprites: { def: () => undefined }, action: 'Idle', dir: 0, done: false } as unknown as Mon['anim'];
let nextId = 300;
function mon(dex: string, x: number, owner: object | null): Mon {
  const sp = species(dex);
  const stats = statsAtLevel(sp.stats, 40);
  return {
    id: nextId++, dex, species: sp, name: sp.name, level: 40, hp: stats.hp, maxHp: stats.hp, stats, stages: { atk: 0, def: 0, spe: 0 },
    types: sp.types, moves: [], cooldowns: [0], x, y: 0, px: x, py: 0, dir: dirFromVector(1, 0, 0),
    anim, sprites: null as unknown as Mon['sprites'], owner: owner as Mon['owner'], wild: !owner, boss: false,
    fainted: false, status: null, statusTimer: 0, flash: 0, homeX: x, homeY: 0, targetX: x, targetY: 0, idleTimer: 0,
    moving: false, inDark: false, drowsy: 0, outsideDark: 0, aura: false, heldItem: null, busy: 0, casting: null, target: null, captured: false, behavior: 'guard', xp: 0, wander: null, wanderPause: 0, roamTarget: null, recall: false, sinceHit: 999, visual: { scale: 1, alpha: 1, flash: 0 }, evolving: null,
  } as Mon;
}
const me = { isPlayer: false, id: 1, stats: { damage: 0 } };
const them = { isPlayer: false, id: 2, stats: { damage: 0 } };

function strike(moveId: string, dex: string, moveAway: boolean): { resolvedAt: number; hitAt: number | null; damage: number } {
  const b = new BattleSystem(new Rng(9));
  const a = mon(dex, 0, me);
  a.moves = [moveId];
  const t = mon('0143', 4, them);
  t.maxHp = t.hp = 9999;
  b.tryCast(a, 0, t.x, t.y, t.id, t);
  let resolvedAt = -1;
  let hitAt: number | null = null;
  let damage = 0;
  for (let i = 0; i < 120; i++) {
    b.stepMon(a, 1 / 60, () => [a, t]);
    b.stepFlights(1 / 60);
    for (const e of b.events as BattleEvent[]) {
      if (e.type === 'resolve') resolvedAt = i;
      if (e.type === 'hit' && e.target === t) {
        hitAt = i;
        damage += e.damage;
      }
    }
    b.events.length = 0;
    // Step out of the mark a quarter second after it appears (a player reacting to it).
    if (moveAway && resolvedAt >= 0 && i === resolvedAt + 15) t.y = 3;
  }
  return { resolvedAt, hitAt, damage };
}

describe('marked, delayed strikes (prototype: Thunder, Stone Edge)', () => {
  for (const [id, dex] of [['thunder', '0026'], ['stone-edge', '0076']] as const) {
    it(`${id}: lands on the marked spot ${move(id).warn} s after it is marked; a Pokémon that steps out in time is missed`, () => {
      const stay = strike(id, dex, false);
      expect(stay.hitAt).not.toBeNull();
      expect((stay.hitAt! - stay.resolvedAt) / 60).toBeCloseTo(move(id).warn!, 1);
      expect(stay.damage).toBeGreaterThan(0);
      const away = strike(id, dex, true);
      expect(away.hitAt).toBeNull();
    });
  }

  it('leaves quick attacks quick: Quick Attack, Aqua Jet, Ice Shard and Thunder Shock have no mark', () => {
    for (const id of ['quick-attack', 'aqua-jet', 'ice-shard', 'thunder-shock']) expect(move(id).warn, id).toBeUndefined();
  });
});
