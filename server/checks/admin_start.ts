/**
 * Check: the administrator's "start now" against a running server (MATCH_SIZE=10, no MIN_PLAYERS
 * override, so a lobby needs five real players), whose DATA_DIR this script can reach to grant the
 * admin role with the admin command line (as on the live server).
 *   - an ordinary account alone in the queue cannot start (its Start now waits for five);
 *   - an account merely named like the administrator gets nothing either;
 *   - the admin account alone starts at once, the other nine seats filled with computer trainers;
 *   - an admin start takes everyone in the lobby along.
 *   DATA_DIR=... npx tsx server/checks/admin_start.ts [http://localhost:8787]
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

async function register(name: string): Promise<string> {
  const r = await fetch(`${BASE}/api/register`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Almia': '1' }, body: JSON.stringify({ username: name, password: `Sturdy-${tag}-Passphrase-42` }) });
  if (r.status !== 200) throw new Error(`register ${name}: ${r.status} ${await r.text()}`);
  return (r.headers.get('set-cookie') ?? '').split(';')[0] as string;
}

class P {
  ws!: WebSocket;
  got: ServerMsg[] = [];
  constructor(readonly name: string, readonly cookie: string) {}
  open(): Promise<void> {
    this.ws = new WebSocket(`${WS}/ws`, { headers: { cookie: this.cookie } });
    this.ws.on('message', (d) => this.got.push(JSON.parse(String(d)) as ServerMsg));
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
      await new Promise((r) => setTimeout(r, 50));
    }
    return null;
  }
  async queue(): Promise<void> {
    this.send({ t: 'roll' });
    await this.until((m) => m.t === 'roll', 10);
    this.send({ t: 'queue', pick: 0 });
    await this.until((m) => m.t === 'lobby', 10);
  }
  lastLobby(): Extract<ServerMsg, { t: 'lobby' }> | undefined {
    return [...this.got].reverse().find((m) => m.t === 'lobby') as Extract<ServerMsg, { t: 'lobby' }> | undefined;
  }
}

const adminName = `Wes${tag}`;
const admin = new P(adminName, await register(adminName));
// The same display name with different case, and an ordinary player
const lookalike = new P(`wes${tag}x`, await register(`wes${tag}x`));
execFileSync('node', [join(import.meta.dirname, '..', '..', 'dist-server', 'admin.js'), 'admin', adminName], { env: process.env, stdio: 'pipe' });

await lookalike.open();
await lookalike.queue();
const l0 = lookalike.lastLobby();
check(l0?.size === 10 && l0?.min === 5, `a public lobby holds ${l0?.size} trainers and needs ${l0?.min} real players`);
check(!l0?.admin, 'an ordinary account is not offered the admin start');
lookalike.send({ t: 'startNow' });
const started0 = await lookalike.until((m) => m.t === 'start', 6);
check(!started0, "an ordinary account's Start now does not start a lobby of one");
lookalike.send({ t: 'leaveQueue' });
await new Promise((r) => setTimeout(r, 500));

await admin.open();
await admin.queue();
check(admin.lastLobby()?.admin === true, 'the admin account is offered the admin start');
admin.send({ t: 'startNow' });
const st = (await admin.until((m) => m.t === 'start', 10)) as Extract<ServerMsg, { t: 'start' }> | null;
check(!!st, 'the admin account alone starts a match at once');
const humans = st?.roster?.filter((r) => r.human).length;
check(st?.roster?.length === 10 && humans === 1, `it has ten trainers (${st?.roster?.length}), ${humans ?? '?'} of them human`);
admin.send({ t: 'leave' });
await new Promise((r) => setTimeout(r, 1500));

// An admin start brings the others in the lobby along.
lookalike.got = [];
admin.got = [];
await lookalike.queue();
await admin.queue();
admin.send({ t: 'startNow' });
const a2 = await admin.until((m) => m.t === 'start', 10);
const b2 = await lookalike.until((m) => m.t === 'start', 10);
check(!!a2 && !!b2, 'an admin start takes everyone in the lobby along');

admin.ws.close();
lookalike.ws.close();
console.log(failed ? 'admin start checks FAILED' : 'All admin start checks passed');
process.exit(failed ? 1 : 0);
