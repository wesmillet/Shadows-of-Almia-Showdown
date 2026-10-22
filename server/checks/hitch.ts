/**
 * How smooth a running match stays while new ones start: one bot plays and measures the gaps
 * between its updates (20 a second, so 50 ms is perfect), while three more matches start.
 * Matches in workers should barely notice; in one thread each start stalls everyone.
 *   npx tsx server/checks/hitch.ts [http://localhost:8787]   (MATCH_SIZE=2, LOBBY_WAIT short)
 */
import WebSocket from 'ws';
import { randomBytes } from 'node:crypto';
import type { ServerMsg } from '../../src/net/protocol';

const BASE = (process.argv[2] ?? 'http://localhost:8787').replace(/^http/, 'ws');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function bot(measure: boolean): Promise<number[]> {
  return new Promise((resolve) => {
    const ws = new WebSocket(`${BASE}/ws?guest=${randomBytes(12).toString('base64url')}`);
    const gaps: number[] = [];
    let last = 0;
    ws.on('message', (d) => {
      const m = JSON.parse(String(d)) as ServerMsg;
      if (m.t === 'hello') ws.send(JSON.stringify({ t: 'roll' }));
      else if (m.t === 'roll') ws.send(JSON.stringify({ t: 'queue', pick: 0 }));
      else if (m.t === 's' && measure) {
        const now = performance.now();
        if (last) gaps.push(now - last);
        last = now;
      }
    });
    setTimeout(() => {
      ws.close();
      resolve(gaps);
    }, measure ? 16_000 : 12_000);
  });
}

const watched = bot(true);
await sleep(5000);
// Three more matches start while the first runs.
const others = [bot(false), bot(false), bot(false), bot(false), bot(false), bot(false)];
const gaps = (await watched).slice(20);
await Promise.all(others);
gaps.sort((a, b) => a - b);
const pct = (p: number) => Math.round(gaps[Math.floor((gaps.length - 1) * p)] ?? 0);
console.log(JSON.stringify({ updates: gaps.length, medianMs: pct(0.5), p99Ms: pct(0.99), worstMs: Math.round(gaps[gaps.length - 1] ?? 0) }));
