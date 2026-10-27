/**
 * Launch-readiness check against a running server (MATCH_SIZE=2 LOBBY_WAIT=3 npm run server):
 * a solo queue fills with bots and starts; queueing without a roll answers instead of hanging;
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

function client(key: string): { ws: WebSocket; got: (t: string, timeout?: number) => Promise<Record<string, unknown>>; send: (m: unknown) => void; msgs: Array<Record<string, unknown>>; closedWith: () => number | null } {
  const ws = new WebSocket(`${WS}?guest=${key}`);
  const msgs: Array<Record<string, unknown>> = [];
  let closeCode: number | null = null;
  ws.on('message', (d) => msgs.push(JSON.parse(String(d))));
  ws.on('close', (code) => (closeCode = code));
  return {
    ws,
    msgs,
    closedWith: () => closeCode,
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
  await a.got('lobby');
  check(true, 'lobby joined');
  const t0 = Date.now();
  a.send({ t: 'startNow' });
  const start = await a.got('start', 10000);
  check(Date.now() - t0 < 6000, `start now pulled the match forward (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  check(typeof start.matchId === 'string' || typeof start.matchId === 'number', 'match started with bot fill');
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
  const tab2 = client(key);
  await tab2.got('hello');
  await sleep(600);
  check(a.closedWith() === 4000, `first tab closed with 4000 (got ${a.closedWith()})`);
  const restart2 = await tab2.got('start', 5000).catch(() => null);
  check(restart2 && restart2.matchId === start.matchId, 'second tab resumed the same match');
  tab2.send({ t: 'leave' });
  tab2.ws.close();
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.log('FAIL', e.message);
  process.exit(1);
});
