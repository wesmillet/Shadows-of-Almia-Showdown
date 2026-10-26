/**
 * End-to-end check of the social side against a running server (npm run server, with MATCH_SIZE=4
 * LOBBY_WAIT=4): accounts, friends, a party queueing as a squad, watching a friend, a ranked match
 * and its rating, a private lobby with custom rules, and the replays that come out of it all.
 *
 *   npx tsx server/checks/social.ts [http://localhost:8787]
 */
import { gunzipSync } from 'node:zlib';
import WebSocket from 'ws';
import type { ClientMsg, ServerMsg } from '../../src/net/protocol';

const BASE = process.argv[2] ?? 'http://localhost:8787';
const WS = BASE.replace(/^http/, 'ws');
const tag = Math.random().toString(36).slice(2, 6);
let failed = false;

function check(ok: unknown, what: string): void {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
  if (!ok) failed = true;
}

async function api(cookie: string, path: string, body?: unknown): Promise<{ status: number; json: Record<string, unknown>; cookie: string }> {
  const r = await fetch(`${BASE}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { cookie, ...(body === undefined ? {} : { 'Content-Type': 'application/json', 'X-Almia': '1' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const set = r.headers.get('set-cookie') ?? '';
  return { status: r.status, json: (await r.json()) as Record<string, unknown>, cookie: set.split(';')[0] || cookie };
}

class Player {
  ws!: WebSocket;
  got: ServerMsg[] = [];
  private waiters: Array<{ test: (m: ServerMsg) => boolean; res: (m: ServerMsg) => void }> = [];
  constructor(readonly name: string, readonly cookie: string) {}

  open(guest = ''): Promise<void> {
    this.ws = new WebSocket(`${WS}/ws${guest ? `?guest=${guest}` : ''}`, { headers: { cookie: this.cookie } });
    this.ws.on('message', (d) => {
      const m = JSON.parse(String(d)) as ServerMsg;
      this.got.push(m);
      for (const w of [...this.waiters]) {
        if (w.test(m)) {
          this.waiters.splice(this.waiters.indexOf(w), 1);
          w.res(m);
        }
      }
    });
    return this.wait('hello').then(() => undefined);
  }

  send(m: ClientMsg): void {
    this.ws.send(JSON.stringify(m));
  }

  /** The next message of type `t` (matching `test`), waiting up to `secs`. */
  wait<T extends ServerMsg['t']>(t: T, test: (m: Extract<ServerMsg, { t: T }>) => boolean = () => true, secs = 20): Promise<Extract<ServerMsg, { t: T }>> {
    return new Promise((res, rej) => {
      const w = { test: (m: ServerMsg) => m.t === t && test(m as Extract<ServerMsg, { t: T }>), res: res as (m: ServerMsg) => void };
      this.waiters.push(w);
      setTimeout(() => {
        const i = this.waiters.indexOf(w);
        if (i >= 0) {
          this.waiters.splice(i, 1);
          rej(new Error(`${this.name}: no ${t} within ${secs}s`));
        }
      }, secs * 1000);
    });
  }

  /** Rolls and picks the first starter (alone, or for a party / private lobby that asked). */
  async pick(mode?: 'casual' | 'ranked'): Promise<void> {
    const roll = this.wait('roll');
    this.send({ t: 'roll' });
    await roll;
    this.send({ t: 'queue', pick: 0, mode });
  }
}

const codes = new Map<string, string[]>();
async function account(name: string): Promise<Player> {
  const r = await api('', '/api/register', { username: name, password: `Sturdy-${tag}-Passphrase-42` });
  if (r.status !== 200) throw new Error(`register ${name}: ${JSON.stringify(r.json)}`);
  codes.set(name, r.json.recovery as string[]);
  return new Player(name, r.cookie);
}

const A = await account(`Ash_${tag}`);
const M = await account(`Misty_${tag}`);
const B = await account(`Brock_${tag}`);
const G = new Player('guest', '');

// ---------------------------------------------------------------- friends
check((await api(A.cookie, '/api/friends/add', { name: M.name })).json.ok, 'friend request sent');
const accept = await api(M.cookie, '/api/friends/add', { name: A.name });
check(String(accept.json.text).includes('now friends'), 'asking back accepts it');
await api(A.cookie, '/api/friends/add', { name: B.name });
await api(B.cookie, '/api/friends/add', { name: A.name });
const fl = (await api(A.cookie, '/api/friends')).json.friends as Array<{ name: string; relation: string }>;
check(fl.length === 2 && fl.every((f) => f.relation === 'friend'), `friends list: ${fl.map((f) => `${f.name}:${f.relation}`).join(', ')}`);
check((await api(A.cookie, '/api/friends/add', { name: 'NoSuchTrainer9' })).status === 400, 'no friending people who do not exist');

await Promise.all([A.open(), M.open(), B.open(), G.open(`guest${tag}guest${tag}1234`)]);
const online = (await api(A.cookie, '/api/friends')).json.friends as Array<{ name: string; online: boolean; activity: string }>;
check(online.every((f) => f.online && f.activity === 'menu'), 'friends show as online, in the menu');

// ---------------------------------------------------------------- a party queues as a squad
const invited = M.wait('social', (m) => m.invites.includes(A.name));
A.send({ t: 'party', a: 'invite', name: M.name });
await invited;
check(true, 'party invite arrives');
const joined = A.wait('social', (m) => (m.party?.members.length ?? 0) === 2);
M.send({ t: 'party', a: 'accept', name: A.name });
const party = await joined;
check(party.party?.leader === A.name, 'invite accepted: a party of two, led by the inviter');
const mPick = M.wait('pick');
const aPick = A.wait('pick');
A.send({ t: 'party', a: 'queue', mode: 'casual' });
await Promise.all([aPick, mPick]);
check(true, 'the leader queues: everyone is asked to pick a starter');
const aStart = A.wait('start', () => true, 30);
const mStart = M.wait('start', () => true, 30);
await A.pick();
await M.pick();
const [as, ms] = await Promise.all([aStart, mStart]);
check(as.matchId === ms.matchId, 'the party lands in the same match');
const aTeam = as.roster.find((r) => r.trainerId === as.you)?.team;
const mTeam = ms.roster.find((r) => r.trainerId === ms.you)?.team;
check(aTeam !== undefined && aTeam === mTeam, `as one squad (team ${aTeam})`);
check(as.mode === 'casual', 'a casual match');

// ---------------------------------------------------------------- watching a friend
const header = B.wait('spectate');
B.send({ t: 'spectate', name: A.name });
const h = await header;
check(h.matchId === as.matchId && h.follow === as.you, 'watching a friend follows them in their match');
const t0 = Date.now();
await B.wait('s', () => true, 15);
const late = (Date.now() - t0) / 1000;
check(late > h.delay - 1, `spectators see it ${late.toFixed(1)}s late (delay ${h.delay}s)`);
const fl2 = (await api(B.cookie, '/api/friends')).json.friends as Array<{ name: string; activity: string; matchId?: string }>;
check(fl2.find((f) => f.name === A.name)?.activity === 'match', 'a friend in a match shows as playing');
G.send({ t: 'spectate', name: A.name });
check((await G.wait('notice')).text.includes('friends'), 'strangers can not watch by name');
B.send({ t: 'unspectate' });

// ---------------------------------------------------------------- ranked
const rStart = B.wait('start', () => true, 40);
await B.pick('ranked');
const rs = await rStart;
check(rs.mode === 'ranked', 'a ranked match (filled with computer trainers after the wait)');
const rated = B.wait('rated', () => true, 20);
B.send({ t: 'leave' });
const rr = await rated;
check(rr.after < rr.before, `leaving a ranked match first costs rating (${rr.before} -> ${rr.after})`);
check(rr.tier === null && rr.placementLeft === 4, 'placement games: no tier yet');
const card = (await api(B.cookie, '/api/ranked')).json;
check(card.games === 1 && card.rating === rr.after, 'the rating is saved');

// ---------------------------------------------------------------- a private lobby
const lob = B.wait('private', (m) => !!m.lobby);
B.send({ t: 'private', a: 'create' });
const code = (await lob).lobby?.code as string;
check(/^[A-Z0-9]{5}$/.test(code), `a private lobby, code ${code}`);
const gJoin = G.wait('private', (m) => (m.lobby?.members.length ?? 0) === 2);
G.send({ t: 'private', a: 'join', code: code.toLowerCase() });
await gJoin;
check(true, 'joined with the code (any case)');
const ruled = G.wait('private', (m) => m.lobby?.rules.level === 30 && m.lobby.rules.bots === false);
B.send({ t: 'private', a: 'rules', rules: { size: 2, bots: false, level: 30, storm: 2, teams: 'solo', rareChest: true } });
await ruled;
check(true, 'the host sets the rules; everyone sees them');
G.send({ t: 'private', a: 'rules', rules: { level: 5 } });
await new Promise((r) => setTimeout(r, 300));
check(!G.got.some((m) => m.t === 'private' && m.lobby?.rules.level === 5), 'only the host can change the rules');
const gp = G.wait('pick');
const bp = B.wait('pick');
B.send({ t: 'private', a: 'start' });
await Promise.all([gp, bp]);
const pStart = G.wait('start', () => true, 20);
await B.pick();
await G.pick();
const ps = await pStart;
check(ps.mode === 'private' && ps.roster.length === 2, `the private match has just the two of them (${ps.roster.length} trainers)`);
const back = B.wait('private', (m) => m.lobby?.state === 'open', 20);
B.send({ t: 'leave' });
G.send({ t: 'leave' });
await back;
check(true, 'after the match, everyone is back in the lobby');

// ---------------------------------------------------------------- the party's match ends; progress; replays
const aProgress = A.wait('progress', () => true, 20);
A.send({ t: 'leave' });
M.send({ t: 'leave' });
const prog = await aProgress;
const gained = prog.xp.reduce((n, x) => n + x.xp, 0);
check(gained > 0 && prog.xp[0]?.what === 'Played a match', `a finished match earns XP (+${gained}: ${prog.xp.map((x) => x.what).join(', ')})`);
check(prog.achievements.some((a) => a.id === 'first_match'), 'and the first achievement');
const meA = (await api(A.cookie, '/api/me')).json as { progress: { xp: number; level: number }; achievements: string[] };
check(meA.progress.xp === gained && meA.achievements.includes('first_match'), `kept on the account (level ${meA.progress.level})`);
check((await api(A.cookie, '/api/look', { look: 'union_09' })).status === 403, 'a Ranger look is locked at level 1');
check((await api(A.cookie, '/api/look', { look: 'civ_04' })).status === 403, 'the townsfolk are locked');
check((await api(A.cookie, '/api/look', { look: 'union_00' })).json.ok, 'the first Ranger is free');
check((await api(A.cookie, '/api/title', { title: 'Master Ranger' })).status === 400, 'titles must be earned');
const bMe = (await api(B.cookie, '/api/me')).json as { progress: { xp: number } };
const gMe = (await api('', '/api/me')).json as { signedIn: boolean };
check(bMe.progress.xp > 0 && !gMe.signedIn, 'ranked earns XP too; private matches add none to anyone');
await new Promise((r) => setTimeout(r, 1500));
const list = (await api('', '/api/replays')).json.replays as Array<{ id: string; mode: string }>;
check(list.some((r) => r.id === as.matchId) && list.some((r) => r.id === rs.matchId), `public replays listed (${list.length})`);
check(!list.some((r) => r.id === ps.matchId), 'private matches are not in the public list');
const mine = (await api(B.cookie, '/api/replays?mine=1')).json.replays as Array<{ id: string }>;
check(mine.some((r) => r.id === ps.matchId), 'but they are in their players\' own list');
const file = await fetch(`${BASE}/api/replay/${as.matchId}`);
const raw = Buffer.from(await file.arrayBuffer());
// fetch unpacks gzip itself; a raw read would need gunzip.
const textBody = raw[0] === 0x1f ? gunzipSync(raw).toString('utf8') : raw.toString('utf8');
const lines = textBody.trim().split('\n').map((l) => JSON.parse(l) as Record<string, unknown>);
check(lines[0]?.matchId === as.matchId && lines[1]?.k === 1, `replay: header, keyframe, ${lines.length - 1} updates`);
check((await fetch(`${BASE}/api/replay/m..%2Fetc`)).status === 404, 'replay paths are checked');

// ---------------------------------------------------------------- recovery codes, passwords, the profile page
const mc = codes.get(M.name) ?? [];
check(mc.length === 8 && mc.every((c) => /^[0-9A-F]{5}-[0-9A-F]{5}$/.test(c)), 'signing up gives eight recovery codes');
check((await api('', '/api/recover', { username: M.name, code: 'AAAAA-BBBBB', password: 'Brand-New-Lantern-77' })).status === 401, 'a wrong code does nothing');
const rec = await api('', '/api/recover', { username: M.name, code: (mc[0] as string).toLowerCase().replace('-', ' '), password: 'Brand-New-Lantern-77' });
check(rec.json.ok && rec.json.codesLeft === 7, 'a recovery code sets a new password (typed any which way)');
check((await api('', '/api/login', { username: M.name, password: `Sturdy-${tag}-Passphrase-42` })).status === 401, 'the old password stops working');
check((await api(M.cookie, '/api/me')).json.signedIn === false, 'and every old session is signed out');
check((await api('', '/api/recover', { username: M.name, code: mc[0], password: 'Another-Lantern-88' })).status === 401, 'each code works once');
const ch = await api(rec.cookie, '/api/password', { current: 'Brand-New-Lantern-77', password: 'Third-Lantern-Pass-99' });
check(ch.json.ok, 'changing the password needs the current one');
const page = await fetch(`${BASE}/u/${encodeURIComponent(A.name)}`);
const html = await page.text();
check(page.status === 200 && html.includes(A.name) && html.includes('First Steps') && html.includes('Trainer level'), 'the public profile page');
check((await fetch(`${BASE}/u/NoSuchTrainer9`)).status === 404, 'no page for nobody');
check(!(await fetch(`${BASE}/u/%3Cscript%3E`).then((r) => r.text())).includes('<script>'), 'names are escaped');

for (const p of [A, M, B, G]) p.ws.close();
console.log(failed ? 'SOME CHECKS FAILED' : 'all social checks passed');
process.exit(failed ? 1 : 0);
