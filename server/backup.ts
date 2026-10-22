/**
 * Continuous backups of the database (accounts, PCs, ratings, everything but replays).
 *
 * Every BACKUP_MINUTES (15) the database is copied with SQLite's online backup (a few pages at a
 * time, so matches never stall), gzipped, and kept:
 *   - on the volume: DATA_DIR/backups, the last 8 and one a day for a week;
 *   - off the machine, when S3 storage is set up (server/s3.ts; `fly storage create` does it):
 *     <kind>/latest.db.gz (every time), <kind>/hourly/<HH>.db.gz (the last 24 hours) and
 *     <kind>/daily/<YYYY-MM-DD>.db.gz (one a day, kept until a bucket rule removes them).
 *
 * So at worst 15 minutes are lost. Restoring: `node dist-server/admin.js restore <file or s3 key>`
 * with the server stopped (docs/online.md).
 */
import { mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { backup, type DatabaseSync } from 'node:sqlite';
import { promisify } from 'node:util';
import { gzip } from 'node:zlib';
import { s3Put, type S3Config } from './s3';

const gz = promisify(gzip);

export interface BackupResult {
  file: string;
  bytes: number;
  uploaded: string[];
  ms: number;
}

export class Backups {
  private readonly dir: string;
  private lastHour = '';
  private lastDay = '';
  private failures = 0;
  last: (BackupResult & { at: number }) | null = null;
  lastError: string | null = null;
  private running = false;

  constructor(
    private readonly db: DatabaseSync,
    dataDir: string,
    private readonly kind: string,
    private readonly s3: S3Config | null,
    private readonly onFail: (text: string) => void,
    private readonly log: (...a: unknown[]) => void,
  ) {
    this.dir = join(dataDir, 'backups');
    mkdirSync(this.dir, { recursive: true });
  }

  /** Backs up now and then every `minutes`. */
  start(minutes: number): void {
    const run = () => void this.run().catch(() => {});
    setTimeout(run, 60_000).unref();
    setInterval(run, minutes * 60_000).unref();
  }

  async run(): Promise<BackupResult | null> {
    if (this.running) return null;
    this.running = true;
    const t0 = performance.now();
    const now = new Date();
    const stamp = now.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 13);
    const raw = join(this.dir, `.almia-${stamp}.db`);
    try {
      await backup(this.db, raw, { rate: 200 });
      const zipped = await gz(readFileSync(raw), { level: 6 });
      unlinkSync(raw);
      const file = join(this.dir, `almia-${stamp}.db.gz`);
      writeFileSync(file, zipped);
      this.prune();
      const uploaded: string[] = [];
      if (this.s3) {
        const hour = String(now.getUTCHours()).padStart(2, '0');
        const day = now.toISOString().slice(0, 10);
        const put = async (key: string) => {
          await s3Put(this.s3 as S3Config, `${this.kind}/${key}`, zipped, 'application/gzip');
          uploaded.push(key);
        };
        await put('latest.db.gz');
        if (hour !== this.lastHour) await put(`hourly/${hour}.db.gz`);
        if (day !== this.lastDay) await put(`daily/${day}.db.gz`);
        this.lastHour = hour;
        this.lastDay = day;
      }
      const r = { file, bytes: zipped.length, uploaded, ms: Math.round(performance.now() - t0) };
      this.last = { ...r, at: Date.now() };
      this.lastError = null;
      this.failures = 0;
      return r;
    } catch (e) {
      this.failures++;
      this.lastError = String(e instanceof Error ? e.message : e);
      this.log('Backup failed:', this.lastError);
      // Twice in a row is worth waking someone for.
      if (this.failures >= 2) this.onFail(`Backups are failing: ${this.lastError}`);
      try {
        unlinkSync(raw);
      } catch {
        // nothing half-written left
      }
      return null;
    } finally {
      this.running = false;
    }
  }

  /** Local copies: the newest 8, plus the newest of each of the last 7 days. */
  private prune(): void {
    const files = readdirSync(this.dir).filter((f) => /^almia-\d{8}-\d{4}\.db\.gz$/.test(f)).sort().reverse();
    const keep = new Set(files.slice(0, 8));
    const days = new Set<string>();
    for (const f of files) {
      const day = f.slice(6, 14);
      if (days.size < 7 && !days.has(day)) {
        days.add(day);
        keep.add(f);
      }
    }
    for (const f of files) if (!keep.has(f)) unlinkSync(join(this.dir, f));
  }

  /** What is on the volume (newest first), for the moderators' Server tab. */
  list(): Array<{ name: string; bytes: number; at: number }> {
    return readdirSync(this.dir)
      .filter((f) => f.endsWith('.db.gz'))
      .map((f) => ({ name: f, bytes: statSync(join(this.dir, f)).size, at: statSync(join(this.dir, f)).mtimeMs }))
      .sort((a, b) => b.at - a.at);
  }
}
