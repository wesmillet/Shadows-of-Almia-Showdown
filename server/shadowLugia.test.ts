/**
 * Shadow Lugia's encounter works end to end under the release's rules (Model P, automatic
 * replacements): it comes at level 100 with its kit and tripled HP, starts a one-on-one bout, both
 * sides deal damage, the player's next Pokémon come out by themselves, a lost bout sends it back
 * into the storm with the team patched up, and a Snag Machine under its threshold takes it. Its
 * strength is deliberately not checked against any team: it is meant to be out of reach.
 */
import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { loadWorld } from './world';
import { Match } from '../src/sim/match';
import { Rng } from '../src/core/rng';
import { CONFIG, combatLevel, statsAtLevel } from '../src/sim/data';
import type { Mon } from '../src/sim/entities';

describe('Shadow Lugia', async () => {
  const world = await loadWorld(join(import.meta.dirname, '..', 'assets'));

  const summon = (seed: number, team: Array<[string, number]>) => {
    const m = new Match({ ground: world.ground(), rng: new Rng(seed), sprites: world.sprites }, [], { humans: [{ name: 'P', starters: ['0004'] }], rivals: 1 });
    const p = m.player;
    // The one rival stays in the match (a match with nobody else in it is over), out of the way.
    for (const t of m.trainers) if (t !== p) t.duelReadyAt = Infinity;
    m.wilds = [];
    m.items = [];
    // On the shore of Tide Lake, the storm held off so nothing else interferes.
    const lake = m.ground.features!.lake as { x: number; y: number; rx: number; ry: number };
    let spot: { x: number; y: number } | null = null;
    for (let r = 1; r < 3 && !spot; r += 0.1) for (let a = 0; a < 6.28 && !spot; a += 0.1) {
      const x = lake.x + Math.cos(a) * lake.rx * r, y = lake.y + Math.sin(a) * lake.ry * r;
      if (m.ground.walkable(Math.floor(x), Math.floor(y)) && m.ground.reachable(Math.floor(x), Math.floor(y))) spot = { x: Math.floor(x) + 0.5, y: Math.floor(y) + 0.5 };
    }
    p.x = p.px = spot!.x;
    p.y = p.py = spot!.y;
    p.party = team.map(([d, l]) => m.makeMon(d, l, p, p.x, p.y));
    m.placeParty(p);
    const hold = () => { m.darkness.radius = m.darkness.targetRadius = 999; m.darkness.nextPulseIn = 1e9; };
    hold();
    expect(m.visitors.summonShadowLugia({ x: lake.x, y: lake.y })).toBe(true);
    const events: Array<Record<string, any>> = [];
    const step = (secs: number, until?: () => boolean) => {
      for (let i = 0; i < secs * 60; i++) {
        hold();
        m.step(1 / 60);
        events.push(...(m.battle.events as Array<Record<string, any>>));
        m.battle.events.length = 0;
        if (until?.()) return true;
      }
      return false;
    };
    expect(step(20, () => !!m.shadowBoutFoe())).toBe(true);
    return { m, p, L: m.shadowBoutFoe()!, step, events };
  };

  it('comes at level 100 with its kit and tripled HP, and opens a one-on-one bout', () => {
    const { m, L } = summon(31, [['0006', 60], ['0009', 60], ['0003', 60]]);
    expect(L.level).toBe(CONFIG.shadowLugia.level);
    expect(L.level).toBe(100);
    expect(L.shadow).toBe(true);
    expect(L.moves).toEqual(['aeroblast', 'dark-pulse', 'shadow-ball', 'psychic']);
    // Its stats are its level 100 stats at the combat level (Model P), its HP tripled on top.
    expect(L.stats).toEqual(statsAtLevel(L.species.stats, 100));
    expect(combatLevel(100)).toBeCloseTo(70.71, 2);
    expect(L.maxHp).toBe(Math.round(L.stats.hp * CONFIG.shadowLugia.hpMult));
    expect(m.playerDuel).not.toBeNull();
  });

  it('fights both ways; the next Pokémon come out by themselves; a lost bout sends it back to the storm', () => {
    const { m, p, L, step, events } = summon(32, [['0006', 60], ['0009', 60], ['0003', 60]]);
    const hp0 = L.hp;
    // The player's Pokémon out attacks it a few times (a player would steer and aim).
    const d = m.playerDuel!;
    const mine = () => (d.a.trainer === p ? d.a : d.b).mon;
    for (let k = 0; k < 6; k++) {
      step(3, () => !!mine() && mine()!.busy <= 0);
      const me = mine();
      if (!me || me.fainted) continue;
      me.target = L;
      for (let s = 0; s < me.moves.length; s++) if (m.battle.castAt(me, s, [L], 12)) break;
      step(1);
    }
    expect(L.hp).toBeLessThan(hp0);
    // Nobody picks for the player: the bout runs on, every Pokémon coming out in turn, until it is lost.
    const ended = step(300, () => !m.shadowBoutFoe());
    expect(ended).toBe(true);
    const hitsOnTeam = events.filter((e) => e.type === 'hit' && e.attacker === L && e.damage > 0).length;
    expect(hitsOnTeam).toBeGreaterThan(0);
    const sends = events.filter((e) => e.type === 'duel-send' && e.trainer === p).map((e) => e.mon as Mon);
    expect(new Set(sends).size).toBe(3);
    expect(events.some((e) => e.type === 'notice' && /sinks back into the storm/.test(e.text))).toBe(true);
    // The team is patched up and the encounter is spent for the match.
    expect(p.party.every((x) => !x.fainted && x.hp > 0)).toBe(true);
    expect(m.visitors.lugiaAvailable()).toBe(false);
  });

  it('is taken by a Snag Machine only under its threshold', () => {
    const { m, p, L } = summon(33, [['0006', 60], ['0009', 60]]);
    expect(m.giveItem(p, 'capture-styler')).toBe(true);
    const slot = m.snagSlot(p);
    expect(slot).toBeGreaterThanOrEqual(0);
    expect(m.snagShadow(slot)).toMatch(/resisted/);
    L.hp = Math.floor(L.maxHp * (CONFIG.shadowLugia.snagBelow - 0.02));
    expect(m.snagShadow(slot)).toMatch(/snagged/);
    expect(p.party).toContain(L);
    expect(m.playerDuel?.state).toBe('over');
    expect(m.shadowBoutFoe()).toBeNull();
  });
});
