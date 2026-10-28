/**
 * Check: the public queue against a running server started with MATCH_SIZE=8 (and a short
 * LOBBY_WAIT). Three players wait and are told one more is needed; neither the countdown nor
 * "Start now with bots" starts a match without four; the fourth starts it (with four computer
 * trainers); asking for ranked (an old client) queues casual.
 *   PORT=8788 SERVER_KIND=dev LOBBY_WAIT=4 MATCH_SIZE=8 node --import tsx server/main.ts &
 *   WS=ws://localhost:8788 npx tsx server/checks/queue.ts
 */
import WebSocket from 'ws';
import type { ClientMsg, ServerMsg } from '../../src/net/protocol';

const WS = process.env.WS ?? 'ws://localhost:8787';
let failed = 0;
const check = (ok: boolean, what: string) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
  if (!ok) failed++;
};

class Guest {
  ws!: WebSocket;
  got: ServerMsg[] = [];
  constructor(readonly name: string) {}
  open(): Promise<void> {
    this.ws = new WebSocket(`${WS}/ws?guest=${this.name}${Date.now()}`);
    this.ws.on('message', (d) => this.got.push(JSON.parse(String(d)) as ServerMsg));
    return this.until((m) => m.t === 'hello').then(() => undefined);
  }
  send(m: ClientMsg): void {
    this.ws.send(JSON.stringify(m));
  }
  async until(test: (m: ServerMsg) => boolean, secs = 20): Promise<ServerMsg> {
    const t0 = Date.now();
    for (;;) {
      const m = this.got.find(test);
      if (m) return m;
      if (Date.now() - t0 > secs * 1000) throw new Error(`${this.name}: timed out`);
      await new Promise((r) => setTimeout(r, 50));
    }
  }
  async queue(mode?: string): Promise<void> {
    this.send({ t: 'roll' });
    await this.until((m) => m.t === 'roll');
    this.send({ t: 'queue', pick: 0, mode } as ClientMsg);
  }
  lastLobby(): Extract<ServerMsg, { t: 'lobby' }> | undefined {
    return [...this.got].reverse().find((m) => m.t === 'lobby') as Extract<ServerMsg, { t: 'lobby' }> | undefined;
  }
}

const gs = ['qa', 'qb', 'qc', 'qd'].map((n) => new Guest(n));
for (const g of gs) await g.open();
// Three in, one of them asking for ranked: all in the same casual lobby.
await gs[0]!.queue();
await gs[1]!.queue('ranked');
await gs[2]!.queue();
await new Promise((r) => setTimeout(r, 1500));
const l = gs[0]!.lastLobby();
check(!!l && l.players.length === 3 && l.mode === 'casual', `three players in one casual lobby (one asked for ranked): ${JSON.stringify(l?.players)}`);
check(l?.need === 1 && l?.min === 4 && l?.startsIn === null, `the lobby says one more is needed (need ${l?.need}, min ${l?.min}, no countdown)`);
// Start now: refused below four. Wait out more than the lobby wait too.
gs[0]!.send({ t: 'startNow' } as ClientMsg);
await new Promise((r) => setTimeout(r, 9000));
check(!gs.some((g) => g.got.some((m) => m.t === 'start')), 'nine seconds on (past the wait), Start now pressed: no match with three');
// The fourth.
await gs[3]!.queue();
const st = (await gs[0]!.until((m) => m.t === 'start', 30)) as Extract<ServerMsg, { t: 'start' }>;
check(st.mode === 'casual' && st.roster.filter((r) => r.human).length === 4 && st.roster.length === 8, `the fourth starts it: ${st.roster.filter((r) => r.human).length} players and ${st.roster.filter((r) => !r.human).length} computer trainers, ${st.mode}`);
for (const g of gs) g.send({ t: 'leave' } as ClientMsg);
for (const g of gs) g.ws.close();
console.log(failed ? `${failed} queue check(s) failed` : 'All queue checks passed');
process.exit(failed ? 1 : 0);
