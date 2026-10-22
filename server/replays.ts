/**
 * Replays: every match is recorded as the stream a spectator who sees what every trainer sees
 * would get (nobody's bag), 10 updates a second, gzipped to DATA_DIR/replays/<match>.jsonl.gz. Every
 * KEYFRAME_SECONDS the stream starts over with everything in full, so a viewer can jump anywhere by
 * starting from the keyframe before it.
 *
 * Line 1 is the header ({ v, matchId, seed, mode, roster, startedAt }); then one line per update:
 * { time, p, e } (a keyframe also has k: 1). The oldest replays go once they pass REPLAY_MB in all.
 */
import { createWriteStream, existsSync, mkdirSync, statSync, unlinkSync, type WriteStream } from 'node:fs';
import { join } from 'node:path';
import { createGzip, type Gzip } from 'node:zlib';
import type { BattleEvent } from '../src/sim/battle';
import type { Match } from '../src/sim/match';
import type { RosterEntry } from '../src/net/protocol';
import { newSeat } from '../src/sim/seat';
import { IdTable, SyncEncoder } from '../src/net/sync';
import { PlayerView } from './view';

export const REPLAY_VERSION = 1;
/** Simulation steps per recorded update (60 / 6 = 10 a second). */
export const RECORD_EVERY = 6;
export const KEYFRAME_SECONDS = 30;

export function replayDir(dataDir: string): string {
  const d = join(dataDir, 'replays');
  mkdirSync(d, { recursive: true });
  return d;
}

export function replayFile(dir: string, id: string): string | null {
  if (!/^m[a-z0-9]{1,16}$/.test(id)) return null;
  const f = join(dir, `${id}.jsonl.gz`);
  return existsSync(f) ? f : null;
}

export function deleteReplay(dir: string, id: string): void {
  const f = replayFile(dir, id);
  if (f) unlinkSync(f);
}

export class ReplayRecorder {
  private readonly gz: Gzip;
  private readonly out: WriteStream;
  private readonly view: PlayerView;
  private enc: SyncEncoder;
  private lastKey = -Infinity;
  private events: BattleEvent[] = [];
  readonly file: string;
  readonly startedAt = Date.now();
  private closed = false;

  constructor(dir: string, readonly matchId: string, seed: number, mode: string, roster: RosterEntry[], private readonly match: Match, private readonly ids: IdTable) {
    this.file = join(dir, `${matchId}.jsonl.gz`);
    this.gz = createGzip({ level: 6 });
    this.out = createWriteStream(this.file);
    this.gz.pipe(this.out);
    // What any trainer can see (a replay follows a trainer), nobody's bag (the first trainer only anchors the view).
    const anchor = match.seats[0]?.trainer ?? match.allTrainers[0];
    this.view = new PlayerView(match, newSeat(anchor as NonNullable<typeof anchor>), {
      around: () => {
        const out: Array<{ x: number; y: number }> = [];
        for (const t of match.allTrainers) if (t.alive && !t.visitor) out.push(t);
        for (const s of match.seats) if (s.controlled) out.push(s.controlled);
        return out;
      },
    });
    this.enc = new SyncEncoder(ids, null, { precision: 100 });
    this.write({ v: REPLAY_VERSION, matchId, seed, mode, roster, startedAt: this.startedAt });
  }

  /** This step's events (kept until the next recorded update). */
  collect(evs: BattleEvent[]): void {
    for (const e of evs) if (!(e.type === 'notice' && e.to !== undefined)) this.events.push(e);
  }

  /** A recorded update (call every RECORD_EVERY steps). */
  frame(): void {
    if (this.closed) return;
    const key = this.match.time - this.lastKey >= KEYFRAME_SECONDS;
    if (key) {
      this.enc = new SyncEncoder(this.ids, null, { precision: 100 });
      this.lastKey = this.match.time;
    }
    const p = this.enc.encode(this.view.build(), this.view.visible);
    const e: Array<Record<string, unknown>> = [];
    for (const ev of this.events) {
      const x = this.enc.encodeEvent(ev);
      if (x) e.push(x);
    }
    this.events = [];
    this.write(key ? { k: 1, time: Math.round(this.match.time * 100) / 100, p, e } : { time: Math.round(this.match.time * 100) / 100, p, e });
  }

  private write(o: unknown): void {
    this.gz.write(`${JSON.stringify(o)}\n`);
  }

  /** Finishes the file; resolves with its size. */
  close(): Promise<number> {
    if (this.closed) return Promise.resolve(0);
    this.closed = true;
    return new Promise((res) => {
      this.out.on('close', () => res(existsSync(this.file) ? statSync(this.file).size : 0));
      this.gz.end();
    });
  }
}
