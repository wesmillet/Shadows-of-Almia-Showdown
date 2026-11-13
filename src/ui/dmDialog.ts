/**
 * Direct messages with friends (server/dms.ts): unread counts for the friends list, a note when one
 * arrives, and the conversation window. Only friends can message each other; every line passes the
 * chat filter, and any message can be reported.
 */
import type { Connection } from '../net/connection';
import type { ServerMsg } from '../net/protocol';
import { el } from './overlay';
import { modal } from './socialPanel';

type Dm = Extract<ServerMsg, { t: 'dm' }>;

/** The one store for this browser's connection (set by main.ts), for panels made later. */
let current: DmStore | null = null;
export function setDmStore(s: DmStore | null): void {
  current = s;
}
export function dmStore(): DmStore | null {
  return current;
}

/** Unread messages per friend, kept current from the server's dm messages. */
export class DmStore {
  unread: Record<string, number> = {};
  /** The friend whose conversation is open (their messages are read as they arrive). */
  open: string | null = null;
  private listeners = new Set<() => void>();
  private incoming = new Set<(m: Dm) => void>();
  private unsub: () => void;

  constructor(private readonly net: Connection, private readonly toast: (text: string) => void) {
    this.unsub = net.on((m) => {
      if (m.t === 'hello' && net.me.signedIn) void this.refresh();
      if (m.t !== 'dm') return;
      for (const l of this.incoming) l(m);
      const me = net.me.user?.username ?? '';
      if (m.from.toLowerCase() === me.toLowerCase()) return;
      if (this.open && this.open.toLowerCase() === m.from.toLowerCase()) {
        void net.api('/api/dms/read', { with: m.from });
        return;
      }
      this.unread[m.from] = (this.unread[m.from] ?? 0) + 1;
      this.toast(`Message from ${m.from}: ${m.text.length > 60 ? `${m.text.slice(0, 57)}...` : m.text}`);
      this.changed();
    });
    if (net.me.signedIn) void this.refresh();
  }

  get total(): number {
    return Object.values(this.unread).reduce((a, b) => a + b, 0);
  }

  async refresh(): Promise<void> {
    const r = await this.net.api<{ unread: Record<string, number> }>('/api/dms/unread');
    if (r.unread) {
      this.unread = r.unread;
      this.changed();
    }
  }

  onChange(l: () => void): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  onMessage(l: (m: Dm) => void): () => void {
    this.incoming.add(l);
    return () => this.incoming.delete(l);
  }

  read(name: string): void {
    for (const k of Object.keys(this.unread)) if (k.toLowerCase() === name.toLowerCase()) delete this.unread[k];
    this.changed();
  }

  private changed(): void {
    for (const l of this.listeners) l();
  }

  dispose(): void {
    this.unsub();
  }
}

/** The conversation with one friend: history, new messages as they come, a box to write in. */
export function dmDialog(net: Connection, store: DmStore, friend: string): Promise<void> {
  let off = () => {};
  return modal((box, close) => {
    store.open = friend;
    store.read(friend);
    box.style.width = 'min(460px, calc(100vw - 32px))';
    box.append(el('h2', '', friend));
    box.append(el('p', '', 'Only friends can message each other. Be kind: messages pass the chat filter and can be reported.'));
    const log = el('div', 'almia-dm-log');
    log.style.cssText = 'height:min(340px,50vh);overflow-y:auto;border:2px solid #4a3424;background:#fffaf0;padding:8px;display:flex;flex-direction:column;gap:6px;';
    box.append(log);
    const me = (net.me.user?.username ?? '').toLowerCase();
    const seen = new Set<number>();
    const line = (m: { id: number; from: string; text: string; at: number }) => {
      if (seen.has(m.id)) return;
      seen.add(m.id);
      const mine = m.from.toLowerCase() === me;
      const row = el('div');
      row.style.cssText = `align-self:${mine ? 'flex-end' : 'flex-start'};max-width:82%;padding:5px 9px;background:${mine ? '#f2d58a' : '#e9dcc2'};border:2px solid #4a3424;word-wrap:break-word;`;
      row.append(el('div', '', m.text));
      const meta = el('div');
      meta.style.cssText = 'font-size:11px;color:#8a6a4a;margin-top:2px;display:flex;gap:8px;justify-content:space-between;';
      meta.append(el('span', '', new Date(m.at).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })));
      if (!mine) {
        const rep = el('a', '', 'Report');
        rep.style.cssText = 'color:#b0302a;cursor:pointer;';
        rep.onclick = async () => {
          rep.textContent = '...';
          const r = await net.api('/api/report', { dmId: m.id, reason: 'Direct message' });
          rep.textContent = r.error ? 'Could not report' : 'Reported';
          rep.onclick = null;
        };
        meta.append(rep);
      }
      row.append(meta);
      log.append(row);
      log.scrollTop = log.scrollHeight;
    };
    const empty = el('div', 'almia-note', 'No messages yet. Say hi!');
    log.append(empty);
    void net.api<{ messages: Array<{ id: number; from: string; text: string; at: number }> }>(`/api/dms?with=${encodeURIComponent(friend)}`).then((r) => {
      if (r.error) {
        empty.textContent = r.error;
        return;
      }
      if (r.messages.length) empty.remove();
      for (const m of r.messages) line(m);
    });
    off = store.onMessage((m) => {
      const other = m.from.toLowerCase() === me ? m.to : m.from;
      if (other.toLowerCase() !== friend.toLowerCase()) return;
      empty.remove();
      line(m);
    });
    const input = el('input') as HTMLInputElement;
    input.maxLength = 300;
    input.placeholder = `Message ${friend}`;
    const err = el('div', 'err');
    const sendBtn = el('button', 'almia-btn', 'Send') as HTMLButtonElement;
    const closeBtn = el('button', 'almia-btn alt', 'Close');
    const send = async () => {
      const text = input.value.trim();
      if (!text) return;
      sendBtn.disabled = true;
      const r = await net.api<{ msg: { id: number; from: string; text: string; at: number } }>('/api/dms/send', { to: friend, text });
      sendBtn.disabled = false;
      if (r.error) {
        err.textContent = r.error;
        return;
      }
      err.textContent = '';
      input.value = '';
      empty.remove();
      line(r.msg);
      input.focus();
    };
    sendBtn.onclick = () => void send();
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') void send();
      if (e.key === 'Escape') finish();
    });
    const finish = () => close();
    closeBtn.onclick = finish;
    const row = el('div', 'row');
    row.append(input, sendBtn);
    sendBtn.style.flex = '0 0 auto';
    box.append(row, err, closeBtn);
    closeBtn.style.cssText = 'width:100%;margin-top:6px;';
    window.setTimeout(() => input.focus(), 30);
  }).then(() => {
    // However it closed (Close, Esc, a click outside).
    off();
    store.open = null;
  });
}
