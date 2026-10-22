/**
 * End-to-end check of running the server (OPS_TOKEN=test-ops-token-1234, MATCH_SIZE=4 LOBBY_WAIT=4,
 * DATA_DIR the server's): metrics, browser errors in the error log, timed events (announced, sent
 * to browsers, XP doubled), draining for a deploy, and backups.
 *
 *   DATA_DIR=... npx tsx server/checks/ops.ts [http://localhost:8787]
 */
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import WebSocket from 'ws';
import type { ClientMsg, ServerMsg } from '../../src/net/protocol';

const BASE = process.argv[2] ?? 'http://localhost:8787';
const TOKEN = process.env.OPS_TOKEN ?? 'test-ops-token-1234';
const tag = Math.random().toString(36).slice(2, 6);
let failed = false;
const check = (ok: unknown, what: string) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
  if (!ok) failed = true;
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function api(cookie: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<{ status: number; json: Record<string, unknown>; cookie: string }> {
  const r = await fetch(`${BASE}${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { cookie, ...headers, ...(body === undefined ? {} : { 'Content-Type': 'application/json', 'X-Almia': '1' }) }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, json: (await r.json().catch(() => ({}))) as Record<string, unknown>, cookie: (r.headers.get('set-cookie') ?? '').split(';')[0] || cookie };
}
const got: ServerMsg[] = [];
const until = async (test: (m: ServerMsg) => boolean, secs = 20) => {
  for (let i = 0; i < secs * 20; i++) {
    const m = got.find(test);
    if (m) return m;
    await sleep(50);
  }
  return null;
};

// ---------------------------------------------------------------- metrics, browser errors
const metrics = await fetch('http://localhost:9091/metrics').then((r) => r.text()).catch(() => '');
check(metrics.includes('almia_players') && metrics.includes('almia_step_ms_avg'), 'Prometheus metrics on their own port');
await fetch(`${BASE}/api/client-error`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: `Test error ${tag}`, stack: 'at draw (main.ts:1:1)', build: 'test' }) });

const admin = `Ops_${tag}`;
const cookie = (await api('', '/api/register', { username: admin, password: `Harbor-${tag}-Lantern-91` })).cookie;
execFileSync('npx', ['tsx', join(import.meta.dirname, '..', 'admin.ts'), 'admin', admin], { env: { ...process.env }, stdio: 'ignore' });
const server = (await api(cookie, '/api/mod/server')).json as { errors: Array<{ source: string; message: string }>; kind: string };
check(server.errors?.some((e) => e.source === 'client' && e.message.includes(tag)), 'browser errors land in the error log');

// ---------------------------------------------------------------- events
const ws = new WebSocket(`${BASE.replace(/^http/, 'ws')}/ws`, { headers: { cookie } });
ws.on('message', (d) => got.push(JSON.parse(String(d)) as ServerMsg));
const send = (m: ClientMsg) => ws.send(JSON.stringify(m));
await until((m) => m.t === 'hello');
const mk = await api(cookie, '/api/mod/events', { kind: 'xp', name: `Double XP ${tag}`, startsAt: Date.now() - 1000, hours: 1, value: 2 });
check(mk.json.ok, 'a moderator schedules an event');
check(await until((m) => m.t === 'events' && m.active.some((e) => e.name.includes(tag))), 'everyone online hears of it');
check(await until((m) => m.t === 'chat' && !!m.announce && m.text.includes(tag)), 'and it is announced');
check((await api(cookie, '/api/mod/events', { kind: 'xp', name: 'Silly', hours: 1, value: 50 })).status === 400, 'boosts are kept sensible');
send({ t: 'roll' });
await until((m) => m.t === 'roll');
send({ t: 'queue', pick: 0 });
await until((m) => m.t === 'start', 30);
send({ t: 'leave' });
const prog = (await until((m) => m.t === 'progress', 20)) as Extract<ServerMsg, { t: 'progress' }> | null;
check(prog?.xp.some((x) => x.what === '2x XP event'), `the event doubles XP (${prog?.xp.map((x) => `${x.what} +${x.xp}`).join(', ')})`);
const evs = (await api(cookie, '/api/mod/events')).json.events as Array<{ id: number; name: string }>;
for (const e of evs.filter((x) => x.name.includes(tag))) await api(cookie, '/api/mod/events/delete', { id: e.id });

// ---------------------------------------------------------------- draining for a deploy
check((await api('', '/api/ops/drain', {})).status === 403, 'the ops API needs the token');
const dr = await api('', '/api/ops/drain', {}, { Authorization: `Bearer ${TOKEN}` });
check(dr.json.ok && dr.json.draining === true, 'draining: no new matches');
const health = await fetch(`${BASE}/health`).then((r) => r.json() as Promise<{ draining: boolean; rooms: number }>);
check(health.draining, '/health says so (the deploy workflow waits on its "rooms")');
got.length = 0;
send({ t: 'roll' });
await until((m) => m.t === 'roll');
send({ t: 'queue', pick: 0 });
check(await until((m) => m.t === 'notice' && m.text.includes('updating'), 5), 'queueing is refused, with the reason');
await api('', '/api/ops/undrain', {}, { Authorization: `Bearer ${TOKEN}` });
check(!(await fetch(`${BASE}/health`).then((r) => r.json() as Promise<{ draining: boolean }>)).draining, 'and back');

// ---------------------------------------------------------------- backups
const bk = (await api('', '/api/ops/backup', {}, { Authorization: `Bearer ${TOKEN}` })).json as { backup: { file: string; bytes: number } | null };
check(bk.backup && bk.backup.bytes > 1000, `a backup (${bk.backup ? Math.round(bk.backup.bytes / 1024) : 0} KB gzipped)`);
const list = execFileSync('npx', ['tsx', join(import.meta.dirname, '..', 'admin.ts'), 'backups'], { env: { ...process.env } }).toString();
check(list.includes('.db.gz'), 'admin.js backups lists them');

ws.close();
console.log(failed ? 'SOME CHECKS FAILED' : 'all ops checks passed');
process.exit(failed ? 1 : 0);
