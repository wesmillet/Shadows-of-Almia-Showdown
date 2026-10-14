import { describe, expect, it } from 'vitest';
import { Rng } from '../core/rng';
import { areaContains, computeDamage, makeArea, moveScore } from './battle';
import { move, species, statsAtLevel } from './data';
import type { Mon } from './entities';

function mon(dex: string, x = 0, y = 0): Mon {
  const sp = species(dex);
  const stats = statsAtLevel(sp.stats, 15);
  return {
    id: 1, dex, species: sp, name: sp.name, level: 15, hp: stats.hp, maxHp: stats.hp, stats, stages: { atk: 0, def: 0 },
    types: sp.types, moves: sp.moves, cooldowns: [0, 0, 0, 0], x, y, px: x, py: y, dir: 0,
    anim: null as unknown as Mon['anim'], sprites: null as unknown as Mon['sprites'], owner: null, wild: true, boss: false,
    fainted: false, status: null, statusTimer: 0, flash: 0, homeX: x, homeY: y, targetX: x, targetY: y, idleTimer: 0,
    moving: false, inDark: false, drowsy: 0, outsideDark: 0, aura: false, heldItem: null, busy: 0, casting: null, target: null, captured: false,
  };
}

describe('areas', () => {
  it('line reaches three tiles ahead and cone widens', () => {
    const caster = mon('0025', 5, 5);
    const line = makeArea(move('thunder-shock'), caster, 8, 5);
    expect(areaContains(line, 7, 5)).toBe(true);
    expect(areaContains(line, 7, 6.2)).toBe(false);
    expect(areaContains(line, 9.2, 5)).toBe(false);
    const cone = makeArea(move('razor-leaf'), caster, 5, 8);
    expect(areaContains(cone, 5, 7)).toBe(true);
    expect(areaContains(cone, 6.2, 7.5)).toBe(true);
    expect(areaContains(cone, 6.2, 5.5)).toBe(false);
    const ring = makeArea(move('discharge'), caster, 5, 5);
    expect(areaContains(ring, 6.5, 5)).toBe(true);
    expect(areaContains(ring, 5, 5)).toBe(false);
    expect(areaContains(ring, 8, 5)).toBe(false);
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
