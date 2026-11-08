/** The sunglasses Poliwag line (a gift for one player): its own forms all the way up, kept as Poliwag in the PC, never wild. */
import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { loadWorld } from './world';
import { Match } from '../src/sim/match';
import { Rng } from '../src/core/rng';
import { SPECIES } from '../src/sim/data';
import { pcBase } from '../src/sim/starters';
import { stoneEvolution } from '../src/sim/evolution';
import { SPAWNS } from '../src/sim/data';

describe('sunglasses Poliwag line', async () => {
  const world = await loadWorld(join(import.meta.dirname, '..', 'assets'));
  it('evolves within its own forms and saves as the sunglasses Poliwag', () => {
    for (const d of ['0060-rad', '0061-rad', '0062-rad', '0186-rad']) {
      expect(SPECIES.has(d)).toBe(true);
      expect(existsSync(join(import.meta.dirname, '..', 'assets', 'pokemon', d, 'Idle-Anim.png'))).toBe(true);
      expect(existsSync(join(import.meta.dirname, '..', 'assets', 'portraits', d, 'Normal.png'))).toBe(true);
      expect(pcBase(d)).toBe('0060-rad');
    }
    const whirl = SPECIES.get('0061-rad')!;
    expect(stoneEvolution(whirl, 'water-stone')).toBe('0062-rad');
    expect(stoneEvolution(whirl, 'shiny-stone')).toBe('0186-rad');
    const m = new Match({ ground: world.ground(), rng: new Rng(2), sprites: world.sprites }, [], { humans: [{ name: 'P', starters: ['0004'] }], rivals: 0, keepsResults: true } as never);
    const mon = m.makeMon('0060-rad', 24, m.seats[0]!.trainer, 10, 10);
    expect(mon.name).toBe('Poliwag');
    expect(JSON.stringify(SPAWNS)).not.toContain('-rad');
  });
});
