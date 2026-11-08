/**
 * Mystery Gift (home page): a player enters a code from the game's makers and gets what it holds,
 * a Pokémon (sent to their PC) or a trainer look. The server checks the code (server/gifts.ts).
 */
import type { Connection } from '../net/connection';
import { isShownLook } from '../net/progression';
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
        el('p', '', g.kind === 'pokemon' ? `${g.shiny ? 'A shiny ' : ''}${g.name} (Lv ${g.level}) was sent to your PC.` : isShownLook(g.look) ? `A new look: ${g.name}. Wear it from the Trainer screen.` : `A new look: ${g.name}. It is saved to your account for when more looks return.`),
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

/**
 * Gifts and messages the game's makers sent this player (server/gifts.ts send): shown on the online
 * menu one at a time; Claim hands the gift over (a Pokémon to the PC, a look, items to the chest).
 */
export async function showInbox(net: Connection): Promise<void> {
  const list = net.me.inbox ?? [];
  for (const g of list) {
    await modal((box, close) => {
      box.append(el('h2', '', g.gift ? 'You got a gift!' : 'A message for you'));
      box.append(el('div', 'almia-note', `From ${g.from}`));
      if (g.message) {
        const p = el('p', '', g.message);
        Object.assign(p.style, { color: '#4a3424', fontSize: '16px', whiteSpace: 'pre-wrap' });
        box.append(p);
      }
      const what = g.gift
        ? g.gift.kind === 'pokemon' ? `${g.gift.shiny ? 'A shiny ' : ''}${g.gift.name} (Lv ${g.gift.level}), sent to your PC`
          : g.gift.kind === 'look' ? `A new look: ${g.gift.name}`
            : `${g.gift.name}${g.gift.count > 1 ? ` x${g.gift.count}` : ''}, sent to your storage chest`
        : null;
      if (what) box.append(el('h3', '', what));
      const err = el('div', 'err');
      const row = el('div', 'row');
      const claim = el('button', 'almia-btn', g.gift ? 'Claim' : 'OK');
      row.append(claim);
      box.append(err, row);
      claim.onclick = async () => {
        claim.disabled = true;
        const r = await net.api<{ ok?: boolean }>('/api/inbox/claim', { id: g.id });
        claim.disabled = false;
        if (!r.ok && r.error !== 'Already claimed') {
          err.textContent = r.error ?? 'Could not claim it';
          return;
        }
        close();
      };
    }, false);
  }
  if (list.length) await net.refreshMe();
}
