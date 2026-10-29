/**
 * Check: the administrator's dashboard (/admin, /api/admin/*) against a running dev server whose
 * DATA_DIR this script can reach (to grant the admin role with the admin command line, as on the
 * live server).
 *   - guests, players and moderators get 403 from every admin endpoint, by direct request;
 *   - an account merely named like the administrator gets nothing;
 *   - the admin gets read-only answers (anything but GET is refused);
 *   - nothing secret comes back (no password hash, session token, Google id);
 *   - online counts: accounts and guests, a second tab of the same account counts once, a guest is
 *     one per guest id, a closed connection leaves the list;
 *   - an account's page: profile, progression, PC entries as stored;
 *   - a completed two-player match appears in the history with both players, bots counted (none),
 *     a winner and a duration, and on each account's page.
 *   DATA_DIR=... npx tsx server/checks/admin_dashboard.ts [http://localhost:8787]
 */
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import WebSocket from 'ws';
import type { ClientMsg, ServerMsg } from '../../src/net/protocol';

const BASE = process.argv[2] ?? 'http://localhost:8787';
const WS = BASE.replace(/^http/, 'ws');
const tag = Math.random().toString(36).slice(2, 6);
let failed = false;
const check = (ok: unknown, what: string) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
  if (!ok) failed = true;
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function register(name: string): Promise<string> {
  const r = await fetch(`${BASE}/api/register`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Almia': '1' }, body: JSON.stringify({ username: name, password: `Sturdy-${tag}-Passphrase-42` }) });
  if (r.status !== 200) throw new Error(`register ${name}: ${r.status} ${await r.text()}`);
  return (r.headers.get('set-cookie') ?? '').split(';')[0] as string;
}

async function get(cookie: string, path: string, method = 'GET'): Promise<{ status: number; json: Record<string, unknown>; text: string }> {
  const r = await fetch(`${BASE}${path}`, { method, headers: { cookie, ...(method === 'GET' ? {} : { 'Content-Type': 'application/json', 'X-Almia': '1' }) }, body: method === 'GET' ? undefined : '{}' });
  const text = await r.text();
  let json: Record<string, unknown> = {};
  try {
    json = JSON.parse(text) as Record<string, unknown>;
  } catch {
    // the page itself (HTML)
  }
  return { status: r.status, json, text };
}

class Player {
  ws!: WebSocket;
  got: ServerMsg[] = [];
  closedWith: number | null = null;
  constructor(readonly name: string, readonly cookie: string) {}
  open(guest = ''): Promise<void> {
    this.ws = new WebSocket(`${WS}/ws${guest ? `?guest=${guest}` : ''}`, { headers: { cookie: this.cookie } });
    this.ws.on('message', (d) => this.got.push(JSON.parse(String(d)) as ServerMsg));
    this.ws.on('close', (code) => (this.closedWith = code));
    return this.until((m) => m.t === 'hello', 10).then(() => undefined);
  }
  send(m: ClientMsg): void {
    this.ws.send(JSON.stringify(m));
  }
  async until(test: (m: ServerMsg) => boolean, secs: number): Promise<ServerMsg | null> {
    const end = Date.now() + secs * 1000;
    let seen = 0;
    while (Date.now() < end) {
      for (; seen < this.got.length; seen++) if (test(this.got[seen] as ServerMsg)) return this.got[seen] as ServerMsg;
      await sleep(50);
    }
    return null;
  }
  async pick(): Promise<void> {
    this.send({ t: 'roll' });
    await this.until((m) => m.t === 'roll', 10);
    this.send({ t: 'queue', pick: 0 });
  }
}

const data = process.env.DATA_DIR;
if (!data) throw new Error("Set DATA_DIR to the server's");
const role = (r: string, name: string) => execFileSync('npx', ['tsx', join(import.meta.dirname, '..', 'admin.ts'), r, name], { env: { ...process.env, DATA_DIR: data }, stdio: 'ignore' });

const adminName = `Boss_${tag}`;
const admin = await register(adminName);
const player = await register(`Plain_${tag}`);
const mod = await register(`Mod_${tag}`);
const lookalike = await register(`${adminName}x`);
role('admin', adminName);
role('mod', `Mod_${tag}`);

// ---------------------------------------------------------------- authorization
const PATHS = ['/api/admin/online', '/api/admin/live', '/api/admin/accounts', '/api/admin/account?id=1', '/api/admin/matches', '/api/admin/match?id=x', '/api/admin/account/matches?id=1'];
for (const [who, cookie] of [['a guest (no cookie)', ''], ['a player', player], ['a moderator', mod], [`an account named like the admin (${adminName}x)`, lookalike], ['a forged session cookie', 'almia_session=forged-token']] as const) {
  const codes = await Promise.all(PATHS.map(async (p) => (await get(cookie, p)).status));
  check(codes.every((c) => c === 403), `${who}: 403 from every admin endpoint (${[...new Set(codes)].join(',')})`);
}
check((await get(admin, '/api/admin/online')).status === 200, 'the admin account: 200');
check((await get(admin, '/api/admin/online', 'POST')).status === 405, 'read-only: a POST is refused (405)');
check((await get(player, '/api/admin/online', 'POST')).status === 403, 'and a player posting gets 403');
const page = await get('', '/admin');
check(page.status === 200 && page.text.includes('/api/admin/online') && !page.text.includes(adminName), 'the /admin page itself holds no data (it asks the API)');

// ---------------------------------------------------------------- online counts
const online = async () => (await get(admin, '/api/admin/online')).json as { counts: { accounts: number; guests: number; hub: number }; players: Array<{ name: string; guest: boolean; state: string }> };
const base = (await online()).counts;
const tab1 = new Player('tab1', player);
await tab1.open();
const tab2 = new Player('tab2', player);
await tab2.open();
await sleep(500);
check(tab1.closedWith === 4000, `a second tab of the same account closes the first (code ${tab1.closedWith})`);
const guestId = `g${tag}${'x'.repeat(16)}`;
const g1 = new Player('g1', '');
await g1.open(guestId);
const g2 = new Player('g2', '');
await g2.open(`h${tag}${'y'.repeat(16)}`);
await sleep(300);
let o = await online();
check(o.counts.accounts === base.accounts + 1, `the account counts once with two tabs opened (${o.counts.accounts - base.accounts})`);
check(o.counts.guests === base.guests + 2, `two guest ids are two guests (${o.counts.guests - base.guests})`);
check(o.players.some((p) => p.guest && /^Guest\d{4}$/.test(p.name)) && o.players.some((p) => p.name === `Plain_${tag}` && !p.guest), 'guests are labelled and named; the account by its username');
check(o.counts.hub >= 3, `on the online menu (hub: ${o.counts.hub})`);
g2.ws.close();
await sleep(500);
o = await online();
check(o.counts.guests === base.guests + 1, 'a closed connection leaves the list at once');
// The account comes back after dropping: listed again, once.
tab2.ws.close();
await sleep(300);
const back = new Player('back', player);
await back.open();
await sleep(300);
o = await online();
check(o.players.filter((p) => p.name === `Plain_${tag}`).length === 1, 'back after a disconnect: listed once');
// Queued: in a lobby.
await back.pick();
await sleep(500);
o = await online();
check(o.players.find((p) => p.name === `Plain_${tag}`)?.state === 'lobby', 'queued for a match: shown in a lobby');
back.send({ t: 'leaveQueue' });

// ---------------------------------------------------------------- accounts
const search = (await get(admin, `/api/admin/accounts?q=${tag}`)).json as { total: number; accounts: Array<Record<string, unknown>> };
check(search.total === 4 && search.accounts.length === 4, `search by username (${search.total} accounts with "${tag}")`);
check(search.accounts.every((a) => !('pass_hash' in a) && !('google_sub' in a)), 'no password hashes or Google ids in the search');
const plainId = Number(search.accounts.find((a) => a.username === `Plain_${tag}`)?.id);
const acct = await get(admin, `/api/admin/account?id=${plainId}`);
const a = acct.json as { account: Record<string, unknown>; progression: { xp: number; level: number }; pc: unknown[]; matches: { total: number }; currencies: unknown };
check(acct.status === 200 && a.account.username === `Plain_${tag}` && typeof a.account.created_at === 'number' && a.account.role === 'player', 'an account: id, creation date, role');
check(typeof a.account.last_seen === 'number', 'last seen is recorded');
check(!acct.text.includes('pass_hash') && !/token/i.test(acct.text) && !acct.text.includes('Sturdy-'), 'nothing secret in an account page');
check(Array.isArray(a.pc) && a.currencies === null && a.progression.xp === 0, 'PC and progression shown; no currency is saved between matches');

// ---------------------------------------------------------------- a completed match in the history
const A = new Player('A', admin);
await A.open();
const B = new Player('B', player);
back.ws.close();
await sleep(200);
await B.open();
A.send({ t: 'private', a: 'create' });
const lob = await A.until((m) => m.t === 'private' && !!m.lobby, 10);
const code = lob && lob.t === 'private' ? (lob.lobby?.code as string) : '';
B.send({ t: 'private', a: 'join', code });
await B.until((m) => m.t === 'private' && (m.lobby?.members.length ?? 0) === 2, 10);
A.send({ t: 'private', a: 'rules', rules: { size: 2, bots: false, level: 5, storm: 1, teams: 'solo', rareChest: false } });
await sleep(300);
A.send({ t: 'private', a: 'start' });
await Promise.all([A.until((m) => m.t === 'pick', 10), B.until((m) => m.t === 'pick', 10)]);
await A.pick();
await B.pick();
const st = await A.until((m) => m.t === 'start', 20);
const matchId = st && st.t === 'start' ? st.matchId : '';
check(!!matchId, `a two-player private match started (${matchId})`);
await sleep(1500);
const live = (await get(admin, '/api/admin/live')).json as { matches: Array<{ id: string; trainers: Array<{ name: string; human: boolean; connected: boolean }> }> };
const lm = live.matches.find((m) => m.id === matchId);
check(lm && lm.trainers.length === 2 && lm.trainers.every((t) => t.human && t.connected), 'live: the match with both players connected');
o = await online();
check(o.players.filter((p) => p.state === 'match').length >= 2, 'online: both shown playing');
// B drops: the seat is held.
B.ws.close();
await sleep(800);
o = await online();
const away = (o as unknown as { away: Array<{ name: string }> }).away;
check(away.some((p) => p.name === `Plain_${tag}`), 'a player who drops mid-match is listed as away, seat held');
await B.open();
await sleep(800);
o = await online();
check(!(o as unknown as { away: Array<{ name: string }> }).away.some((p) => p.name === `Plain_${tag}`) && o.players.find((p) => p.name === `Plain_${tag}`)?.state === 'match', 'back in: playing again, no longer away');
// B quits: A is the last trainer standing.
const ended = A.until((m) => m.t === 'end', 20);
B.send({ t: 'leave' });
const end = await ended;
check(end && end.t === 'end' && end.outcome === 'win', 'A wins when B leaves');
await sleep(1500);
const hist = (await get(admin, '/api/admin/matches?mode=private')).json as { matches: Array<Record<string, unknown>>; since: number };
const row = hist.matches.find((m) => m.id === matchId);
check(row && row.trainers_n === 2 && row.humans === 2 && row.bots === 0 && row.winner === adminName && typeof row.seconds === 'number', `the match is in the history (winner ${row?.winner}, ${row?.trainers_n} trainers, ${row?.bots} bots)`);
check(typeof hist.since === 'number', 'the history says when full records began');
const md = (await get(admin, `/api/admin/match?id=${matchId}`)).json as { match: { trainers: Array<{ name: string; place: number; outcome: string; human: boolean; stats: unknown }> }; full: boolean };
const places = md.match.trainers.map((t) => `${t.name}#${t.place}:${t.outcome}`).sort().join(' ');
check(md.full && md.match.trainers.length === 2 && md.match.trainers.find((t) => t.name === adminName)?.place === 1 && md.match.trainers.find((t) => t.name === `Plain_${tag}`)?.place === 2, `participants and places (${places})`);
const mine = (await get(admin, `/api/admin/account?id=${plainId}`)).json as { matches: { matches: Array<{ id: string }> } };
check(mine.matches.matches.some((m) => m.id === matchId), "and on the player's account page");
const filtered = (await get(admin, `/api/admin/matches?mode=private&player=${encodeURIComponent(adminName)}`)).json as { matches: Array<{ id: string }> };
check(filtered.matches.some((m) => m.id === matchId), 'filter by trainer name');

for (const p of [A, B, g1]) p.ws.close();
console.log(failed ? 'admin dashboard checks FAILED' : 'All admin dashboard checks passed');
process.exit(failed ? 1 : 0);
