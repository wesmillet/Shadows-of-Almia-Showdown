/**
 * The game server: one program that serves the game's pages and art, runs every online match, the
 * matchmaking, parties, private lobbies, spectating and replays (server/hub.ts), the global chat,
 * and (server/accounts.ts) players' accounts and saves.
 *
 *   npm run server            # development (port 8787, short lobby wait)
 *   node dist-server/main.js  # production, after npm run build:server
 *
 * Settings come from the environment: PORT, SERVER_KIND (live | demo | dev), LOBBY_WAIT (seconds),
 * MATCH_SIZE, DIST_DIR (the built client), ASSETS_DIR, DATA_DIR (the database); and for running it
 * (docs/online.md): OPS_TOKEN, ALERT_WEBHOOK_URL, METRICS_PORT, BACKUP_MINUTES, the S3 variables,
 * DRAIN_SECONDS.
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
import { ModApi } from './modApi';
import { MOD_PAGE } from './modPage';
import { privacyPage } from './privacyPage';
import { Room, STEP, type RoomHooks } from './room';
import { loadWorld } from './world';
import { Accounts, clientIp } from './accounts';
import { Alerts, ErrorLog, Metrics } from './telemetry';
import { Backups } from './backup';
import { s3FromEnv } from './s3';
import { Events } from './events';
import { WorkerPool } from './remoteRoom';
import { timingSafeEqual } from 'node:crypto';

const ROOT = resolve(import.meta.dirname, '..');
const PORT = Number(process.env.PORT ?? 8787);
// On Fly the kind must be set: a missing SERVER_KIND would quietly run the live app as dev
// (tester chest on, looser limits).
if (process.env.FLY_APP_NAME && !process.env.SERVER_KIND) {
  console.error('SERVER_KIND is not set (live, demo or dev): refusing to start on Fly without it.');
  process.exit(1);
}
const KIND = (process.env.SERVER_KIND ?? 'dev') as 'live' | 'demo' | 'dev';
const DIST = process.env.DIST_DIR ?? join(ROOT, 'dist');
const ASSETS = process.env.ASSETS_DIR ?? join(ROOT, 'assets');
const DATA = process.env.DATA_DIR ?? join(ROOT, '.data');
const SIZE = Number(process.env.MATCH_SIZE ?? 8);
const WAIT = Number(process.env.LOBBY_WAIT ?? (KIND === 'live' ? 60 : 15));
/**
 * Real players a public lobby needs before computer trainers fill the rest: half the lobby (four of
 * eight). MIN_PLAYERS may lower it for testing, but never on the live server.
 */
const HALF = Math.ceil(SIZE / 2);
const MIN_PLAYERS = KIND === 'live' ? Math.max(HALF, Number(process.env.MIN_PLAYERS ?? HALF)) : Number(process.env.MIN_PLAYERS ?? HALF);
const BUILD = (process.env.BUILD_ID ?? 'local').slice(0, 7);
/** Messages a browser may send per second before it is cut off (a normal player sends about 25). */
const MSG_RATE = 120;
/** Testing only: pretend every message takes this long each way (to try the game on a slow connection). */
const LAG = KIND === 'live' ? 0 : Number(process.env.SIM_LATENCY_MS ?? 0);

const log = (...a: unknown[]) => console.log(new Date().toISOString(), ...a);
/** A shared secret for /api/ops (the deploy workflow drains the server with it). */
const OPS_TOKEN = process.env.OPS_TOKEN ?? '';
/** On shutdown, matches get this long to finish before they are called off (fly.toml kill_timeout is longer). */
const DRAIN_SECONDS = Number(process.env.DRAIN_SECONDS ?? 240);

log(`Loading the world (${KIND})...`);
const world = await loadWorld(ASSETS);
const accounts = new Accounts(DATA, KIND);
const alerts = new Alerts(KIND, log);
const errors = new ErrorLog(accounts.db, alerts);
accounts.onError = (e, ctx) => errors.record('api', e, ctx);
// Nothing a bug does should take every match down with it: recorded, and the server carries on.
process.on('uncaughtException', (e) => {
  log('Uncaught:', e);
  errors.record('server', e);
});
process.on('unhandledRejection', (e) => {
  log('Unhandled rejection:', e);
  errors.record('server', e);
});
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
    if (id !== null) accounts.addToPc(id, mon, 'voucher', matchId);
  },
  flagged: (key, name, matchId, summary) => {
    log(`Flagged ${name} (${key}) in ${matchId}: ${summary}`);
    accounts.autoReport(name, `Automatic: impossible actions in match ${matchId} (${summary})`);
  },
};

const REPLAYS = process.env.REPLAYS !== '0';
const REPLAY_DIR = REPLAYS ? replayDir(DATA) : null;
const metrics: Metrics = new Metrics(() => {
  const st = hub.stats();
  return {
    players: st.players, rooms: st.rooms, queued: st.queued.casual, watching: st.watching, errors: errors.total,
    dbBytes: fileSize(join(DATA, 'almia.db')) + fileSize(join(DATA, 'almia.db-wal')), replayBytes: replayBytes,
  };
});
let replayBytes = 0;
/** Matches run in worker threads (ROOM_WORKERS of them; 0 runs them in this thread). */
const WORKERS = process.env.ROOM_WORKERS !== undefined ? Number(process.env.ROOM_WORKERS) : WorkerPool.defaultSize();
const pool: WorkerPool | null = WORKERS > 0
  ? new WorkerPool(WORKERS, {
    assets: ASSETS, hooks: roomHooks, log,
    deliver: (key, data) => (hub.clients.get(key) as Conn | undefined)?.sendRaw(data),
    onError: (message, stack, context) => {
      const e = new Error(message);
      e.stack = stack;
      log(`Match ${String(context.match ?? '')} failed:`, message);
      errors.record('match', e, context);
      alerts.send(`crash:${String(context.match ?? message)}`, `Match ${String(context.match ?? '?')} crashed and was called off: ${message}`);
    },
    onStats: (n, total, max) => metrics.addSteps(n, total, max),
  })
  : null;
const hub: Hub = new Hub({
  makeRoom: pool?.factory(),
  world, accounts, size: SIZE, wait: { casual: WAIT }, minPlayers: MIN_PLAYERS, hooks: roomHooks,
  replayDir: REPLAY_DIR, replayBytes: Number(process.env.REPLAY_MB ?? 400) * 1024 * 1024, log,
  onMatchStart: () => metrics.counters.matchesStarted++,
  onMatchEnd: (_r, report) => {
    if (report.aborted) metrics.counters.matchesAborted++;
    else metrics.counters.matchesEnded++;
  },
});
// A password change or a recovery closes the account's game connections (the browser signs in again).
accounts.onSignedOut = (userId, reason) => {
  const c = hub.clients.get(`u${userId}`) as Conn | undefined;
  if (!c) return;
  c.send({ t: 'error', text: reason });
  c.ws.close(4003, reason.slice(0, 100));
};
const chat = new Chat((msg) => {
  for (const c of hub.clients.values()) c.send(msg);
}, accounts);
const events = new Events(
  accounts.db,
  (active) => {
    const msg: ServerMsg = { t: 'events', active: active.map((e) => ({ name: e.name, kind: e.kind, value: e.value, endsAt: e.endsAt })) };
    for (const c of hub.clients.values()) c.send(msg);
  },
  (text) => chat.announce(text),
);
hub.events = events;
const s3 = s3FromEnv();
const backups = new Backups(accounts.db, DATA, KIND, s3, (text) => alerts.send('backup', text), log);
if (KIND !== 'dev' || process.env.BACKUP_MINUTES) backups.start(Number(process.env.BACKUP_MINUTES ?? 15));
log(`Backups: every ${process.env.BACKUP_MINUTES ?? 15} min on the volume${s3 ? ` and to s3://${s3.bucket}` : ' (no S3 storage set up)'}`);

function fileSize(f: string): number {
  try {
    return statSync(f).size;
  } catch {
    return 0;
  }
}
const modApi = new ModApi(accounts, {
  matches: () => [...hub.rooms].map((r) => ({ id: r.id, mode: r.mode, time: r.time, players: r.roster.filter((x) => x.human).map((x) => x.name), watchers: r.watcherCount })),
  online: () => hub.clients.size,
  kick: (userId, reason) => {
    const c = hub.clients.get(`u${userId}`) as Conn | undefined;
    if (!c) return;
    c.send({ t: 'error', text: reason });
    c.ws.close(4003, reason.slice(0, 100));
  },
  removeChat: (id) => chat.remove(id),
  announce: (text) => chat.announce(text),
  server: () => ({
    kind: KIND, build: BUILD, startedAt: metrics.started, draining: hub.draining, samples: metrics.samples, counters: metrics.counters, workers: pool?.status() ?? null,
    errors: errors.recent(60), backups: { last: backups.last, lastError: backups.lastError, s3: s3 ? s3.bucket : null, local: backups.list().slice(0, 10) },
  }),
  drain: (on) => hub.drain(on),
  backupNow: () => backups.run(),
  clearError: (key) => errors.clear(key),
  events,
});

interface Conn extends Client {
  ws: WebSocket;
  msgs: number;
  /** A message already turned into JSON (from a match worker). */
  sendRaw(data: string): void;
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
  try {
    hub.message(c, msg);
  } catch (e) {
    errors.record('message', e, { t: msg.t, player: c.name });
  }
}

/** /api/ops: for the deploy workflow (Authorization: Bearer OPS_TOKEN). */
async function ops(req: IncomingMessage, res: ServerResponse, path: string): Promise<void> {
  const send = (status: number, body: unknown): void => {
    res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(JSON.stringify(body));
  };
  const given = Buffer.from(String(req.headers.authorization ?? '').replace(/^Bearer /, ''));
  const want = Buffer.from(OPS_TOKEN);
  if (!OPS_TOKEN || given.length !== want.length || !timingSafeEqual(given, want)) return send(403, { error: 'Not allowed' });
  if (req.method === 'POST' && (path === '/api/ops/drain' || path === '/api/ops/undrain')) {
    const on = path === '/api/ops/drain';
    hub.drain(on);
    if (on) chat.announce('The server is updating in a few minutes. Matches running now will finish; new ones start right after.');
    log(on ? 'Draining for an update' : 'Draining stopped');
    return send(200, { ok: true, ...hub.stats() });
  }
  if (req.method === 'POST' && path === '/api/ops/backup') return send(200, { ok: true, backup: await backups.run() });
  return send(404, { error: 'Not found' });
}

/** A browser's own errors (the game threw): kept with the server's, a few per visitor. */
const clientErrorBudget = new Map<string, number>();
setInterval(() => clientErrorBudget.clear(), 3600_000).unref();
async function clientError(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const ip = clientIp(req);
  const n = (clientErrorBudget.get(ip) ?? 0) + 1;
  clientErrorBudget.set(ip, n);
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 8192) break;
  }
  if (n <= 20) {
    try {
      const b = JSON.parse(body) as { message?: string; stack?: string; build?: string; where?: string };
      const e = new Error(String(b.message ?? 'unknown').slice(0, 300));
      e.stack = `Error: ${e.message}\n${String(b.stack ?? '').slice(0, 1500)}`;
      errors.record('client', e, { build: String(b.build ?? '').slice(0, 20), where: String(b.where ?? '').slice(0, 100), agent: String(req.headers['user-agent'] ?? '').slice(0, 120) });
    } catch {
      // not worth keeping
    }
  }
  res.writeHead(204).end();
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
  if (url.startsWith('/api/ops/')) {
    void ops(req, res, url.split('?')[0] as string);
    return;
  }
  if (url === '/api/client-error' && req.method === 'POST') {
    void clientError(req, res);
    return;
  }
  if (url.split('?')[0] === '/privacy' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=3600' }).end(privacyPage(process.env.PRIVACY_CONTACT ?? null));
    return;
  }
  if (url.split('?')[0] === '/mod' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Frame-Options': 'DENY', 'X-Content-Type-Options': 'nosniff' }).end(MOD_PAGE);
    return;
  }
  if (url.startsWith('/api/mod/')) {
    void modApi.handle(req, res, url.split('?')[0] as string, new URL(url, 'http://x'));
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
    const viewer = accounts.userFromRequest(req);
    const file = REPLAY_DIR && accounts.canWatchReplay(id, viewer?.id ?? null) ? replayFile(REPLAY_DIR, id) : null;
    if (!file) {
      res.writeHead(404, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: 'No such replay' }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/x-ndjson', 'Content-Encoding': 'gzip', 'Cache-Control': 'private, max-age=86400', 'Content-Length': statSync(file).size });
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
/** Game connections one address may hold at once (a family or a dorm shares one; a script does not need fifty). */
const MAX_PER_IP = Number(process.env.MAX_PER_IP ?? (KIND === 'live' ? 12 : 64));
const perIp = new Map<string, number>();

/** On the live server a browser page from another site may not open a game connection. */
function originOk(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (KIND !== 'live' || !origin) return true;
  try {
    const host = new URL(origin).host;
    const allowed = new Set([req.headers.host, process.env.PUBLIC_URL ? new URL(process.env.PUBLIC_URL).host : undefined].filter(Boolean));
    return allowed.has(host);
  } catch {
    return false;
  }
}

http.on('upgrade', (req, socket, head) => {
  if (!(req.url ?? '').startsWith('/ws') || !originOk(req)) {
    socket.destroy();
    return;
  }
  const ip = clientIp(req);
  if ((perIp.get(ip) ?? 0) >= MAX_PER_IP) {
    socket.end('HTTP/1.1 429 Too Many Requests\r\n\r\n');
    return;
  }
  perIp.set(ip, (perIp.get(ip) ?? 0) + 1);
  let counted = true;
  const release = () => {
    if (!counted) return;
    counted = false;
    const n = (perIp.get(ip) ?? 1) - 1;
    if (n <= 0) perIp.delete(ip);
    else perIp.set(ip, n);
  };
  socket.once('close', release);
  wss.handleUpgrade(req, socket, head, (ws) => {
    ws.once('close', release);
    void connect(ws, req);
  });
});

async function connect(ws: WebSocket, req: IncomingMessage): Promise<void> {
  // A frame over maxPayload (or any socket error) closes this connection, and only this one.
  ws.on('error', () => ws.terminate());
  const who = await accounts.identify(req);
  if (who.banned) {
    // A banned device or address: told why, and nothing else.
    ws.send(JSON.stringify({ t: 'error', text: `You can not play from here (${who.banned})` }));
    ws.close(4003, 'banned');
    return;
  }
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
      this.sendRaw(JSON.stringify(msg));
    },
    sendRaw(data: string) {
      if (ws.readyState !== ws.OPEN) return;
      // A stalled client never draining its socket would pile up 20 updates a second in memory.
      if (ws.bufferedAmount > 2 * 1024 * 1024) {
        ws.terminate();
        return;
      }
      metrics.sent(data.length);
      if (LAG) setTimeout(() => ws.readyState === ws.OPEN && ws.send(data), LAG);
      else ws.send(data);
    },
  };
  c.send({ t: 'hello', name: c.name, guest: c.guest, server: KIND, build: BUILD });
  chat.history(c);
  hub.connect(c);
  metrics.counters.connections++;
  ws.on('pong', () => {
    (c as Conn & { heartbeatDue?: boolean }).heartbeatDue = false;
  });
  ws.on('message', (data) => {
    (c as Conn & { heartbeatDue?: boolean }).heartbeatDue = false;
    metrics.received();
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
  // A tick is due every 4 ms; how late this one is says whether the server keeps up.
  metrics.lag(now - last - 4);
  acc += Math.min(0.25, (now - last) / 1000);
  last = now;
  while (acc >= STEP) {
    acc -= STEP;
    const t0 = performance.now();
    for (const r of hub.rooms) {
      // Matches in workers keep their own clocks; this thread steps its own.
      if (!(r instanceof Room)) continue;
      try {
        r.step();
      } catch (e) {
        // One match failing: recorded, called off for its players (nothing lost), the rest go on.
        log(`Match ${r.id} crashed:`, e);
        errors.record('match', e, { match: r.id, time: r.time });
        alerts.send(`crash:${r.id}`, `Match ${r.id} crashed and was called off: ${e instanceof Error ? e.message : e}`);
        try {
          r.abort('Something went wrong in this match, so it was called off. It does not count as a loss, and anything you took out of your storage chest is back in it. Sorry!');
        } catch {
          hub.rooms.delete(r);
        }
      }
    }
    if (hub.rooms.size) metrics.step(performance.now() - t0);
  }
  hub.tick(Date.now());
}, 4);
setInterval(() => {
  for (const c of hub.clients.values()) (c as Conn).msgs = 0;
}, 1000);
// Dead connections (sleep, dropped wifi) never fire 'close' on their own: ping every 15 s and
// terminate whoever missed the last one. The client pings every 3 s anyway, so a live line always
// has traffic; this is the backstop.
setInterval(() => {
  for (const c of hub.clients.values()) {
    const conn = c as Conn & { heartbeatDue?: boolean };
    const ws = conn.ws;
    if (ws.readyState !== ws.OPEN) continue;
    if (conn.heartbeatDue) {
      ws.terminate();
      continue;
    }
    conn.heartbeatDue = true;
    ws.ping();
  }
}, 15_000).unref();
setInterval(() => events.tick(), 5000).unref();
// Every 10 s: a sample for the dashboard, and a word if the server keeps falling behind.
let slowSamples = 0;
setInterval(() => {
  const s = metrics.sample();
  replayBytes = REPLAY_DIR ? accounts.replayBytes() : 0;
  // 60 steps a second must fit in a second; past ~70% of it, matches start to stutter. One slow
  // moment (a match being set up) is normal: half a minute of it is not.
  slowSamples = s.rooms && (s.stepAvg * 60 > 700 || s.lag > 100) ? slowSamples + 1 : 0;
  if (slowSamples >= 3) alerts.send('slow', `The server is falling behind: ${s.stepAvg.toFixed(2)} ms a step over ${s.rooms} matches, ticks up to ${s.lag} ms late, for 30 s. Time for a bigger machine (fly scale vm).`);
}, 10_000).unref();
metrics.serve(Number(process.env.METRICS_PORT ?? 9091), log);

// Not being able to listen (the port taken) is the one error the server does not survive.
http.on('error', (e) => {
  log('Can not serve:', e);
  process.exit(1);
});
http.listen(PORT, () => {
  log(`Shadows of Almia Showdown server (${KIND}, build ${BUILD}) on :${PORT}`);
  if (KIND !== 'dev') alerts.send(`start:${BUILD}`, `Server started (build ${BUILD})`);
});

// ---------------------------------------------------------------- shutting down

/**
 * Fly stops the machine with SIGTERM (a deploy, a restart). No new matches start; the ones running
 * get DRAIN_SECONDS to finish, then are called off with nothing counted. Replays and a last backup
 * are written, and the database closed cleanly.
 */
let stopping = false;
async function shutdown(signal: string): Promise<void> {
  if (stopping) return;
  stopping = true;
  log(`${signal}: draining (${hub.rooms.size} match(es) running)`);
  hub.drain(true);
  if (hub.rooms.size) chat.announce('The server is restarting soon. Matches running now have a few minutes to finish.');
  const until = Date.now() + DRAIN_SECONDS * 1000;
  while (hub.rooms.size && Date.now() < until) await new Promise((r) => setTimeout(r, 1000));
  if (hub.rooms.size) {
    log(`Calling off ${hub.rooms.size} match(es)`);
    hub.shutdown('The server is restarting for an update, so this match was called off. It does not count as a loss, and anything you took out of your storage chest is back in it.');
  }
  // Replays finishing, messages going out.
  await new Promise((r) => setTimeout(r, 1500));
  await backups.run();
  await pool?.stop();
  for (const c of hub.clients.values()) (c as Conn).ws.close(1012, 'Server restarting');
  try {
    accounts.db.close();
  } catch {
    // already closed
  }
  log('Stopped cleanly');
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
