import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Rng } from '../core/rng';
import { SPECIES, drawScale, species, statsAtLevel } from './data';
import type { Mon } from './entities';
import { applyEvolution, evolutionsAt, formAtLevel } from './evolution';
import spawns from '../../data/spawns.json';

const stubSprites = { resolve: (a: string) => a, ensureSheet: () => Promise.resolve(), def: () => null } as unknown as Mon['sprites'];

function mon(dex: string, level: number): Mon {
  const sp = species(dex);
  const stats = statsAtLevel(sp.stats, level);
  return {
    id: 1, dex, species: sp, name: sp.name, level, hp: Math.round(stats.hp / 2), maxHp: stats.hp, stats, stages: { atk: 0, def: 0, spe: 0 },
    types: [...sp.types], moves: [...sp.moves], cooldowns: [0, 0, 0, 0], x: 0, y: 0, px: 0, py: 0, dir: 2,
    anim: null as unknown as Mon['anim'], sprites: stubSprites, owner: null, wild: false, boss: false,
    fainted: false, status: null, statusTimer: 0, flash: 0, homeX: 0, homeY: 0, targetX: 0, targetY: 0, idleTimer: 0,
    moving: false, inDark: false, drowsy: 0, outsideDark: 0, aura: false, heldItem: null, busy: 0, casting: null, target: null, captured: false, behavior: 'guard', xp: 0, wander: null, wanderPause: 0, roamTarget: null, recall: false, sinceHit: 999, visual: { scale: 1, alpha: 1, flash: 0 }, evolving: null,
  };
}

describe('evolution data', () => {
  it('every evolution points at a known species with sprites, at a higher level than the one before', () => {
    for (const s of SPECIES.values()) {
      for (const e of s.evolves ?? []) {
        expect(SPECIES.has(e.to), `${s.name} -> ${e.to}`).toBe(true);
        expect(existsSync(`assets/pokemon/${e.to}/AnimData.xml`), `${e.to} sprites`).toBe(true);
        expect(e.level).toBeGreaterThan(1);
        for (const e2 of species(e.to).evolves ?? []) expect(e2.level, `${e.to} evolves later than it appears`).toBeGreaterThan(e.level);
      }
    }
  });

  it('every starter has an evolution line, every evolution target exists, and every species a canonical size', () => {
    const bases = [...spawns.starterPool];
    for (const s of SPECIES.values()) for (const e of s.evolves ?? []) expect(SPECIES.has(e.to), `${s.name} -> ${e.to}`).toBe(true);
    for (const dex of bases) expect(species(dex).evolves?.length, dex).toBeGreaterThan(0);
    for (const s of SPECIES.values()) {
      expect(s.heightM, s.name).toBeGreaterThan(0);
      expect(s.body?.length, s.name).toBe(2);
      expect(drawScale(s), s.name).toBeGreaterThan(0.1);
    }
    // Sizes follow the Pokédex: Gyarados towers over Magikarp, Pikachu stands well under a trainer.
    expect(drawScale(species('0130')) * species('0130').body[1]).toBeGreaterThan(3 * drawScale(species('0129')) * species('0129').body[1]);
    expect(drawScale(species('0025')) * species('0025').body[1]).toBeLessThan(16);
  });
});

describe('evolving', () => {
  it('follows a line as far as the level allows', () => {
    const rng = new Rng(1);
    expect(formAtLevel('0387', 10, rng)).toBe('0387');
    expect(formAtLevel('0387', 18, rng)).toBe('0388');
    expect(formAtLevel('0387', 40, rng)).toBe('0389');
    expect(formAtLevel('0129', 25, rng)).toBe('0130');
    expect(evolutionsAt(species('0133'), 22)).toHaveLength(8);
    const eeveelutions = new Set(Array.from({ length: 40 }, () => formAtLevel('0133', 30, rng)));
    expect(eeveelutions.size).toBeGreaterThan(3);
    // In the wild most stay unevolved, some don't.
    const wild = Array.from({ length: 200 }, () => formAtLevel('0010', 12, rng, true));
    const base = wild.filter((d) => d === '0010').length;
    expect(base).toBeGreaterThan(80);
    expect(base).toBeLessThan(200);
  });

  it('swaps species, types and stats, keeps the HP share and TM moves', () => {
    const m = mon('0387', 18);
    m.moves[3] = 'earthquake'; // taught by a TM
    applyEvolution(m, species('0388'), stubSprites);
    expect(m.name).toBe('Grotle');
    expect(m.dex).toBe('0388');
    expect(m.moves).toEqual(['razor-leaf', 'energy-ball', 'bite', 'earthquake']);
    expect(m.stats).toEqual(statsAtLevel(species('0388').stats, 18));
    expect(m.hp / m.maxHp).toBeCloseTo(0.5, 1);
    expect(m.anim.dir).toBe(2);
  });
});
