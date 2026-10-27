/**
 * Trading (accounts only): offers waiting for you, the offers you sent, and a new offer: look a
 * trainer up by name, pick one of yours and one of theirs. The server checks and swaps (accounts.ts
 * tradeApi). The game's own cream modal, like sign-in and Options.
 */
import type { Connection } from '../net/connection';
import { el, overlayRoot } from './overlay';

interface Card {
  pcId: number;
  dex: string;
  name: string;
  level: number;
  shiny?: boolean;
  alpha?: boolean;
  shadow?: boolean;
  /** Out on Wonder Trade (can't be offered meanwhile). */
  wonder?: boolean;
}
interface WonderState {
  waiting: Card | null;
  news: Array<{ id: number; got: Card | null; gave: Card | null; partner: string }>;
}
interface Offer {
  id: number;
  from: string;
  to: string;
  incoming: boolean;
  give: Card | null;
  want: Card | null;
}

const CSS = `
.almia-trade { width: min(560px, calc(100vw - 24px)) !important; max-height: calc(100vh - 24px); overflow-y: auto; }
.almia-trade h3 { margin: 14px 0 6px; font-size: 15px; font-weight: normal; color: #c2611a; }
.almia-trade .line { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 6px 0; border-bottom: 1px dashed #d8c7a6; }
.almia-trade .line:last-child { border-bottom: 0; }
.almia-trade .what { flex: 1; line-height: 1.35; }
.almia-trade .hint { color: #8a6a4a; font-size: 13px; }
.almia-trade select { width: 100%; padding: 8px; font: inherit; border: 2px solid #4a3424; background: #fffaf0; color: #4a3424; }
.almia-trade .pair { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 8px; }
.almia-trade .pair label { margin: 0 0 4px; }
.almia-trade .find { display: flex; gap: 8px; }
.almia-trade .find input { flex: 1; }
.almia-trade .msg { min-height: 18px; margin-top: 8px; font-size: 14px; color: #2f7a3a; }
.almia-trade .msg.err { color: #b0302a; }
.almia-trade .wonder { margin-top: 6px; padding: 10px 12px; border: 2px dashed #c2611a; background: #fff6e4; }
.almia-trade .wonder .find select { flex: 1; }
.almia-trade .news { color: #2f7a3a; padding: 4px 0; }
.almia-card { width: min(380px, calc(100vw - 24px)) !important; text-align: center; }
.almia-card .big { font-size: 22px; margin: 4px 0; }
.almia-card .sub { color: #8a6a4a; font-size: 13px; margin-bottom: 10px; }
.almia-card .stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; margin: 12px 0; }
.almia-card .stats div { border: 2px solid #d8c7a6; padding: 8px 4px; background: #fffaf0; }
.almia-card .stats b { display: block; font-size: 18px; font-weight: normal; color: #c2611a; }
.almia-card .row { justify-content: center; }
`;
let styled = false;

function cardText(c: Card | null): string {
  if (!c) return '(gone)';
  return `${c.shiny ? '★ ' : ''}${c.shadow ? 'Shadow ' : ''}${c.name} Lv ${c.level}${c.alpha ? ' · Alpha' : ''}`;
}

/** Opens the trading dialog; resolves when it closes. */
export function openTrades(net: Connection, startWith?: string): Promise<void> {
  if (!styled) {
    const st = document.createElement('style');
    st.textContent = CSS;
    document.head.appendChild(st);
    styled = true;
  }
  return new Promise((resolve) => {
    const wrap = el('div', 'almia-modal-wrap');
    const box = el('div', 'almia-panel almia-modal almia-trade');
    wrap.appendChild(box);
    overlayRoot().appendChild(wrap);
    let theirs: { name: string; pc: Card[] } | null = null;
    let wonder: WonderState = { waiting: null, news: [] };
    let mine: Card[] = [];
    let note = '';
    let noteErr = false;
    const off = net.on((m) => {
      if (m.t === 'trades') void refresh();
    });
    const close = (): void => {
      off();
      window.removeEventListener('keydown', onKey, true);
      wrap.remove();
      resolve();
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.code === 'Escape') {
        e.stopPropagation();
        close();
      }
    };
    window.addEventListener('keydown', onKey, true);
    wrap.addEventListener('pointerdown', (e) => {
      if (e.target === wrap) close();
    });
    let offers: Offer[] = [];
    const say = (text: string, err = false): void => {
      note = text;
      noteErr = err;
      draw();
    };
    const refresh = async (): Promise<void> => {
      const [o, p] = await Promise.all([net.api<{ offers: Offer[]; wonder?: WonderState }>('/api/trades'), net.api<{ pc: Card[] }>('/api/pc')]);
      offers = o.offers ?? [];
      if (o.wonder) wonder = o.wonder;
      // Wonder Trade results are shown once (here), then count as seen.
      if (wonder.news.length) void net.api('/api/wonder/seen', {});
      mine = p.pc ?? [];
      // Their PC may have changed too (a trade just went through).
      if (theirs) {
        const t = await net.api<{ name: string; pc: Card[] }>(`/api/trade/pc/${encodeURIComponent(theirs.name)}`);
        if (!t.error) theirs = { name: t.name, pc: t.pc };
      }
      draw();
    };
    const draw = (): void => {
      box.innerHTML = '';
      box.appendChild(el('h2', '', 'Trade'));
      box.appendChild(el('p', '', 'Swap Pokémon from your PC with another trainer. They accept or decline when they next look.'));
      const tradable = mine.filter((c) => !c.wonder);
      box.appendChild(el('h3', '', 'Wonder Trade'));
      const w = el('div', 'wonder');
      for (const n of wonder.news) w.appendChild(el('div', 'news', `Your ${cardText(n.gave)} went to ${n.partner}, who sent you ${cardText(n.got)}!`));
      if (wonder.waiting) {
        const line = el('div', 'line');
        line.appendChild(el('div', 'what', `${cardText(wonder.waiting)} is out on Wonder Trade. It swaps with the next trainer who sends one.`));
        const back = el('button', 'almia-btn alt', 'Take back');
        back.onclick = async () => {
          const r = await net.api<{ text?: string }>('/api/wonder/cancel', {});
          say(r.error ?? r.text ?? '', !!r.error);
          void refresh();
        };
        line.appendChild(back);
        w.appendChild(line);
      } else {
        w.appendChild(el('div', 'hint', 'Send one Pokémon off and get a surprise from another trainer.'));
        const row = el('div', 'find');
        const pick = el('select');
        if (!tradable.length) pick.appendChild(new Option('Your PC is empty', ''));
        for (const c of tradable) pick.appendChild(new Option(cardText(c), String(c.pcId)));
        const go = el('button', 'almia-btn', 'Send');
        go.disabled = !tradable.length;
        go.onclick = async () => {
          go.disabled = true;
          const r = await net.api<{ text?: string }>('/api/wonder', { give: Number(pick.value) });
          say(r.error ?? r.text ?? '', !!r.error);
          void refresh();
        };
        row.append(pick, go);
        w.appendChild(row);
      }
      box.appendChild(w);
      const incoming = offers.filter((o) => o.incoming);
      const outgoing = offers.filter((o) => !o.incoming);
      box.appendChild(el('h3', '', `Offers for you${incoming.length ? ` (${incoming.length})` : ''}`));
      if (!incoming.length) box.appendChild(el('div', 'hint', 'None right now.'));
      for (const o of incoming) {
        const line = el('div', 'line');
        line.appendChild(el('div', 'what', `${o.from} offers ${cardText(o.give)} for your ${cardText(o.want)}`));
        const yes = el('button', 'almia-btn', 'Accept');
        const no = el('button', 'almia-btn alt', 'Decline');
        yes.onclick = async () => {
          const r = await net.api<{ ok?: boolean; text?: string }>('/api/trades/respond', { id: o.id, accept: true });
          say(r.error ?? r.text ?? 'Done', !!r.error);
          void refresh();
        };
        no.onclick = async () => {
          const r = await net.api<{ ok?: boolean }>('/api/trades/respond', { id: o.id, accept: false });
          if (r.error) say(r.error, true);
          void refresh();
        };
        line.append(yes, no);
        box.appendChild(line);
      }
      box.appendChild(el('h3', '', 'Your offers'));
      if (!outgoing.length) box.appendChild(el('div', 'hint', 'None waiting.'));
      for (const o of outgoing) {
        const line = el('div', 'line');
        line.appendChild(el('div', 'what', `To ${o.to}: your ${cardText(o.give)} for their ${cardText(o.want)}`));
        const cancel = el('button', 'almia-btn alt', 'Cancel');
        cancel.onclick = async () => {
          const r = await net.api<{ ok?: boolean }>('/api/trades/cancel', { id: o.id });
          if (r.error) say(r.error, true);
          void refresh();
        };
        line.appendChild(cancel);
        box.appendChild(line);
      }
      box.appendChild(el('h3', '', 'New trade'));
      const find = el('div', 'find');
      const who = el('input');
      who.placeholder = "Trainer's name";
      who.maxLength = 32;
      who.value = theirs?.name ?? '';
      who.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Enter') look.click();
      });
      const look = el('button', 'almia-btn alt', 'Look up');
      look.onclick = async () => {
        const name = who.value.trim();
        if (!name) return;
        const r = await net.api<{ name: string; pc: Card[] }>(`/api/trade/pc/${encodeURIComponent(name)}`);
        if (r.error) {
          theirs = null;
          return say(r.error, true);
        }
        theirs = { name: r.name, pc: r.pc };
        say(r.pc.length ? '' : `${r.name} has no Pokémon in their PC yet`, !r.pc.length);
      };
      find.append(who, look);
      box.appendChild(find);
      if (theirs && theirs.pc.length) {
        const pair = el('div', 'pair');
        const pickMine = el('select');
        const pickTheirs = el('select');
        if (!tradable.length) pickMine.appendChild(new Option('Your PC is empty', ''));
        for (const c of tradable) pickMine.appendChild(new Option(cardText(c), String(c.pcId)));
        for (const c of theirs.pc) pickTheirs.appendChild(new Option(cardText(c), String(c.pcId)));
        const a = el('div');
        a.append(el('label', '', 'You give'), pickMine);
        const b = el('div');
        b.append(el('label', '', `You get from ${theirs.name}`), pickTheirs);
        pair.append(a, b);
        box.appendChild(pair);
        const row = el('div', 'row');
        const sendBtn = el('button', 'almia-btn', 'Send offer');
        sendBtn.disabled = !tradable.length;
        sendBtn.onclick = async () => {
          const r = await net.api<{ ok?: boolean; text?: string }>('/api/trades/offer', { give: Number(pickMine.value), want: Number(pickTheirs.value) });
          say(r.error ?? r.text ?? 'Offer sent', !!r.error);
          if (!r.error) void refresh();
        };
        row.appendChild(sendBtn);
        box.appendChild(row);
      }
      const msg = el('div', `msg${noteErr ? ' err' : ''}`, note);
      box.appendChild(msg);
      const foot = el('div', 'row');
      const done = el('button', 'almia-btn alt', 'Close');
      done.onclick = close;
      foot.appendChild(done);
      box.appendChild(foot);
    };
    if (startWith) {
      // Opened from a trainer's card: their PC is already looked up.
      void net.api<{ name: string; pc: Card[] }>(`/api/trade/pc/${encodeURIComponent(startWith)}`).then((r) => {
        if (r.error) return say(r.error, true);
        theirs = { name: r.name, pc: r.pc };
        if (!r.pc.length) say(`${r.name} has no Pokémon to trade yet`, true);
        else draw();
      });
    }
    draw();
    void refresh();
  });
}

/** Offers waiting for this player plus unseen Wonder Trade results (the hub's badge). */
export async function incomingTrades(net: Connection): Promise<number> {
  const r = await net.api<{ offers: Offer[]; wonder?: WonderState }>('/api/trades');
  return (r.offers ?? []).filter((o) => o.incoming).length + (r.wonder?.news.length ?? 0);
}

interface Profile {
  name: string;
  joined: number;
  stats: { wins?: number; matches?: number; catches?: number };
  pc: number;
  online: boolean;
  progress: { level: number };
  title: string | null;
}

/** A trainer's card (from a name in chat): level, title, record, and a Trade button. */
export function openTrainerCard(net: Connection, name: string): Promise<void> {
  if (!styled) {
    const st = document.createElement('style');
    st.textContent = CSS;
    document.head.appendChild(st);
    styled = true;
  }
  return new Promise((resolve) => {
    const wrap = el('div', 'almia-modal-wrap');
    const box = el('div', 'almia-panel almia-modal almia-card');
    wrap.appendChild(box);
    overlayRoot().appendChild(wrap);
    const close = (): void => {
      window.removeEventListener('keydown', onKey, true);
      wrap.remove();
      resolve();
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.code === 'Escape') {
        e.stopPropagation();
        close();
      }
    };
    window.addEventListener('keydown', onKey, true);
    wrap.addEventListener('pointerdown', (e) => {
      if (e.target === wrap) close();
    });
    box.appendChild(el('div', 'hint', 'Loading...'));
    void net.api<Profile>(`/api/profile/${encodeURIComponent(name)}`).then((p) => {
      box.innerHTML = '';
      if (p.error) {
        box.append(el('h2', '', name), el('p', '', p.error));
      } else {
        box.appendChild(el('div', 'big', p.name));
        const since = new Date(p.joined).toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
        box.appendChild(el('div', 'sub', `Lv ${p.progress.level}${p.title ? ` · ${p.title}` : ''} · ${p.online ? 'Online now' : `Trainer since ${since}`}`));
        const stats = el('div', 'stats');
        for (const [label, n] of [['Wins', p.stats.wins ?? 0], ['Matches', p.stats.matches ?? 0], ['In PC', p.pc]] as Array<[string, number]>) {
          const d = el('div');
          d.append(el('b', '', String(n)), document.createTextNode(label));
          stats.appendChild(d);
        }
        box.appendChild(stats);
      }
      const row = el('div', 'row');
      const isMe = net.me.signedIn && net.me.user?.username.toLowerCase() === name.toLowerCase();
      if (!p.error && !isMe) {
        const trade = el('button', 'almia-btn', 'Trade');
        if (!net.me.signedIn) {
          trade.disabled = true;
          trade.title = 'Sign in to trade';
        }
        trade.onclick = () => {
          close();
          void openTrades(net, p.name);
        };
        row.appendChild(trade);
      }
      const done = el('button', 'almia-btn alt', 'Close');
      done.onclick = close;
      row.appendChild(done);
      box.appendChild(row);
      if (!p.error && !isMe && !net.me.signedIn) box.appendChild(el('div', 'hint', 'Sign in to trade.'));
    });
  });
}
