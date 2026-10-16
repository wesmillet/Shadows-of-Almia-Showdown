/**
 * The player's storage chest between games: what is in it is kept in this browser's localStorage,
 * so anything stored in a town chest is there again next match (like the PC, src/pc.ts). Storage
 * can be unavailable (private windows, blocked site data, the test runner): every read and write
 * is guarded and the chest simply starts empty.
 */
import type { InventorySlot } from './sim/entities';

const KEY = 'almia.chest.v1';
/** Tester mode (src/dev.ts) keeps its own chest, so its free stock never reaches the real one. */
const DEV_KEY = 'almia.chest.dev.v1';

export function loadChest(dev = false): InventorySlot[] | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    // A tester's first dev chest carries over what was in the shared one before the two were split.
    const raw = localStorage.getItem(dev ? DEV_KEY : KEY) ?? (dev ? localStorage.getItem(KEY) : null);
    if (!raw) return null;
    const list = JSON.parse(raw) as unknown;
    if (!Array.isArray(list)) return null;
    return (list as InventorySlot[]).filter((e) => e && typeof e.id === 'string' && typeof e.count === 'number' && e.count > 0);
  } catch {
    return null;
  }
}

export function saveChest(box: Array<InventorySlot | null>, dev = false): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(dev ? DEV_KEY : KEY, JSON.stringify(box.filter((e): e is InventorySlot => !!e).map((e) => ({ id: e.id, count: e.count }))));
  } catch {
    // no saving here: the chest still works for this match
  }
}
