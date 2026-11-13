/** Beam clash: two foes' beams pointed at each other lock, push toward the weaker side, and the winner breaks through. */
import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { loadWorld } from './world';
import { Match } from '../src/sim/match';
import { Rng } from '../src/core/rng';
import { CONFIG } from '../src/sim/data';
import type { Mon } from '../src/sim/entities';

describe('beam clash', async () => {
  const world = await loadWorld(join(import.meta.dirname, '..', 'assets'));
  const setup = (levelA: number, levelB: number) => {
    const m = new Match({ ground: world.ground(), rng: new Rng(4), sprites: world.sprites }, [], { humans: [{ name: 'P', starters: ['0004'] }], rivals: 0 });
    const p = m.seats[0]!.trainer;
    m.items = [];
    m.wilds = [];
    const a = m.makeMon('0004', levelA, p, p.x, p.y);
    const b = m.makeMon('0007', levelB, null, p.x + 4, p.y);
    b.wild = true;
    const beam = (mon: Mon, moveId: string, toward: Mon) => {
      const dx = toward.x - mon.x;
      const dy = toward.y - mon.y;
      const d = Math.hypot(dx, dy);
      mon.channel = { moveId, left: 2, next: 0.25, pulses: 9, fired: 1, dirX: dx / d, dirY: dy / d, aimX: toward.x, aimY: toward.y };
      mon.casting = { moveId, t: 0.05, targetX: toward.x, targetY: toward.y } as never;
    };
    beam(a, 'flamethrower', b);
    beam(b, 'hydro-pump', a);
    const both = () => [a, b];
    const step = (dt: number) => {
      for (const mon of both()) m.battle.stepMon(mon, dt, both);
    };
    return { m, a, b, step };
  };

  it('locks, holds both beams and lets no damage through', () => {
    const { m, a, b, step } = setup(30, 30);
    const ha = a.hp;
    const hb = b.hp;
    step(0.02);
    expect(a.channel?.clash).toBeTruthy();
    expect(b.channel?.clash).toBeTruthy();
    expect(m.battle.events.some((e) => e.type === 'clash' && e.state === 'start')).toBe(true);
    for (let i = 0; i < 40; i++) step(0.02);
    expect(a.hp).toBe(ha);
    expect(b.hp).toBe(hb);
    expect(a.channel).toBeTruthy();
    expect(b.channel).toBeTruthy();
  });

  it('the stronger beam pushes through and the loser is hit and stops', () => {
    // Hydro Pump at a high level against a low Flamethrower: water wins.
    const { m, a, b, step } = setup(10, 60);
    const ha = a.hp;
    for (let i = 0; i < 400 && (a.channel?.clash || b.channel?.clash || i === 0); i++) step(0.02);
    const won = m.battle.events.find((e) => e.type === 'clash' && e.state === 'won');
    expect(won && won.type === 'clash' && won.a).toBe(b);
    expect(a.channel).toBeFalsy();
    expect(a.hp).toBeLessThan(ha);
  });

  it('never lasts past maxSeconds', () => {
    const { step, a } = setup(30, 30);
    let t = 0;
    step(0.02);
    while (a.channel?.clash && t < 20) {
      step(0.05);
      t += 0.05;
    }
    expect(t).toBeLessThanOrEqual(CONFIG.battle.clash.maxSeconds + 0.1);
  });

  it('turning a beam away breaks the lock', () => {
    const { m, a, b, step } = setup(30, 30);
    step(0.02);
    expect(a.channel?.clash).toBeTruthy();
    a.channel!.dirX = 0;
    a.channel!.dirY = 1;
    a.channel!.aimX = a.x;
    a.channel!.aimY = a.y + 3;
    step(0.02);
    expect(a.channel?.clash).toBeFalsy();
    expect(b.channel?.clash).toBeFalsy();
    expect(m.battle.events.some((e) => e.type === 'clash' && e.state === 'break')).toBe(true);
  });
});
