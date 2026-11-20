/**
 * What's new: the player-facing CHANGELOG.md shown in the game, newest update first, from the
 * online menu. Updates are numbered (CHANGELOG.md says how); the section still being written
 * ("Update 1.7 (not live yet)") is shown without the note, since it goes live with its deploy.
 * Secret features never appear because they are kept out of CHANGELOG.md.
 */
import changelogText from '../../CHANGELOG.md?raw';
import { el, overlayRoot } from './overlay';

const CSS = `
.almia-news { width: min(620px, calc(100vw - 24px)) !important; max-height: calc(100vh - 24px); display: flex; flex-direction: column; padding-bottom: 0 !important; }
.almia-news .scroll { overflow-y: auto; padding-right: 6px; }
.almia-news h3 { margin: 14px 0 6px; font-size: 16px; font-weight: normal; color: #c2611a; display: flex; align-items: center; gap: 8px; }
.almia-news h3 .tag { font-size: 11px; color: #fff; background: #c2611a; padding: 1px 6px; }
.almia-news ul { margin: 0 0 6px; padding-left: 18px; }
.almia-news li { font-size: 14px; line-height: 1.45; margin: 0 0 5px; }
.almia-news .row { display: flex; justify-content: flex-end; padding: 10px 0 16px; }
`;
const SEEN = 'almia.changelog.seen';
let styled = false;

export interface ChangelogSection {
  title: string;
  latest: boolean;
  items: string[];
}

/** The changelog's sections: "## Title" headings with "- " items (indented lines continue an item). */
export function changelogSections(text: string = changelogText): ChangelogSection[] {
  const out: ChangelogSection[] = [];
  for (const line of text.split('\n')) {
    const h = /^##\s+(.*)$/.exec(line);
    if (h) {
      const title = (h[1] as string).trim();
      // "Update 1.7 (not live yet)" goes live with the deploy that ships it: shown as "Update 1.7".
      const shown = title.replace(/\s*\(not live yet\)\s*$/i, '').trim() || 'Latest update';
      out.push({ title: shown, latest: out.length === 0, items: [] });
      continue;
    }
    const sec = out[out.length - 1];
    if (!sec) continue;
    const item = /^-\s+(.*)$/.exec(line);
    if (item) sec.items.push((item[1] as string).trim());
    else if (/^\s{2,}\S/.test(line) && sec.items.length) sec.items[sec.items.length - 1] += ` ${line.trim()}`;
  }
  return out.filter((s) => s.items.length);
}

/** A short fingerprint of the newest section, so the menu can mark news this browser has not opened. */
function latestKey(): string {
  const s = changelogSections()[0];
  return s ? `${s.title}:${s.items.length}:${s.items.join('').length}` : '';
}

/** True when the newest update has not been opened in this browser yet. */
export function changelogUnseen(): boolean {
  try {
    return localStorage.getItem(SEEN) !== latestKey();
  } catch {
    return false;
  }
}

/** Opens What's new; resolves when it closes. */
export function openChangelog(): Promise<void> {
  try {
    localStorage.setItem(SEEN, latestKey());
  } catch {
    /* private window: the dot comes back next time, harmless */
  }
  if (!styled) {
    const st = document.createElement('style');
    st.textContent = CSS;
    document.head.appendChild(st);
    styled = true;
  }
  return new Promise((resolve) => {
    // The game treats .almia-modal-wrap as "a dialog is open" and stops reading clicks.
    const wrap = el('div', 'almia-modal-wrap');
    const box = el('div', 'almia-panel almia-modal almia-news');
    wrap.appendChild(box);
    overlayRoot().appendChild(wrap);
    box.appendChild(el('h2', '', "What's new"));
    const scroll = el('div', 'scroll');
    for (const sec of changelogSections()) {
      const h = el('h3', '', sec.title);
      if (sec.latest) h.appendChild(el('span', 'tag', 'NEW'));
      const ul = el('ul');
      for (const it of sec.items) ul.appendChild(el('li', '', it));
      scroll.append(h, ul);
    }
    box.appendChild(scroll);
    const row = el('div', 'row');
    const ok = el('button', 'almia-btn', 'Close');
    row.appendChild(ok);
    box.appendChild(row);
    const close = (): void => {
      window.removeEventListener('keydown', onKey, true);
      wrap.remove();
      resolve();
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.code === 'Escape' || e.code === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        close();
      }
    };
    window.addEventListener('keydown', onKey, true);
    ok.addEventListener('click', close);
    wrap.addEventListener('click', (e) => {
      if (e.target === wrap) close();
    });
  });
}
