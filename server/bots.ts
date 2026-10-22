/**
 * Load test and protocol check: N fake players connect to a running server, roll, queue, play a
 * match through the network (wandering and casting), and decode every update with the browser's
 * own SyncDecoder. Prints bandwidth and what each saw.
 *
 *   npx tsx server/bots.ts [players=3] [seconds=60] [url=ws://127.0.0.1:8787/ws]
 */
import WebSocket from 'ws';
import { randomBytes } from 'node:crypto';
import type { ServerMsg } from '../src/net/protocol';
import { SyncDecoder } from '../src/net/sync';

const N = Number(process.argv[2] ?? 3);
const SECONDS = Number(process.argv[3] ?? 60);
const URL = process.argv[4] ?? 'ws://127.0.0.1:8787/ws';

interface Bot {
  name: string;
  bytes: number;
  /** Bytes read from the network (after compression). */
  wire?: number;
  snaps: number;
  events: number;
  notices: string[];
  replies: string[];
  you: number;
  outcome: string | null;
  dec: SyncDecoder;
  errors: string[];
  maxObjects: number;
}

const bots: Bot[] = [];
const t0 = Date.now();
await Promise.all(Array.from({ length: N }, (_, i) => new Promise<void>((done) => {
  const ws = new WebSocket(`${URL}?guest=${randomBytes(12).toString('base64url')}`);
  const bot: Bot = { name: '', bytes: 0, snaps: 0, events: 0, notices: [], replies: [], you: 0, outcome: null, dec: new SyncDecoder(), errors: [], maxObjects: 0 };
  bots.push(bot);
  const send = (m: unknown) => ws.readyState === ws.OPEN && ws.send(JSON.stringify(m));
  let timer: NodeJS.Timeout | null = null;
  let n = 0;
  ws.on('message', (data) => {
    const raw = String(data);
    bot.bytes += raw.length;
    const msg = JSON.parse(raw) as ServerMsg;
    if (msg.t === 'hello') {
      bot.name = msg.name;
      send({ t: 'roll' });
    } else if (msg.t === 'roll') send({ t: 'queue', pick: i % 3 });
    else if (msg.t === 'start') {
      bot.you = msg.you;
      timer = setInterval(() => {
        n++;
        if (n % 40 === 1) {
          const a = Math.random() * Math.PI * 2;
          send({ t: 'in', mx: Math.cos(a), my: Math.sin(a) });
        }
        if (n % 15 === 0) send({ t: 'cmd', c: 'cast', a: [n % 2] });
        if (n % 90 === 0) send({ t: 'cmd', c: 'interact', a: [] });
      }, 50);
    } else if (msg.t === 's') {
      bot.snaps++;
      try {
        bot.dec.apply(msg.p);
      } catch (e) {
        bot.errors.push(String(e));
      }
      bot.maxObjects = Math.max(bot.maxObjects, bot.dec.objects.size);
      bot.events += msg.e.length;
      for (const e of msg.e) if (e.type === 'notice') bot.notices.push(String(e.text));
    } else if (msg.t === 'reply') bot.replies.push(msg.text);
    else if (msg.t === 'end') bot.outcome = `${msg.outcome} #${msg.place}`;
  });
  ws.on('error', (e) => bot.errors.push(String(e)));
  setTimeout(() => {
    if (timer) clearInterval(timer);
    bot.wire = (ws as unknown as { _socket?: { bytesRead: number } })._socket?.bytesRead ?? 0;
    ws.close();
    done();
  }, SECONDS * 1000);
})));

const secs = (Date.now() - t0) / 1000;
for (const b of bots) {
  // What actually crossed the network (compressed), next to the size of the messages themselves.
  const wire = b.wire ?? 0;
  const root = b.dec.root as { trainers?: unknown[]; wilds?: unknown[]; seat?: { trainer?: { name?: string; x?: number; y?: number; party?: Array<{ name?: string; hp?: number }> } } } | null;
  const me = root?.seat?.trainer;
  console.log(JSON.stringify({
    bot: b.name, kbPerSec: +(b.bytes / 1024 / secs).toFixed(1), wireKbPerSec: +(wire / 1024 / secs).toFixed(1), snaps: b.snaps, events: b.events, objects: b.dec.objects.size, maxObjects: b.maxObjects,
    me: me ? `${me.name} @ ${me.x?.toFixed(1)},${me.y?.toFixed(1)} party ${me.party?.map((p) => `${p?.name}:${p?.hp}`).join('/')}` : null,
    seeTrainers: root?.trainers?.length, seeWilds: root?.wilds?.length, outcome: b.outcome,
    notices: b.notices.slice(0, 4), replies: [...new Set(b.replies)].slice(0, 4), errors: b.errors.slice(0, 3),
  }));
}
process.exit(0);
