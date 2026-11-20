/** Not a test: a balance run (STEVEN_SIM=1 npx vitest run server/stevenBalance.sim.test.ts). Rival-AI challengers against Steven. */
import { describe, it } from 'vitest';
import { join } from 'node:path';
import { loadWorld } from './world';
import { Match } from '../src/sim/match';
import { Rng } from '../src/core/rng';
import { CONFIG } from '../src/sim/data';

const RUN = process.env.STEVEN_SIM === '1';
describe.skipIf(!RUN)('Steven balance', async () => {
  const world = await loadWorld(join(import.meta.dirname, '..', 'assets'));
  const TEAMS: Record<string, string[]> = {
    six: ['0006', '0448', '0094', '0130', '0445', '0254'],
    three: ['0006', '0448', '0445'],
    mixed: ['0009', '0065', '0149', '0248', '0373', '0094'],
  };
  it('runs', () => {
    const lv = Number(process.env.SIM_LEVEL ?? 50);
    const n = Number(process.env.SIM_N ?? 30);
    const over = process.env.SIM_OVER;
    if (over) (CONFIG as unknown as { steven: { levelOver: number; aceLevelOver: number } }).steven.levelOver = Number(over.split(',')[0]);
    if (over) (CONFIG as unknown as { steven: { levelOver: number; aceLevelOver: number } }).steven.aceLevelOver = Number(over.split(',')[1]);
    const dg = process.env.SIM_DODGE;
    if (dg) (CONFIG as unknown as { steven: { dodge: number[] } }).steven.dodge = dg.split(',').map(Number);
    for (const [name, team] of Object.entries(TEAMS)) {
      let wins = 0, transformed = 0, secs = 0, aceLeft = 0, left = 0, dmgByAll = 0, dmgOnAll = 0;
      for (let s = 1; s <= n; s++) {
        const m = new Match({ ground: world.ground(), rng: new Rng(1000 + s), sprites: world.sprites }, [], { humans: [{ name: 'P', starters: ['0004'] }], rivals: 0 });
        const st = m.stadium!;
        const sim = m.makeTrainer('Sim', 'trainer_a', false, st.playerSpot.x, st.playerSpot.y);
        sim.party = team.map((d) => { const x = m.makeMon(d, lv, sim, sim.x, sim.y); x.behavior = 'aggressive'; return x; });
        m.trainers.push(sim);
        const host = m.makeTrainer('Steven', 'steven', false, st.stevenSpot.x, st.stevenSpot.y);
        host.visitor = true; host.champion = process.env.SIM_MODE !== 'rival';
        (m.steven as unknown as { buildTeam(h: unknown, p: unknown): void }).buildTeam(host, sim);
        m.trainers.push(host);
        // the real player out of the way
        m.player.x = m.player.px = 20; m.player.y = m.player.py = 20;
        const d = m.startDuel(sim, host, st.playerSpot, st.stevenSpot);
        d.bounds = { ...st.field }; d.stadium = true;
        let t = 0;
        const seen = new Set<object>();
        let dmgBy = 0, dmgOn = 0;
        while (d.state !== 'over' && t < 600) {
          m.step(0.05); t += 0.05;
          for (const e of m.battle.events as Array<{ type: string; damage?: number; attacker?: { owner?: unknown } }>) {
            if (seen.has(e)) continue; seen.add(e);
            if (e.type === 'hit' && e.attacker?.owner === sim) dmgBy += e.damage ?? 0;
            if (e.type === 'hit' && e.attacker?.owner === host) dmgOn += e.damage ?? 0;
          }
        }
        if (s <= 0) console.log('seed', s, 'damage by challenger', dmgBy, 'on challenger', dmgOn, 'host', host.party.map((x) => `${x.name}:${x.hp}/${x.maxHp}${x.fainted ? 'X' : ''}`).join(' '), 'sim', sim.party.map((x) => `${x.name}:${x.hp}`).join(' '), 'duel', d.state, d.winner?.name);
        dmgByAll += dmgBy; dmgOnAll += dmgOn;
        if (d.winner === sim) wins++;
        if (host.party[5]?.aceForm?.done) transformed++;
        secs += t;
        left += sim.party.filter((x) => !x.fainted).length;
        aceLeft += d.winner === host ? host.party.filter((x) => !x.fainted).length : 0;
      }
      console.log(`${name} Lv${lv} over=${process.env.SIM_OVER ?? 'cfg'} dodge=${dg ?? 'cfg'} ai=${process.env.SIM_MODE ?? 'champion'}: dmg ratio ${(dmgByAll / Math.max(1, dmgOnAll)).toFixed(2)}, challenger wins ${wins}/${n} (${Math.round((100 * wins) / n)}%), ace changed form ${transformed}/${n}, avg ${Math.round(secs / n)} s, Steven had ${(aceLeft / Math.max(1, n - wins)).toFixed(1)} left when he won`);
    }
  }, 600000);
});
