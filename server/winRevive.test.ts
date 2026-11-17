/** Winning a trainer battle revives and fully heals the winner's whole team. */
import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { loadWorld } from './world';
import { Match } from '../src/sim/match';
import { Rng } from '../src/core/rng';

describe('win revive', async () => {
  const world = await loadWorld(join(import.meta.dirname, '..', 'assets'));
  it('fainted Pokémon come back at full HP, the rest are healed and cured', () => {
    const m = new Match({ ground: world.ground(), rng: new Rng(3), sprites: world.sprites }, [], { humans: [{ name: 'P', starters: ['0004', '0007', '0001'] }], rivals: 3, keepsResults: true } as never);
    const p = m.seats[0]!.trainer;
    const foe = m.trainers.find((t) => t !== p && !t.visitor && !t.challenger)!;
    const [a, b, c] = p.party;
    a!.hp = 3;
    b!.fainted = true;
    b!.hp = 0;
    c!.hp = 5;
    m.battle.applyStatus(c!, 'poison');
    (m as unknown as { finalWinBonus(w: unknown, l: unknown): void }).finalWinBonus(p, foe);
    for (const x of [a, b, c]) {
      expect(x!.fainted).toBe(false);
      expect(x!.hp).toBe(x!.maxHp);
    }
    expect(c!.status).toBeNull();
    expect(b!.stowed).toBe(true);
  });
});
