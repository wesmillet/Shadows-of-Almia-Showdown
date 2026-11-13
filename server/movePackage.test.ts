/** Move balance package: telegraphed instant moves, harder contact moves, shorter sky reach, walking while beaming. */
import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { loadWorld } from './world';
import { Match } from '../src/sim/match';
import { Rng } from '../src/core/rng';
import { CONFIG, move } from '../src/sim/data';
import { impactDelay, isInstant, moveReach, computeDamage } from '../src/sim/battle';

describe('move package', async () => {
  const world = await loadWorld(join(import.meta.dirname, '..', 'assets'));
  const setup = () => {
    const m = new Match({ ground: world.ground(), rng: new Rng(9), sprites: world.sprites }, [], { humans: [{ name: 'P', starters: ['0004'] }], rivals: 0 });
    const p = m.seats[0]!.trainer;
    m.items = [];
    m.wilds = [];
    m.darkness.radius = m.darkness.targetRadius = 999;
    m.darkness.nextPulseIn = 1e9;
    return { m, p };
  };

  it('classifies instant moves and gives them a warning', () => {
    expect(isInstant(move('psychic'))).toBe(true);
    expect(isInstant(move('earth-power'))).toBe(true);
    expect(isInstant(move('icicle-crash'))).toBe(false);
    expect(isInstant(move('crunch'))).toBe(false);
    expect(isInstant(move('flamethrower'))).toBe(false);
    const { m, p } = setup();
    const a = p.party[0]!;
    const b = m.makeMon('0399', 5, null, a.x + 3, a.y);
    expect(impactDelay(a, b, move('psychic'))).toBeGreaterThanOrEqual(CONFIG.battle.telegraph.seconds);
  });

  it('sky moves reach 4 tiles, shots 5', () => {
    expect(moveReach(move('icicle-crash'))).toBe(CONFIG.battle.skyReach);
    expect(CONFIG.battle.skyReach).toBeLessThan(5);
    expect(moveReach(move('shadow-ball'))).toBe(5);
  });

  it('contact moves hit 10% harder', () => {
    const { m, p } = setup();
    const a = m.makeMon('0248', 40, p, p.x, p.y);
    const b = m.makeMon('0399', 40, null, p.x + 1, p.y);
    const crunch = move('crunch');
    const fake = { ...crunch, contact: false } as typeof crunch;
    const r1 = computeDamage(new Rng(1), a, b, crunch, 1);
    const r2 = computeDamage(new Rng(1), a, b, fake, 1);
    expect((r1.raw ?? 0) / (r2.raw ?? 1)).toBeCloseTo(CONFIG.battle.contactPower, 3);
  });

  it('a target that leaves the warning ring is missed; one that stays is hit', () => {
    for (const leave of [true, false]) {
      const { m, p } = setup();
      const a = m.makeMon('0065', 40, p, p.x, p.y);
      const b = m.makeMon('0399', 40, null, p.x + 3, p.y);
      b.wild = true;
      const before = b.hp;
      m.battle.inFlight.length = 0;
      m.battle.events.length = 0;
      // As if the cast just resolved on b.
      (m.battle as unknown as { resolve: (...x: unknown[]) => void }).resolve(a, move('psychic'), { shape: 'single', tx: b.x, ty: b.y, x: a.x, y: a.y } as never, [b]);
      expect(m.battle.events.some((e) => e.type === 'telegraph')).toBe(true);
      expect(b.hp).toBe(before);
      if (leave) b.y += 2.5;
      m.battle.stepFlights(CONFIG.battle.telegraph.seconds + 0.05);
      if (leave) expect(b.hp).toBe(before);
      else expect(b.hp).toBeLessThan(before);
    }
  });

  it('a steered Pokémon walks at half speed while its beam fires', () => {
    const { m } = setup();
    const a = m.player.party[0]!;
    const x0 = a.x;
    const full = m.walkSteered(a, 1, 0, 0.1);
    a.x = x0;
    a.channel = { manual: true, moveId: 'flamethrower', left: 1, next: 0.1, pulses: 8, fired: 0, dirX: 1, dirY: 0, aimX: a.x + 3, aimY: a.y } as never;
    const half = m.walkSteered(a, 1, 0, 0.1);
    expect(half / full).toBeCloseTo(CONFIG.battle.channel.walkSpeed, 2);
  });
});

describe('sky drops', async () => {
  const world = await loadWorld(join(import.meta.dirname, '..', 'assets'));
  it('Icicle Crash lands on the marked spot: backing straight away dodges it, standing still does not', () => {
    for (const leave of [true, false]) {
      const m = new Match({ ground: world.ground(), rng: new Rng(9), sprites: world.sprites }, [], { humans: [{ name: 'P', starters: ['0004'] }], rivals: 0 });
      const p = m.seats[0]!.trainer;
      m.items = [];
      m.wilds = [];
      const a = m.makeMon('0461', 40, p, p.x, p.y);
      const b = m.makeMon('0399', 40, null, p.x + 3, p.y);
      b.wild = true;
      const before = b.hp;
      m.battle.inFlight.length = 0;
      m.battle.events.length = 0;
      (m.battle as unknown as { resolve: (...x: unknown[]) => void }).resolve(a, move('icicle-crash'), { shape: 'single', tx: b.x, ty: b.y, x: a.x, y: a.y } as never, [b]);
      expect(m.battle.events.some((e) => e.type === 'telegraph')).toBe(true);
      const f = m.battle.inFlight[0]!;
      expect(f.t).toBeGreaterThanOrEqual(CONFIG.battle.skyDrop.minSeconds - 1e-9);
      if (leave) b.x += 2; // straight away from the attacker, along the line
      m.battle.stepFlights(f.t + 0.05);
      if (leave) expect(b.hp).toBe(before);
      else expect(b.hp).toBeLessThan(before);
    }
  });
});
