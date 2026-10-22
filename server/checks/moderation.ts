/**
 * End-to-end check of anti-cheat and moderation against a running server (MATCH_SIZE=4
 * LOBBY_WAIT=4, and DATA_DIR the same as the server's, to make the first admin):
 * flags from a tampered client and the automatic report, chat strikes and the automatic mute,
 * the moderators' API (reports, player, alts, remove a message, announce), a ban with devices
 * (refused on reconnect and on sign-up from that device), and unbanning.
 *
 *   DATA_DIR=... npx tsx server/checks/moderation.ts [http://localhost:8787]
 */
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
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

async function api(cookie: string, path: string, body?: unknown, device = ''): Promise<{ status: number; json: Record<string, unknown>; cookie: string }> {
  const r = await fetch(`${BASE}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { cookie, ...(device ? { 'X-Device': device } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json', 'X-Almia': '1' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, json: (await r.json().catch(() => ({}))) as Record<string, unknown>, cookie: (r.headers.get('set-cookie') ?? '').split(';')[0] || cookie };
}

class Client {
  ws!: WebSocket;
  got: ServerMsg[] = [];
  closed: number | null = null;
  constructor(readonly name: string, readonly cookie: string, readonly device: string) {}
  open(): Promise<ServerMsg> {
    this.closed = null;
    this.ws = new WebSocket(`${WS}/ws?device=${this.device}`, { headers: { cookie: this.cookie } });
    this.ws.on('message', (d) => this.got.push(JSON.parse(String(d)) as ServerMsg));
    this.ws.on('close', (code) => (this.closed = code));
    return this.wait((m) => m.t === 'hello' || m.t === 'error');
  }
  send(m: ClientMsg): void {
    if (this.ws.readyState === this.ws.OPEN) this.ws.send(JSON.stringify(m));
  }
  async wait(test: (m: ServerMsg) => boolean, secs = 20): Promise<ServerMsg> {
    const from = this.got.length;
    for (let i = 0; i < secs * 20; i++) {
      const m = this.got.slice(from).find(test) ?? (i === 0 ? undefined : undefined);
      if (m) return m;
      await sleep(50);
    }
    throw new Error(`${this.name}: timed out`);
  }
}

const reg = async (name: string, device: string) => {
  const r = await api('', '/api/register', { username: name, password: `Quiet-${tag}-Lantern-55` }, device);
  if (r.status !== 200) throw new Error(`register ${name}: ${JSON.stringify(r.json)}`);
  return r.cookie;
};
const dev = () => randomBytes(18).toString('base64url');

const modName = `Officer_${tag}`;
const cheatName = `Sneaky_${tag}`;
const altName = `Sneaky2_${tag}`;
const devMod = dev();
const devCheat = dev();
const modCookie = await reg(modName, devMod);
const cheatCookie = await reg(cheatName, devCheat);
const altCookie = await reg(altName, devCheat);

check((await api(cheatCookie, '/api/mod/overview')).status === 403, 'players can not use the moderators\' API');
const data = process.env.DATA_DIR;
if (!data) throw new Error('Set DATA_DIR to the server\'s');
execFileSync('npx', ['tsx', join(import.meta.dirname, '..', 'admin.ts'), 'admin', modName], { env: { ...process.env, DATA_DIR: data }, stdio: 'ignore' });
const ov = (await api(modCookie, '/api/mod/overview')).json;
check(ov.you && (ov.you as { role: string }).role === 'admin', 'admin.js admin <name> makes an administrator');

// ---------------------------------------------------------------- a tampered client gets flagged
const cheat = new Client(cheatName, cheatCookie, devCheat);
const alt = new Client(altName, altCookie, devCheat);
await cheat.open();
await alt.open();
cheat.send({ t: 'roll' });
await cheat.wait((m) => m.t === 'roll');
cheat.send({ t: 'queue', pick: 0 });
await cheat.wait((m) => m.t === 'start', 30);
for (let i = 0; i < 7; i++) {
  // Move keys five times too strong, and a ball thrown across the island.
  cheat.send({ t: 'in', f: [[1000 + i * 3, 5, 0], [1001 + i * 3, 5, 0], [1002 + i * 3, 5, 0]], ax: 0, ay: 0 });
  cheat.send({ t: 'cmd', c: 'throw', a: [0, 5, 5], n: i });
  await sleep(600);
}
cheat.send({ t: 'leave' });
await sleep(1500);
const reports = (await api(modCookie, '/api/mod/reports')).json.reports as Array<{ target: string; reason: string; reporter_key: string }>;
check(reports.some((r) => r.target === cheatName && r.reporter_key === 'system' && r.reason.includes('impossible actions')), 'enough flags in one match: reported automatically');
const flags = (await api(modCookie, '/api/mod/flags')).json.flags as Array<{ name: string; kinds: string }>;
const mine = flags.find((f) => f.name === cheatName);
check(mine && mine.kinds.includes('input') && mine.kinds.includes('throw-range'), `the flags are kept (${mine?.kinds})`);

// ---------------------------------------------------------------- chat strikes
for (const w of ['what the fuck', 'this is shit', 'you bitch']) {
  cheat.ws.readyState === cheat.ws.OPEN || (await cheat.open());
  cheat.send({ t: 'chat', text: w });
  await sleep(300);
}
await sleep(300);
check(cheat.got.some((m) => m.t === 'chat' && !!m.system && /muted from chat for 10 minutes \(language\)/.test(m.text)), 'three strikes: muted automatically (10 minutes the first time)');
cheat.send({ t: 'chat', text: 'hello again' });
await sleep(400);
check(cheat.got.some((m) => m.t === 'chat' && !!m.system && m.text.includes('muted from chat')), 'and can not talk for now');

// ---------------------------------------------------------------- the moderators
const p = (await api(modCookie, `/api/mod/player?name=${cheatName}`)).json as { flags: unknown[]; devices: Array<{ device_id: string; accounts: number }>; alts: Array<{ username: string }>; mutedUntil: number | null; history: Array<{ action: string }> };
check(p.flags.length > 0 && p.mutedUntil, 'a player\'s page: flags, mute');
check(p.alts.some((a) => a.username === altName), 'and other accounts on the same device');
check(p.history.some((h) => h.action === 'auto-mute'), 'and what the server did');
const watcher = new Client(modName, modCookie, devMod);
await watcher.open();
const said = (await api(modCookie, '/api/mod/chat')).json.chat as Array<{ id: number; name: string }>;
const target = said.find((c) => c.name === cheatName);
check(!!target, 'chat log');
if (target) {
  await api(modCookie, '/api/mod/chat/remove', { id: target.id });
  check(await watcher.wait((m) => m.t === 'chatDelete' && m.id === target.id, 5).catch(() => null), 'removing a message takes it out of every open chat');
}
await api(modCookie, '/api/mod/announce', { text: `Maintenance at noon ${tag}` });
check(await alt.wait((m) => m.t === 'chat' && !!m.announce && m.text.includes(tag), 5).catch(() => null), 'announcements reach everyone');

// ---------------------------------------------------------------- a ban, with devices
const ban = await api(modCookie, '/api/mod/action', { name: cheatName, action: 'ban', devices: true, reason: 'cheating' });
check(ban.json.ok && Number(ban.json.devices) >= 1, `banned with ${ban.json.devices} device(s)`);
await sleep(500);
check(cheat.closed === 4003, 'and disconnected at once');
const again = new Client(cheatName, '', devCheat);
const hello = await again.open();
check(hello.t === 'error' && again.closed !== null, 'the device is refused, even signed out');
check((await api('', '/api/register', { username: `Fresh_${tag}`, password: `Quiet-${tag}-Lantern-55` }, devCheat)).status === 403, 'and can not make a new account');
check((await api(altCookie, '/api/me')).json.signedIn === true, 'the alt account itself is not banned (only its device)');
await api(modCookie, '/api/mod/action', { name: cheatName, action: 'unban', reason: 'appeal accepted' });
const back = new Client(cheatName, '', devCheat);
check((await back.open()).t === 'hello', 'unbanned: the device can play again');
const log = (await api(modCookie, '/api/mod/log')).json.log as Array<{ action: string }>;
check(['ban', 'unban', 'announce', 'remove-chat', 'auto-mute'].every((a) => log.some((l) => l.action === a)), 'everything is in the moderators\' log');
const page = await fetch(`${BASE}/mod`);
check(page.status === 200 && (await page.text()).includes('Moderators'), 'the dashboard page');

for (const c of [cheat, alt, watcher, again, back]) c.ws.close();
console.log(failed ? 'SOME CHECKS FAILED' : 'all moderation checks passed');
process.exit(failed ? 1 : 0);
