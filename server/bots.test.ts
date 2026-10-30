/**
 * Computer trainers play by a player's rules: the same start, the same walking pace, the same
 * healer, no outpost beacon pulling them across the map, and they catch Pokémon with real balls.
 */
import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { loadWorld } from './world';
import { Match } from '../src/sim/match';
import { Rng } from '../src/core/rng';
import { CONFIG } from '../src/sim/data';
import { BASE_TIERS, STARTER_TIERS } from '../src/sim/starters';
import { setCatchTarget, spares } from '../src/sim/bot';

describe('computer trainers', async () => {
  const world = await loadWorld(join(import.meta.dirname, '..', 'assets'));
  const newMatch = (seed: number, rivals = 4) => new Match({ ground: world.ground(), rng: new Rng(seed), sprites: world.sprites }, [], { humans: [{ name: 'P', starters: ['0004'] }], rivals });

  it('start like a new player: one starter from the new-player pool, the same level, bag and money', () => {
    const m = newMatch(5);
    const p = m.seats[0]!.trainer;
    const pool = new Set(STARTER_TIERS.filter((t) => BASE_TIERS.includes(t.id)).flatMap((t) => t.dex));
    for (const t of m.trainers) {
      expect(t.party).toHaveLength(1);
      expect(pool.has(t.party[0]!.dex)).toBe(true);
      expect(t.party[0]!.level).toBe(p.party[0]!.level);
      expect(t.items).toEqual(p.items);
      expect(t.money).toBe(p.money);
    }
    // no beacon on the outposts any more
    expect(m.outposts.every((o) => !('beacon' in o))).toBe(true);
  });

  it('walk at a player pace and heal by the healer rules', () => {
    const m = newMatch(6, 1);
    const p = m.seats[0]!.trainer;
    const b = m.trainers[0]!;
    expect(m.trainerSpeed(b)).toBe(m.trainerSpeed(p));
    const o = m.outposts[0]!;
    for (const t of [p, b]) {
      t.x = o.x;
      t.y = o.y;
      t.party[0]!.hp = 1;
      expect(m.healAt(t, o)).toContain('healed');
      expect(t.party[0]!.hp).toBe(t.party[0]!.maxHp);
      // and the same 20 s wait before the next heal
      t.party[0]!.hp = 1;
      expect(m.healAt(t, o)).toContain('moment');
    }
  });

  it('wear a wild down to catch it, hold back once it is weak, then throw a ball', () => {
    const m = newMatch(7, 1);
    const b = m.trainers[0]!;
    const w = m.wilds.find((x) => !x.alpha && !x.boss && !x.legend && Math.hypot(x.x - m.centerX, x.y - m.centerY) > 60)!;
    // Stand the bot beside it with a ball, the wild weak.
    b.x = b.px = w.x + 3;
    b.y = b.py = w.y;
    w.hp = Math.max(1, Math.floor(w.maxHp * 0.1));
    setCatchTarget(b, w);
    expect(spares(b.party[0]!, w)).toBe(true);
    b.ai = 'hunt';
    b.aiKey = `m${w.id}`;
    b.aiTimer = 5;
    const balls = b.items.reduce((n, s) => n + (s?.id.endsWith('-ball') ? s.count : 0), 0);
    let thrown = false;
    for (let i = 0; i < 60 && !thrown; i++) {
      m.step(1 / 60);
      thrown = m.throws.some((th) => th.thrower === b);
    }
    expect(thrown).toBe(true);
    expect(b.items.reduce((n, s) => n + (s?.id.endsWith('-ball') ? s.count : 0), 0)).toBe(balls - 1);
    // thrown from where it stands, within a player's throwing range
    const th = m.throws.find((x) => x.thrower === b)!;
    expect(Math.hypot(th.targetX - th.startX, th.targetY - th.startY)).toBeLessThanOrEqual(CONFIG.catch.throwRange);
  });

  it('keep the levels they earned when the final two begin (no catch-up for the team behind)', () => {
    const was = CONFIG.duel.finalShowdown;
    (CONFIG.duel as { finalShowdown: boolean }).finalShowdown = true;
    try {
      // A human behind a bot, then a bot behind a human: neither gets lifted.
      for (const humanBehind of [true, false]) {
        const m = newMatch(8, 1);
        const p = m.seats[0]!.trainer;
        const b = m.trainers[0]!;
        const [low, high] = humanBehind ? [p, b] : [b, p];
        low.party = [m.makeMon('0025', 6, low, low.x, low.y), m.makeMon('0004', 9, low, low.x, low.y)];
        high.party = [m.makeMon('0009', 48, high, high.x, high.y)];
        const before = low.party.map((x) => [x.dex, x.level]);
        for (let i = 0; i < 60 * 12 && !m.finalStarted; i++) m.step(1 / 60);
        expect(m.finalStarted).toBe(true);
        expect(low.party.map((x) => [x.dex, x.level])).toEqual(before);
      }
    } finally {
      (CONFIG.duel as { finalShowdown: boolean }).finalShowdown = was;
    }
  });

  it('take the storm like anyone: they walk out of it, and one that can not get out in time passes out', () => {
    const m = newMatch(9, 1);
    const p = m.seats[0]!.trainer;
    const b = m.trainers[0]!;
    const freeze = (r: number) => {
      m.darkness.radius = r;
      m.darkness.targetRadius = r;
      m.darkness.nextPulseIn = 9999;
    };
    // A bot a few tiles out in the storm walks back into the light; its exposure counts while it does.
    const spot = (dist: number) => {
      for (let a = 0; a < Math.PI * 2; a += 0.05) {
        const x = m.centerX + Math.cos(a) * dist;
        const y = m.centerY + Math.sin(a) * dist;
        if (m.ground.reachable(Math.floor(x), Math.floor(y)) && m.ground.walkable(Math.floor(x), Math.floor(y))) return { x: Math.floor(x) + 0.5, y: Math.floor(y) + 0.5 };
      }
      throw new Error('no spot');
    };
    // (Kept out of a trainer battle with each other, which would pause the storm for both.)
    p.duelReadyAt = Infinity;
    b.duelReadyAt = Infinity;
    // (no wild Pokémon about to get in the way)
    m.wilds = [];
    freeze(60);
    const s = spot(66);
    b.x = b.px = s.x;
    b.y = b.py = s.y;
    m.placeParty(b);
    m.step(1 / 60);
    expect(m.isDark(b.x, b.y)).toBe(true);
    for (let i = 0; i < 60 * 4; i++) m.step(1 / 60);
    expect(b.stormT ?? 0).toBeGreaterThan(0);
    expect(Math.hypot(b.x - m.centerX, b.y - m.centerY)).toBeLessThan(66);
    // A bot and a human far out in the storm, with no way back in time: both pass out at the same exposure.
    freeze(5);
    const far = spot(120);
    for (const t of [p, b]) {
      t.x = t.px = far.x;
      t.y = t.py = far.y;
      t.stormT = 0;
      t.downUntil = undefined;
      for (const mon of t.party) {
        mon.fainted = false;
        mon.hp = mon.maxHp;
        mon.status = null;
        mon.drowsy = 0;
      }
      m.placeParty(t);
    }
    const tol = m.trainerStormSeconds(b);
    expect(tol).toBe(m.trainerStormSeconds(p));
    // Exposure builds the same for both, and both are out of the match: their Pokémon fall asleep
    // and faint in the storm, or they pass out and Darkrai takes them (whichever comes first).
    const outAt: Record<string, number> = {};
    for (let i = 0; i < 60 * (tol + 4); i++) {
      m.over = false;
      m.step(1 / 60);
      if (i === 60 * 5) expect(b.stormT).toBeCloseTo(p.stormT ?? 0, 5);
      for (const t of [p, b]) if ((!t.alive || t.grabbed != null) && outAt[t.name] === undefined) outAt[t.name] = m.time;
    }
    expect(outAt[b.name]).toBeDefined();
    expect(outAt[p.name]).toBeDefined();
  });

  it("leave a player's own aiming alone: a manual move fires into open space or past a wall", () => {
    const m = newMatch(10, 0);
    const p = m.seats[0]!.trainer;
    const mon = p.party[0]!;
    m.withSeat(m.seats[0]!, () => {
      expect(m.takeControl(mon)).toBe(true);
      // nothing anywhere near: aimed into empty ground 6 tiles off, it still goes
      m.wilds = [];
      m.aim = { x: mon.x + 6, y: mon.y };
      const slot = mon.moves.findIndex((id) => id);
      expect(m.playerCast(slot)).toBe('cast');
    });
  });
});

describe('computer trainers giving up on errands (round 3 fix)', async () => {
  const world = await loadWorld(join(import.meta.dirname, '..', 'assets'));

  it('give up on an errand they make no progress on, even when flipping between two errands every second', () => {
    const m = new Match({ ground: world.ground(), rng: new Rng(3), sprites: world.sprites }, [], { humans: [{ name: 'P', starters: ['0004'] }], rivals: 1 });
    const t = m.trainers[0]!;
    const watch = (m as unknown as { watchAiProgress(t: unknown): void }).watchAiProgress.bind(m);
    const item = { x: t.x + 3, y: t.y - 3 };
    const shop = { x: t.x + 30, y: t.y + 30 };
    const x0 = t.x;
    // An item just out of reach and a shop far off: one second toward each in turn, never closer to either.
    let banned: string[] = [];
    for (let i = 0; i < 60 * 40 && !banned.length; i++) {
      const second = Math.floor(i / 60);
      const toItem = second % 2 === 0;
      t.ai = toItem ? 'seekItem' : 'shop';
      // (stepAi starts a new spell of walking whenever the errand changes)
      if (t.aiKey !== (toItem ? 'i9' : 'shop')) t.aiProgress = undefined;
      t.aiKey = toItem ? 'i9' : 'shop';
      t.aiTarget = toItem ? item : shop;
      t.x = x0 + Math.sin(i / 20) * 0.4;
      (m as unknown as { time: number }).time += 1 / 60;
      watch(t);
      banned = Object.keys(t.aiBans ?? {});
    }
    expect(banned.length).toBeGreaterThan(0);
    // About 6 s spent on the errand that went nowhere, so within 20 s of flipping.
    expect((m as unknown as { time: number }).time).toBeLessThan(20);
  });
});
