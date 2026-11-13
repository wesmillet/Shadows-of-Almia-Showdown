/**
 * The PC: Pokémon the player has extracted from matches, kept between games.
 *
 * A Pokémon gets here two ways: after a win the player picks one from the
 * party, and mid-match an Extraction Voucher sends one home (it leaves the
 * match). The PC lives in this browser's localStorage under one key, so it
 * stays on this device across sessions; nothing reads it back into a match
 * yet (it is a record to build on: starters from the PC, trading, a Box screen).
 * Storage can be unavailable (private windows, blocked site data): every read
 * and write is guarded and the game carries on without it.
 */
import type { Mon } from './sim/entities';
import { firstForm } from './sim/starters';
import { SPECIES } from './sim/data';

export interface PcEntry {
  /** Unique within the PC. */
  uid: string;
  dex: string;
  name: string;
  level: number;
  shiny?: boolean;
  alpha?: boolean;
  legend?: boolean;
  /** Snagged as Shadow Lugia (dex 0249-shadow): tagged Shadow in the box. */
  shadow?: boolean;
  moves: string[];
  heldItem?: string | null;
  /** How it got here. */
  via: 'win' | 'voucher' | 'egg' | 'gift' | 'reward';
  /** When (ISO date) and from which match seed. */
  at: string;
  seed?: number;
  /** Starred in the PC (sorted first). */
  fav?: boolean;
  /** Online: the server's row id (favourites are saved by it). */
  pcId?: number;
  /** The form it was in when kept (a Slaking kept as Slakoth): what the PC shows. */
  evolvedFrom?: string;
}

/**
 * The species the PC shows for an entry: the form it was caught or kept in. The entry itself is
 * stored at the first stage of its line (`dex`), which is what a match starts it as.
 */
export function shownDex(e: PcEntry): string {
  return e.evolvedFrom && SPECIES.has(e.evolvedFrom) ? e.evolvedFrom : e.dex;
}

/** Its name as shown: a plain species name follows the shown form, a nickname stays. */
export function shownName(e: PcEntry): string {
  const base = SPECIES.get(e.dex)?.name;
  const shown = SPECIES.get(shownDex(e))?.name;
  // Names never carry 'Shiny', 'Alolan', 'Galarian' and the like (older entries may).
  const name = plainName(e.name);
  if (/^\d{4}/.test(name) || (shown && name === base)) return shown ?? name;
  return name;
}

/** A Pokémon's name without a 'Shiny', 'Alolan', 'Galarian', 'Hisuian' or 'Paldean' in front. */
export function plainName(name: string): string {
  return name.replace(/^(?:(?:Shiny|Alolan|Galarian|Hisuian|Paldean) )+/, '');
}

/** Stars or unstars a Pokémon in this browser's PC. */
export function setFavLocal(uid: string, on: boolean): void {
  try {
    const list = loadPc();
    const e = list.find((x) => x.uid === uid);
    if (!e) return;
    if (on) e.fav = true;
    else delete e.fav;
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* storage unavailable: the star lasts this visit */
  }
}

const KEY = 'almia.pc.v1';

export function loadPc(): PcEntry[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const list = JSON.parse(raw) as unknown;
    return Array.isArray(list) ? (list as PcEntry[]).filter((e) => e && typeof e.dex === 'string') : [];
  } catch {
    return [];
  }
}

/** Stores a Pokémon in the PC; returns false when storage is unavailable. */
export function extractToPc(m: Mon, via: PcEntry['via'], seed?: number): boolean {
  // A Mega goes home as the form it Mega Evolved from, and an evolved Pokémon as the first form
  // of its line (with that form's moves at its level).
  const base = firstForm({ dex: m.megaFrom?.dex ?? m.dex, name: (m.megaFrom?.name ?? m.name).replace(/^Shadow /, ''), level: m.level, moves: [...m.moves] });
  const entry: PcEntry = {
    uid: `${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`,
    dex: base.dex,
    name: base.name,
    level: m.level,
    shiny: !!m.shiny || undefined,
    alpha: !!m.alpha || undefined,
    legend: !!m.legend || undefined,
    shadow: !!m.shadow || undefined,
    moves: base.moves,
    heldItem: m.heldItem ?? null,
    via,
    at: new Date().toISOString(),
    seed,
    evolvedFrom: base.from,
  };
  try {
    const list = loadPc();
    list.push(entry);
    localStorage.setItem(KEY, JSON.stringify(list));
    return true;
  } catch {
    return false;
  }
}
