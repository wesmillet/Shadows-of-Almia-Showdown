/**
 * Moderation and upkeep, run on the server (on Fly: fly ssh console -C "node dist-server/admin.js reports").
 *
 *   reports                 open chat reports, newest first
 *   resolve <id>            mark a report handled
 *   player <name>           an account: when it joined, stats, ban and mute
 *   mute <name> <minutes>   no chatting for a while (0 lifts it)
 *   ban <name>              signed out everywhere, can not sign in or chat
 *   unban <name>
 *   delete <name>           removes the account and everything kept for it (a player's request)
 *   chat [n]                the last n chat messages
 *   mod <name>              makes an account a moderator (the dashboard at /mod, a MOD badge in chat)
 *   admin <name>            an administrator (also sets roles and deletes accounts from the dashboard)
 *   player-role <name>      back to an ordinary player
 */
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';

const DATA = process.env.DATA_DIR ?? join(import.meta.dirname, '..', '.data');
const db = new DatabaseSync(join(DATA, 'almia.db'));
db.exec('PRAGMA foreign_keys = ON');
const [cmd, a, b] = process.argv.slice(2);

interface U {
  id: number;
  username: string;
  created_at: number;
  banned: number;
  muted_until: number;
  role: string;
}

const user = (name: string | undefined): U => {
  const u = db.prepare('SELECT id, username, created_at, banned, muted_until, role FROM users WHERE username = ?').get(name ?? '') as U | undefined;
  if (!u) {
    console.error(`No account named ${name}`);
    process.exit(1);
  }
  return u;
};
const when = (t: number) => new Date(t).toISOString().replace('T', ' ').slice(0, 16);

switch (cmd) {
  case 'reports': {
    const rows = db.prepare('SELECT r.id, r.target, r.reason, r.at, u.username AS by FROM reports r LEFT JOIN users u ON u.id = r.reporter_id WHERE r.resolved = 0 ORDER BY r.id DESC LIMIT 50').all() as Array<Record<string, unknown>>;
    if (!rows.length) console.log('No open reports.');
    for (const r of rows) console.log(`#${r.id} ${when(r.at as number)}  ${r.by} reported ${r.target}: "${r.reason}"`);
    break;
  }
  case 'resolve':
    db.prepare('UPDATE reports SET resolved = 1 WHERE id = ?').run(Number(a));
    console.log(`Report #${a} resolved.`);
    break;
  case 'player': {
    const u = user(a);
    const prof = db.prepare('SELECT stats FROM profiles WHERE user_id = ?').get(u.id) as { stats: string } | undefined;
    const pc = (db.prepare('SELECT COUNT(*) AS n FROM pc WHERE user_id = ?').get(u.id) as { n: number }).n;
    const reports = (db.prepare('SELECT COUNT(*) AS n FROM reports WHERE target = ?').get(u.username) as { n: number }).n;
    console.log(`${u.username} (#${u.id}, ${u.role}) joined ${when(u.created_at)}`);
    console.log(`  banned: ${u.banned ? 'yes' : 'no'}  muted until: ${u.muted_until > Date.now() ? when(u.muted_until) : '-'}  reports against: ${reports}`);
    console.log(`  stats: ${prof?.stats ?? '{}'}  PC: ${pc} Pokémon`);
    break;
  }
  case 'mute': {
    const u = user(a);
    const mins = Number(b ?? 60);
    db.prepare('UPDATE users SET muted_until = ? WHERE id = ?').run(mins > 0 ? Date.now() + mins * 60_000 : 0, u.id);
    console.log(mins > 0 ? `${u.username} muted for ${mins} minutes.` : `${u.username} unmuted.`);
    break;
  }
  case 'ban': {
    const u = user(a);
    db.prepare('UPDATE users SET banned = 1 WHERE id = ?').run(u.id);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(u.id);
    console.log(`${u.username} banned and signed out.`);
    break;
  }
  case 'unban': {
    const u = user(a);
    db.prepare('UPDATE users SET banned = 0 WHERE id = ?').run(u.id);
    console.log(`${u.username} unbanned.`);
    break;
  }
  case 'delete': {
    const u = user(a);
    db.prepare('DELETE FROM users WHERE id = ?').run(u.id);
    db.prepare('UPDATE chat SET name = ?, text = ? WHERE user_id = ?').run('[deleted]', '[deleted]', u.id);
    console.log(`${u.username} and everything kept for it deleted.`);
    break;
  }
  case 'chat': {
    const rows = db.prepare('SELECT id, name, text, at FROM chat ORDER BY id DESC LIMIT ?').all(Number(a ?? 30)) as Array<{ id: number; name: string; text: string; at: number }>;
    for (const r of rows.reverse()) console.log(`#${r.id} ${when(r.at)} ${r.name}: ${r.text}`);
    break;
  }
  case 'mod':
  case 'admin':
  case 'player-role': {
    const u = user(a);
    const role = cmd === 'player-role' ? 'player' : cmd;
    db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, u.id);
    console.log(`${u.username} is now ${role === 'player' ? 'a player again' : `a${role === 'admin' ? 'n admin' : ' moderator'} (the dashboard is at /mod)`}.`);
    break;
  }
  default:
    console.log('Commands: reports | resolve <id> | player <name> | mute <name> <minutes> | ban <name> | unban <name> | delete <name> | chat [n] | mod <name> | admin <name> | player-role <name>');
}
