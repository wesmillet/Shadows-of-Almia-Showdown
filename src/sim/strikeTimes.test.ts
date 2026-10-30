import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import TABLE from '../../data/strike-times.json';
import { buildStrikeTable } from '../../scripts/strike-times';
import { Rng } from '../core/rng';
import { BattleSystem } from './battle';
import { CONFIG, MOVES, species, statsAtLevel } from './data';
import type { Mon } from './entities';
import { ANIM_FALLBACKS, strikeTime } from './strikeTimes';

describe('strike-timing table', () => {
  it('matches the sprite folders\' AnimData (run scripts/strike-times.ts after changing sprites)', () => {
    expect(buildStrikeTable(join(import.meta.dirname, '..', '..', 'assets', 'pokemon'))).toEqual(TABLE);
  });

  it('follows the sprites\' fallback chain: an action a folder lacks strikes on the one that plays instead', () => {
    const rows = TABLE as unknown as Record<string, Record<string, number | null>>;
    let checked = 0;
    for (const [dex, row] of Object.entries(rows)) {
      for (const action of ['Strike', 'Swing', 'Charge', 'Double', 'Rotate']) {
        if (action in row) continue;
        const alt = (ANIM_FALLBACKS[action] ?? []).find((a) => a in row);
        if (!alt) continue;
        expect(strikeTime(dex, action)).toEqual({ action: alt, seconds: row[alt] === null ? null : (row[alt] as number) / 60 });
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('times a cast from the table whether or not any sprite has loaded, and keeps a move\'s own wind-up', () => {
    // A Pokémon whose sprites never load (as on the server, or a sheet still downloading offline).
    const blind = { play() {}, sprites: { def: () => undefined }, action: 'Idle', dir: 0, done: false } as unknown as Mon['anim'];
    const make = (dex: string, moveId: string): Mon => {
      const sp = species(dex);
      const stats = statsAtLevel(sp.stats, 30);
      return {
        id: 1, dex, species: sp, name: sp.name, level: 30, hp: stats.hp, maxHp: stats.hp, stats, stages: { atk: 0, def: 0, spe: 0 },
        types: sp.types, moves: [moveId], cooldowns: [0], x: 0, y: 0, px: 0, py: 0, dir: 0, anim: blind, sprites: null as unknown as Mon['sprites'],
        owner: null, wild: true, boss: false, fainted: false, status: null, statusTimer: 0, flash: 0, homeX: 0, homeY: 0, targetX: 0, targetY: 0, idleTimer: 0,
        moving: false, inDark: false, drowsy: 0, outsideDark: 0, aura: false, heldItem: null, busy: 0, casting: null, target: null, captured: false, behavior: 'guard', xp: 0,
        wander: null, wanderPause: 0, roamTarget: null, recall: false, sinceHit: 999, visual: { scale: 1, alpha: 1, flash: 0 }, evolving: null,
      } as Mon;
    };
    let timed = 0;
    let ownWindUp = 0;
    for (const m of MOVES.values()) {
      if (m.leap || m.category === 'status' && m.shape === 'self') continue;
      for (const dex of ['0025', '0006', '0445', '0143']) {
        const a = make(dex, m.id);
        const b = new BattleSystem(new Rng(1));
        if (!b.tryCast(a, 0, 3, 0, null, null)) continue;
        const want = m.cast !== undefined ? m.cast : (() => {
          const s = strikeTime(dex, m.anim).seconds;
          return s === null ? CONFIG.battle.castSeconds : Math.max(0.12, Math.min(0.6, s));
        })();
        // (A lunge re-plans its strike around the rush in; contact.test covers that.)
        if (a.lunge) continue;
        expect(a.casting!.t).toBeCloseTo(want, 9);
        if (m.cast !== undefined) ownWindUp++;
        timed++;
      }
    }
    expect(timed).toBeGreaterThan(300);
    expect(ownWindUp).toBeGreaterThan(0);
  });
});
