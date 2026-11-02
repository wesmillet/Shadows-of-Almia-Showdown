/**
 * The offline demo's menu on a touch screen (the Menu button in a match): how to play, credits and
 * music. The match waits while it is open, as it does for any dialog.
 */
import { music } from '../audio/music';
import { openCredits } from './credits';
import { openHowToPlay } from './howToPlay';
import { el, overlayRoot } from './overlay';

export function openTouchMenu(): void {
  if (document.querySelector('.almia-modal-wrap')) return;
  const wrap = el('div', 'almia-modal-wrap');
  const box = el('div', 'almia-panel almia-modal');
  box.appendChild(el('h2', '', 'Menu'));
  const col = el('div');
  col.style.display = 'flex';
  col.style.flexDirection = 'column';
  col.style.gap = '8px';
  col.style.marginTop = '10px';
  const close = (): void => wrap.remove();
  const btn = (label: string, fn: () => void, alt = true): HTMLButtonElement => {
    const b = el('button', alt ? 'almia-btn alt' : 'almia-btn', label);
    b.style.minHeight = '42px';
    b.addEventListener('click', fn);
    col.appendChild(b);
    return b;
  };
  btn('Resume', close, false);
  btn('How to play', () => {
    close();
    void openHowToPlay();
  });
  btn('Credits', () => {
    close();
    void openCredits();
  });
  const mus = btn(music.muted ? 'Music: off' : 'Music: on', () => {
    music.toggleMute();
    mus.textContent = music.muted ? 'Music: off' : 'Music: on';
  });
  box.appendChild(col);
  wrap.appendChild(box);
  wrap.addEventListener('pointerdown', (e) => {
    if (e.target === wrap) close();
  });
  overlayRoot().appendChild(wrap);
}
