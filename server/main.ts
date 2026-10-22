/**
 * The game server: one program that serves the game's pages and art, runs every online match, the
 * matchmaking lobby and the global chat, and (server/accounts.ts) players' accounts and saves.
 *
 *   npm run server            # development (port 8787, short lobby wait)
 *   node dist-server/main.js  # production, after npm run build:server
 *
 * Settings come from the environment: PORT, SERVER_KIND (live | demo | dev), LOBBY_WAIT (seconds),
 * MATCH_SIZE, DIST_DIR (the built client), ASSETS_DIR, DATA_DIR (the database).
 */
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomBytes, randomInt } from 'node:crypto';
import { extname, join, normalize, resolve } from 'node:path';
import { WebSocketServer, type WebSocket } from 'ws';
import type { ClientMsg, ServerMsg } from '../src/net/protocol';
import { starterChoices, unlockedFromPc } from '../src/sim/starters';
import { Chat } from './chat';
import { Lobby, type Queued } from './lobby';
import { Room, STEP, type Peer, type RoomHooks, type RoomResult } from './room';
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

interface Conn extends Peer {
  ws: WebSocket;
  accountId: number | null;
  guest: boolean;
  rollSeed: number | null;
  /** The starters this player's roll was drawn from (their PC's unlocks). */
  rollPool: string[];
  room: Room | null;
  msgs: number;
}

const conns = new Map<string, Conn>();
const rooms = new Set<Room>();
const chat = new Chat((msg) => {
  for (const c of conns.values()) c.send(msg);
}, accounts);

const lobby = new Lobby({
  size: SIZE,
  waitSeconds: WAIT,
  fullSeconds: 3,
  start: (players: Queued[]) => {
    const seed = randomInt(1, 2 ** 31);
    const room = new Room(world, players.map((q) => ({ name: q.peer.name, starter: q.starter, peer: q.peer })), SIZE, seed, roomHooks, endRoom);
    rooms.add(room);
    for (const q of players) {
      const c = conns.get(q.peer.key);
      if (c) c.room = room;
    }
    log(`Match ${room.id}: ${players.length} player(s), ${SIZE - players.length} computer trainer(s)`);
  },
});

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

function endRoom(room: Room, results: RoomResult[]): void {
  rooms.delete(room);
  for (const c of conns.values()) if (c.room === room) c.room = null;
  accounts.recordMatch(room.id, results);
  log(`Match ${room.id} over: ${results.map((r) => `${r.name} #${r.place}`).join(', ')}`);
}

function onMessage(c: Conn, raw: string): void {
  let msg: ClientMsg;
  try {
    msg = JSON.parse(raw) as ClientMsg;
  } catch {
    return;
  }
  if (!msg || typeof msg !== 'object' || typeof msg.t !== 'string') return;
  switch (msg.t) {
    case 'ping':
      c.send({ t: 'pong', at: msg.at });
      return;
    case 'chat':
      chat.say(c, msg.text);
      return;
    case 'roll':
      if (c.room) return;
      c.rollSeed = randomInt(1, 2 ** 31);
      // A signed-in player's pool grows with their PC; a guest rolls from the starting pool.
      c.rollPool = c.accountId === null ? [] : unlockedFromPc(accounts.pcDexes(c.accountId));
      c.send({ t: 'roll', seed: c.rollSeed, pool: c.rollPool });
      return;
    case 'queue': {
      if (c.room || c.rollSeed === null) return;
      const choices = starterChoices(c.rollSeed, c.rollPool);
      const pick = typeof msg.pick === 'number' && Number.isInteger(msg.pick) ? choices[msg.pick] : undefined;
      if (!pick) return c.send({ t: 'error', text: 'Pick one of the starters you rolled' });
      lobby.join({ peer: c, starter: pick }, Date.now());
      return;
    }
    case 'leaveQueue':
      lobby.leave(c.key);
      return;
    default:
      c.room?.receive(c.key, msg);
  }
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
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ ok: true, kind: KIND, build: BUILD, rooms: rooms.size, players: conns.size, queued: lobby.waiting }));
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

const wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 });
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
  conns.get(key)?.ws.close(4000, 'Opened in another tab');
  const c: Conn = {
    ws, key, name: who.name, look: who.look, accountId: who.accountId, guest: who.accountId === null, rollSeed: null, rollPool: [], room: null, msgs: 0,
    send(msg: ServerMsg) {
      if (ws.readyState !== ws.OPEN) return;
      const data = JSON.stringify(msg);
      if (LAG) setTimeout(() => ws.readyState === ws.OPEN && ws.send(data), LAG);
      else ws.send(data);
    },
  };
  conns.set(key, c);
  c.send({ t: 'hello', name: c.name, guest: c.guest, server: KIND, build: BUILD });
  chat.history(c);
  // Back after a dropped connection: straight into the match still running.
  for (const r of rooms) {
    if (r.has(key)) {
      c.room = r;
      r.rejoin(c);
    }
  }
  ws.on('message', (data) => {
    if (++c.msgs > MSG_RATE) {
      ws.close(4001, 'Too many messages');
      return;
    }
    const raw = String(data);
    if (LAG) setTimeout(() => onMessage(c, raw), LAG);
    else onMessage(c, raw);
  });
  ws.on('close', () => {
    if (conns.get(key) !== c) return;
    conns.delete(key);
    lobby.leave(key);
    c.room?.disconnect(key);
  });
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
    for (const r of rooms) {
      try {
        r.step();
      } catch (e) {
        log(`Match ${r.id} crashed:`, e);
        rooms.delete(r);
      }
    }
  }
  lobby.tick(Date.now());
}, 4);
setInterval(() => {
  for (const c of conns.values()) c.msgs = 0;
}, 1000);

http.listen(PORT, () => log(`Shadows of Almia Showdown server (${KIND}) on :${PORT}`));
