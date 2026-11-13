// Read-only report on the live database (DATA_DIR/almia.db), run on the Fly machine by the
// "Data report" workflow. Opens the file read-only and prints totals as JSON. It never reads
// passwords, password hashes, session tokens, emails or other secrets.
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';

const db = new DatabaseSync(join(process.env.DATA_DIR || '/data', 'almia.db'), { readOnly: true });
const all = (sql, ...a) => db.prepare(sql).all(...a);
const one = (sql, ...a) => db.prepare(sql).get(...a);
const has = (t) => !!one("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", t);
const out = { at: new Date().toISOString() };

if (has('match_log')) {
  const rows = all('SELECT id, mode, started_at, ended_at, seconds, humans, bots, aborted, trainers FROM match_log ORDER BY started_at');
  out.matches = { total: rows.length, aborted: rows.filter((r) => r.aborted).length, since: rows[0] ? new Date(Number(rows[0].ended_at)).toISOString() : null };
  // Per day: matches, average length, average humans and computer trainers.
  const days = {};
  for (const r of rows) {
    const d = new Date(Number(r.started_at)).toISOString().slice(0, 10);
    const x = (days[d] ??= { matches: 0, seconds: 0, humans: 0, bots: 0, private: 0 });
    x.matches++;
    x.seconds += Number(r.seconds) || 0;
    x.humans += Number(r.humans) || 0;
    x.bots += Number(r.bots) || 0;
    if (r.mode === 'private') x.private++;
  }
  out.byDay = Object.fromEntries(Object.entries(days).map(([d, x]) => [d, { matches: x.matches, avgMinutes: +(x.seconds / x.matches / 60).toFixed(1), avgHumans: +(x.humans / x.matches).toFixed(1), avgBots: +(x.bots / x.matches).toFixed(1), private: x.private }]));
  // How many ran at once: the peak, and per hour (UTC) of the last 3 days the most at once.
  const ev = [];
  for (const r of rows) if (r.started_at && r.ended_at) { ev.push([Number(r.started_at), 1]); ev.push([Number(r.ended_at), -1]); }
  ev.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let cur = 0, peak = 0, peakAt = 0;
  const hourly = {};
  const cutoff = Date.now() - 3 * 86400_000;
  for (const [t, d] of ev) {
    cur += d;
    if (cur > peak) { peak = cur; peakAt = t; }
    if (t >= cutoff) { const h = new Date(t).toISOString().slice(0, 13); hourly[h] = Math.max(hourly[h] ?? 0, cur); }
  }
  out.concurrent = { peak, peakAt: peakAt ? new Date(peakAt).toISOString() : null, maxPerHourLast3Days: hourly };
  // Computer trainers: wins and eliminations (finished public matches).
  const bots = {};
  for (const r of rows) {
    if (r.aborted || r.mode === 'private') continue;
    let list;
    try { list = JSON.parse(r.trainers); } catch { continue; }
    for (const t of list) {
      if (t.human) continue;
      const b = (bots[t.name] ??= { name: t.name, matches: 0, wins: 0, elims: 0, kos: 0 });
      b.matches++;
      if (t.outcome === 'win') b.wins++;
      b.elims += t.stats?.eliminations ?? 0;
      b.kos += t.stats?.knockouts ?? 0;
    }
  }
  const list = Object.values(bots);
  out.botsTotal = { trainers: list.length, wins: list.reduce((a, b) => a + b.wins, 0) };
  out.botsByWins = list.slice().sort((a, b) => b.wins - a.wins || b.elims - a.elims).slice(0, 20);
  out.botsByElims = list.slice().sort((a, b) => b.elims - a.elims || b.wins - a.wins).slice(0, 20);
  // Who wins: humans or computer trainers (finished public matches).
  let humanWins = 0, botWins = 0;
  for (const r of rows) {
    if (r.aborted || r.mode === 'private') continue;
    let list2;
    try { list2 = JSON.parse(r.trainers); } catch { continue; }
    const w = list2.find((t) => t.outcome === 'win');
    if (w) { if (w.human) humanWins++; else botWins++; }
  }
  out.winners = { humans: humanWins, computer: botWins };
}
if (has('users')) out.accounts = { total: one('SELECT COUNT(*) n FROM users').n, last7days: one('SELECT COUNT(*) n FROM users WHERE created_at > ?', Date.now() - 7 * 86400_000).n };
if (has('feedback')) out.feedback = all("SELECT kind, status, COUNT(*) n FROM feedback GROUP BY kind, status");
if (has('pc')) {
  // Duplicate legendaries/Mythicals per player (by species line as stored).
  out.pcEntries = one('SELECT COUNT(*) n FROM pc').n;
}
console.log('REPORT_JSON_START');
console.log(JSON.stringify(out, null, 1));
console.log('REPORT_JSON_END');
