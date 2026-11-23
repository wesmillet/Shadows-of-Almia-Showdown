/** Steven: the winner's invitation, the stadium, his ace's form change, the prize, and a friendly loss. */
import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { loadWorld } from './world';
import { Match } from '../src/sim/match';
import { Rng } from '../src/core/rng';
import { LIMITED_FORM, STEVEN_TEAM, stevenConfig } from '../src/sim/steven';
import type { Mon } from '../src/sim/entities';
import type { BattleEvent } from '../src/sim/battle';

describe('Steven', async () => {
  const world = await loadWorld(join(import.meta.dirname, '..', 'assets'));
  const won = (seed = 5, enabled = true) => {
    const m = new Match({ ground: world.ground(), rng: new Rng(seed), sprites: world.sprites }, [], { humans: [{ name: 'P', starters: ['0006'] }], rivals: 1 });
    m.stevenEnabled = enabled;
    const p = m.player;
    p.party.push(m.makeMon('0448', 50, p, p.x, p.y), m.makeMon('0094', 48, p, p.x, p.y));
    for (const r of m.trainers.filter((t) => !t.visitor && !t.challenger)) m.eliminate(r);
    const events: BattleEvent[] = [];
    const step = (n: number, dt = 0.05) => {
      for (let i = 0; i < n; i++) {
        m.step(dt);
        events.push(...m.battle.events);
      }
    };
    step(2);
    return { m, p, step, events };
  };

  it('invites the winner, whose win waits for the answer', () => {
    const { m, step } = won();
    expect(m.steven.state).toBe('invite');
    expect(m.seats[0]!.outcome).toBeFalsy();
    expect(m.over).toBe(false);
    step(10);
    expect(m.over).toBe(false);
  });

  it('declining gives the win at once; switched off, there is no invitation', () => {
    const a = won();
    a.m.stevenAnswer(false);
    a.step(2);
    expect(a.m.seats[0]!.outcome).toBe('win');
    expect(a.m.over).toBe(true);
    const b = won(5, false);
    expect(b.m.steven.state).toBe('done');
    expect(b.m.seats[0]!.outcome).toBe('win');
  });

  it('accepting brings the winner to the stadium against six, the ace last and higher', () => {
    const { m, p, step } = won();
    m.stevenAnswer(true);
    const st = m.stadium!;
    expect(m.steven.state).toBe('intro');
    expect(st.contains(p.x, p.y)).toBe(true);
    expect(m.isDark(p.x, p.y)).toBe(false);
    const host = m.steven.host!;
    expect(host.party).toHaveLength(6);
    const bases = host.party.map((x) => x.dex.split('-')[0]);
    expect(new Set(bases)).toEqual(new Set(STEVEN_TEAM));
    const ace = host.party[5]!;
    expect(ace).toBe(m.steven.ace);
    expect(ace.level).toBeGreaterThan(host.party[0]!.level);
    expect(ace.aceForm?.to).toBe(LIMITED_FORM[m.steven.aceBase]);
    // Everyone restored for the battle.
    expect(p.party.every((x) => x.hp === x.maxHp && !x.fainted)).toBe(true);
    step(Math.ceil(stevenConfig().introSeconds / 0.05) + 2);
    expect(m.steven.state).toBe('battle');
    const d = m.playerDuel!;
    expect(d.stadium).toBe(true);
    expect(d.bounds).toEqual(st.field);
  });

  it('the stadium: walkable floor, walls, never reachable on foot from the island', () => {
    const { m } = won();
    const st = m.stadium!;
    const fx = Math.floor((st.field.x0 + st.field.x1) / 2);
    const fy = Math.floor((st.field.y0 + st.field.y1) / 2);
    expect(m.ground.walkable(fx, fy)).toBe(true);
    expect(m.ground.walkable(st.field.x0 - 1, fy)).toBe(false);
    expect(m.ground.reachable(fx, fy)).toBe(false);
    expect(st.ox).toBeGreaterThanOrEqual(m.ground.cols);
  });

  it('his ace, worn down to half, heals to full, changes form, grows and gets stronger', () => {
    const { m, step } = won(7);
    m.stevenAnswer(true);
    step(Math.ceil(stevenConfig().introSeconds / 0.05) + 2);
    const host = m.steven.host!;
    const ace = host.party[5] as Mon;
    const before = { ...ace.stats };
    const form = ace.aceForm!.to;
    ace.hp = Math.floor(ace.maxHp * 0.45);
    (m as unknown as { stepChampionMon(a: Mon, f: Mon | null, dt: number): void }).stepChampionMon(ace, null, 0.05);
    expect(ace.evolving?.form).toBe(true);
    // stepEvolutions runs for trainers in the match.
    for (let i = 0; i < 90; i++) (m as unknown as { stepEvolutions(dt: number): void }).stepEvolutions(0.05);
    expect(ace.dex).toBe(form);
    expect(ace.hp).toBe(ace.maxHp);
    expect(ace.grown).toBeCloseTo(stevenConfig().transformScale, 1);
    expect(ace.stats.atk).toBeGreaterThan(before.atk);
    expect(ace.aceForm!.done).toBe(true);
  });

  it('beating him sends the ace form home and then the match ends with the win', () => {
    const { m, p, step, events } = won(9);
    m.stevenAnswer(true);
    step(Math.ceil(stevenConfig().introSeconds / 0.05) + 2);
    for (const x of m.steven.host!.party) {
      x.hp = 0;
      x.fainted = true;
    }
    step(40);
    expect(m.steven.result).toBe('won');
    const home = events.find((e) => e.type === 'extracted' && e.via === 'steven');
    expect(home && home.type === 'extracted' ? home.mon.dex : '').toBe(LIMITED_FORM[m.steven.aceBase]);
    step(Math.ceil(stevenConfig().outroSeconds / 0.05) + 4);
    expect(m.seats[0]!.outcome).toBe('win');
    expect(m.over).toBe(true);
    expect(p.alive).toBe(true);
  });

  it('losing to him is friendly: patched up, and the win stands', () => {
    const { m, p, step } = won(11);
    m.stevenAnswer(true);
    step(Math.ceil(stevenConfig().introSeconds / 0.05) + 2);
    for (const x of p.party) {
      x.hp = 0;
      x.fainted = true;
    }
    step(40);
    expect(m.steven.result).toBe('lost');
    expect(p.alive).toBe(true);
    expect(p.party.some((x) => !x.fainted && x.hp > 0)).toBe(true);
    step(Math.ceil(stevenConfig().outroSeconds / 0.05) + 4);
    expect(m.seats[0]!.outcome).toBe('win');
    expect(m.over).toBe(true);
  });
  it('a prize from the PC works as a starter and evolves along its own line', () => {
    const m = new Match({ ground: world.ground(), rng: new Rng(3), sprites: world.sprites }, [], { humans: [{ name: 'P', starters: ['0374-molten'] }], rivals: 0 });
    const mon = m.player.party[0]!;
    expect(mon.dex).toBe('0374-molten');
    expect(mon.species.types).toEqual(['steel', 'fire']);
    expect(mon.moves.length).toBeGreaterThan(0);
    const next = mon.species.evolves?.[0];
    expect(next?.to).toBe('0375-molten');
  });
});
