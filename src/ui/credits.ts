/**
 * Credits: CREDITS.md shown in the game (Options), so the attribution the assets' licences ask for
 * is where players are, online and offline.
 */
import creditsText from '../../CREDITS.md?raw';
import { el, overlayRoot } from './overlay';

const CSS = `
.almia-credits { width: min(640px, calc(100vw - 24px)) !important; max-height: calc(100vh - 24px); overflow-y: auto; }
.almia-credits h3 { margin: 12px 0 4px; font-size: 15px; font-weight: normal; color: #c2611a; }
.almia-credits p, .almia-credits li { font-size: 13px; line-height: 1.45; margin: 0 0 6px; overflow-wrap: anywhere; }
.almia-credits ul { margin: 0 0 6px; padding-left: 18px; }
.almia-credits .row { display: flex; justify-content: flex-end; margin-top: 10px; }
`;
let styled = false;

/** Strips Markdown down to text: links keep their text and address, code and emphasis marks go. */
const plain = (s: string) => s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)').replace(/[`*]/g, '');

export function openCredits(): Promise<void> {
  if (!styled) {
    const st = document.createElement('style');
    st.textContent = CSS;
    document.head.appendChild(st);
    styled = true;
  }
  return new Promise((resolve) => {
    const wrap = el('div', 'almia-modal-wrap');
    const box = el('div', 'almia-panel almia-modal almia-credits');
    wrap.appendChild(box);
    overlayRoot().appendChild(wrap);
    let list: HTMLUListElement | null = null;
    let para: string[] = [];
    const flush = () => {
      if (para.length) box.appendChild(el('p', '', plain(para.join(' '))));
      para = [];
    };
    for (const raw of creditsText.split('\n')) {
      const line = raw.trim();
      if (line.startsWith('#')) {
        flush();
        list = null;
        box.appendChild(el(line.startsWith('# ') ? 'h2' : 'h3', '', plain(line.replace(/^#+\s*/, ''))));
      } else if (line.startsWith('- ')) {
        flush();
        if (!list) box.appendChild((list = el('ul', '') as HTMLUListElement));
        list.appendChild(el('li', '', plain(line.slice(2))));
      } else if (!line) {
        flush();
        list = null;
      } else para.push(line);
    }
    flush();
    const row = el('div', 'row');
    const done = el('button', 'almia-btn', 'Close');
    row.appendChild(done);
    box.appendChild(row);
    const close = (): void => {
      window.removeEventListener('keydown', onKey, true);
      wrap.remove();
      resolve();
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.code === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        close();
      }
    };
    window.addEventListener('keydown', onKey, true);
    done.addEventListener('click', close);
    wrap.addEventListener('pointerdown', (e) => {
      if (e.target === wrap) close();
    });
  });
}
