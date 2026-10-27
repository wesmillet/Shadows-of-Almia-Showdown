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
`;
let styled = false;

function cardText(c: Card | null): string {
  if (!c) return '(gone)';
  return `${c.shiny ? '★ ' : ''}${c.shadow ? 'Shadow ' : ''}${c.name} Lv ${c.level}${c.alpha ? ' · Alpha' : ''}`;
}

/** Opens the trading dialog; resolves when it closes. */
export function openTrades(net: Connection): Promise<void> {
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
      const [o, p] = await Promise.all([net.api<{ offers: Offer[] }>('/api/trades'), net.api<{ pc: Card[] }>('/api/pc')]);
      offers = o.offers ?? [];
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
        if (!mine.length) pickMine.appendChild(new Option('Your PC is empty', ''));
        for (const c of mine) pickMine.appendChild(new Option(cardText(c), String(c.pcId)));
        for (const c of theirs.pc) pickTheirs.appendChild(new Option(cardText(c), String(c.pcId)));
        const a = el('div');
        a.append(el('label', '', 'You give'), pickMine);
        const b = el('div');
        b.append(el('label', '', `You get from ${theirs.name}`), pickTheirs);
        pair.append(a, b);
        box.appendChild(pair);
        const row = el('div', 'row');
        const sendBtn = el('button', 'almia-btn', 'Send offer');
        sendBtn.disabled = !mine.length;
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
    draw();
    void refresh();
  });
}

/** How many offers are waiting for this player (for the hub's badge). */
export async function incomingTrades(net: Connection): Promise<number> {
  const r = await net.api<{ offers: Offer[] }>('/api/trades');
  return (r.offers ?? []).filter((o) => o.incoming).length;
}
