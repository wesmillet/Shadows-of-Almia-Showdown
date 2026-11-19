/** One of each legendary: a second can't be kept, hatched, traded in or redeemed. Forms count apart. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Accounts } from './accounts';
import { legendKey } from '../src/sim/starters';

let acc: Accounts;
let server: Server;
let base = '';
beforeAll(async () => {
  acc = new Accounts(mkdtempSync(join(tmpdir(), 'almia-legend-')), 'dev');
  server = createServer((req, res) => void acc.handle(req, res));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => server.close());

const call = async (path: string, body: unknown, cookie: string) => {
  const r = await fetch(`${base}${path}`, body === null ? { headers: { 'X-Almia': '1', cookie } } : { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Almia': '1', cookie }, body: JSON.stringify(body) });
  return { status: r.status, json: (await r.json()) as Record<string, unknown>, cookie: (r.headers.get('set-cookie') ?? '').split(';')[0] as string };
};
const mon = (dex: string, extra: Record<string, unknown> = {}) => ({ dex, name: dex, level: 60, shiny: false, moves: [], ...extra });

describe('one of each legendary', () => {
  it('forms are their own legendary; shinies are not', () => {
    expect(legendKey('0249')).toBe('0249');
    expect(legendKey('0249-shadow')).toBe('0249-shadow');
    expect(legendKey('0004')).toBeNull();
  });

  it('the keep menu marks one already owned and refuses it; another form is fine', async () => {
    const cookie = (await call('/api/register', { username: 'Legend1', password: 'Sturdy-Mountain-Passphrase-42' }, '')).cookie;
    const id = (acc.db.prepare("SELECT id FROM users WHERE username = 'Legend1'").get() as { id: number }).id;
    acc.addToPc(id, mon('0249', { shiny: true }), 'win', 'm0');
    acc.db.prepare('INSERT OR IGNORE INTO matches (id, ended_at, summary, mode) VALUES (?, ?, ?, ?)').run('mL', Date.now(), '[]', 'casual');
    acc.db.prepare('INSERT INTO match_players (match_id, user_id, place, outcome, stats, party, picks_left) VALUES (?, ?, 1, ?, ?, ?, ?)').run('mL', id, 'win', '{}', JSON.stringify([mon('0249'), mon('0249-shadow'), mon('0007')]), 3);
    const got = await call('/api/extract', null, cookie);
    const party = got.json.party as Array<{ owned?: boolean }>;
    expect(party[0]?.owned).toBe(true);
    expect(party[1]?.owned).toBeUndefined();
    expect(got.json.picks).toBe(2);
    const no = await call('/api/extract', { match: 'mL', index: 0 }, cookie);
    expect(no.status).toBe(400);
    expect(String(no.json.error)).toMatch('one of each legendary');
    expect((await call('/api/extract', { match: 'mL', index: 1 }, cookie)).json.ok).toBe(true);
    expect(acc.ownedLegends(id).sort()).toEqual(['0249', '0249-shadow']);
  });

  it('an Egg that would hatch an owned legendary hatches another', () => {
    const id = Number(acc.db.prepare('INSERT INTO users (username, pass_hash, created_at) VALUES (?, ?, ?)').run('Legend2', 'x', Date.now()).lastInsertRowid);
    acc.addToPc(id, mon('0151'), 'egg', 'e0');
    for (let i = 0; i < 20; i++) {
      const d = acc.eggDex(id, '0151', 'mythic');
      expect(d).not.toBe('0151');
      expect(legendKey(d)).not.toBeNull();
    }
    expect(acc.eggDex(id, '0007', 'rare')).toBe('0007');
  });

  it('a trade that would give either side a second is refused', () => {
    const a = Number(acc.db.prepare('INSERT INTO users (username, pass_hash, created_at) VALUES (?, ?, ?)').run('Legend3', 'x', Date.now()).lastInsertRowid);
    acc.addToPc(a, mon('0385'), 'win', 'x');
    const lugia = acc.addToPc(a, mon('0249'), 'win', 'x');
    // Trading Jirachi in while giving one away is fine; while keeping one, not.
    const jirachi = (acc.db.prepare("SELECT id FROM pc WHERE user_id = ? AND json_extract(entry, '$.dex') = '0385'").get(a) as { id: number }).id;
    expect(acc.legendProblem(a, '0385', [jirachi])).toBeNull();
    expect(acc.legendProblem(a, '0385', [lugia])).toMatch('Jirachi');
  });
});
