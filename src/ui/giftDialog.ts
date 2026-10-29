/**
 * Mystery Gift (home page): a player enters a code from the game's makers and gets what it holds,
 * a Pokémon (sent to their PC) or a trainer look. The server checks the code (server/gifts.ts).
 */
import type { Connection } from '../net/connection';
import { el } from './overlay';
import { modal } from './socialPanel';

type Result = { kind: 'pokemon'; dex: string; name: string; level: number; shiny: boolean } | { kind: 'look'; look: string; name: string };

export function giftDialog(net: Connection, goOnline: () => void): Promise<void> {
  return modal((box, close) => {
    box.append(el('h2', '', 'Mystery Gift'));
    if (!net.me.signedIn) {
      box.append(el('p', '', 'Sign in online to redeem a Mystery Gift code.'));
      const row = el('div', 'row');
      const go = el('button', 'almia-btn', 'Go online');
      go.onclick = () => {
        close();
        goOnline();
      };
      const done = el('button', 'almia-btn alt', 'Close');
      done.onclick = close;
      row.append(go, done);
      box.append(row);
      return;
    }
    box.append(el('p', '', 'Got a code? Enter it here for a Pokémon or a new look.'));
    const label = el('label', '', 'Code');
    const input = el('input');
    input.maxLength = 24;
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.style.textTransform = 'uppercase';
    const err = el('div', 'err');
    const got = el('div');
    const row = el('div', 'row');
    const redeem = el('button', 'almia-btn', 'Redeem');
    const done = el('button', 'almia-btn alt', 'Close');
    done.onclick = close;
    row.append(redeem, done);
    box.append(label, input, err, got, row);
    setTimeout(() => input.focus(), 0);
    const go = async (): Promise<void> => {
      const code = input.value.trim();
      if (!code) return;
      redeem.disabled = true;
      err.textContent = '';
      const r = await net.api<Result>('/api/gift/redeem', { code }).catch(() => ({ error: 'Could not reach the server' }) as { error: string });
      redeem.disabled = false;
      if ('error' in r && r.error) {
        err.textContent = r.error;
        return;
      }
      const g = r as Result;
      got.replaceChildren(
        el('h3', '', 'You received a gift!'),
        el('p', '', g.kind === 'pokemon' ? `${g.shiny ? 'A shiny ' : ''}${g.name} (Lv ${g.level}) was sent to your PC.` : `A new look: ${g.name}. Wear it from the Trainer screen.`),
      );
      input.value = '';
      if (g.kind === 'look') void net.refreshMe();
    };
    redeem.onclick = () => void go();
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') void go();
    });
  }, false);
}
