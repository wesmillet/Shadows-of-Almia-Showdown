/**
 * Options: music volume, camera shake, simple graphics, and every key binding (click a key, press
 * the new one). An HTML dialog over the game, in the game's own cream panel style. Changes save at once.
 */
import { Input } from '../core/input';
import { music } from '../audio/music';
import { KEY_ACTIONS, boundKey, keyName, saveSettings, settings } from '../settings';
import { el, overlayRoot } from './overlay';

/** Layout only: the look is the game's own cream panel, modal and buttons (overlay.ts). */
const CSS = `
.almia-opt { width: min(520px, calc(100vw - 24px)) !important; max-height: calc(100vh - 24px); overflow-y: auto; }
.almia-opt h3 { margin: 14px 0 6px; font-size: 15px; font-weight: normal; color: #c2611a; }
.almia-opt .line { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 5px 0; border-bottom: 1px dashed #d8c7a6; }
.almia-opt .line:last-child { border-bottom: 0; }
.almia-opt .hint { color: #8a6a4a; font-size: 13px; }
.almia-opt input[type=range] { width: 180px; accent-color: #c2611a; }
.almia-opt .key { min-width: 110px; text-align: center; }
.almia-opt .key.listen { background: #4a3424; color: #f4ecdc; }
.almia-opt .fixed { color: #8a6a4a; }
`;

let styled = false;

/** Opens the Options dialog; resolves when it closes. */
export function openOptions(): Promise<void> {
  const root = overlayRoot();
  if (!styled) {
    const st = document.createElement('style');
    st.textContent = CSS;
    document.head.appendChild(st);
    styled = true;
  }
  return new Promise((resolve) => {
    // The game treats .almia-modal-wrap as "a dialog is open" and stops reading clicks.
    const wrap = el('div', 'almia-modal-wrap');
    const box = el('div', 'almia-panel almia-modal almia-opt');
    wrap.appendChild(box);
    root.appendChild(wrap);
    const close = (): void => {
      Input.capture = null;
      window.removeEventListener('keydown', onKey, true);
      wrap.remove();
      resolve();
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.code === 'Escape' && !Input.capture) {
        e.preventDefault();
        e.stopPropagation();
        close();
      }
    };
    window.addEventListener('keydown', onKey, true);
    wrap.addEventListener('pointerdown', (e) => {
      if (e.target === wrap) close();
    });

    const draw = (): void => {
      box.innerHTML = '';
      box.appendChild(el('h2', '', 'Options'));
      box.appendChild(el('div', 'hint', 'Saved in this browser as you change them.'));

      // Sound.
      box.appendChild(el('h3', '', 'Sound'));
      const vol = el('div', 'line');
      vol.appendChild(el('span', '', 'Music volume'));
      const slider = el('input');
      slider.type = 'range';
      slider.min = '0';
      slider.max = '100';
      slider.value = String(Math.round(settings.music * 100));
      const pct = el('span', 'hint', `${slider.value}%`);
      slider.addEventListener('input', () => {
        settings.music = Number(slider.value) / 100;
        pct.textContent = `${slider.value}%`;
        saveSettings();
      });
      const right = el('div');
      right.style.display = 'flex';
      right.style.alignItems = 'center';
      right.style.gap = '10px';
      right.append(slider, pct);
      vol.appendChild(right);
      box.appendChild(vol);
      box.appendChild(toggleLine('Music', !music.muted, () => {
        music.toggleMute();
        draw();
      }));

      // Display.
      box.appendChild(el('h3', '', 'Display'));
      box.appendChild(toggleLine('Camera shake on big hits', settings.shake, () => {
        settings.shake = !settings.shake;
        saveSettings();
        draw();
      }));
      box.appendChild(toggleLine('Simple graphics (fixes flickering in some browsers; applies on the next screen)', settings.simpleGraphics, () => {
        settings.simpleGraphics = !settings.simpleGraphics;
        saveSettings();
        draw();
      }));

      // Controls.
      box.appendChild(el('h3', '', 'Controls'));
      box.appendChild(el('div', 'hint', 'Click a key, then press the new one. Esc cancels.'));
      for (const a of KEY_ACTIONS) {
        const line = el('div', 'line');
        line.appendChild(el('span', '', a.label));
        const btn = el('button', `almia-btn${settings.binds[a.code] ? '' : ' alt'} key`, keyName(boundKey(a.code)));
        btn.addEventListener('click', () => {
          btn.textContent = 'Press a key...';
          btn.classList.add('listen');
          Input.capture = (code) => {
            Input.capture = null;
            if (code !== 'Escape') bind(a.code, code);
            draw();
          };
        });
        line.appendChild(btn);
        box.appendChild(line);
      }
      const fixed: Array<[string, string]> = [['Aim and use moves', 'Left / right click'], ['Steer a Pokémon', 'Click it'], ['Back / close', 'Esc'], ['Arrow keys', 'Also move']];
      for (const [what, how] of fixed) {
        const line = el('div', 'line');
        line.append(el('span', '', what), el('span', 'fixed', how));
        box.appendChild(line);
      }

      const foot = el('div', 'row');
      const reset = el('button', 'almia-btn alt', 'Reset controls');
      reset.addEventListener('click', () => {
        settings.binds = {};
        saveSettings();
        draw();
      });
      const done = el('button', 'almia-btn', 'Done');
      done.addEventListener('click', close);
      foot.append(reset, done);
      box.appendChild(foot);
    };
    draw();
  });
}

function toggleLine(labelText: string, on: boolean, flip: () => void): HTMLDivElement {
  const line = el('div', 'line');
  line.appendChild(el('span', '', labelText));
  const t = el('button', `almia-btn${on ? '' : ' alt'}`, on ? 'On' : 'Off');
  t.addEventListener('click', flip);
  line.appendChild(t);
  return line;
}

/**
 * Binds `physical` to the action whose default is `def`. A key can do one thing: whatever action
 * held that key gives it up and goes back to its own default (or swaps into `def`'s old key).
 */
function bind(def: string, physical: string): void {
  const old = boundKey(def);
  for (const a of KEY_ACTIONS) {
    if (a.code === def) continue;
    if (boundKey(a.code) === physical) {
      // Swap: the other action takes this one's old key.
      if (old === a.code) delete settings.binds[a.code];
      else settings.binds[a.code] = old;
    }
  }
  if (physical === def) delete settings.binds[def];
  else settings.binds[def] = physical;
  saveSettings();
}
