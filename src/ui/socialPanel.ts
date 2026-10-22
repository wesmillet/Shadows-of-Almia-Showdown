/**
 * The online hub's HTML panels: friends and party (right side), notices (top), and the dialogs for
 * leaderboards, replays and joining a private lobby by code.
 */
import type { Connection } from '../net/connection';
import type { FriendEntry, ServerMsg } from '../net/protocol';
import { ACHIEVEMENTS } from '../net/progression';
import { el, overlayRoot } from './overlay';

const ACTIVITY: Record<FriendEntry['activity'], [string, string]> = {
  offline: ['Offline', ''],
  menu: ['Online', 'on'],
  queue: ['Finding a match', 'busy'],
  match: ['In a match', 'busy'],
  watching: ['Watching a match', 'watch'],
  private: ['In a private lobby', 'busy'],
};

/** Notices from the server (an invite, a friend joining your party), shown for a few seconds on any screen. */
export class Toaster {
  private box: HTMLDivElement;
  private unsub: () => void;

  constructor(net: Connection) {
    this.box = el('div', 'almia-toasts');
    overlayRoot().appendChild(this.box);
    this.unsub = net.on((m) => {
      if (m.t === 'notice' || m.t === 'unqueued') this.show(m.text);
      else if (m.t === 'error') this.show(m.text);
    });
  }

  show(text: string, seconds = 3.5): void {
    const t = el('div', 'almia-panel almia-toast', text);
    this.box.appendChild(t);
    while (this.box.childElementCount > 3) this.box.firstElementChild?.remove();
    window.setTimeout(() => t.remove(), seconds * 1000);
  }

  dispose(): void {
    this.unsub();
    this.box.remove();
  }
}

/**
 * Friends and party, right side of the hub. Friends show what they are doing; online ones can be
 * invited to your party, and a friend in a match can be watched. Requests are answered here.
 */
export class SocialPanel {
  readonly el: HTMLDivElement;
  private body: HTMLDivElement;
  private unsub: () => void;
  private typed = '';

  constructor(private readonly net: Connection, private readonly actions: { watch: (name: string) => void; profile: (name: string) => void }) {
    this.el = el('div', 'almia-panel almia-side');
    const head = el('div', 'almia-chat-head');
    head.append(el('span', '', 'Friends & party'), el('span', '', '▾'));
    head.onclick = () => this.el.classList.toggle('collapsed');
    this.body = el('div', 'almia-side-body');
    this.el.append(head, this.body);
    overlayRoot().appendChild(this.el);
    this.unsub = net.on((m) => {
      if (m.t === 'social' || m.t === 'hello') this.render();
    });
    this.render();
  }

  /** Narrow windows: tucked away until opened. */
  setCollapsed(c: boolean): void {
    this.el.classList.toggle('collapsed', c);
  }

  private render(): void {
    const net = this.net;
    const b = this.body;
    // Keep what was being typed into the add box.
    const prev = b.querySelector('input');
    if (prev) this.typed = prev.value;
    const focused = document.activeElement === prev;
    b.replaceChildren();
    if (!net.me.signedIn) {
      b.append(el('div', 'almia-note', 'Sign in to add friends, make a party and watch your friends play.'));
      return;
    }
    const { friends, party, invites } = net.social;
    // Party invites first: they are what is waiting on you.
    for (const from of invites) {
      const row = el('div', 'almia-row');
      const nm = el('span', 'nm', `${from} invited you`);
      const yes = el('button', 'almia-small', 'Join');
      yes.onclick = () => net.send({ t: 'party', a: 'accept', name: from });
      const no = el('button', 'almia-small alt', 'No');
      no.onclick = () => net.send({ t: 'party', a: 'decline', name: from });
      row.append(nm, yes, no);
      b.append(row);
    }
    if (party) {
      b.append(el('h3', '', `Party · ${party.members.length}/4`));
      const lead = party.leader === party.you;
      for (const m of party.members) {
        const row = el('div', 'almia-row');
        const nm = el('span', 'nm', `${m.name === party.leader ? '♛ ' : ''}${m.name}${m.name === party.you ? ' (you)' : ''}`);
        if (m.picked !== undefined) nm.append(el('span', 'sub', m.picked ? 'Starter picked' : 'Picking a starter...'));
        row.append(nm);
        if (lead && m.name !== party.you) {
          const kick = el('button', 'almia-small alt', 'Remove');
          kick.onclick = () => net.send({ t: 'party', a: 'kick', name: m.name });
          row.append(kick);
        }
        b.append(row);
      }
      for (const n of party.invited) {
        const row = el('div', 'almia-row');
        row.append(el('span', 'nm', `${n} (invited)`));
        b.append(row);
      }
      const leave = el('button', 'almia-small alt', 'Leave party');
      leave.onclick = () => net.send({ t: 'party', a: 'leave' });
      const note = el('div', 'almia-note', lead ? 'You lead: Find a Match takes everyone, as one squad.' : `${party.leader} starts the matches.`);
      b.append(note, leave);
    }
    // Add a friend.
    b.append(el('h3', '', 'Add a friend'));
    const add = el('div', 'almia-add');
    const input = el('input');
    input.placeholder = 'Trainer name';
    input.maxLength = 16;
    input.value = this.typed;
    const go = el('button', 'almia-small', 'Add');
    const send = async () => {
      const name = input.value.trim();
      if (!name) return;
      go.disabled = true;
      const r = await net.api<{ ok?: boolean; text?: string }>('/api/friends/add', { name });
      go.disabled = false;
      this.typed = '';
      input.value = '';
      note.textContent = r.ok ? (r.text ?? 'Sent') : (r.error ?? 'Could not add');
    };
    go.onclick = () => void send();
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') void send();
      if (e.key === 'Escape') input.blur();
      e.stopPropagation();
    });
    add.append(input, go);
    const note = el('div', 'almia-note', '');
    b.append(add, note);
    if (focused) input.focus();
    const incoming = friends.filter((f) => f.relation === 'incoming');
    if (incoming.length) {
      b.append(el('h3', '', 'Friend requests'));
      for (const f of incoming) {
        const row = el('div', 'almia-row');
        const yes = el('button', 'almia-small', 'Accept');
        yes.onclick = () => void net.api('/api/friends/add', { name: f.name });
        const no = el('button', 'almia-small alt', 'Decline');
        no.onclick = () => void net.api('/api/friends/remove', { name: f.name });
        row.append(el('span', 'nm', f.name), yes, no);
        b.append(row);
      }
    }
    const mine = friends.filter((f) => f.relation === 'friend').sort((x, y) => Number(y.online) - Number(x.online) || x.name.localeCompare(y.name));
    b.append(el('h3', '', `Friends · ${mine.filter((f) => f.online).length} online`));
    if (!mine.length) b.append(el('div', 'almia-note', 'No friends yet. Add someone by their trainer name.'));
    const inParty = new Set(party?.members.map((m) => m.name) ?? []);
    const canInvite = !party || party.leader === party.you;
    for (const f of mine) {
      const [label, dot] = ACTIVITY[f.activity] ?? ACTIVITY.offline;
      const row = el('div', 'almia-row');
      row.append(el('span', `dot ${dot}`));
      const nm = el('span', 'nm', f.name);
      nm.style.cursor = 'pointer';
      nm.title = 'Profile';
      nm.onclick = () => this.actions.profile(f.name);
      nm.append(el('span', 'sub', label));
      row.append(nm);
      if (f.activity === 'match' || f.activity === 'watching') {
        const w = el('button', 'almia-small alt', 'Watch');
        w.disabled = f.activity !== 'match';
        w.onclick = () => this.actions.watch(f.name);
        row.append(w);
      }
      if (f.online && canInvite && !inParty.has(f.name)) {
        const inv = el('button', 'almia-small', 'Invite');
        inv.disabled = !!party?.invited.includes(f.name);
        inv.onclick = () => net.send({ t: 'party', a: 'invite', name: f.name });
        row.append(inv);
      }
      b.append(row);
    }
    const outgoing = friends.filter((f) => f.relation === 'outgoing');
    if (outgoing.length) {
      b.append(el('h3', '', 'Sent'));
      for (const f of outgoing) {
        const row = el('div', 'almia-row');
        const cancel = el('button', 'almia-small alt', 'Cancel');
        cancel.onclick = () => void net.api('/api/friends/remove', { name: f.name });
        row.append(el('span', 'nm', f.name), cancel);
        b.append(row);
      }
    }
  }

  focused(): boolean {
    return !!this.el.contains(document.activeElement) && document.activeElement?.tagName === 'INPUT';
  }

  dispose(): void {
    this.unsub();
    this.el.remove();
  }
}

/** A modal box; resolves when closed. */
function modal(build: (box: HTMLDivElement, close: () => void) => void, wide = true): Promise<void> {
  return new Promise((resolve) => {
    const wrap = el('div', 'almia-modal-wrap');
    const box = el('div', `almia-panel almia-modal${wide ? ' wide' : ''}`);
    wrap.appendChild(box);
    overlayRoot().appendChild(wrap);
    // Esc closes it (the screen underneath ignores the keyboard while a dialog is open).
    const keys = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    const close = () => {
      window.removeEventListener('keydown', keys);
      wrap.remove();
      resolve();
    };
    window.addEventListener('keydown', keys);
    wrap.addEventListener('pointerdown', (e) => {
      if (e.target === wrap) close();
    });
    build(box, close);
  });
}

interface RankedRow {
  name: string;
  rating: number;
  games: number;
  wins: number;
  tier: { name: string; color: string } | null;
}

/** Ranked (this season) and all-time wins. */
export function leaderboardDialog(net: Connection, onProfile: (name: string) => void): Promise<void> {
  return modal((box, close) => {
    box.append(el('h2', '', 'Leaderboards'));
    const tabs = el('div', 'almia-tabs');
    const list = el('div', 'list');
    const show = async (which: 'ranked' | 'wins') => {
      for (const b of tabs.children) (b as HTMLButtonElement).className = `almia-small${(b as HTMLElement).dataset.k === which ? '' : ' alt'}`;
      list.replaceChildren(el('div', 'almia-note', 'Loading...'));
      const t = el('table', 'almia-board');
      if (which === 'ranked') {
        const r = await net.api<{ season: number; players: RankedRow[] }>('/api/leaderboard?mode=ranked');
        t.innerHTML = '<tr><th>#</th><th>Trainer</th><th>Tier</th><th class="r">Rating</th><th class="r">Wins</th></tr>';
        (r.players ?? []).forEach((p, i) => {
          const tr = el('tr');
          const tier = el('td', '', p.tier?.name ?? '');
          if (p.tier) tier.style.color = p.tier.color;
          const nm = el('td', '', p.name);
          nm.style.cursor = 'pointer';
          nm.onclick = () => {
            close();
            onProfile(p.name);
          };
          tr.append(el('td', '', String(i + 1)), nm, tier, el('td', 'r', String(p.rating)), el('td', 'r', `${p.wins}/${p.games}`));
          t.appendChild(tr);
        });
        list.replaceChildren(el('div', 'almia-note', `Season ${r.season ?? 1} · five placement games before you are listed`), t);
        if (!r.players?.length) list.append(el('div', 'almia-note', 'Nobody has finished their placement games yet.'));
      } else {
        const r = await net.api<{ players: Array<{ name: string; wins: number; matches: number }> }>('/api/leaderboard');
        t.innerHTML = '<tr><th>#</th><th>Trainer</th><th class="r">Wins</th><th class="r">Matches</th></tr>';
        (r.players ?? []).forEach((p, i) => {
          const tr = el('tr');
          tr.append(el('td', '', String(i + 1)), el('td', '', p.name), el('td', 'r', String(p.wins)), el('td', 'r', String(p.matches)));
          t.appendChild(tr);
        });
        list.replaceChildren(t);
        if (!r.players?.length) list.append(el('div', 'almia-note', 'No wins yet. Be the first!'));
      }
    };
    for (const [k, label] of [['ranked', 'Ranked'], ['wins', 'All-time wins']] as const) {
      const b = el('button', 'almia-small', label);
      b.dataset.k = k;
      b.onclick = () => void show(k);
      tabs.append(b);
    }
    const done = el('button', 'almia-btn alt', 'Close');
    done.onclick = close;
    const row = el('div', 'row');
    row.append(done);
    box.append(tabs, list, row);
    void show('ranked');
  });
}

export interface ReplayInfo {
  id: string;
  mode: string;
  endedAt: number;
  seconds: number;
  players: Array<{ name: string; place: number; human: boolean }>;
  winner: string | null;
  humans: number;
}

/** Recent matches to watch back: everyone's (public) and your own. */
export function replaysDialog(net: Connection, onWatch: (r: ReplayInfo) => void): Promise<void> {
  return modal((box, close) => {
    box.append(el('h2', '', 'Replays'));
    const tabs = el('div', 'almia-tabs');
    const list = el('div', 'list');
    const show = async (mine: boolean) => {
      for (const b of tabs.children) (b as HTMLButtonElement).className = `almia-small${(b as HTMLElement).dataset.k === String(mine) ? '' : ' alt'}`;
      list.replaceChildren(el('div', 'almia-note', 'Loading...'));
      const r = await net.api<{ replays: ReplayInfo[] }>(mine ? '/api/replays?mine=1' : '/api/replays');
      list.replaceChildren();
      if (r.error) list.append(el('div', 'almia-note', r.error));
      if (!r.replays?.length && !r.error) list.append(el('div', 'almia-note', mine ? 'Your matches show up here once they finish.' : 'No replays yet.'));
      for (const x of r.replays ?? []) {
        const row = el('div', 'almia-row');
        const humans = x.players.filter((p) => p.human).map((p) => p.name);
        const when = new Date(x.endedAt);
        const nm = el('span', 'nm', `${x.mode === 'ranked' ? 'Ranked · ' : x.mode === 'private' ? 'Private · ' : ''}${humans.join(', ') || 'Computer trainers'}`);
        nm.append(el('span', 'sub', `${x.winner ? `${x.winner} won` : 'No winner'} · ${Math.floor(x.seconds / 60)}:${String(Math.floor(x.seconds % 60)).padStart(2, '0')} · ${when.toLocaleDateString()} ${when.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`));
        const w = el('button', 'almia-small', 'Watch');
        w.onclick = () => {
          close();
          onWatch(x);
        };
        row.append(nm, w);
        list.append(row);
      }
    };
    for (const [mine, label] of [[false, 'Recent'], [true, 'Mine']] as const) {
      const b = el('button', 'almia-small', label);
      b.dataset.k = String(mine);
      b.disabled = mine && !net.me.signedIn;
      b.onclick = () => void show(mine);
      tabs.append(b);
    }
    const done = el('button', 'almia-btn alt', 'Close');
    done.onclick = close;
    const row = el('div', 'row');
    row.append(done);
    box.append(tabs, list, row);
    void show(false);
  });
}

/** Asks for a private lobby's code; resolves with it (or null). */
export function joinCodeDialog(): Promise<string | null> {
  let code: string | null = null;
  return modal((box, close) => {
    box.append(el('h2', '', 'Join a private lobby'), el('p', '', 'Ask the host for the five-letter code.'));
    const input = el('input');
    input.maxLength = 8;
    input.style.textTransform = 'uppercase';
    input.style.letterSpacing = '4px';
    input.style.fontSize = '22px';
    const go = el('button', 'almia-btn', 'Join');
    const cancel = el('button', 'almia-btn alt', 'Cancel');
    const submit = () => {
      code = input.value.trim().toUpperCase();
      close();
    };
    go.onclick = submit;
    cancel.onclick = close;
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') submit();
    });
    const row = el('div', 'row');
    row.append(cancel, go);
    box.append(input, row);
    input.focus();
  }, false).then(() => code);
}

interface Profile {
  name: string;
  joined: number;
  stats: { matches: number; wins: number; catches: number; knockouts: number; damage: number; bestPlace: number | null };
  ranked?: { rating: number; tier: { name: string; color: string } | null; placementLeft: number; games: number; wins: number; peak: number; rank: number | null; season: number };
  recent: Array<{ match: string; place: number; outcome: string; mode: string; at: number; ratingDelta: number | null; xp: number | null; replay: boolean }>;
  pc: number;
  online: boolean;
  progress: { xp: number; level: number; into: number; next: number };
  title: string | null;
  achievements: Array<{ id: string; at: number }>;
}

/**
 * A trainer's profile: level, title, ranked standing, stats, achievements, recent matches (with
 * their replays). Your own also has your account tools: the title you wear, a link to share,
 * changing your password, and new recovery codes.
 */
export function profileDialog(net: Connection, name: string, onReplay?: (matchId: string) => void): Promise<void> {
  return modal((box, close) => {
    box.append(el('h2', '', name), el('div', 'almia-note', 'Loading...'));
    void net.api<Profile>(`/api/profile/${encodeURIComponent(name)}`).then((p) => {
      box.replaceChildren();
      const body = el('div');
      body.style.cssText = 'overflow-y:auto;flex:1;min-height:0';
      const head = el('div');
      head.append(el('h2', '', p.name ?? name));
      box.append(head, body);
      if (p.error) {
        body.append(el('div', 'almia-note', p.error));
      } else {
        const mine = net.me.user?.username === p.name;
        if (p.title) {
          const t = el('div', '', p.title);
          t.style.color = '#c2611a';
          head.append(t);
        }
        const pr = p.progress;
        const lvl = el('div', '', `Trainer level ${pr.level}`);
        lvl.style.marginTop = '4px';
        const bar = el('div');
        bar.style.cssText = 'height:8px;border:2px solid #4a3424;background:#e9dcc2;max-width:260px;margin:4px 0';
        const fill = el('div');
        fill.style.cssText = `height:100%;background:#f2c24a;width:${pr.next ? Math.round((pr.into / pr.next) * 100) : 100}%`;
        bar.append(fill);
        body.append(lvl, bar, el('div', 'almia-note', `${pr.next ? `${pr.into} / ${pr.next} XP to level ${pr.level + 1} · ` : ''}${p.online ? 'Online now · ' : ''}trainer since ${new Date(p.joined).toLocaleDateString()} · ${p.pc} Pokémon in their PC`));
        const r = p.ranked;
        if (r) {
          const line = el('div', '', r.tier ? `${r.tier.name} · ${r.rating}${r.rank ? ` · #${r.rank}` : ''}` : r.games ? `Ranked: ${r.placementLeft} placement game${r.placementLeft === 1 ? '' : 's'} left` : 'No ranked games this season');
          if (r.tier) line.style.color = r.tier.color;
          line.style.fontSize = '19px';
          line.style.margin = '8px 0 2px';
          body.append(line, el('div', 'almia-note', `Season ${r.season} · ${r.wins} wins in ${r.games} ranked · peak ${r.peak}`));
        }
        const st = p.stats;
        const t = el('table', 'almia-board');
        t.innerHTML = '<tr><th>Matches</th><th>Wins</th><th>Best</th><th>Catches</th><th>Knockouts</th></tr>';
        const tr = el('tr');
        for (const v of [st.matches, st.wins, st.bestPlace ?? '-', st.catches, st.knockouts]) tr.append(el('td', '', String(v)));
        t.append(tr);
        body.append(t);
        // Achievements: earned ones bright, the rest faint with what they take.
        const have = new Set(p.achievements.map((a) => a.id));
        body.append(el('h3', '', `Achievements · ${have.size}/${ACHIEVEMENTS.length}`));
        const grid = el('div');
        grid.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:6px';
        for (const a of ACHIEVEMENTS) {
          const b = el('div');
          b.style.cssText = `border:2px solid #4a3424;background:#fffaf0;padding:5px 6px;font-size:12px;${have.has(a.id) ? '' : 'opacity:0.4'}`;
          b.title = `${a.desc}${a.title ? ` · title: ${a.title}` : ''}${a.look ? ' · unlocks a look' : ''}`;
          const n = el('div', '', a.name);
          n.style.color = have.has(a.id) ? '#c2611a' : '#4a3424';
          b.append(n, el('div', 'almia-note', a.desc));
          grid.append(b);
        }
        body.append(grid);
        if (p.recent?.length) {
          body.append(el('h3', '', 'Recent matches'));
          for (const m of p.recent.slice(0, 8)) {
            const row = el('div', 'almia-row');
            const what = m.outcome === 'win' ? 'Won' : `#${m.place}`;
            const extra = [m.mode === 'ranked' ? `Ranked${m.ratingDelta !== null ? ` ${m.ratingDelta >= 0 ? '+' : ''}${m.ratingDelta}` : ''}` : 'Casual', m.xp !== null ? `+${m.xp} XP` : ''].filter(Boolean).join(' · ');
            const nm = el('span', 'nm', `${what} · ${extra}`);
            nm.append(el('span', 'sub', new Date(m.at).toLocaleString()));
            row.append(nm);
            if (m.replay && onReplay) {
              const w = el('button', 'almia-small alt', 'Replay');
              w.onclick = () => {
                close();
                onReplay(m.match);
              };
              row.append(w);
            }
            body.append(row);
          }
        }
        if (mine) body.append(accountTools(net, p, () => close()));
      }
      const row = el('div', 'row');
      const link = el('button', 'almia-btn alt', 'Copy profile link');
      link.onclick = () => void navigator.clipboard?.writeText(`${net.base}/u/${encodeURIComponent(p.name ?? name)}`).then(() => (link.textContent = 'Link copied'));
      const done = el('button', 'almia-btn alt', 'Close');
      done.onclick = close;
      row.append(link, done);
      box.append(row);
    });
  });
}

/** Your own profile: the title you wear, password and recovery codes. */
function accountTools(net: Connection, p: Profile, close: () => void): HTMLElement {
  const wrap = el('div');
  wrap.append(el('h3', '', 'Your account'));
  const titles = net.me.titles ?? [];
  const row = el('div', 'almia-row');
  row.append(el('span', 'nm', 'Title you wear'));
  const sel = el('select');
  for (const t of ['', ...titles]) {
    const o = el('option', '', t || (titles.length ? 'None' : 'Earn titles with achievements'));
    o.value = t;
    if ((p.title ?? '') === t) o.selected = true;
    sel.append(o);
  }
  sel.disabled = !titles.length;
  const note = el('div', 'almia-note', '');
  sel.onchange = async () => {
    const r = await net.api<{ ok?: boolean }>('/api/title', { title: sel.value });
    note.textContent = r.ok ? (sel.value ? `You now wear "${sel.value}"` : 'No title') : (r.error ?? 'Could not change it');
    void net.refreshMe();
  };
  row.append(sel);
  wrap.append(row);
  if (net.me.user?.password) {
    const actions = el('div', 'almia-tabs');
    const pw = el('button', 'almia-small alt', 'Change password');
    pw.onclick = () => {
      close();
      void changePasswordDialog(net);
    };
    const codes = el('button', 'almia-small alt', 'New recovery codes');
    codes.onclick = async () => {
      const r = await net.api<{ recovery?: string[] }>('/api/recovery/new', {});
      close();
      if (r.recovery) void recoveryCodesDialog(r.recovery, true);
    };
    actions.append(pw, codes);
    wrap.append(actions);
  }
  wrap.append(note);
  return wrap;
}

/** Shows recovery codes once (after signing up, or new ones). */
export function recoveryCodesDialog(codes: string[], replaced = false): Promise<void> {
  return modal((box, close) => {
    box.append(
      el('h2', '', 'Your recovery codes'),
      el('p', '', `We keep no email, so these are how you get back in if you forget your password. Each works once. Save them somewhere safe now: they will not be shown again.${replaced ? ' Your old codes no longer work.' : ''}`),
    );
    const list = el('div');
    list.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:6px;font-size:20px;letter-spacing:2px;margin:6px 0 10px';
    for (const c of codes) list.append(el('div', '', c));
    const row = el('div', 'row');
    const copy = el('button', 'almia-btn alt', 'Copy');
    copy.onclick = () => void navigator.clipboard?.writeText(codes.join('\n')).then(() => (copy.textContent = 'Copied'));
    const ok = el('button', 'almia-btn', "I've saved them");
    ok.onclick = close;
    row.append(copy, ok);
    box.append(list, row);
  }, false);
}

function changePasswordDialog(net: Connection): Promise<void> {
  return modal((box, close) => {
    box.append(el('h2', '', 'Change password'));
    const cur = el('input');
    cur.type = 'password';
    cur.autocomplete = 'current-password';
    const next = el('input');
    next.type = 'password';
    next.autocomplete = 'new-password';
    const err = el('div', 'err');
    const go = el('button', 'almia-btn', 'Change it');
    const cancel = el('button', 'almia-btn alt', 'Cancel');
    cancel.onclick = close;
    go.onclick = async () => {
      go.disabled = true;
      const r = await net.api<{ ok?: boolean }>('/api/password', { current: cur.value, password: next.value });
      go.disabled = false;
      if (r.ok) {
        err.style.color = '#2e7d32';
        err.textContent = 'Changed. Other browsers signed in as you were signed out.';
        window.setTimeout(close, 1400);
      } else err.textContent = r.error ?? 'That did not work';
    };
    const row = el('div', 'row');
    row.append(cancel, go);
    box.append(el('label', '', 'Current password'), cur, el('label', '', 'New password (8+ characters)'), next, err, row);
    cur.focus();
  }, false);
}

/** Forgot your password: your trainer name, one recovery code, and a new password. */
export function recoverDialog(net: Connection): Promise<boolean> {
  let ok = false;
  return modal((box, close) => {
    box.append(el('h2', '', 'Forgot your password?'), el('p', '', 'Use one of the recovery codes you saved when you made your account.'));
    const name = el('input');
    name.autocomplete = 'username';
    const code = el('input');
    code.style.letterSpacing = '2px';
    const pass = el('input');
    pass.type = 'password';
    pass.autocomplete = 'new-password';
    const err = el('div', 'err');
    const go = el('button', 'almia-btn', 'Set new password');
    const cancel = el('button', 'almia-btn alt', 'Cancel');
    cancel.onclick = close;
    go.onclick = async () => {
      go.disabled = true;
      const r = await net.api<{ ok?: boolean; codesLeft?: number }>('/api/recover', { username: name.value.trim(), code: code.value, password: pass.value });
      go.disabled = false;
      if (!r.ok) {
        err.textContent = r.error ?? 'That did not work';
        return;
      }
      ok = true;
      await net.refreshMe();
      await net.reconnect();
      err.style.color = '#2e7d32';
      err.textContent = `You're back in. ${r.codesLeft ?? 0} recovery code${r.codesLeft === 1 ? '' : 's'} left${(r.codesLeft ?? 0) < 3 ? ': make new ones from your profile' : ''}.`;
      window.setTimeout(close, 2200);
    };
    const row = el('div', 'row');
    row.append(cancel, go);
    box.append(el('label', '', 'Trainer name'), name, el('label', '', 'Recovery code'), code, el('label', '', 'New password (8+ characters)'), pass, err, row);
    name.focus();
  }, false).then(() => ok);
}

export type { ServerMsg };
