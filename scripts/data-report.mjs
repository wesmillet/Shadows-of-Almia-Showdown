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
  const rows = all('SELECT id, mode, started_at, ended_at, seconds, winner, humans, bots, aborted, trainers FROM match_log ORDER BY started_at');
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
      const b = (bots[t.name] ??= { name: t.name, matches: 0, wins: 0, top3: 0, elims: 0, kos: 0 });
      b.matches++;
      if (r.winner && t.name === r.winner) b.wins++;
      if (t.outcome === 'win') b.top3++;
      b.elims += t.stats?.eliminations ?? 0;
      b.kos += t.stats?.knockouts ?? 0;
    }
  }
  const list = Object.values(bots);
  out.botsTotal = { trainers: list.length, wins: list.reduce((a, b) => a + b.wins, 0), top3: list.reduce((a, b) => a + b.top3, 0) };
  // Where humans finish, and how they are knocked out of a match.
  const places = {};
  for (const r of rows) {
    if (r.aborted || r.mode === 'private') continue;
    let l3; try { l3 = JSON.parse(r.trainers); } catch { continue; }
    for (const t of l3) if (t.human) { const k = t.place <= 3 ? `place${t.place}` : 'place4plus'; places[k] = (places[k] ?? 0) + 1; }
  }
  out.humanPlaces = places;
  out.botsByWins = list.slice().sort((a, b) => b.wins - a.wins || b.elims - a.elims).slice(0, 20);
  out.botsByElims = list.slice().sort((a, b) => b.elims - a.elims || b.wins - a.wins).slice(0, 20);
  // Who wins: humans or computer trainers (finished public matches).
  let humanWins = 0, botWins = 0;
  for (const r of rows) {
    if (r.aborted || r.mode === 'private') continue;
    let list2;
    try { list2 = JSON.parse(r.trainers); } catch { continue; }
    const w = list2.find((t) => r.winner && t.name === r.winner);
    if (w) { if (w.human) humanWins++; else botWins++; }
  }
  out.winners = { humans: humanWins, computer: botWins };
  // How public matches really ended: a player won, one computer trainer was left, or the room
  // closed with several computer trainers still standing (the last player went out first).
  const ends = { playerWon: 0, oneComputerLeft: 0, closedWithSeveralLeft: 0, other: 0 };
  const realBot = {};
  for (const r of rows) {
    if (r.aborted || r.mode === 'private') continue;
    let l4; try { l4 = JSON.parse(r.trainers); } catch { continue; }
    const humanWin = l4.some((t) => t.human && t.outcome === 'win');
    const botsFirst = l4.filter((t) => !t.human && t.place === 1);
    if (humanWin) ends.playerWon++;
    else if (botsFirst.length === 1) { ends.oneComputerLeft++; realBot[botsFirst[0].name] = (realBot[botsFirst[0].name] ?? 0) + 1; }
    else if (botsFirst.length > 1) ends.closedWithSeveralLeft++;
    else ends.other++;
  }
  out.ends = ends;
  out.realComputerWins = realBot;
}
if (has('users')) out.accounts = { total: one('SELECT COUNT(*) n FROM users').n, last7days: one('SELECT COUNT(*) n FROM users WHERE created_at > ?', Date.now() - 7 * 86400_000).n };
if (has('feedback')) out.feedback = all("SELECT kind, status, COUNT(*) n FROM feedback GROUP BY kind, status");
if (has('pc')) {
  // Duplicate legendaries/Mythicals per player (by species line as stored).
  out.pcEntries = one('SELECT COUNT(*) n FROM pc').n;
}
// One player's recent public matches (by their in-game name), for following up a bug report.
const who = (process.env.REPORT_PLAYER || '').trim().toLowerCase();
if (who && has('match_log')) {
  const since = Date.now() - 14 * 86400_000;
  const rows = all('SELECT id, mode, started_at, ended_at, seconds, winner, aborted, trainers FROM match_log WHERE ended_at > ? ORDER BY ended_at', since);
  out.player = [];
  for (const r of rows) {
    let list; try { list = JSON.parse(r.trainers); } catch { continue; }
    const me = list.find((t) => String(t.name).toLowerCase() === who);
    if (!me) continue;
    const replay = has('replays') ? !!one('SELECT 1 FROM replays WHERE id = ?', r.id) : false;
    out.player.push({ id: r.id, mode: r.mode, ended: new Date(Number(r.ended_at)).toISOString(), minutes: +(Number(r.seconds) / 60).toFixed(1), winner: r.winner, replay, place: me.place, outcome: me.outcome, stats: me.stats, team: me.team ?? null });
  }
}
// That player's PC history (collection log) and current PC, for following up a lost-Pokémon or
// lost-shiny report: what was added, traded, released or rewritten, with the stored species and
// shiny flag. Game data only.
if (who && has('users') && has('collection_log')) {
  const u = one('SELECT id FROM users WHERE lower(username) = ?', who);
  if (u) {
    const pick = (d) => { try { const e = typeof d === 'string' ? JSON.parse(d) : d; return e && typeof e === 'object' ? { dex: e.dex, name: e.name, level: e.level, shiny: !!e.shiny, evolvedFrom: e.evolvedFrom, via: e.via } : null; } catch { return null; } };
    out.collection = all('SELECT action, pc_id, other_name, ref, detail, at FROM collection_log WHERE user_id = ? ORDER BY at DESC LIMIT 200', u.id).map((r) => {
      let det = null; try { det = r.detail ? JSON.parse(r.detail) : null; } catch {}
      const d = det && (det.dex || det.name) ? pick(det) : det && det.from ? det : det && det.entry ? pick(det.entry) : null;
      return { at: new Date(Number(r.at)).toISOString(), action: r.action, pcId: r.pc_id, other: r.other_name, ref: r.ref, mon: d };
    });
    out.pcNow = all('SELECT id, entry, created_at FROM pc WHERE user_id = ? ORDER BY id', u.id).map((r) => ({ pcId: r.id, ...pick(r.entry) }));
  }
}
// Shiny sweep (player = SHINY_SWEEP): every account's duplicate shinies, each copy sorted into a
// glitch copy (a win or voucher pick in the PC-starter glitch window, of a line the player already had
// shiny) or a later duplicate. Read-only; usernames, PC ids, species and levels only.
if (who === 'shiny_sweep' && has('pc') && has('users')) {
  const START = Date.parse('2026-11-08T22:31:00Z');
  const FIX = Date.parse('2026-11-12T15:30:00Z');
  const via = new Map();
  if (has('collection_log')) for (const r of all("SELECT pc_id, action, at FROM collection_log WHERE action LIKE 'add%'")) via.set(r.pc_id, { action: r.action, at: Number(r.at) });
  const names = new Map(all('SELECT id, username FROM users').map((u) => [u.id, u.username]));
  const groups = new Map();
  for (const r of all('SELECT id, user_id, entry, created_at FROM pc')) {
    let e; try { e = JSON.parse(r.entry); } catch { continue; }
    if (!e || !e.shiny) continue;
    const k = r.user_id + '|' + e.dex;
    if (!groups.has(k)) groups.set(k, []);
    const v = via.get(r.id);
    groups.get(k).push({ pcId: r.id, dex: e.dex, name: e.name, level: e.level, at: v ? v.at : Number(r.created_at), how: v ? v.action : 'unknown' });
  }
  const players = new Map();
  for (const [k, list] of groups) {
    if (list.length < 2) continue;
    list.sort((a, b) => a.at - b.at || a.pcId - b.pcId);
    const uid = Number(k.split('|')[0]);
    const p = players.get(uid) ?? { player: names.get(uid) ?? String(uid), glitch: [], later: [] };
    for (const x of list.slice(1)) {
      const row = { pcId: x.pcId, name: x.name, dex: x.dex, level: x.level, at: new Date(x.at).toISOString().slice(0, 16), how: x.how };
      if (x.at >= START && x.at <= FIX && /add:(win|voucher)/.test(x.how)) p.glitch.push(row); else p.later.push(row);
    }
    players.set(uid, p);
  }
  out.shinySweep = [...players.values()].filter((p) => p.glitch.length || p.later.length).sort((a, b) => b.glitch.length - a.glitch.length || b.later.length - a.later.length);
}
console.log('REPORT_JSON_START');
console.log(JSON.stringify(out, null, 1));
console.log('REPORT_JSON_END');
