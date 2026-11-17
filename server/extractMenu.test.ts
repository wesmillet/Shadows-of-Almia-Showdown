/** The keep menu only comes back while there is a Pokémon a pick can still go to. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Accounts } from './accounts';

let acc: Accounts;
let server: Server;
let base = '';
beforeAll(async () => {
  acc = new Accounts(mkdtempSync(join(tmpdir(), 'almia-extract-')), 'dev');
  server = createServer((req, res) => void acc.handle(req, res));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => server.close());

const call = async (path: string, body: unknown, cookie: string) => {
  const r = await fetch(`${base}${path}`, body === null ? { headers: { 'X-Almia': '1', cookie } } : { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Almia': '1', cookie }, body: JSON.stringify(body) });
  return { status: r.status, json: (await r.json()) as Record<string, unknown>, cookie: (r.headers.get('set-cookie') ?? '').split(';')[0] as string };
};
const mon = (dex: string, extra: Record<string, unknown> = {}) => ({ dex, name: dex, level: 20, shiny: false, moves: [], ...extra });

describe('keep menu', () => {
  it('closes when every Pokémon left came from a PC, and after the last pickable one is kept', async () => {
    const cookie = (await call('/api/register', { username: 'Keeper1', password: 'Sturdy-Mountain-Passphrase-42' }, '')).cookie;
    const id = (acc.db.prepare("SELECT id FROM users WHERE username = 'Keeper1'").get() as { id: number }).id;
    const put = (match: string, party: unknown[], picks: number) => {
      acc.db.prepare('INSERT OR IGNORE INTO matches (id, ended_at, summary, mode) VALUES (?, ?, ?, ?)').run(match, Date.now(), '[]', 'casual');
      acc.db.prepare('INSERT INTO match_players (match_id, user_id, place, outcome, stats, party, picks_left) VALUES (?, ?, 1, ?, ?, ?, ?)').run(match, id, 'win', '{}', JSON.stringify(party), picks);
    };
    // Only a PC starter: nothing to keep, so no menu, and the picks lapse.
    put('mA', [mon('0004', { fromPc: true })], 2);
    expect((await call('/api/extract', null, cookie)).json.match).toBeNull();
    expect((acc.db.prepare("SELECT picks_left FROM match_players WHERE match_id = 'mA'").get() as { picks_left: number }).picks_left).toBe(0);
    // Three picks but one Pokémon that can go: the menu offers one, and is gone once it is kept.
    put('mB', [mon('0004', { fromPc: true }), mon('0007')], 3);
    const got = await call('/api/extract', null, cookie);
    expect(got.json.match).toBe('mB');
    expect(got.json.picks).toBe(1);
    expect((await call('/api/extract', { match: 'mB', index: 1 }, cookie)).json.ok).toBe(true);
    expect((await call('/api/extract', null, cookie)).json.match).toBeNull();
  });
});
