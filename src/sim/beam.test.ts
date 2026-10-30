import { describe, expect, it } from 'vitest';
import { Rng } from '../core/rng';
import { dirFromVector } from '../core/math';
import { BattleSystem, computeDamage, type BattleEvent } from './battle';
import { CONFIG, move, species, statsAtLevel } from './data';
import type { Mon } from './entities';

/** Dice that never crit, never roll a status and always roll the top of the damage range. */
class FixedRng extends Rng {
  constructor() {
    super(1);
  }
  override next(): number {
    return 0.999999;
  }
}

const anim = { play() {}, sprites: { def: () => undefined }, action: 'Shoot', dir: 0, done: false } as unknown as Mon['anim'];
let nextId = 10;
function mon(dex: string, level: number, x: number, y: number, owner: object | null): Mon {
  const sp = species(dex);
  const stats = statsAtLevel(sp.stats, level);
  return {
    id: nextId++, dex, species: sp, name: sp.name, level, hp: stats.hp, maxHp: stats.hp, stats, stages: { atk: 0, def: 0, spe: 0 },
    types: sp.types, moves: [], cooldowns: [0, 0, 0, 0], x, y, px: x, py: y, dir: dirFromVector(1, 0, 0),
    anim, sprites: null as unknown as Mon['sprites'], owner: owner as Mon['owner'], wild: !owner, boss: false,
    fainted: false, status: null, statusTimer: 0, flash: 0, homeX: x, homeY: y, targetX: x, targetY: y, idleTimer: 0,
    moving: false, inDark: false, drowsy: 0, outsideDark: 0, aura: false, heldItem: null, busy: 0, casting: null, target: null, captured: false, behavior: 'guard', xp: 0, wander: null, wanderPause: 0, roamTarget: null, recall: false, sinceHit: 999, visual: { scale: 1, alpha: 1, flash: 0 }, evolving: null,
  } as Mon;
}

const me = { isPlayer: false, id: 1, stats: { damage: 0 } };
const them = { isPlayer: false, id: 2, stats: { damage: 0 } };

/** Steps the caster (and flights) for `seconds`, keeping every event with the time it came. */
function run(b: BattleSystem, a: Mon, all: Mon[], seconds: number, log: Array<{ t: number; ev: BattleEvent }>, t0 = 0, each?: (t: number) => void): number {
  let t = t0;
  for (let i = 0; i < Math.round(seconds * 60); i++) {
    each?.(t);
    b.stepMon(a, 1 / 60, () => all);
    b.stepFlights(1 / 60);
    t += 1 / 60;
    for (const ev of b.events) log.push({ t, ev });
    b.events.length = 0;
  }
  return t;
}

function beam(dex = '0006', id = 'flamethrower', level = 30): Mon {
  const a = mon(dex, level, 0, 0, me);
  a.moves = [id];
  return a;
}

const hitsOn = (log: Array<{ t: number; ev: BattleEvent }>, t: Mon) =>
  log.filter((l) => l.ev.type === 'hit' && l.ev.target === t) as Array<{ t: number; ev: Extract<BattleEvent, { type: 'hit' }> }>;

describe('channelled beams (round 3 fix)', () => {
  const pulses = Math.round(CONFIG.battle.channel.seconds / CONFIG.battle.channel.tick) + 1;
  const scale = CONFIG.battle.channel.powerMult / pulses;

  it('lands every pulse while the beam is up, the last one with the channel\'s end, and nothing after', () => {
    const b = new BattleSystem(new Rng(3));
    const a = beam();
    const t = mon('0143', 30, 2, 0, them);
    t.maxHp = t.hp = 99999;
    expect(b.tryCast(a, 0, t.x, t.y, t.id, t)).toBe(true);
    const log: Array<{ t: number; ev: BattleEvent }> = [];
    run(b, a, [a, t], 4, log);
    const hits = hitsOn(log, t);
    const end = log.find((l) => l.ev.type === 'channel-end')!.t;
    expect(hits.length).toBe(pulses);
    expect(hits.every((h) => h.ev.pulse)).toBe(true);
    expect(Math.max(...hits.map((h) => h.t))).toBeCloseTo(end, 5);
    // Every pulse is a quarter second apart.
    for (let i = 1; i < hits.length; i++) expect(hits[i]!.t - hits[i - 1]!.t).toBeCloseTo(CONFIG.battle.channel.tick, 1);
    expect(b.inFlight.length).toBe(0);
  });

  it('a beam cut off mid-way deals nothing more', () => {
    const b = new BattleSystem(new Rng(3));
    const a = beam();
    const t = mon('0143', 30, 2, 0, them);
    t.maxHp = t.hp = 99999;
    b.tryCast(a, 0, t.x, t.y, t.id, t);
    const log: Array<{ t: number; ev: BattleEvent }> = [];
    const at = run(b, a, [a, t], 1.0, log);
    b.interrupt(a);
    const before = hitsOn(log, t).length;
    run(b, a, [a, t], 2, log, at);
    expect(before).toBeGreaterThan(0);
    expect(hitsOn(log, t).length).toBe(before);
    expect(hitsOn(log, t).every((h) => h.t <= at + 1e-9)).toBe(true);
  });

  it('adds up to powerMult times one hit: fractions carry from pulse to pulse on the same target', () => {
    const rng = new FixedRng();
    const a = beam();
    const t = mon('0076', 30, 2, 0, them); // Golem resists Fire: small pulses, most of them fractional
    t.maxHp = t.hp = 99999;
    const raw = computeDamage(rng, a, t, move('flamethrower'), scale).raw!;
    expect(raw % 1).not.toBe(0);
    const b = new BattleSystem(new FixedRng());
    b.tryCast(a, 0, t.x, t.y, t.id, t);
    const log: Array<{ t: number; ev: BattleEvent }> = [];
    run(b, a, [a, t], 3, log);
    const total = hitsOn(log, t).reduce((s, h) => s + h.ev.damage, 0);
    expect(total).toBe(Math.floor(raw * pulses + 1e-9));
  });

  it('never passes a fraction to another cast, or between targets', () => {
    const rng = new FixedRng();
    const a = beam();
    const t1 = mon('0076', 30, 2, 0, them);
    const t2 = mon('0076', 30, 2, 0.05, them); // two Golem in the same beam
    for (const t of [t1, t2]) t.maxHp = t.hp = 99999;
    const raw = computeDamage(rng, a, t1, move('flamethrower'), scale).raw!;
    const b = new BattleSystem(new FixedRng());
    const log: Array<{ t: number; ev: BattleEvent }> = [];
    // Cast twice in a row on the same pair.
    for (let k = 0; k < 2; k++) {
      a.cooldowns = [0, 0, 0, 0];
      b.tryCast(a, 0, t1.x, t1.y, t1.id, t1);
      run(b, a, [a, t1, t2], 3, log);
    }
    const sum = (t: Mon) => hitsOn(log, t).reduce((s, h) => s + h.ev.damage, 0);
    // Each target, each cast: exactly its own whole points, the leftover thrown away with the beam.
    expect(sum(t1)).toBe(2 * Math.floor(raw * pulses + 1e-9));
    expect(sum(t2)).toBe(sum(t1));
  });

  it('hits only what is in the beam when it pulses: a target that leaves stops taking damage and keeps its own carry when it returns', () => {
    const rng = new FixedRng();
    const a = beam();
    const t = mon('0076', 30, 2, 0, them);
    t.maxHp = t.hp = 99999;
    const raw = computeDamage(rng, a, t, move('flamethrower'), scale).raw!;
    const b = new BattleSystem(new FixedRng());
    b.tryCast(a, 0, t.x, t.y, t.id, t);
    const log: Array<{ t: number; ev: BattleEvent }> = [];
    // Out of the line (5 tiles to the side) from 0.8 s to 1.6 s.
    run(b, a, [a, t], 3, log, 0, (time) => {
      t.y = time > 0.8 && time < 1.6 ? 5 : 0;
    });
    const hits = hitsOn(log, t);
    expect(hits.length).toBeLessThan(pulses);
    expect(hits.length).toBeGreaterThan(3);
    expect(hits.every((h) => h.t <= 0.8 + 1e-9 || h.t >= 1.6 - 1e-9)).toBe(true);
    expect(hits.reduce((s, h) => s + h.ev.damage, 0)).toBe(Math.floor(raw * hits.length + 1e-9));
  });

  it('an immune target takes nothing; the beam still lands on the others', () => {
    const b = new BattleSystem(new Rng(4));
    const a = beam('0026', 'thunderbolt');
    const ground = mon('0074', 30, 2, 0, them); // Geodude: Ground, immune to Electric: immune to Electric
    const other = mon('0143', 30, 2.2, 0.05, them);
    for (const t of [ground, other]) t.maxHp = t.hp = 99999;
    b.tryCast(a, 0, other.x, other.y, other.id, other);
    const log: Array<{ t: number; ev: BattleEvent }> = [];
    run(b, a, [a, ground, other], 3, log);
    expect(hitsOn(log, ground).every((h) => h.ev.damage === 0 && h.ev.effectiveness === 0)).toBe(true);
    expect(hitsOn(log, other).reduce((s, h) => s + h.ev.damage, 0)).toBeGreaterThan(0);
  });

  it('switching targets mid-beam: each target gets only the pulses that touched it', () => {
    const b = new BattleSystem(new Rng(5));
    const a = beam();
    const east = mon('0143', 30, 2.2, 0, them);
    const south = mon('0143', 30, 0, 2.2, them);
    for (const t of [east, south]) t.maxHp = t.hp = 99999;
    b.tryCast(a, 0, east.x, east.y, east.id, east);
    const log: Array<{ t: number; ev: BattleEvent }> = [];
    run(b, a, [a, east, south], 3, log, 0, (time) => {
      if (time > 0.9 && a.channel) {
        a.channel.aimX = south.x;
        a.channel.aimY = south.y;
      }
    });
    const e = hitsOn(log, east);
    const s = hitsOn(log, south);
    expect(e.length).toBeGreaterThan(0);
    expect(s.length).toBeGreaterThan(0);
    // The east target stops being hit once the beam has swung off it; the south one only once it arrives.
    expect(Math.max(...e.map((h) => h.t))).toBeLessThan(Math.max(...s.map((h) => h.t)));
    expect(Math.min(...s.map((h) => h.t))).toBeGreaterThan(0.9);
    expect(e.length).toBeLessThan(pulses);
    expect(s.length).toBeLessThan(pulses);
  });
});
