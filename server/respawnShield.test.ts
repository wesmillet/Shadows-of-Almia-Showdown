/** Respawn shield, and computer trainers leaving players alone at outposts and just after a respawn. */
import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { loadWorld } from './world';
import { Match } from '../src/sim/match';
import { Rng } from '../src/core/rng';
import { CONFIG } from '../src/sim/data';
import type { Trainer } from '../src/sim/entities';

describe('respawn shield and quiet outposts', async () => {
  const world = await loadWorld(join(import.meta.dirname, '..', 'assets'));
  const make = (rivals: number, humans = 1) => {
    const m = new Match({ ground: world.ground(), rng: new Rng(3), sprites: world.sprites }, [], { humans: Array.from({ length: humans }, (_, i) => ({ name: `P${i}`, starters: ['0004'] })), rivals });
    const x = m as unknown as { down(t: Trainer): void; respawn(t: Trainer): void; findDuels(): void; stepShields(): void };
    return { m, x };
  };

  it('a respawned trainer is shielded: no damage from attacks', () => {
    const { m, x } = make(0);
    const t = m.seats[0]!.trainer;
    x.down(t);
    x.respawn(t);
    expect(t.shield).toBeTruthy();
    const mon = t.party[0]!;
    const foe = m.makeMon('0399', 30, null, t.x + 1, t.y);
    const hp = mon.hp;
    m.battle.applyDamage(mon, 10, foe);
    expect(mon.hp).toBe(hp);
  });

  it('the shield ends after its seconds, or on walking off', () => {
    const { m, x } = make(0);
    const t = m.seats[0]!.trainer;
    x.down(t);
    x.respawn(t);
    m.time += CONFIG.respawn.shield.seconds + 0.1;
    x.stepShields();
    expect(t.shield).toBeFalsy();
    x.down(t);
    x.respawn(t);
    t.x += CONFIG.respawn.shield.walkTiles + 0.5;
    x.stepShields();
    expect(t.shield).toBeFalsy();
  });

  const pairUp = (m: Match, a: Trainer, b: Trainer, at: { x: number; y: number }) => {
    a.x = a.px = at.x;
    a.y = a.py = at.y;
    b.x = b.px = at.x + 2;
    b.y = b.py = at.y;
    a.duelReadyAt = b.duelReadyAt = 0;
  };

  it('a computer trainer does not challenge a player beside a healer, but does away from one', () => {
    const { m, x } = make(1);
    const p = m.seats[0]!.trainer;
    const bot = m.trainers.find((t) => t !== p && !t.challenger && !t.visitor)!;
    for (const t of m.allTrainers) if (t !== p && t !== bot) t.x += 500;
    const o = m.outposts.find((q) => !q.cost)!;
    pairUp(m, p, bot, { x: o.x + 3, y: o.y + 1 });
    x.findDuels();
    expect(p.duelId).toBeFalsy();
    // Far from every healer: open ground the two can see across.
    const far = { x: m.centerX - 25, y: m.centerY + 25 };
    if (m.outposts.every((q) => Math.hypot(q.x - far.x, q.y - far.y) > 9)) {
      pairUp(m, p, bot, far);
      x.findDuels();
      expect(p.duelId).toBeTruthy();
    }
  });

  it('a computer trainer leaves a just-respawned player alone for a while', () => {
    const { m, x } = make(1);
    const p = m.seats[0]!.trainer;
    const bot = m.trainers.find((t) => t !== p && !t.challenger && !t.visitor)!;
    p.respawnedAt = m.time;
    p.shield = null;
    pairUp(m, p, bot, { x: m.centerX - 25, y: m.centerY + 25 });
    x.findDuels();
    expect(p.duelId).toBeFalsy();
  });

  it('two players near a healer still battle', () => {
    const { m, x } = make(0, 2);
    const [a, b] = [m.seats[0]!.trainer, m.seats[1]!.trainer];
    const o = m.outposts.find((q) => !q.cost)!;
    pairUp(m, a, b, { x: o.x + 3, y: o.y + 1 });
    x.findDuels();
    expect(a.duelId).toBeTruthy();
  });
});
