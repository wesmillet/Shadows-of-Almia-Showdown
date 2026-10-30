/**
 * Trainer battles never wait forever: a player who does not pick their next Pokémon gets the first
 * able one in party order once the pick time is up; a player who picks in time gets their pick;
 * running out ends the battle; both sides running out at once ends it with no winner.
 */
import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { loadWorld } from './world';
import { Match, type Duel } from '../src/sim/match';
import { Rng } from '../src/core/rng';
import { CONFIG } from '../src/sim/data';
import type { Mon, Trainer } from '../src/sim/entities';

describe('trainer battle replacements', async () => {
  const world = await loadWorld(join(import.meta.dirname, '..', 'assets'));

  /** The player against one computer trainer, standing apart in the open, the storm held off. */
  const setup = (seed: number, playerTeam: Array<[string, number]>, rivalTeam: Array<[string, number]>) => {
    const m = new Match({ ground: world.ground(), rng: new Rng(seed), sprites: world.sprites }, [], { humans: [{ name: 'P', starters: ['0004'] }], rivals: 1 });
    const p = m.seats[0]!.trainer;
    const b = m.trainers.find((t) => t !== p)!;
    m.wilds = [];
    m.items = [];
    const hold = () => { m.darkness.radius = m.darkness.targetRadius = 999; m.darkness.nextPulseIn = 1e9; };
    hold();
    // an open spot
    let spot = { x: p.x, y: p.y };
    find: for (let r = 0; r < 160; r += 2) for (let a = 0; a < 6.28; a += 0.2) {
      const x = Math.floor(m.centerX + Math.cos(a) * (40 + r)), y = Math.floor(m.centerY + Math.sin(a) * (40 + r));
      let ok = true;
      for (let dy = -8; dy <= 8 && ok; dy++) for (let dx = -8; dx <= 8 && ok; dx++) if (dx * dx + dy * dy <= 64 && !(m.ground.walkable(x + dx, y + dy) && m.ground.reachable(x + dx, y + dy))) ok = false;
      if (ok) { spot = { x: x + 0.5, y: y + 0.5 }; break find; }
    }
    p.x = p.px = spot.x - 2.5; p.y = p.py = spot.y;
    b.x = b.px = spot.x + 2.5; b.y = b.py = spot.y;
    p.party = playerTeam.map(([d, l]) => m.makeMon(d, l, p, p.x, p.y));
    b.party = rivalTeam.map(([d, l]) => m.makeMon(d, l, b, b.x, b.y));
    for (const t of [p, b]) { t.items = t.items.map(() => null); m.placeParty(t); }
    const d = m.startDuel(p, b);
    const ended: Array<Trainer | null> = [];
    const sent: Mon[] = [];
    const step = (secs: number, until?: () => boolean) => {
      for (let i = 0; i < secs * 60; i++) {
        hold();
        m.step(1 / 60);
        for (const e of m.battle.events as Array<{ type: string; winner?: Trainer | null; mon?: Mon }>) {
          if (e.type === 'duel-end') ended.push(e.winner ?? null);
          if (e.type === 'duel-send') sent.push(e.mon!);
        }
        m.battle.events.length = 0;
        if (until?.()) return true;
      }
      return false;
    };
    const side = (t: Trainer) => (d.a.trainer === t ? d.a : d.b);
    return { m, p, b, d, step, side, ended, sent };
  };
  const knockOut = (mon: Mon) => { mon.hp = 0; mon.fainted = true; };

  it('sends out the first able Pokémon in party order when the player does not pick', () => {
    const { p, step, side, d } = setup(11, [['0004', 30], ['0007', 30], ['0001', 30]], [['0025', 30], ['0396', 30]]);
    expect(step(5, () => !!side(p).mon && d.state === 'fight')).toBe(true);
    const lead = side(p).mon!;
    // The second in the party is already out of it: the next comes from further down.
    const second = p.party.find((x) => x !== lead)!;
    knockOut(second);
    knockOut(lead);
    expect(step(3, () => side(p).awaitingPick)).toBe(true);
    // Nothing comes out during the pick time...
    step(CONFIG.duel.playerPickSeconds - 1);
    expect(side(p).mon).toBeNull();
    // ...then the first able one in party order does, with no input.
    expect(step(2, () => !!side(p).mon)).toBe(true);
    const third = p.party.find((x) => x !== lead && x !== second)!;
    expect(side(p).mon).toBe(third);
    expect(side(p).awaitingPick).toBe(false);
  });

  it('lets a player who picks in time choose', () => {
    const { m, p, step, side, d } = setup(12, [['0004', 30], ['0007', 30], ['0001', 30]], [['0025', 30], ['0396', 30]]);
    expect(step(5, () => !!side(p).mon && d.state === 'fight')).toBe(true);
    const lead = side(p).mon!;
    knockOut(lead);
    expect(step(3, () => side(p).awaitingPick)).toBe(true);
    const last = p.party[p.party.length - 1]!;
    expect(m.duelPick(p.party.length - 1)).toContain(last.name);
    expect(side(p).mon).toBe(last);
  });

  it('a computer trainer sends its next one in party order too', () => {
    const { b, step, side, d } = setup(13, [['0004', 30]], [['0025', 30], ['0396', 30], ['0399', 30]]);
    expect(step(5, () => !!side(b).mon && d.state === 'fight')).toBe(true);
    const lead = side(b).mon!;
    const next = b.party.find((x) => x !== lead)!;
    knockOut(lead);
    expect(step(CONFIG.duel.aiPickSeconds + 2, () => !!side(b).mon)).toBe(true);
    expect(side(b).mon).toBe(next);
  });

  it('ends when a side runs out, with the other side the winner', () => {
    const { p, b, step, side, d, ended } = setup(14, [['0004', 30]], [['0025', 30], ['0396', 30]]);
    expect(step(5, () => !!side(p).mon && d.state === 'fight')).toBe(true);
    knockOut(side(p).mon!);
    expect(step(4, () => d.state === 'over')).toBe(true);
    expect(d.winner).toBe(b);
    expect(ended).toEqual([b]);
    expect(p.duelId).toBeUndefined();
    expect(b.duelId).toBeUndefined();
  });

  it('ends with no winner when both last Pokémon go down at once', () => {
    const { p, b, step, side, d, ended } = setup(15, [['0004', 30]], [['0025', 30]]);
    expect(step(5, () => !!side(p).mon && !!side(b).mon && d.state === 'fight')).toBe(true);
    knockOut(side(p).mon!);
    knockOut(side(b).mon!);
    expect(step(4, () => d.state === 'over')).toBe(true);
    expect(d.winner).toBeNull();
    expect(ended).toEqual([null]);
    expect(p.duelId).toBeUndefined();
    expect(b.duelId).toBeUndefined();
  });

  it('an idle player against a computer trainer: every Pokémon comes out in turn and the battle runs out', () => {
    const { p, step, ended, sent, m } = setup(16, [['0004', 20], ['0007', 20], ['0001', 20]], [['0025', 35], ['0396', 35]]);
    const order = [...p.party];
    // Nobody steers or picks for the player. The battle runs until the player's team is out (here
    // that also ends the match, the player being its only human).
    expect(step(240, () => m.over || ended.length > 0)).toBe(true);
    expect(sent.filter((x) => x.owner === p)).toEqual(order);
    expect(p.party.every((x) => x.fainted)).toBe(true);
  });

  it("an idle player's Pokemon fights on its own after idleSeconds; one who steers keeps control", () => {
    const { m, p, step, side, d } = setup(17, [['0004', 40]], [['0025', 12]]);
    expect(step(5, () => !!side(p).mon && d.state === 'fight')).toBe(true);
    const mine = side(p).mon!;
    const casts = () => (m.battle.events as Array<{ type: string; attacker?: Mon }>).filter((e) => e.type === 'cast' && e.attacker === mine).length;
    // Steering every step: never idle, the Pokemon does nothing on its own.
    const seat = m.seats[0]!;
    let own = 0;
    for (let i = 0; i < 60 * (CONFIG.duel.idleSeconds + 4); i++) {
      seat.moveX = i % 120 < 60 ? 1 : -1;
      seat.moveY = 0;
      m.darkness.radius = m.darkness.targetRadius = 999;
      m.step(1 / 60);
      own += casts();
      m.battle.events.length = 0;
    }
    expect(own).toBe(0);
    expect(side(p).idle).toBeFalsy();
    expect(mine.fainted).toBe(false);
    // Hands off: after idleSeconds it fights.
    seat.moveX = 0;
    let after = 0;
    for (let i = 0; i < 60 * (CONFIG.duel.idleSeconds + 6) && !mine.fainted; i++) {
      m.darkness.radius = m.darkness.targetRadius = 999;
      m.step(1 / 60);
      after += casts();
      m.battle.events.length = 0;
    }
    expect(after).toBeGreaterThan(0);
  });

  it('two idle players: the battle still runs to its end', () => {
    const m = new Match({ ground: world.ground(), rng: new Rng(18), sprites: world.sprites }, [], { humans: [{ name: 'P', starters: ['0004'] }, { name: 'Q', starters: ['0007'] }], rivals: 1 });
    const [P, Q] = [m.seats[0]!.trainer, m.seats[1]!.trainer];
    m.wilds = [];
    m.items = [];
    Q.x = Q.px = P.x + 3;
    Q.y = Q.py = P.y;
    P.party = [m.makeMon('0004', 20, P, P.x, P.y), m.makeMon('0001', 20, P, P.x, P.y)];
    Q.party = [m.makeMon('0007', 20, Q, Q.x, Q.y), m.makeMon('0025', 20, Q, Q.x, Q.y)];
    for (const t of [P, Q]) m.placeParty(t);
    const d = m.startDuel(P, Q);
    let over = false;
    for (let i = 0; i < 60 * 300 && !over; i++) {
      m.darkness.radius = m.darkness.targetRadius = 999;
      m.darkness.nextPulseIn = 1e9;
      m.step(1 / 60);
      m.battle.events.length = 0;
      over = d.state === 'over' || m.over;
    }
    expect(over).toBe(true);
  });
});
