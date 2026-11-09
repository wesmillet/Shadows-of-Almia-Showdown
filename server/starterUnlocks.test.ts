import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Accounts } from './accounts';
import { STARTER_TIERS } from '../src/sim/starters';
import { ALL_STARTERS } from '../src/sim/starterAchievements';

function account(): { acc: Accounts; uid: number } {
  const acc = new Accounts(mkdtempSync(join(tmpdir(), 'almia-starters-')), 'live');
  const uid = Number(acc.db.prepare('INSERT INTO users (username, pass_hash, created_at) VALUES (?, ?, ?)').run('Starter', 'x', Date.now()).lastInsertRowid);
  acc.db.prepare('INSERT INTO profiles (user_id) VALUES (?)').run(uid);
  return { acc, uid };
}

const result = (uid: number, place: number, species: string[]) => ({
  key: `u${uid}`, name: 'Starter', outcome: 'loss' as const, place,
  stats: { catches: species.length, knockouts: 0, damage: 0, timeSurvived: 60, species }, party: [], vouchers: 0,
});

describe('starter achievements', () => {
  it('unlock from matches, take a final choice, and feed the roll', () => {
    const { acc, uid } = account();
    let info = acc.starters.info(uid);
    // Signing in is the first unlock; nothing else yet.
    expect(info.achievements.filter((a) => a.done).map((a) => a.id)).toEqual(['sign_in']);
    expect(info.eligible).toEqual([]);
    acc.recordMatch('m1', [result(uid, 2, ['0025', '0399'])], 'casual');
    acc.recordMatch('m2', [result(uid, 3, ['0041'])], 'casual');
    acc.recordMatch('m3', [result(uid, 1, ['0403'])], 'casual');
    // No launch date set: the launch week achievement is hidden.
    acc.starters.weekStart = null;
    info = acc.starters.info(uid);
    const by = Object.fromEntries(info.achievements.map((a) => [a.id, a]));
    expect(by.sign_in?.done).toBe(true);
    expect(by.launch_week).toBeUndefined();
    expect(acc.starters.choose(uid, 'sign_in', '0004')).toBeNull();
    expect(by.three_matches?.done).toBe(true);
    expect(by.three_matches?.dex).toBeNull();
    expect(by.podium_three?.done).toBe(true);
    expect(by.ten_species?.done).toBe(false);
    expect(by.ten_species?.progress).toBe(4);
    // A choice is final.
    expect(acc.starters.choose(uid, 'three_matches', '0001')).toMatch('one of the three');
    expect(acc.starters.choose(uid, 'three_matches', '0255')).toBeNull();
    expect(acc.starters.choose(uid, 'three_matches', '0258')).toMatch('already');
    expect(acc.starters.choose(uid, 'ten_species', '0387')).toMatch('Not unlocked');
    // Nominations: only what the account has; saved; the roll uses them.
    const uncommon = '0004';
    expect(acc.starters.nominate(uid, ['0255', '0447'])).toMatch('not one you can star');
    expect(acc.starters.nominate(uid, ['0255', uncommon])).toBeNull();
    expect(acc.starters.forRoll(uid).sort()).toEqual(['0255', uncommon].sort());
  });

  it('players from before get credit from what was recorded', () => {
    const { acc, uid } = account();
    acc.db.prepare('UPDATE profiles SET stats = ? WHERE user_id = ?').run(JSON.stringify({ matches: 5, catches: 12 }), uid);
    const info = acc.starters.info(uid);
    const by = Object.fromEntries(info.achievements.map((a) => [a.id, a]));
    expect(by.sign_in?.done).toBe(true);
    expect(by.three_matches?.done).toBe(true);
  });

  it('launch week: 25 trainers defeated that week give a random shiny starter', () => {
    const { acc, uid } = account();
    acc.starters.weekStart = new Date(Date.now() - 3600_000).toISOString();
    const ko = (n: number) => ({ ...result(uid, 4, []), stats: { catches: 0, knockouts: 0, eliminations: n, damage: 0, timeSurvived: 60, species: [] } });
    acc.recordMatch('w1', [ko(20)], 'casual');
    let by = Object.fromEntries(acc.starters.info(uid).achievements.map((a) => [a.id, a]));
    expect(by.launch_week?.progress).toBe(20);
    expect(by.launch_week?.done).toBe(false);
    acc.recordMatch('w2', [ko(5)], 'casual');
    by = Object.fromEntries(acc.starters.info(uid).achievements.map((a) => [a.id, a]));
    expect(by.launch_week?.done).toBe(true);
    expect(ALL_STARTERS).toContain(by.launch_week?.dex);
    const pc = acc.db.prepare('SELECT entry FROM pc WHERE user_id = ?').all(uid).map((r) => JSON.parse((r as { entry: string }).entry) as { dex: string; shiny?: boolean });
    expect(pc.find((e) => e.dex === by.launch_week?.dex)?.shiny).toBe(true);
    // Outside the week it is not shown (unless earned) and nothing counts.
    acc.starters.weekStart = '2020-01-01T00:00:00Z';
    const { acc: acc2, uid: uid2 } = account();
    acc2.starters.weekStart = '2020-01-01T00:00:00Z';
    expect(acc2.starters.info(uid2).achievements.some((a) => a.id === 'launch_week')).toBe(false);
    expect(acc.starters.info(uid).achievements.some((a) => a.id === 'launch_week')).toBe(true);
  });

  it('rewards go to the PC; Pokémon are kept at their first form, old entries too', () => {
    const { acc, uid } = account();
    const pcIds = () => acc.db.prepare('SELECT entry FROM pc WHERE user_id = ?').all(uid).map((r) => JSON.parse((r as { entry: string }).entry) as { dex: string; name: string; via: string; evolvedFrom?: string; level: number });
    acc.recordMatch('m1', [result(uid, 5, ['0025'])], 'casual');
    expect(acc.starters.choose(uid, 'sign_in', '0007')).toBeNull();
    expect(pcIds().filter((e) => e.via === 'reward').length).toBe(1);
    acc.recordMatch('m2', [result(uid, 5, [])], 'casual');
    acc.recordMatch('m3', [result(uid, 5, [])], 'casual');
    expect(acc.starters.choose(uid, 'three_matches', '0258')).toBeNull();
    const reward = pcIds().find((e) => e.dex === '0258');
    expect(reward?.via).toBe('reward');
    expect(reward?.level).toBe(5);
    // A Charizard won in a match is kept as a Charmander.
    acc.addToPc(uid, { dex: '0006', name: 'Charizard', level: 40, moves: [] }, 'win', 'm4');
    const c = pcIds().find((e) => e.evolvedFrom === '0006');
    expect(c?.dex).toBe('0004');
    expect(c?.name).toBe('Charmander');
    // An entry stored before this rule changes on the next start.
    acc.db.prepare('INSERT INTO pc (user_id, entry, created_at) VALUES (?, ?, ?)').run(uid, JSON.stringify({ uid: 'old', dex: '0445', name: 'Garchomp', level: 60, moves: [], via: 'win' }), Date.now());
    acc.db.prepare("DELETE FROM meta WHERE key = 'pc_first_forms_v2'").run();
    (acc as unknown as { firstFormsOnce(): void }).firstFormsOnce();
    expect(pcIds().find((e) => e.evolvedFrom === '0445')?.dex).toBe('0443');
    // Only the Pikachu caught in m1 counts: collected Pokémon (extracted Charizard and Garchomp,
    // the rewarded Mudkip) are not catches.
    expect(acc.starters.progress(uid).species).toBe(1);
  });
});
