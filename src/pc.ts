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

export interface PcEntry {
  /** Unique within the PC. */
  uid: string;
  dex: string;
  name: string;
  level: number;
  shiny?: boolean;
  alpha?: boolean;
  legend?: boolean;
  moves: string[];
  heldItem?: string | null;
  /** How it got here. */
  via: 'win' | 'voucher';
  /** When (ISO date) and from which match seed. */
  at: string;
  seed?: number;
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
  const entry: PcEntry = {
    uid: `${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`,
    // A Mega goes home as the form it Mega Evolved from.
    dex: m.megaFrom?.dex ?? m.dex,
    name: m.megaFrom?.name ?? m.name,
    level: m.level,
    shiny: !!m.shiny || undefined,
    alpha: !!m.alpha || undefined,
    legend: !!m.legend || undefined,
    moves: [...m.moves],
    heldItem: m.heldItem ?? null,
    via,
    at: new Date().toISOString(),
    seed,
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
