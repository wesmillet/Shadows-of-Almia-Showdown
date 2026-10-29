/**
 * Launch-readiness check against a running server (MATCH_SIZE=2 LOBBY_WAIT=3 npm run server):
 * a lobby with the real players it needs (half the match) fills with bots and starts; queueing without a roll answers instead of hanging;
 * a dropped connection rejoins inside the reconnect window with the room still alive; a second
 * tab takes the session over (the first is closed with 4000) and resumes the same match.
 *
 *   npx tsx server/checks/launch_check.ts [http://localhost:8787]
 */
import WebSocket from 'ws';

const WS = (process.argv[2] ?? 'http://localhost:8787').replace(/^http/, 'ws') + '/ws';
let failed = false;
const check = (ok: unknown, what: string) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
  if (!ok) failed = true;
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function client(key: string): { ws: WebSocket; got: (t: string, timeout?: number) => Promise<Record<string, unknown>>; send: (m: unknown) => void; msgs: Array<Record<string, unknown>>; closedWith: () => number | null; closedAt: () => number | null; closeReason: () => string } {
  const ws = new WebSocket(`${WS}?guest=${key}`);
  const msgs: Array<Record<string, unknown>> = [];
  let closeCode: number | null = null;
  let closeAt: number | null = null;
  let reason = '';
  ws.on('message', (d) => msgs.push(JSON.parse(String(d))));
  ws.on('close', (code, why) => {
    closeCode = code;
    closeAt = Date.now();
    reason = String(why);
  });
  return {
    ws,
    msgs,
    closedWith: () => closeCode,
    closedAt: () => closeAt,
    closeReason: () => reason,
    send: (m) => ws.send(JSON.stringify(m)),
    got: async (t, timeout = 8000) => {
      const t0 = Date.now();
      for (;;) {
        const m = msgs.find((x) => x.t === t);
        if (m) return m;
        if (Date.now() - t0 > timeout) throw new Error(`timed out waiting for ${t}`);
        await sleep(50);
      }
    },
  };
}

(async () => {
  const key = 'checkkey' + Math.random().toString(36).slice(2).padEnd(18, 'x');
  let a = client(key);
  await a.got('hello');
  a.send({ t: 'roll' });
  const roll = await a.got('roll');
  check(typeof roll.seed === 'number', 'roll came back');
  a.send({ t: 'queue', pick: 0, mode: 'casual' });
  const lobby = await a.got('lobby');
  check(true, 'lobby joined');
  // a match needs `need` more real players before it starts: bring them in (they leave once it starts)
  const extra: Array<ReturnType<typeof client>> = [];
  for (let i = 0; i < Number(lobby.need ?? 0); i++) {
    const c = client('check-fill-' + i + Math.random().toString(36).slice(2, 8));
    await c.got('hello');
    c.send({ t: 'roll' });
    await c.got('roll');
    c.send({ t: 'queue', pick: 0, mode: 'casual' });
    extra.push(c);
  }
  if (extra.length) {
    await sleep(800);
    check(true, `${extra.length} more trainer${extra.length === 1 ? '' : 's'} joined (a match needs half its seats)`);
  }
  const t0 = Date.now();
  a.send({ t: 'startNow' });
  const start = await a.got('start', 10000);
  check(Date.now() - t0 < 6000, `start now pulled the match forward (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  check(typeof start.matchId === 'string' || typeof start.matchId === 'number', 'match started with bot fill');
  for (const c of extra) {
    c.send({ t: 'leave' });
    c.ws.close();
  }
  await a.got('s', 5000);
  check(true, 'state updates flowing');
  // queue with no roll: must answer, not hang
  const b0 = client('check-noroll-' + Math.random().toString(36).slice(2, 6));
  await b0.got('hello');
  b0.send({ t: 'queue', pick: 0, mode: 'casual' });
  const unq = await b0.got('unqueued', 4000).catch(() => null);
  check(unq, 'queue with no roll answers (unqueued)');
  b0.ws.close();
  // drop and rejoin inside the window
  a.ws.close();
  await sleep(2500);
  a = client(key);
  await a.got('hello');
  const restart = await a.got('start', 6000).catch(() => null);
  if (!restart) console.log('   after rejoin, messages were:', JSON.stringify(a.msgs.map((m) => m.t)));
  check(restart && restart.matchId === start.matchId, 'room survived the drop and resumed the match');
  if (restart) {
    a.msgs.length = 0;
    await a.got('s', 5000);
    check(true, 'state flowing again after rejoin');
  }
  // a second tab takes over: the first gets 4000
  // The server closes the first tab as soon as the second says hello, but the 'close' event only
  // fires once the closing handshake is done, which over a real network (and Fly's proxy) can take
  // longer than on localhost: wait for the event itself (up to 10 s) and report how long it took.
  const tab2 = client(key);
  await tab2.got('hello');
  const helloAt = Date.now();
  // The server's 'error'-free takeover: the old tab is told nothing else first.
  while (a.closedWith() === null && Date.now() - helloAt < 10_000) await sleep(25);
  const took = a.closedAt() !== null ? `${(a.closedAt() as number) - helloAt} ms after the second tab's hello` : 'no close within 10 s';
  check(a.closedWith() === 4000, `first tab closed with 4000 (got ${a.closedWith()}${a.closeReason() ? `, "${a.closeReason()}"` : ''}; ${took})`);
  const restart2 = await tab2.got('start', 5000).catch(() => null);
  check(restart2 && restart2.matchId === start.matchId, 'second tab resumed the same match');
  tab2.send({ t: 'leave' });
  tab2.ws.close();
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.log('FAIL', e.message);
  process.exit(1);
});
