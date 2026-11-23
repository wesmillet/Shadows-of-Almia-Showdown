/** Steven online: the server asks, the winner answers with a command, the prize reaches the account's PC, leaving keeps the win. */
import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { loadWorld } from './world';
import { Room } from './room';
import { stevenConfig } from '../src/sim/steven';

describe('Steven online', async () => {
  const world = await loadWorld(join(import.meta.dirname, '..', 'assets'));
  const make = (steven = true, mode = 'casual') => {
    const stored: Array<{ key: string; dex: string; via?: string }> = [];
    const sent: Array<{ t: string; outcome?: string }> = [];
    const hooks = { rareChest: false, steven, chestLoad: () => null, chestSave: () => {}, extracted: (key: string, mon: { dex: string }, _id: string, via?: string) => stored.push({ key, dex: mon.dex, via }) };
    const peer = { key: 'u1', name: 'A', send: (m: { t: string; outcome?: string }) => sent.push(m) };
    const room = new Room(world, [{ name: 'A', starter: '0006', peer }], 6, 21, hooks as never, () => {}, { mode } as never);
    const m = room.match;
    const p = m.player;
    p.party.push(m.makeMon('0448', 50, p, p.x, p.y));
    const run = (seconds: number) => {
      for (let i = 0; i < seconds * 60 && !room.closed; i++) room.step();
    };
    run(0.2);
    for (const t of m.trainers.filter((t) => t !== p && !t.visitor && !t.challenger)) m.eliminate(t);
    run(0.2);
    return { room, m, p, run, stored, sent };
  };

  it('invites, takes the answer as a command, and stores the prize on a win', () => {
    const { room, m, run, stored, sent } = make();
    expect(m.steven.state).toBe('invite');
    expect(sent.some((x) => x.t === 'end')).toBe(false);
    room.receive('u1', { t: 'cmd', c: 'steven', a: [1], n: 1 } as never);
    expect(m.steven.state).toBe('intro');
    run(stevenConfig().introSeconds + 0.5);
    expect(m.steven.state).toBe('battle');
    for (const x of m.steven.host!.party) {
      x.hp = 0;
      x.fainted = true;
    }
    run(3);
    expect(m.steven.result).toBe('won');
    expect(stored).toEqual([{ key: 'u1', dex: expect.stringMatching(/-(molten|glacier|moon|amber|moss|abyss)$/), via: 'steven' }]);
    run(stevenConfig().outroSeconds + 1);
    expect(sent.find((x) => x.t === 'end')?.outcome).toBe('win');
    expect(room.closed).toBe(true);
  });

  it('leaving during the battle keeps the win (no prize)', () => {
    const { room, m, run, stored, sent } = make();
    room.receive('u1', { t: 'cmd', c: 'steven', a: [1], n: 1 } as never);
    run(stevenConfig().introSeconds + 0.5);
    room.receive('u1', { t: 'leave' } as never);
    run(0.5);
    expect(sent.find((x) => x.t === 'end')?.outcome).toBe('win');
    expect(stored).toHaveLength(0);
    expect(m.steven.state).toBe('done');
  });

  it('switched off (STEVEN=0) or in a private match: the win comes at once', () => {
    for (const [steven, mode] of [[false, 'casual'], [true, 'private']] as const) {
      const { m, sent } = make(steven, mode);
      expect(m.steven.state).toBe('done');
      expect(sent.find((x) => x.t === 'end')?.outcome).toBe('win');
    }
  });
});
