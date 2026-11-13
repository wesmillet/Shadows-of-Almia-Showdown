/**
 * The Starters panel (from the hub, signed in): the four starter achievements with their progress
 * and rewards (a choice of three is final; rewards go to the PC). The third slot's nominations are
 * chosen in My PC (src/ui/pcScreen.ts); this panel only lists them. Everything is saved to the
 * account by the server (server/starterUnlocks.ts). Works with a mouse or a finger.
 */
import type { Connection } from '../net/connection';
import type { StartersInfo } from '../sim/starterAchievements';
import { SPECIES } from '../sim/data';
import { ASSET_ROOT } from '../sprites/assets';
import { el, overlayRoot } from './overlay';
import { ACHIEVEMENTS, LEVELS_ON, lookName } from '../net/progression';

const CSS = `
.almia-starters { width: min(780px, calc(100vw - 24px)) !important; max-height: calc(100vh - 24px); overflow-y: auto; padding: 14px 16px 16px !important; }
.almia-starters h2 { margin: 0 0 2px; }
.almia-starters h3 { margin: 14px 0 6px; font-size: 16px; font-weight: normal; color: #c2611a; }
.almia-starters .sub { color: #8a6a4a; font-size: 13px; line-height: 1.35; margin: 0 0 6px; }
.almia-starters .ach { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 8px; border-bottom: 2px dashed #e0d0b4; }
.almia-starters .ach .what { flex: 1 1 200px; min-width: 0; }
.almia-starters .ach .name { font-size: 15px; }
.almia-starters .bar { height: 8px; background: #e0d0b4; margin-top: 4px; max-width: 220px; }
.almia-starters .bar i { display: block; height: 100%; background: #2e7d32; }
.almia-starters .got { display: flex; align-items: center; gap: 6px; font-size: 14px; }
.almia-starters .opts { display: flex; flex-wrap: wrap; gap: 6px; }
.almia-starters button { min-height: 40px; }
.almia-starters .mon { display: inline-flex; align-items: center; gap: 6px; }
.almia-starters img.face { width: 32px; height: 32px; image-rendering: pixelated; flex: none; background: #e9dcc2; }
.almia-starters .tier { font-size: 11px; padding: 1px 5px; color: #fff; text-shadow: 0 1px 0 rgba(0,0,0,0.4); }
.almia-starters .slots { display: grid; grid-template-columns: repeat(auto-fill, minmax(132px, 1fr)); gap: 6px; }
.almia-starters .slot { display: flex; flex-direction: column; align-items: flex-start; gap: 3px; padding: 6px 8px; background: #fbf5e9; border: 2px solid #e0d0b4; min-height: 74px; font-size: 13px; text-align: left; font-family: inherit; color: inherit; cursor: pointer; }
.almia-starters .slot.empty { color: #8a6a4a; cursor: default; }
.almia-starters .slot .odds { color: #2e7d32; }
.almia-starters .pool { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 6px; }
.almia-starters .pool button { display: flex; align-items: center; gap: 6px; text-align: left; font-family: inherit; font-size: 13px; padding: 4px 6px; background: #fbf5e9; border: 2px solid #e0d0b4; color: inherit; cursor: pointer; }
.almia-starters .pool button.on { border-color: #c2611a; background: #fde7cf; }
.almia-starters .pool button:disabled { opacity: 0.45; cursor: default; }
.almia-starters .meter { font-size: 15px; margin: 4px 0 8px; }
.almia-starters .meter.over { color: #b0302a; }
.almia-starters .row { display: flex; gap: 8px; margin-top: 12px; flex-wrap: wrap; position: sticky; bottom: -16px; background: #f4ecdc; padding: 8px 0 10px; }
.almia-starters .msg { min-height: 18px; font-size: 13px; color: #b0302a; margin-top: 6px; }
.almia-starters .msg.ok { color: #2e7d32; }
.almia-starters .achs { display: grid; grid-template-columns: repeat(auto-fill, minmax(168px, 1fr)); gap: 6px; }
.almia-starters .achs > div { border: 2px solid #e0d0b4; background: #fbf5e9; padding: 6px 8px; font-size: 12px; line-height: 1.3; }
.almia-starters .achs > div.no { opacity: 0.45; }
.almia-starters .achs .an { font-size: 14px; color: #4a3424; }
.almia-starters .achs > div.yes .an { color: #c2611a; }
.almia-starters .achs .rw { color: #2e7d32; margin-top: 2px; }
`;
let styled = false;

const nameOf = (dex: string): string => SPECIES.get(dex)?.name ?? dex;
function face(dex: string): HTMLImageElement {
  const img = el('img', 'face');
  img.alt = '';
  img.src = `${ASSET_ROOT}portraits/${dex.split('-')[0]}/Normal.png`;
  img.onerror = () => (img.style.visibility = 'hidden');
  return img;
}

/** Opens the panel; resolves when it closes. */
export function openStarters(net: Connection): Promise<void> {
  if (!styled) {
    const st = document.createElement('style');
    st.textContent = CSS;
    document.head.appendChild(st);
    styled = true;
  }
  return new Promise((resolve) => {
    const wrap = el('div', 'almia-modal-wrap');
    const box = el('div', 'almia-panel almia-modal almia-starters');
    wrap.appendChild(box);
    overlayRoot().appendChild(wrap);
    let info: StartersInfo | null = null;
    let confirming: { id: string; dex: string } | null = null;
    let message = '';
    let ok = false;
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
    wrap.addEventListener('pointerdown', (e) => {
      if (e.target === wrap) close();
    });

    const load = async (): Promise<void> => {
      // Fresh earned achievements (the account's own list comes with /api/me).
      await net.refreshMe().catch(() => undefined);
      const r = await net.api<StartersInfo>('/api/starters');
      if (r.error) {
        message = r.error;
        ok = false;
      } else {
        info = r;
      }
      draw();
    };

    const draw = (): void => {
      box.replaceChildren();
      box.appendChild(el('h2', '', 'Starters & Achievements'));
      box.appendChild(el('p', 'sub', 'Your first two starter slots roll from every Pokémon in your PC (Commons until it has some). The third rolls from the Pokémon you star below.'));
      if (!info) {
        box.appendChild(el('p', 'sub', message || 'Loading...'));
        return;
      }
      const data = info;
      // ---- achievements: earned ones bright, the rest faint with what they take and what they give
      const have = new Set(net.me.achievements ?? []);
      const shown = ACHIEVEMENTS.filter((a) => LEVELS_ON || !a.id.startsWith('level_'));
      box.appendChild(el('h3', '', `Achievements · ${shown.filter((a) => have.has(a.id)).length}/${shown.length}`));
      const grid = el('div', 'achs');
      for (const a of shown) {
        const got = have.has(a.id);
        const card = el('div', got ? 'yes' : 'no');
        card.append(el('div', 'an', `${got ? '✓ ' : ''}${a.name}`), el('div', 'sub', a.desc));
        const gives = [a.title ? `Title: ${a.title}` : '', a.look ? `Look: ${lookName(a.look)}` : ''].filter(Boolean).join(' · ');
        if (gives) card.append(el('div', 'rw', gives));
        grid.appendChild(card);
      }
      box.appendChild(grid);
      box.appendChild(el('h3', '', 'Starter unlocks'));
      for (const a of data.achievements) {
        const row = el('div', 'ach');
        const what = el('div', 'what');
        what.append(el('div', 'name', a.name), el('div', 'sub', `${a.desc} · ${a.progress}/${a.goal}`));
        const bar = el('div', 'bar');
        const fill = el('i');
        fill.style.width = `${Math.round((a.progress / a.goal) * 100)}%`;
        bar.appendChild(fill);
        what.appendChild(bar);
        row.appendChild(what);
        if (a.dex) {
          const got = el('div', 'got');
          got.append(face(a.dex), el('span', '', `Unlocked: ${a.reward.kind === 'random' && a.reward.shiny ? 'shiny ' : ''}${nameOf(a.dex)} (in your PC)`));
          row.appendChild(got);
        } else if (a.reward.kind === 'choice') {
          const opts = el('div', 'opts');
          for (const d of a.reward.options) {
            const sure = confirming?.id === a.id && confirming.dex === d;
            const b = el('button', sure ? 'almia-btn' : 'almia-btn alt');
            const m = el('span', 'mon');
            m.append(face(d), el('span', '', sure ? `Choose ${nameOf(d)}? (final)` : nameOf(d)));
            b.appendChild(m);
            b.disabled = !a.done;
            b.addEventListener('click', () => {
              if (!sure) {
                confirming = { id: a.id, dex: d };
                return draw();
              }
              confirming = null;
              void net.api<StartersInfo>('/api/starters/choose', { id: a.id, dex: d }).then((r) => {
                if (r.error) [message, ok] = [r.error, false];
                else [info, message, ok] = [r, `${nameOf(d)} unlocked`, true];
                draw();
              });
            });
            opts.appendChild(b);
          }
          row.appendChild(opts);
        } else {
          row.appendChild(el('div', 'sub', `Reward: ${a.reward.label}`));
        }
        box.appendChild(row);
      }
      const row = el('div', 'row');
      const done = el('button', 'almia-btn alt', 'Close');
      done.addEventListener('click', close);
      row.append(done);
      box.appendChild(row);
      box.appendChild(el('div', ok ? 'msg ok' : 'msg', message));
    };
    draw();
    void load();
  });
}
