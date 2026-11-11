/**
 * Trainer battles: a shot misses only when its target steps sideways out of its path (walking
 * toward or away from the shooter does not dodge it), and the player's beam turns briskly.
 */
import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { loadWorld } from './world';
import { Match } from '../src/sim/match';
import { Rng } from '../src/core/rng';
import { CONFIG } from '../src/sim/data';

describe('trainer battle shots', async () => {
  const world = await loadWorld(join(import.meta.dirname, '..', 'assets'));
  const setup = () => {
    const m = new Match({ ground: world.ground(), rng: new Rng(4), sprites: world.sprites }, [], { humans: [{ name: 'P', starters: ['0004'] }], rivals: 3 });
    m.finalStarted = true; // keep the battle where it is
    const p = m.seats[0]!.trainer;
    const r = m.trainers.find((t) => !t.visitor && !t.challenger)!;
    p.party = [m.makeMon('0006', 40, p, p.x, p.y)];
    r.party = [m.makeMon('0009', 40, r, r.x, r.y)];
    r.x = p.x + 4; r.y = p.y;
    m.startDuel(p, r);
    const d = m.duels.find((x) => x.id === p.duelId)!;
    for (let i = 0; i < 600 && !(d.a.mon && d.b.mon); i++) m.step(1 / 60);
    const mine = (d.a.trainer === p ? d.a : d.b).mon!;
    const foe = (d.a.trainer === p ? d.b : d.a).mon!;
    return { m, mine, foe };
  };
  const fire = (dx: number, dy: number) => {
    const { m, mine, foe } = setup();
    mine.moves = ['ember'];
    mine.cooldowns = [0];
    foe.x = mine.x + 4; foe.y = mine.y;
    m.aim = { x: foe.x, y: foe.y };
    const hp = foe.hp;
    let missed = false;
    expect(m.playerCast(0)).toBe('cast');
    const at = { x: foe.x, y: foe.y };
    for (let i = 0; i < 150; i++) {
      foe.moving = false; foe.casting = null; foe.x = at.x + dx; foe.y = at.y + dy;
      m.battle.events.length = 0;
      m.step(1 / 60);
      if (m.battle.events.some((e) => e.type === 'text' && e.text === 'Missed!')) missed = true;
      if (foe.hp < hp || missed) break;
    }
    return { hit: foe.hp < hp, missed };
  };
  it('a shot still hits a foe that backed away along its path', () => {
    expect(fire(0.9, 0).hit).toBe(true);
  });
  it('a shot misses a foe that stepped well out to the side', () => {
    expect(fire(0, 3).hit).toBe(false);
  });
});

describe('battle rings', async () => {
  const world = await loadWorld(join(import.meta.dirname, '..', 'assets'));
  it('another trainer and their Pokémon are held outside a trainer battle', () => {
    const m = new Match({ ground: world.ground(), rng: new Rng(4), sprites: world.sprites }, [], { humans: [{ name: 'P', starters: ['0004'] }], rivals: 4 });
    m.finalStarted = true;
    const p = m.seats[0]!.trainer;
    const [r, other] = m.trainers.filter((t) => !t.visitor && !t.challenger);
    p.party = [m.makeMon('0006', 40, p, p.x, p.y)];
    r!.party = [m.makeMon('0009', 40, r!, r!.x, r!.y)];
    r!.x = p.x + 4; r!.y = p.y;
    m.startDuel(p, r!);
    const d = m.duels.find((x) => x.id === p.duelId)!;
    other!.x = other!.px = d.cx + 1; other!.y = other!.py = d.cy;
    const om = other!.party.find((x) => !x.fainted)!;
    om.stowed = false; om.x = d.cx - 1; om.y = d.cy;
    m.step(1 / 60);
    expect(Math.hypot(other!.x - d.cx, other!.y - d.cy)).toBeGreaterThanOrEqual(CONFIG.duel.arenaRadius);
    expect(Math.hypot(om.x - d.cx, om.y - d.cy)).toBeGreaterThanOrEqual(CONFIG.duel.arenaRadius);
  });
});

describe('Struggle', async () => {
  const world = await loadWorld(join(import.meta.dirname, '..', 'assets'));
  it('a Pokémon with only Normal moves hurts a Ghost in a trainer battle (and pays recoil)', () => {
    const m = new Match({ ground: world.ground(), rng: new Rng(6), sprites: world.sprites }, [], { humans: [{ name: 'P', starters: ['0004'] }], rivals: 3 });
    m.finalStarted = true;
    const p = m.seats[0]!.trainer;
    const r = m.trainers.find((t) => !t.visitor && !t.challenger)!;
    p.party = [m.makeMon('0143', 40, p, p.x, p.y)];
    r.party = [m.makeMon('0092', 40, r, r.x, r.y)];
    r.x = p.x + 3; r.y = p.y;
    m.startDuel(p, r);
    const d = m.duels.find((x) => x.id === p.duelId)!;
    for (let i = 0; i < 600 && !(d.a.mon && d.b.mon); i++) m.step(1 / 60);
    const mine = (d.a.trainer === p ? d.a : d.b).mon!;
    const foe = (d.a.trainer === p ? d.b : d.a).mon!;
    mine.moves = ['tackle'];
    mine.cooldowns = [0];
    foe.moves = ['lick'];
    foe.x = mine.x + 0.9; foe.y = mine.y;
    const hp = foe.hp;
    const myHp = mine.hp;
    let struggled = false;
    for (let i = 0; i < 240 && foe.hp === hp; i++) {
      mine.cooldowns = [0];
      foe.casting = null; foe.x = mine.x + 0.9; foe.y = mine.y; foe.moving = false;
      if (!mine.casting) m.battle.castToward(mine, 0, foe.x, foe.y, undefined, foe);
      m.battle.events.length = 0;
      m.step(1 / 60);
      if (m.battle.events.some((e) => e.type === 'text' && e.text === 'Struggle!')) struggled = true;
    }
    expect(struggled).toBe(true);
    expect(foe.hp).toBeLessThan(hp);
    expect(mine.hp).toBeLessThan(myHp);
  });
});

describe('switching mid-battle', async () => {
  const world = await loadWorld(join(import.meta.dirname, '..', 'assets'));
  it('the out Pokémon comes back, the chosen one goes out after a gap, then a 15 s wait', () => {
    const m = new Match({ ground: world.ground(), rng: new Rng(7), sprites: world.sprites }, [], { humans: [{ name: 'P', starters: ['0004'] }], rivals: 3 });
    m.finalStarted = true;
    const p = m.seats[0]!.trainer;
    const r = m.trainers.find((t) => !t.visitor && !t.challenger)!;
    p.party = [m.makeMon('0006', 40, p, p.x, p.y), m.makeMon('0009', 40, p, p.x, p.y)];
    r.party = [m.makeMon('0003', 40, r, r.x, r.y)];
    r.x = p.x + 4; r.y = p.y;
    m.startDuel(p, r);
    const d = m.duels.find((x) => x.id === p.duelId)!;
    for (let i = 0; i < 600 && !(d.a.mon && d.b.mon && d.state === 'fight'); i++) m.step(1 / 60);
    const side = d.a.trainer === p ? d.a : d.b;
    const first = side.mon!;
    const other = p.party.find((x) => x !== first)!;
    expect(m.duelPick(p.party.indexOf(other))).toMatch(/come back/);
    expect(side.mon).toBeNull();
    for (let i = 0; i < 120; i++) m.step(1 / 60);
    expect(side.mon).toBe(other);
    expect(m.duelPick(p.party.indexOf(first))).toMatch(/switch again/);
  });
});
