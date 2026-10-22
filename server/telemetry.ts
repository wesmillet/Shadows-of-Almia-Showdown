/**
 * Keeping an eye on the server: alerts (a Discord or Slack webhook), an error log (the server's and
 * players' browsers', grouped by kind), and metrics (Prometheus text for Fly's Grafana, and a
 * rolling hour of samples for the moderators' Server tab).
 *
 *   ALERT_WEBHOOK_URL   a Discord or Slack incoming webhook: deploys, new kinds of errors, a match
 *                       crashing, the server falling behind, backups failing
 *   METRICS_PORT        where /metrics is served (default 9091; internal only, fly.toml [metrics])
 */
import { createServer } from 'node:http';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import type { DatabaseSync } from 'node:sqlite';

// ---------------------------------------------------------------- alerts

export class Alerts {
  private readonly url = process.env.ALERT_WEBHOOK_URL ?? '';
  private last = new Map<string, number>();

  constructor(private readonly kind: string, private readonly log: (...a: unknown[]) => void) {}

  /** Sends an alert (the same `key` at most once every 10 minutes). */
  send(key: string, text: string): void {
    const now = Date.now();
    if (now - (this.last.get(key) ?? 0) < 10 * 60_000) return;
    this.last.set(key, now);
    this.log(`ALERT ${key}: ${text}`);
    if (!this.url) return;
    const body = `[${this.kind}] ${text}`.slice(0, 1900);
    // Discord reads "content", Slack reads "text".
    void fetch(this.url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: body, text: body }) }).catch(() => {});
  }
}

// ---------------------------------------------------------------- errors

export interface ErrorRow {
  key: string;
  source: string;
  message: string;
  stack: string;
  context: string;
  count: number;
  first_at: number;
  last_at: number;
}

/** Errors, grouped by where they come from and what they say (counted, with the latest context). */
export class ErrorLog {
  total = 0;

  constructor(private readonly db: DatabaseSync, private readonly alerts: Alerts) {
    db.exec(`CREATE TABLE IF NOT EXISTS errors (
      key TEXT PRIMARY KEY, source TEXT NOT NULL, message TEXT NOT NULL, stack TEXT NOT NULL, context TEXT NOT NULL,
      count INTEGER NOT NULL, first_at INTEGER NOT NULL, last_at INTEGER NOT NULL
    )`);
  }

  record(source: string, err: unknown, context: Record<string, unknown> = {}): void {
    this.total++;
    const e = err instanceof Error ? err : new Error(String(err));
    const message = e.message.slice(0, 300);
    const stack = (e.stack ?? '').split('\n').slice(0, 12).join('\n').slice(0, 2000);
    // The same error: the same message from the same place (the first line of the stack below it).
    const at = (e.stack ?? '').split('\n').find((l) => l.trim().startsWith('at ')) ?? '';
    const key = `${source}|${message.replace(/\d+/g, 'N')}|${at.trim().replace(/:\d+:\d+\)?$/, '')}`.slice(0, 400);
    const now = Date.now();
    const ctx = JSON.stringify(context).slice(0, 1000);
    const seen = this.db.prepare('SELECT count FROM errors WHERE key = ?').get(key) as { count: number } | undefined;
    if (seen) this.db.prepare('UPDATE errors SET count = count + 1, last_at = ?, context = ?, stack = ? WHERE key = ?').run(now, ctx, stack, key);
    else {
      this.db.prepare('INSERT INTO errors (key, source, message, stack, context, count, first_at, last_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?)').run(key, source, message, stack, ctx, now, now);
      // A kind of error not seen before is worth a look.
      this.alerts.send(`error:${key}`, `New ${source} error: ${message}\n${at.trim()}`);
    }
  }

  recent(limit = 100): ErrorRow[] {
    return this.db.prepare('SELECT * FROM errors ORDER BY last_at DESC LIMIT ?').all(limit) as unknown as ErrorRow[];
  }

  clear(key: string): void {
    this.db.prepare('DELETE FROM errors WHERE key = ?').run(key);
  }
}

// ---------------------------------------------------------------- metrics

export interface Sample {
  at: number;
  players: number;
  rooms: number;
  queued: number;
  watching: number;
  /** Simulation milliseconds per step (all rooms), average and worst over the interval. */
  stepAvg: number;
  stepMax: number;
  /** How late the clock's ticks ran (ms, worst over the interval). */
  lag: number;
  /** Messages a second, in and out. */
  msgIn: number;
  msgOut: number;
  /** Kilobytes a second sent (before compression). */
  kbOut: number;
  rssMb: number;
  heapMb: number;
}

export class Metrics {
  readonly started = Date.now();
  readonly counters = { matchesStarted: 0, matchesEnded: 0, matchesAborted: 0, msgIn: 0, msgOut: 0, bytesOut: 0, connections: 0 };
  private steps = { n: 0, total: 0, max: 0 };
  private lagMax = 0;
  private window = { msgIn: 0, msgOut: 0, bytesOut: 0, at: Date.now() };
  readonly samples: Sample[] = [];
  private readonly loop = monitorEventLoopDelay({ resolution: 10 });

  constructor(private readonly live: () => { players: number; rooms: number; queued: number; watching: number; dbBytes: number; replayBytes: number; errors: number }) {
    this.loop.enable();
  }

  step(ms: number): void {
    this.steps.n++;
    this.steps.total += ms;
    if (ms > this.steps.max) this.steps.max = ms;
  }

  /** Steps timed elsewhere (a match worker's last second). */
  addSteps(n: number, total: number, max: number): void {
    this.steps.n += n;
    this.steps.total += total;
    if (max > this.steps.max) this.steps.max = max;
  }

  lag(ms: number): void {
    if (ms > this.lagMax) this.lagMax = ms;
  }

  sent(bytes: number): void {
    this.counters.msgOut++;
    this.counters.bytesOut += bytes;
  }

  received(): void {
    this.counters.msgIn++;
  }

  /** Takes a sample (every 10 s); keeps the last hour. */
  sample(): Sample {
    const now = Date.now();
    const secs = Math.max(0.001, (now - this.window.at) / 1000);
    const l = this.live();
    const mem = process.memoryUsage();
    const s: Sample = {
      at: now, players: l.players, rooms: l.rooms, queued: l.queued, watching: l.watching,
      stepAvg: this.steps.n ? +(this.steps.total / this.steps.n).toFixed(3) : 0, stepMax: +this.steps.max.toFixed(2), lag: Math.round(this.lagMax),
      msgIn: Math.round((this.counters.msgIn - this.window.msgIn) / secs), msgOut: Math.round((this.counters.msgOut - this.window.msgOut) / secs),
      kbOut: +((this.counters.bytesOut - this.window.bytesOut) / 1024 / secs).toFixed(1),
      rssMb: Math.round(mem.rss / 1048576), heapMb: Math.round(mem.heapUsed / 1048576),
    };
    this.samples.push(s);
    if (this.samples.length > 360) this.samples.shift();
    this.steps = { n: 0, total: 0, max: 0 };
    this.lagMax = 0;
    this.window = { msgIn: this.counters.msgIn, msgOut: this.counters.msgOut, bytesOut: this.counters.bytesOut, at: now };
    return s;
  }

  /** Prometheus text format (for Fly's metrics, fly.toml [metrics]). */
  prometheus(): string {
    const s = this.samples[this.samples.length - 1];
    const l = this.live();
    const lines: string[] = [];
    const g = (name: string, help: string, v: number, type = 'gauge') => lines.push(`# HELP almia_${name} ${help}`, `# TYPE almia_${name} ${type}`, `almia_${name} ${v}`);
    g('players', 'Connected players', l.players);
    g('rooms', 'Matches running', l.rooms);
    g('queued', 'Players in the queues', l.queued);
    g('watching', 'Spectators', l.watching);
    g('step_ms_avg', 'Simulation ms per step (last 10 s)', s?.stepAvg ?? 0);
    g('step_ms_max', 'Worst simulation step (last 10 s)', s?.stepMax ?? 0);
    g('tick_lag_ms', 'How late the clock ran (last 10 s)', s?.lag ?? 0);
    g('event_loop_p99_ms', 'Event loop delay, 99th percentile', +(this.loop.percentile(99) / 1e6).toFixed(2));
    g('rss_bytes', 'Resident memory', process.memoryUsage().rss);
    g('db_bytes', 'Database size', l.dbBytes);
    g('replay_bytes', 'Replays on disk', l.replayBytes);
    g('matches_started_total', 'Matches started', this.counters.matchesStarted, 'counter');
    g('matches_ended_total', 'Matches finished', this.counters.matchesEnded, 'counter');
    g('matches_aborted_total', 'Matches called off', this.counters.matchesAborted, 'counter');
    g('messages_in_total', 'WebSocket messages received', this.counters.msgIn, 'counter');
    g('messages_out_total', 'WebSocket messages sent', this.counters.msgOut, 'counter');
    g('bytes_out_total', 'Bytes sent (before compression)', this.counters.bytesOut, 'counter');
    g('connections_total', 'Connections opened', this.counters.connections, 'counter');
    g('errors_total', 'Errors recorded', l.errors, 'counter');
    g('uptime_seconds', 'Seconds since start', Math.round((Date.now() - this.started) / 1000));
    return `${lines.join('\n')}\n`;
  }

  /** Serves /metrics on its own port (kept off the public one). */
  serve(port: number, log: (...a: unknown[]) => void): void {
    const srv = createServer((req, res) => {
      if (req.url === '/metrics') res.writeHead(200, { 'Content-Type': 'text/plain; version=0.0.4' }).end(this.prometheus());
      else res.writeHead(404).end();
    });
    // Metrics are optional: a taken port only costs them.
    srv.on('error', (e) => log('Metrics not served:', e.message));
    srv.listen(port, () => log(`Metrics on :${port}/metrics`));
  }
}
