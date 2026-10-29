import { describe, expect, it } from 'vitest';
import { decide, duelMargin, fightMargin, huntTarget, partyHpFraction } from './ai';
import { BattleSystem } from './battle';
import { species, statsAtLevel } from './data';
import type { Mon, Trainer } from './entities';
import { Rng } from '../core/rng';
import { botStarter } from './bot';
import { BASE_TIERS, STARTER_TIERS } from './starters';

function mon(dex: string, level: number, x = 0, y = 0, extra: Partial<Mon> = {}): Mon {
  const sp = species(dex);
  const stats = statsAtLevel(sp.stats, level);
  return {
    id: Math.floor(Math.random() * 1e9), dex, species: sp, name: sp.name, level, hp: stats.hp, maxHp: stats.hp, stats, stages: { atk: 0, def: 0, spe: 0 },
    types: sp.types, moves: sp.moves.slice(0, 2), cooldowns: [0, 0], x, y, px: x, py: y, dir: 0,
    anim: null as unknown as Mon['anim'], sprites: null as unknown as Mon['sprites'], owner: null, wild: true, boss: false,
    fainted: false, status: null, statusTimer: 0, flash: 0, homeX: x, homeY: y, targetX: x, targetY: y, idleTimer: 0,
    moving: false, inDark: false, drowsy: 0, outsideDark: 0, aura: false, heldItem: null, busy: 0, casting: null, target: null, captured: false,
    behavior: 'guard', xp: 0, wander: null, wanderPause: 0, roamTarget: null, recall: false, sinceHit: 999, visual: { scale: 1, alpha: 1, flash: 0 }, evolving: null,
    ...extra,
  };
}

function trainer(x: number, y: number, team: Mon[]): Trainer {
  const t = { x, y, dir: 0, alive: true, party: team, items: [null, null], held: [null, null], money: 500, outpostReady: 0, aiTarget: null, stats: { catches: 0, knockouts: 0, damage: 0, timeSurvived: 0 } } as unknown as Trainer;
  for (const m of team) {
    m.owner = t;
    m.wild = false;
  }
  return t;
}

const world = (rivals: Trainer[], extra: object = {}) => ({
  ground: { reachable: () => true } as never,
  rng: new Rng(3),
  items: [],
  outposts: [{ x: 0, y: 0 }],
  rivals,
  darkRadius: Infinity,
  centerX: 24,
  centerY: 24,
  ...extra,
});

describe('trainer AI', () => {
  it('sizes up a wild Pokémon by the matchup, not its level alone', () => {
    // A Squirtle against a Geodude two levels up: Water on Rock/Ground, an easy win.
    const me = trainer(10, 10, [mon('0007', 12)]);
    expect(fightMargin(me, mon('0074', 14))).toBeGreaterThan(2);
    // A Pikachu against a Geodude two levels down: its Electric moves do nothing.
    const pika = trainer(10, 10, [mon('0025', 12)]);
    expect(fightMargin(pika, mon('0074', 10))).toBeLessThan(1);
    // Worn down, the same Squirtle has less margin.
    const hurt = trainer(10, 10, [mon('0007', 12)]);
    hurt.party[0]!.hp = Math.round(hurt.party[0]!.maxHp * 0.2);
    expect(fightMargin(hurt, mon('0074', 14))).toBeLessThan(fightMargin(me, mon('0074', 14)));
  });

  it('hunts a wild it beats, takes on an Alpha only with a clear edge, and backs away from danger', () => {
    const me = trainer(10, 10, [mon('0008', 20), mon('0007', 18)]);
    const geodude = mon('0074', 20, 30, 10);
    const alpha = mon('0026', 36, 14, 10, { alpha: true });
    const pick = huntTarget(me, [alpha, geodude], 30);
    expect(pick?.mon).toBe(geodude);
    // A much stronger team does take the Alpha on (the XP is worth it).
    const strong = trainer(10, 10, [mon('0076', 45), mon('0076', 45)]);
    expect(huntTarget(strong, [alpha, mon('0074', 34, 20, 10)], 30)?.mon).toBe(alpha);
    // A Pikachu alone next to a strong Ground type turns away.
    const pika = trainer(10, 10, [mon('0025', 8)]);
    const d = decide(pika, { ...world([]), wilds: [mon('0075', 12, 13, 10)] });
    expect(d.ai).toBe('flee');
  });

  it('battles a rival it outclasses, keeps away from one that outclasses it', () => {
    const strong = trainer(10, 10, [mon('0009', 40), mon('0003', 40)]);
    const weak = trainer(13, 10, [mon('0025', 8)]);
    expect(duelMargin(strong, weak)).toBeGreaterThan(2);
    expect(decide(strong, world([weak], { time: 600 })).ai).toBe('engage');
    expect(decide(weak, world([strong], { time: 600 })).ai).toBe('flee');
  });

  it('heals when worn down, flees a rival when low', () => {
    const hurt = trainer(10, 10, [mon('0007', 12)]);
    hurt.party[0]!.hp = Math.round(hurt.party[0]!.maxHp * 0.2);
    expect(partyHpFraction(hurt)).toBeCloseTo(0.2, 1);
    expect(decide(hurt, world([])).ai).toBe('heal');
    expect(decide(hurt, world([trainer(13, 10, [mon('0025', 12)])])).ai).toBe('flee');
  });

  it('starts like a new player: one starter from the new-player pool', () => {
    const pool = new Set(STARTER_TIERS.filter((t) => BASE_TIERS.includes(t.id)).flatMap((t) => t.dex));
    const rng = new Rng(9);
    for (let i = 0; i < 50; i++) expect(pool.has(botStarter(rng))).toBe(true);
  });

  it('wastes no move on a target out of its reach', () => {
    const b = new BattleSystem(new Rng(1));
    const a = mon('0025', 15, 0, 0);
    a.moves = ['thunder-shock'];
    a.cooldowns = [0];
    const far = mon('0129', 15, 30, 0);
    const near = mon('0129', 15, 2, 0);
    expect(b.chooseMove(a, far)).toBe(0);
    expect(b.chooseMove(a, far, true)).toBe(-1);
    expect(b.chooseMove(a, near, true)).toBe(0);
  });
});
