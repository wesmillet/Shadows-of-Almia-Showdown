/** Splitting stacks at the storage chest: a count moves part of a stack, the rest stays. */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FanGround, type FanMapFile } from '../src/ground/fanGround';
import { CONFIG, SPECIES } from '../src/sim/data';
import { Match } from '../src/sim/match';
import { Rng } from '../src/core/rng';
import { SpriteRegistry } from '../src/sprites/pokemonSprite';
import { NodeAssets } from './nodeAssets';

describe('chest stack splitting', async () => {
  const ROOT = join(import.meta.dirname, '..', 'assets');
  const ground = FanGround.headless(JSON.parse(readFileSync(join(ROOT, 'maps', `${CONFIG.map.name}.json`), 'utf8')) as FanMapFile);
  const sprites = new SpriteRegistry(new NodeAssets(ROOT));
  await sprites.preload([...SPECIES.keys()].slice(0, 30));

  it('stores and takes one or some, and the whole stack without a count', () => {
    const m = new Match({ ground, rng: new Rng(3), sprites }, [], { humans: [{ name: 'P1', starters: ['0025'] }], rivals: 0 });
    m.chestStore = { load: () => [], save: () => {} };
    const p = m.seats[0]!.trainer;
    p.items = p.items.map(() => null);
    p.items[0] = { id: 'super-potion', count: 5 };
    m.deposit(p, 'items', 0, 1);
    expect(p.items[0]?.count).toBe(4);
    const at = m.storageOf(p).findIndex((s) => s?.id === 'super-potion');
    expect(m.storageOf(p)[at]?.count).toBe(1);
    m.deposit(p, 'items', 0, 2);
    expect(p.items[0]?.count).toBe(2);
    expect(m.storageOf(p)[at]?.count).toBe(3);
    m.withdraw(p, at, 1);
    expect(m.storageOf(p)[at]?.count).toBe(2);
    expect(p.items[0]?.count).toBe(3);
    m.withdraw(p, at);
    expect(m.storageOf(p)[at]).toBeNull();
    expect(p.items[0]?.count).toBe(5);
    m.deposit(p, 'items', 0);
    expect(p.items[0]).toBeNull();
    expect(m.storageOf(p)[at]?.count).toBe(5);
  }, 60_000);
});
