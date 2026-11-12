/** A starter that came from the player's own PC can not be kept again (no copies), and copies already made can be found and removed. */
import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadWorld } from './world';
import { Match } from '../src/sim/match';
import { Rng } from '../src/core/rng';
import { Accounts } from './accounts';
import { pcFields } from './pcFields';

describe('PC starters', async () => {
  const world = await loadWorld(join(import.meta.dirname, '..', 'assets'));

  it("'!' marks a PC starter: no voucher extraction, and the end screen can not keep it", () => {
    const m = new Match({ ground: world.ground(), rng: new Rng(3), sprites: world.sprites }, [], { humans: [{ name: 'P', starters: ['0385!*'] }], rivals: 0 });
    m.keepsResults = true;
    const p = m.player;
    const lead = p.party[0]!;
    expect(lead.dex).toBe('0385');
    expect(lead.fromPc).toBe(true);
    expect(lead.shiny).toBe(true);
    expect(pcFields(lead).fromPc).toBe(true);
    // A second Pokémon, and a voucher: the PC starter still can not go.
    p.party.push(m.makeMon('0004', 5, p, p.x, p.y));
    p.items[0] = { id: 'extraction-voucher', count: 1 };
    expect(m.extractWithVoucher(0, 0)).toMatch(/came from your PC/);
    expect(p.party).toHaveLength(2);
    expect(p.items[0]?.count).toBe(1);
    // Alpha and PC marks together.
    const m2 = new Match({ ground: world.ground(), rng: new Rng(4), sprites: world.sprites }, [], { humans: [{ name: 'P', starters: ['0004!^'] }], rivals: 0 });
    expect(m2.player.party[0]?.dex).toBe('0004');
    expect(m2.player.party[0]?.alpha).toBe(true);
    expect(m2.player.party[0]?.fromPc).toBe(true);
  });

  it('finds duplicate legendaries and removes only later copies', () => {
    const a = new Accounts(mkdtempSync(join(tmpdir(), 'dup-')), 'dev');
    const uid = Number(a.db.prepare("INSERT INTO users (username, pass_hash, created_at) VALUES ('Shan', 'x', ?)").run(Date.now()).lastInsertRowid);
    a.db.prepare('INSERT OR IGNORE INTO profiles (user_id) VALUES (?)').run(uid);
    const j = { dex: '0385', name: 'Jirachi', level: 5, moves: [] as string[] };
    const first = a.addToPc(uid, j, 'egg', 'egg:1');
    const copy1 = a.addToPc(uid, { ...j, level: 30 }, 'win', 'm1');
    const copy2 = a.addToPc(uid, { ...j, level: 31 }, 'voucher', 'm2');
    a.addToPc(uid, { dex: '0004', name: 'Charmander', level: 5, moves: [] }, 'win', 'm3');
    const g = a.duplicateLegends();
    expect(g).toHaveLength(1);
    expect(g[0]?.copies.map((c) => [c.pcId, c.suspect])).toEqual([[first, false], [copy1, true], [copy2, true]]);
    const by = { id: 1, name: 'Wes' };
    expect(a.removeDuplicateLegend(first, by)).toMatch(/original/);
    expect(a.removeDuplicateLegend(copy1, by)).toBeNull();
    expect(a.removeDuplicateLegend(copy2, by)).toBeNull();
    expect(a.duplicateLegends()).toHaveLength(0);
    const left = a.db.prepare("SELECT COUNT(*) AS n FROM pc WHERE user_id = ? AND json_extract(entry, '$.dex') = '0385'").get(uid) as { n: number };
    expect(left.n).toBe(1);
    const logged = a.db.prepare("SELECT COUNT(*) AS n FROM collection_log WHERE action = 'remove:duplicate'").get() as { n: number };
    expect(logged.n).toBe(2);
  });
});
