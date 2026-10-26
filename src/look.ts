/**
 * The player's chosen trainer look (a character from assets/rangers/manifest.json), kept in this
 * browser. Only the starting Ranger is open for now; the rest are shown locked (they will be unlockables).
 */
const KEY = 'almia.look.v1';

/** The looks anyone can wear. */
export const FREE_LOOKS = ['union_00'];

export function lookUnlocked(character: string): boolean {
  return FREE_LOOKS.includes(character);
}

/** The saved look, if it is one that can be worn (an old pick of a now-locked look is ignored). */
export function loadLook(): string | null {
  try {
    const c = localStorage.getItem(KEY);
    return c && lookUnlocked(c) ? c : null;
  } catch {
    return null;
  }
}

export function saveLook(character: string): void {
  try {
    localStorage.setItem(KEY, character);
  } catch {
    // Storage blocked: the pick lasts for this visit only.
  }
}
