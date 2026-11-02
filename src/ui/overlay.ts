/**
 * HTML on top of the game canvas for the few things a canvas is bad at (scrolling text): the
 * how-to-play card and the credits. Styled after the pixel skin: cream panels, dark ink, BoldPixels.
 * (The online build has a fuller version of this file with chat and sign-in.)
 */
const CSS = `
.almia-ui { position: fixed; inset: 0; pointer-events: none; z-index: 10; font-family: "BoldPixels", "Segoe UI", system-ui, sans-serif; }
.almia-ui * { box-sizing: border-box; }
.almia-panel { pointer-events: auto; background: #f4ecdc; color: #4a3424; border: 3px solid #4a3424; box-shadow: 0 4px 0 #2a1d14, 0 0 0 3px #f4ecdc inset; image-rendering: pixelated; }
.almia-btn { font: inherit; border: 0; background: #c2611a; color: #fff; padding: 7px 12px; cursor: pointer; text-shadow: 0 1px 0 #8a3a0a; }
.almia-btn.alt { background: #e9dcc2; color: #4a3424; text-shadow: none; }
.almia-modal-wrap { position: absolute; inset: 0; background: rgba(8,4,20,0.55); display: flex; align-items: center; justify-content: center; pointer-events: auto; }
.almia-modal { width: min(380px, calc(100vw - 32px)); padding: 18px 20px 20px; font-size: 16px; }
.almia-modal h2 { margin: 0 0 4px; font-size: 26px; font-weight: normal; }
.almia-modal p { margin: 4px 0 12px; color: #8a6a4a; font-size: 14px; line-height: 1.35; }
.almia-modal .row { display: flex; gap: 8px; margin-top: 14px; }
.almia-modal .row .almia-btn { flex: 1; }
`;

let root: HTMLDivElement | null = null;

export function overlayRoot(): HTMLDivElement {
  if (root) return root;
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
  root = document.createElement('div');
  root.className = 'almia-ui';
  document.body.appendChild(root);
  return root;
}

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
}
