/**
 * A match worker (server/remoteRoom.ts starts them): loads the world once, then runs the matches it
 * is given, each an ordinary Room (server/room.ts), on its own 60 Hz clock. Players' messages
 * arrive from the main thread; everything a match sends goes back there to be delivered.
 */
import { parentPort, workerData } from 'node:worker_threads';
import { loadWorld } from './world';
import { Room, STEP, type Peer, type RoomHooks } from './room';
import { ReplayRecorder } from './replays';
import type { FromWorker, PeerInfo, RoomState, ToWorker } from './remoteRoom';
import type { ServerMsg } from '../src/net/protocol';

const port = parentPort;
if (!port) throw new Error('roomWorker runs as a worker thread');
const post = (m: FromWorker) => port.postMessage(m);

const world = await loadWorld((workerData as { assets: string }).assets);
const rooms = new Map<string, Room>();

/** One stand-in per player (or spectator): what a Room sends them goes to the main thread. */
const peers = new Map<string, Peer>();
function peer(p: PeerInfo): Peer {
  let x = peers.get(p.key);
  if (!x) {
    x = { key: p.key, name: p.name, look: p.look, title: p.title, send: (msg: ServerMsg) => post({ ev: 'send', key: p.key, data: JSON.stringify(msg) }) };
    peers.set(p.key, x);
  }
  return x;
}

function state(r: Room): RoomState {
  const playing: string[] = [];
  const trainerIds: Record<string, number> = {};
  for (const key of r.playerKeys()) {
    if (r.playing(key)) playing.push(key);
    const id = r.trainerIdOf(key);
    if (id !== undefined) trainerIds[key] = id;
  }
  return { time: r.time, closed: r.closed, humansIn: r.humansIn, watcherCount: r.watcherCount, botCount: r.botCount, playing, trainerIds, roster: r.roster, watchers: r.watcherKeys() };
}

port.on('message', (m: ToWorker) => {
  try {
    if (m.op === 'create') return create(m);
    const r = rooms.get(m.room);
    if (!r) return;
    switch (m.op) {
      case 'receive':
        return r.receive(m.key, m.msg);
      case 'disconnect':
        return r.disconnect(m.key);
      case 'rejoin':
        return r.rejoin(peer(m.peer));
      case 'spectate':
        r.spectate(peer(m.peer), m.follow);
        return post({ ev: 'state', room: r.id, state: state(r) });
      case 'unspectate':
        return r.unspectate(m.key);
      case 'follow':
        return r.follow(m.key, m.trainerId, m.step);
      case 'abort':
        return r.abort(m.text);
    }
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    post({ ev: 'error', room: 'room' in m ? m.room : '', message: err.message, stack: err.stack ?? '', time: 0 });
  }
});

function create(m: Extract<ToWorker, { op: 'create' }>): void {
  const hooks: RoomHooks = {
    rareChest: m.hooks.rareChest,
    cluster: m.hooks.cluster,
    chestLoad: (key) => m.chests[key] ?? [],
    chestSave: (key, box) => post({ ev: 'chestSave', key, box }),
    extracted: (key, mon, matchId) => post({ ev: 'extracted', key, mon, matchId }),
    flagged: (key, name, matchId, summary) => post({ ev: 'flagged', key, name, matchId, summary }),
  };
  const s = m.spec;
  const dir = s.replayDir;
  const room = new Room(
    world,
    s.entries.map((e) => ({ name: e.name, starter: e.starter, team: e.team, peer: peer(e) })),
    s.size,
    s.seed,
    hooks,
    (r, report) => {
      rooms.delete(r.id);
      void report.replay.then((replay) => post({ ev: 'end', room: r.id, results: report.results, botPlaces: report.botPlaces, flags: report.flags, aborted: report.aborted, replay }));
    },
    { ...s.opts, recorder: dir ? (r) => new ReplayRecorder(dir, r.id, s.seed, s.opts.mode, r.roster, r.match, r.ids) : undefined },
  );
  rooms.set(room.id, room);
  post({ ev: 'state', room: room.id, state: state(room) });
}

// ---------------------------------------------------------------- the clock

let last = performance.now();
let acc = 0;
let n = 0;
let total = 0;
let max = 0;
setInterval(() => {
  const now = performance.now();
  acc += Math.min(0.25, (now - last) / 1000);
  last = now;
  while (acc >= STEP) {
    acc -= STEP;
    if (!rooms.size) continue;
    const t0 = performance.now();
    for (const r of [...rooms.values()]) {
      try {
        r.step();
      } catch (e) {
        // This match only: called off (nothing counted), the others go on.
        const err = e instanceof Error ? e : new Error(String(e));
        post({ ev: 'error', room: r.id, message: err.message, stack: err.stack ?? '', time: r.time });
        try {
          r.abort('Something went wrong in this match, so it was called off. Nothing was lost. Sorry!');
        } catch {
          rooms.delete(r.id);
        }
      }
    }
    const ms = performance.now() - t0;
    n++;
    total += ms;
    if (ms > max) max = ms;
  }
}, 4);

// Twice a second: each match's state (who is still in, watchers, the clock) for the hub.
setInterval(() => {
  for (const r of rooms.values()) post({ ev: 'state', room: r.id, state: state(r) });
}, 500);
// Once a second: step timings for the server's metrics.
setInterval(() => {
  post({ ev: 'stats', n, total, max });
  n = 0;
  total = 0;
  max = 0;
}, 1000);

post({ ev: 'ready' });
