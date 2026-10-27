/**
 * The player's storage chest between games: what is in it is kept in this browser's localStorage,
 * so anything stored in a town chest is there again next match (like the PC, src/pc.ts). Storage
 * can be unavailable (private windows, blocked site data, the test runner): every read and write
 * is guarded and the chest simply starts empty.
 */
import type { InventorySlot } from './sim/entities';

// v2: the rare-item chest used to be on for everyone and filled every chest with every rare item,
// so chests start fresh once.
const KEY = 'almia.chest.v2';

export function loadChest(): InventorySlot[] | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const list = JSON.parse(raw) as unknown;
    if (!Array.isArray(list)) return null;
    return (list as InventorySlot[]).filter((e) => e && typeof e.id === 'string' && typeof e.count === 'number' && e.count > 0);
  } catch {
    return null;
  }
}

export function saveChest(box: Array<InventorySlot | null>): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(KEY, JSON.stringify(box.filter((e): e is InventorySlot => !!e).map((e) => ({ id: e.id, count: e.count }))));
  } catch {
    // no saving here: the chest still works for this match
  }
}
