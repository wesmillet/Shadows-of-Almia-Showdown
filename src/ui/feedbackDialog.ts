/**
 * Send feedback (Options): a bug report, a suggestion or general feedback, straight to the admin
 * dashboard (server/feedback.ts). Guests can send it too; the build and the browser go with it so a
 * bug can be traced.
 */
import { serverBase } from '../net/connection';
import { el } from './overlay';
import { modal } from './socialPanel';

const KINDS: Array<[string, string, string]> = [
  ['bug', 'Bug', 'What happened, and what were you doing just before?'],
  ['suggestion', 'Suggestion', 'What would make the game better?'],
  ['feedback', 'Feedback', 'Anything you want to tell us.'],
];

/** Whether this build has a server to send feedback to (the GitHub Pages demo has none). */
export function canSendFeedback(): boolean {
  return serverBase() !== null;
}

export function openFeedback(): Promise<void> {
  return modal((box, close) => {
    box.append(el('h2', '', 'Send feedback'));
    box.append(el('p', '', 'Found a bug or have an idea? It goes straight to the developer.'));
    let kind = 'bug';
    const tabs = el('div', 'row');
    tabs.style.marginTop = '4px';
    const text = el('textarea');
    text.maxLength = 2000;
    text.rows = 6;
    Object.assign(text.style, { width: '100%', padding: '9px 10px', font: 'inherit', fontSize: '15px', border: '2px solid #4a3424', background: '#fffaf0', color: '#4a3424', outline: 'none', resize: 'vertical', marginTop: '10px' });
    const pick = (k: string): void => {
      kind = k;
      for (const b of tabs.children) (b as HTMLButtonElement).className = `almia-btn${(b as HTMLButtonElement).dataset.k === k ? '' : ' alt'}`;
      text.placeholder = KINDS.find((x) => x[0] === k)?.[2] ?? '';
    };
    for (const [k, label] of KINDS) {
      const b = el('button', 'almia-btn alt', label);
      b.dataset.k = k;
      b.onclick = () => pick(k);
      tabs.append(b);
    }
    // Typing here must not move the trainer or trigger key bindings.
    text.addEventListener('keydown', (e) => e.stopPropagation());
    const err = el('div', 'err');
    const row = el('div', 'row');
    const send = el('button', 'almia-btn', 'Send');
    const cancel = el('button', 'almia-btn alt', 'Close');
    cancel.onclick = close;
    row.append(send, cancel);
    box.append(tabs, text, err, row);
    pick('bug');
    setTimeout(() => text.focus(), 0);
    send.onclick = async () => {
      const body = text.value.trim();
      if (body.length < 5) {
        err.textContent = 'Tell us a little more';
        return;
      }
      send.disabled = true;
      err.textContent = '';
      let r: { ok?: boolean; error?: string };
      try {
        const res = await fetch(`${serverBase()}/api/feedback`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json', 'X-Almia': '1' },
          body: JSON.stringify({ kind, text: body, build: __BUILD__, device: `${navigator.userAgent.slice(0, 150)} · ${window.innerWidth}x${window.innerHeight}` }),
        });
        r = (await res.json()) as { ok?: boolean; error?: string };
      } catch {
        r = { error: "Can't reach the game server" };
      }
      send.disabled = false;
      if (!r.ok) {
        err.textContent = r.error ?? 'Could not send it';
        return;
      }
      box.replaceChildren(el('h2', '', 'Thank you!'), el('p', '', 'Your message was sent. Every report gets read.'));
      const done = el('button', 'almia-btn', 'Close');
      done.onclick = close;
      const r2 = el('div', 'row');
      r2.append(done);
      box.append(r2);
    };
  }, false);
}
