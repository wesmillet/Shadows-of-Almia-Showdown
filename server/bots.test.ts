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
});
