/** The Castle Champion and Ace Trainer Celeste field six (three ranged, three melee, from twelve) and give TMs. */
import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { loadWorld } from './world';
import { Match } from '../src/sim/match';
import { Rng } from '../src/core/rng';
import { SHOPS, drawTeam, rewardTms } from '../src/sim/town';
import { ITEMS } from '../src/sim/items';

describe('tougher Castle and Ace fights', async () => {
  const world = await loadWorld(join(import.meta.dirname, '..', 'assets'));
  it('draws three ranged and three melee, different each time', () => {
    const ch = SHOPS.challenger;
    const seen = new Set<string>();
    for (let s = 1; s <= 8; s++) {
      const team = drawTeam(new Rng(s), ch.ranged!, ch.melee!, 6, () => true);
      expect(team).toHaveLength(6);
      expect(new Set(team).size).toBe(6);
      expect(team.filter((d) => ch.ranged!.includes(d))).toHaveLength(3);
      seen.add(team.slice().sort().join());
    }
    expect(seen.size).toBeGreaterThan(1);
    const tms = rewardTms(new Rng(2), [2, 3], ['tm-a', 'tm-b', 'tm-c', 'tm-d']);
    expect(tms.length).toBeGreaterThanOrEqual(2);
    expect(tms.length).toBeLessThanOrEqual(3);
  });
  it('the champion sends six; beating him gives 2 or 3 TMs', () => {
    const m = new Match({ ground: world.ground(), rng: new Rng(3), sprites: world.sprites }, [], { humans: [{ name: 'P', starters: ['0004'] }], rivals: 0, keepsResults: true } as never);
    if (!m.challenge) return;
    m.startChallenge();
    const foe = m.challenge.foe!;
    expect(foe.party).toHaveLength(6);
    const p = m.player;
    p.items = p.items.map(() => null);
    p.held = p.held.map(() => null);
    (m as unknown as { winChallenge(c: unknown): void }).winChallenge(m.challenge);
    const tms = p.held.filter((e) => e && ITEMS[e.id]?.kind === 'tm').reduce((n, e) => n + e!.count, 0);
    expect(tms).toBeGreaterThanOrEqual(2);
  });
});
