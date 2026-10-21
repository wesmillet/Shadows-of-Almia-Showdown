/**
 * The player's chosen trainer look (a character from assets/rangers/manifest.json), kept in this
 * browser. Every look is free for now; once the game goes online they become unlockables.
 */
const KEY = 'almia.look.v1';

export function loadLook(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

/** Called after the look changes (main.ts saves it to the signed-in account too). */
export const lookHooks: { saved: ((character: string) => void) | null } = { saved: null };

export function saveLook(character: string): void {
  lookHooks.saved?.(character);
  try {
    localStorage.setItem(KEY, character);
  } catch {
    // Storage blocked: the pick lasts for this visit only.
  }
}
