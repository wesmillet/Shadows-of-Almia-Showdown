/**
 * How to play: the goal and the controls on one card. It opens by itself at the start of a
 * browser's first match, and from the title screen (H) at any time.
 * Nothing secret is mentioned (no hidden encounters or capture rules).
 */
import { el, overlayRoot } from './overlay';
import { Input } from '../core/input';

const CSS = `
.almia-how { width: min(560px, calc(100vw - 24px)) !important; max-height: calc(100vh - 24px); overflow-y: auto; }
.almia-how h3 { margin: 12px 0 4px; font-size: 15px; font-weight: normal; color: #c2611a; }
.almia-how p { margin: 0 0 4px; font-size: 14px; line-height: 1.45; }
.almia-how { padding-bottom: 0 !important; }
.almia-how .row { display: flex; justify-content: flex-end; margin-top: 12px; position: sticky; bottom: 0; padding: 8px 0 16px; background: inherit; }
`;
const SEEN = 'almia.howToPlay.seen';
let styled = false;

/** True until this browser has been shown the card once. */
export function howToPlayUnseen(): boolean {
  try {
    return localStorage.getItem(SEEN) !== '1';
  } catch {
    return false;
  }
}

/** Opens the card; resolves when it closes. Marks it seen. */
export function openHowToPlay(): Promise<void> {
  try {
    localStorage.setItem(SEEN, '1');
  } catch {
    /* private window: shown again next time, harmless */
  }
  if (!styled) {
    const st = document.createElement('style');
    st.textContent = CSS;
    document.head.appendChild(st);
    styled = true;
  }
  const k = (code: string) => code.replace(/^Key/, '');
  const move = ['KeyW', 'KeyA', 'KeyS', 'KeyD'].map(k).join('');
  const touchSections: Array<[string, string]> = [
    ['The goal', 'Ten trainers on one island. Be the last trainer standing.'],
    ['Moving', 'Put your left thumb anywhere on the left of the field and slide it to walk. Your Pokémon follow you and fight wild Pokémon nearby on their own while Auto is on.'],
    ['Fighting', 'The two big buttons on the right are your moves. Tap one to use it on your target (or the way you face), or drag from it to aim and let go to use it there. You can keep walking while you aim. Dodge dashes out of the way in battles and while you steer a Pokémon.'],
    ['Catching', 'Tap a wild Pokémon to target it, wear it down, then tap Ball (or drag from Ball to aim and let go to throw). Hold Ball to choose which kind. You can carry six.'],
    ['Your team', 'The portraits on the left are your party. Tap one to send it out, recall it, control it yourself or change how it fights. Bag holds your items: tap one to use it.'],
    ['Healing', 'Stand at an outpost to heal your team. If a wild Pokémon knocks out your whole team, you lose your bag and come back at an outpost a little later.'],
    ['Trainer battles', 'Come close to another trainer and you battle one on one: steer with your left thumb, attack and dodge with your right. When one of yours is knocked out, tap the next one within 4 seconds, or the first able one in your party goes out. Lose every Pokémon in a trainer battle and you are out of the match.'],
    ['The storm', 'Every few minutes the darkness closes in toward the crystal in the middle. Pokémon fall asleep in it, and a trainer who stays in it too long is out. Keep to the light.'],
    ['After the match', 'Win, and a Pokémon from your team goes to your PC for keeps.'],
  ];
  const keySections: Array<[string, string]> = [
    ['The goal', 'Ten trainers on one island. Be the last trainer standing.'],
    ['Moving and fighting', `Walk with ${move} or the arrow keys. Your Pokémon follow you and fight wild Pokémon nearby on their own (auto-battle, ${k('KeyR')}). To use a move yourself, aim with the mouse: left click for the first move, right click for the second (or ${k('KeyQ')} and ${k('KeyE')}). Click one of your Pokémon to steer it, Esc to stop.`],
    ['Catching', `Wear a wild Pokémon down, target it (${k('Tab')} or click it) and throw a ball (${k('KeyF')}). You can carry six. Items and balls are in your bag (1-6).`],
    ['Healing', 'Stand at an outpost to heal your team. If a wild Pokémon knocks out your whole team, you lose your bag and come back at an outpost a little later.'],
    ['Trainer battles', `Come close to another trainer and you battle one on one: steer your Pokémon with ${move}, aim and use moves with the mouse, dodge with ${k('Space')}. When one of yours is knocked out, pick the next (click or 1-6) within 4 seconds, or the first able one in your party goes out. Lose every Pokémon in a trainer battle and you are out of the match.`],
    ['The storm', 'Every few minutes the darkness closes in toward the crystal in the middle. Pokémon fall asleep in it, and a trainer who stays in it too long is out. Keep to the light.'],
    ['After the match', 'Win, and a Pokémon from your team goes to your PC for keeps.'],
  ];
  const sections = Input.touch ? touchSections : keySections;
  return new Promise((resolve) => {
    const root = overlayRoot();
    // The game treats .almia-modal-wrap as "a dialog is open" and stops reading clicks.
    const wrap = el('div', 'almia-modal-wrap');
    const box = el('div', 'almia-panel almia-modal almia-how');
    wrap.appendChild(box);
    root.appendChild(wrap);
    box.appendChild(el('h2', '', 'How to play'));
    for (const [h, p] of sections) box.append(el('h3', '', h), el('p', '', p));
    if (!Input.touch) box.appendChild(el('p', '', 'Controls can be changed in Options.'));
    const row = el('div', 'row');
    const ok = el('button', 'almia-btn', 'Let’s go');
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
    wrap.addEventListener('pointerdown', (e) => {
      if (e.target === wrap) close();
    });
  });
}
