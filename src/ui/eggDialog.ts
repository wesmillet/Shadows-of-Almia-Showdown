/**
 * The daily Egg (signed-in players, online): one a day (UTC). Hatching it shows what came out, by
 * the starter tiers' odds, and sends it to the PC. The server rolls it (/api/egg/hatch).
 */
import type { Connection } from '../net/connection';
import { ASSET_ROOT } from '../sprites/assets';
import { portraitPicture } from '../sprites/pokemonSprite';
import { el } from './overlay';
import { modal } from './socialPanel';

interface EggState {
  ready: boolean;
  nextAt: number;
  today: { dex: string; name: string; shiny: boolean; tier: string } | null;
}
interface Hatched {
  dex: string;
  name: string;
  shiny: boolean;
  tier: string;
  tierName: string;
  color: string;
  nextAt: number;
}

const CSS = `
.almia-egg { text-align: center; }
.almia-egg .stage { height: 150px; display: flex; align-items: center; justify-content: center; }
.almia-egg .stage img, .almia-egg .stage canvas { width: 96px; height: 96px; image-rendering: pixelated; }
.almia-egg .egg { width: 72px; height: 72px; image-rendering: pixelated; }
.almia-egg .egg.wobble { animation: almia-wobble 0.32s ease-in-out infinite alternate; }
.almia-egg .flash { animation: almia-flash 0.6s ease-out; }
.almia-egg .tier { font-size: 15px; margin-top: 4px; }
@keyframes almia-wobble { from { transform: rotate(-14deg); } to { transform: rotate(14deg); } }
@keyframes almia-flash { from { filter: brightness(4); transform: scale(0.6); } to { filter: none; transform: scale(1); } }
`;
let styled = false;

/** "in 5 h 12 min" until `at`. */
function until(at: number): string {
  const m = Math.max(1, Math.ceil((at - Date.now()) / 60000));
  return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`;
}

/** Whether today's Egg is waiting (for the hub button's badge). */
export async function eggReady(net: Connection): Promise<boolean> {
  if (!net.me.signedIn) return false;
  const st = await net.api<EggState>('/api/egg').catch(() => null);
  return !!st?.ready;
}

export function eggDialog(net: Connection): Promise<void> {
  if (!styled) {
    const st = document.createElement('style');
    st.textContent = CSS;
    document.head.appendChild(st);
    styled = true;
  }
  return modal((box, close) => {
    box.classList.add('almia-egg');
    box.append(el('h2', '', 'Daily Egg'), el('div', 'almia-note', 'Loading...'));
    const egg = (): HTMLImageElement => {
      const i = el('img', 'egg');
      i.src = `${ASSET_ROOT}items/mystery-egg.png`;
      return i;
    };
    const show = async (who: { dex: string; name: string; shiny: boolean }, stage: HTMLElement): Promise<void> => {
      const pic = await portraitPicture(ASSET_ROOT, who.dex, who.shiny);
      stage.replaceChildren();
      if (pic) {
        pic.classList.add('flash');
        stage.append(pic);
      }
    };
    void net.api<EggState>('/api/egg').then((st) => {
      box.replaceChildren(el('h2', '', 'Daily Egg'));
      const stage = el('div', 'stage');
      const note = el('div', 'almia-note');
      const row = el('div', 'row');
      const done = el('button', 'almia-btn alt', 'Close');
      done.onclick = close;
      if (st.error || !st) {
        note.textContent = st?.error ?? 'Could not reach the server';
        box.append(note, row);
        row.append(done);
        return;
      }
      if (!st.ready) {
        if (st.today) void show(st.today, stage);
        note.textContent = `${st.today ? `Today's Egg hatched into ${st.today.shiny ? 'a shiny ' : ''}${st.today.name}. ` : ''}Your next Egg comes in ${until(st.nextAt)}.`;
        row.append(done);
        box.append(stage, note, row);
        return;
      }
      stage.append(egg());
      note.textContent = "A new Egg! Whatever hatches goes to your PC. Most are common, a few are rare, and once in a while it's something special.";
      const hatch = el('button', 'almia-btn', 'Hatch it');
      row.append(hatch, done);
      box.append(stage, note, row);
      hatch.onclick = () => {
        hatch.disabled = true;
        (stage.firstChild as HTMLElement | null)?.classList.add('wobble');
        note.textContent = 'Oh? The Egg is hatching...';
        const started = Date.now();
        void net.api<Hatched>('/api/egg/hatch', {}).then(async (r) => {
          // let it wobble a moment, as an Egg should
          await new Promise((res) => setTimeout(res, Math.max(0, 1600 - (Date.now() - started))));
          if (r.error) {
            stage.replaceChildren(egg());
            note.textContent = r.error;
            hatch.remove();
            return;
          }
          await show(r, stage);
          hatch.remove();
          const tier = el('div', 'tier', `${r.tierName}${r.shiny ? ' · ★ Shiny!' : ''}`);
          tier.style.color = r.color;
          note.replaceChildren(el('div', '', `${r.name} hatched from the Egg! It was sent to your PC.`), tier, el('div', '', `Your next Egg comes in ${until(r.nextAt)}.`));
        });
      };
    });
  }, false);
}
