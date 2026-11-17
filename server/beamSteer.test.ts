/** Every player's own beam follows their own aim, not only the first seat's. */
import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { loadWorld } from './world';
import { Match } from '../src/sim/match';
import { Rng } from '../src/core/rng';

describe('beam steering online', async () => {
  const world = await loadWorld(join(import.meta.dirname, '..', 'assets'));
  it("the second player's beam turns to the second player's aim", () => {
    const m = new Match({ ground: world.ground(), rng: new Rng(4), sprites: world.sprites }, [], { humans: [{ name: 'A', starters: ['0004'] }, { name: 'B', starters: ['0007'] }], rivals: 0 } as never);
    const seatB = m.seats[1]!;
    const mon = seatB.trainer.party[0]!;
    mon.stowed = false;
    mon.channel = { manual: true, moveId: 'hydro-pump', left: 2, next: 0.25, pulses: 9, fired: 1, dirX: 1, dirY: 0, aimX: mon.x + 3, aimY: mon.y } as never;
    mon.casting = { moveId: 'hydro-pump', t: 0.05, targetX: mon.x + 3, targetY: mon.y } as never;
    m.seats[0]!.aim = { x: mon.x + 3, y: mon.y };
    seatB.aim = { x: mon.x, y: mon.y + 3 };
    (m as unknown as { steerChannels(): void }).steerChannels();
    const ch = () => mon.channel as unknown as { aimX: number; aimY: number; dirY: number };
    expect(ch().aimX).toBeCloseTo(mon.x, 5);
    expect(ch().aimY).toBeCloseTo(mon.y + 3, 5);
    m.battle.stepMon(mon, 0.02, () => [mon]);
    expect(ch().dirY).toBeGreaterThan(0.9);
  });
});
