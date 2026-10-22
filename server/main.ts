/**
 * The game server: one program that serves the game's pages and art, runs every online match, the
 * matchmaking, parties, private lobbies, spectating and replays (server/hub.ts), the global chat,
 * and (server/accounts.ts) players' accounts and saves.
 *
 *   npm run server            # development (port 8787, short lobby wait)
 *   node dist-server/main.js  # production, after npm run build:server
 *
 * Settings come from the environment: PORT, SERVER_KIND (live | demo | dev), LOBBY_WAIT (seconds),
 * MATCH_SIZE, DIST_DIR (the built client), ASSETS_DIR, DATA_DIR (the database).
 */
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';
import { WebSocketServer, type WebSocket } from 'ws';
import type { ClientMsg, ServerMsg } from '../src/net/protocol';
import { Chat } from './chat';
import { Hub, type Client } from './hub';
import { replayDir, replayFile } from './replays';
import { notFoundPage, profilePage } from './profilePage';
import { STEP, type RoomHooks } from './room';
import { loadWorld } from './world';
import { Accounts } from './accounts';

const ROOT = resolve(import.meta.dirname, '..');
const PORT = Number(process.env.PORT ?? 8787);
const KIND = (process.env.SERVER_KIND ?? 'dev') as 'live' | 'demo' | 'dev';
const DIST = process.env.DIST_DIR ?? join(ROOT, 'dist');
const ASSETS = process.env.ASSETS_DIR ?? join(ROOT, 'assets');
const DATA = process.env.DATA_DIR ?? join(ROOT, '.data');
const SIZE = Number(process.env.MATCH_SIZE ?? 8);
const WAIT = Number(process.env.LOBBY_WAIT ?? (KIND === 'live' ? 60 : 15));
/** Ranked waits longer for real players before filling up with computer trainers. */
const RANKED_WAIT = Number(process.env.RANKED_WAIT ?? (KIND === 'live' ? 120 : WAIT * 2));
const BUILD = (process.env.BUILD_ID ?? 'local').slice(0, 7);
/** Messages a browser may send per second before it is cut off (a normal player sends about 25). */
const MSG_RATE = 120;
/** Testing only: pretend every message takes this long each way (to try the game on a slow connection). */
const LAG = KIND === 'live' ? 0 : Number(process.env.SIM_LATENCY_MS ?? 0);

const log = (...a: unknown[]) => console.log(new Date().toISOString(), ...a);

log(`Loading the world (${KIND})...`);
const world = await loadWorld(ASSETS);
const accounts = new Accounts(DATA, KIND);
log(`World ready: ${world.map.cols}x${world.map.rows}`);

// ---------------------------------------------------------------- connections

/** Account ids by player key (guests have none: nothing of theirs is kept). */
const accountOf = (key: string): number | null => (key.startsWith('u') ? Number(key.slice(1)) : null);

const roomHooks: RoomHooks = {
  rareChest: process.env.RARE_CHEST ? process.env.RARE_CHEST === '1' : KIND !== 'live',
  cluster: KIND !== 'live' && process.env.DEV_CLUSTER === '1',
  chestLoad: (key) => {
    const id = accountOf(key);
    return id === null ? [] : accounts.loadChest(id);
  },
  chestSave: (key, box) => {
    const id = accountOf(key);
    if (id !== null) accounts.saveChest(id, box);
  },
  extracted: (key, mon, matchId) => {
    const id = accountOf(key);
    if (id !== null) accounts.addToPc(id, Accounts.pcFields(mon), 'voucher', matchId);
  },
};

const REPLAYS = process.env.REPLAYS !== '0';
const REPLAY_DIR = REPLAYS ? replayDir(DATA) : null;
const hub = new Hub({
  world, accounts, size: SIZE, wait: { casual: WAIT, ranked: RANKED_WAIT }, hooks: roomHooks,
  replayDir: REPLAY_DIR, replayBytes: Number(process.env.REPLAY_MB ?? 400) * 1024 * 1024, log,
});
const chat = new Chat((msg) => {
  for (const c of hub.clients.values()) c.send(msg);
}, accounts);

interface Conn extends Client {
  ws: WebSocket;
  msgs: number;
}

function onMessage(c: Conn, raw: string): void {
  let msg: ClientMsg;
  try {
    msg = JSON.parse(raw) as ClientMsg;
  } catch {
    return;
  }
  if (!msg || typeof msg !== 'object' || typeof msg.t !== 'string') return;
  if (msg.t === 'ping') return c.send({ t: 'pong', at: msg.at });
  if (msg.t === 'chat') return chat.say(c, msg.text);
  hub.message(c, msg);
}

// ---------------------------------------------------------------- web

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json',
  '.xml': 'application/xml', '.txt': 'text/plain; charset=utf-8', '.ttf': 'font/ttf', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};

function serveStatic(req: IncomingMessage, res: ServerResponse): void {
  const url = (req.url ?? '/').split('?')[0] ?? '/';
  let rel = normalize(decodeURIComponent(url)).replace(/^([/\\])+/, '');
  if (!rel) rel = 'index.html';
  let file = join(DIST, rel);
  if (!file.startsWith(DIST)) {
    res.writeHead(403).end();
    return;
  }
  if (!existsSync(file) || !statSync(file).isFile()) {
    if (rel.startsWith('assets/')) {
      res.writeHead(404).end('not found');
      return;
    }
    file = join(DIST, 'index.html');
  }
  const ext = extname(file);
  // Built scripts carry a content hash in their name: cache them for good. Art changes with deploys: an hour.
  const cache = rel.startsWith('assets/') && /-[A-Za-z0-9_-]{8}\.(js|css)$/.test(rel) ? 'public, max-age=31536000, immutable' : ext === '.html' ? 'no-cache' : 'public, max-age=3600';
  res.writeHead(200, { 'Content-Type': TYPES[ext] ?? 'application/octet-stream', 'Cache-Control': cache, 'X-Content-Type-Options': 'nosniff' });
  createReadStream(file).pipe(res);
}

const http = createServer((req, res) => {
  const url = req.url ?? '/';
  if (url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ ok: true, kind: KIND, build: BUILD, ...hub.stats() }));
    return;
  }
  if (url.startsWith('/u/') && req.method === 'GET') {
    // A trainer's public profile page (to share outside the game).
    const name = decodeURIComponent(url.slice(3).split(/[?#]/)[0] ?? '').slice(0, 32);
    const u = accounts.db.prepare('SELECT * FROM users WHERE username = ?').get(name) as Parameters<Accounts['publicProfile']>[0] | undefined;
    const html = u && !u.banned ? profilePage(accounts.publicProfile(u), ASSETS) : notFoundPage(name);
    res.writeHead(u && !u.banned ? 200 : 404, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'self'; style-src 'unsafe-inline' 'self'; img-src 'self'" }).end(html);
    return;
  }
  if (url.startsWith('/api/replay/') && req.method === 'GET') {
    // A replay file: gzipped JSON lines, which the browser unpacks on the way in.
    const id = decodeURIComponent(url.slice('/api/replay/'.length).split('?')[0] ?? '');
    const file = REPLAY_DIR && accounts.hasReplay(id) ? replayFile(REPLAY_DIR, id) : null;
    if (!file) {
      res.writeHead(404, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: 'No such replay' }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/x-ndjson', 'Content-Encoding': 'gzip', 'Cache-Control': 'public, max-age=86400', 'Content-Length': statSync(file).size });
    createReadStream(file).pipe(res);
    return;
  }
  if (url.startsWith('/api/')) {
    void accounts.handle(req, res);
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405).end();
    return;
  }
  serveStatic(req, res);
});

// Updates are JSON with the same field names over and over: compression (keeping its dictionary
// between messages) cuts them to a fraction. Level 3 is quick; small messages go as they are.
const wss = new WebSocketServer({
  noServer: true,
  maxPayload: 16 * 1024,
  perMessageDeflate: { zlibDeflateOptions: { level: 3, memLevel: 7 }, serverMaxWindowBits: 13, clientNoContextTakeover: true, threshold: 200, concurrencyLimit: 16 },
});
http.on('upgrade', (req, socket, head) => {
  if (!(req.url ?? '').startsWith('/ws')) {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => void connect(ws, req));
});

async function connect(ws: WebSocket, req: IncomingMessage): Promise<void> {
  const who = await accounts.identify(req);
  const key = who.key;
  // The same player connecting twice (a second tab): the older connection goes.
  const old = hub.clients.get(key) as Conn | undefined;
  if (old) {
    hub.disconnect(old);
    old.ws.close(4000, 'Opened in another tab');
  }
  const c: Conn = {
    ws, key, name: who.name, look: who.look, title: who.title, accountId: who.accountId, guest: who.accountId === null, rollSeed: null, rollPool: [], room: null, msgs: 0,
    watching: null, party: null, invites: new Set(), private: null, pick: null, shown: '',
    send(msg: ServerMsg) {
      if (ws.readyState !== ws.OPEN) return;
      const data = JSON.stringify(msg);
      if (LAG) setTimeout(() => ws.readyState === ws.OPEN && ws.send(data), LAG);
      else ws.send(data);
    },
  };
  c.send({ t: 'hello', name: c.name, guest: c.guest, server: KIND, build: BUILD });
  chat.history(c);
  hub.connect(c);
  ws.on('message', (data) => {
    if (++c.msgs > MSG_RATE) {
      ws.close(4001, 'Too many messages');
      return;
    }
    const raw = String(data);
    if (LAG) setTimeout(() => onMessage(c, raw), LAG);
    else onMessage(c, raw);
  });
  ws.on('close', () => hub.disconnect(c));
}

// ---------------------------------------------------------------- the clock

let last = performance.now();
let acc = 0;
setInterval(() => {
  const now = performance.now();
  acc += Math.min(0.25, (now - last) / 1000);
  last = now;
  while (acc >= STEP) {
    acc -= STEP;
    for (const r of hub.rooms) {
      try {
        r.step();
      } catch (e) {
        log(`Match ${r.id} crashed:`, e);
        hub.rooms.delete(r);
      }
    }
  }
  hub.tick(Date.now());
}, 4);
setInterval(() => {
  for (const c of hub.clients.values()) (c as Conn).msgs = 0;
}, 1000);

http.listen(PORT, () => log(`Shadows of Almia Showdown server (${KIND}) on :${PORT}`));
