/**
 * Player settings, kept in this browser: key bindings, music volume, screen shake and the simple
 * graphics mode. The Options screen (src/ui/optionsScreen.ts) edits them.
 *
 * Key bindings are a remap layer under src/core/input.ts: the game keeps asking for its default
 * key codes (KeyQ, Space...), and Input translates the physical key the player pressed into the
 * default code it stands for. So rebinding never touches the code that reads the keys.
 */
export interface KeyAction {
  /** The default key code the game listens for. */
  code: string;
  label: string;
}

/** Every rebindable action, in the order the Options screen lists them. */
export const KEY_ACTIONS: KeyAction[] = [
  { code: 'KeyW', label: 'Move up' },
  { code: 'KeyA', label: 'Move left' },
  { code: 'KeyS', label: 'Move down' },
  { code: 'KeyD', label: 'Move right' },
  { code: 'KeyQ', label: 'Use move 1' },
  { code: 'KeyE', label: 'Use move 2' },
  { code: 'Space', label: 'Talk / pick up / fish / dodge' },
  { code: 'Tab', label: 'Target nearest wild' },
  { code: 'KeyF', label: 'Throw a ball' },
  { code: 'KeyC', label: 'Capture Styler (hold)' },
  { code: 'KeyV', label: 'Ride / land' },
  { code: 'KeyM', label: 'Mega Evolve' },
  { code: 'KeyR', label: 'Auto-battle on / off' },
  { code: 'KeyG', label: 'Held items & TMs' },
  { code: 'KeyN', label: 'Music on / off' },
];

export interface Settings {
  /** Default code -> the physical key code the player chose (only changed ones are stored). */
  binds: Record<string, string>;
  /** Music volume 0..1. */
  music: number;
  /** Camera shake on heavy hits. */
  shake: boolean;
  /** Plain Canvas 2D drawing instead of WebGL lighting (for browsers that flicker). */
  simpleGraphics: boolean;
}

const KEY = 'almia.settings.v1';
const DEFAULTS: Settings = { binds: {}, music: 0.8, shake: true, simpleGraphics: false };

function load(): Settings {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Settings>;
    return { ...DEFAULTS, ...raw, binds: { ...(raw.binds ?? {}) } };
  } catch {
    return { ...DEFAULTS, binds: {} };
  }
}

export const settings: Settings = typeof window === 'undefined' ? { ...DEFAULTS, binds: {} } : load();

const listeners = new Set<() => void>();

export function saveSettings(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    /* storage blocked: the settings last this visit */
  }
  for (const l of listeners) l();
}

export function onSettings(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** The physical key bound to an action (its default when not rebound). */
export function boundKey(code: string): string {
  return settings.binds[code] ?? code;
}

/** A key code as a player reads it: KeyQ -> Q, Digit1 -> 1, ShiftLeft -> Left Shift. */
export function keyName(code: string): string {
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return `Num ${code.slice(6)}`;
  if (code.startsWith('Arrow')) return `${code.slice(5)} arrow`;
  const named: Record<string, string> = { ShiftLeft: 'Left Shift', ShiftRight: 'Right Shift', ControlLeft: 'Left Ctrl', ControlRight: 'Right Ctrl', AltLeft: 'Left Alt', AltRight: 'Right Alt', Space: 'Space', Tab: 'Tab', Enter: 'Enter', Backquote: '`', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/', Backslash: '\\', CapsLock: 'Caps Lock' };
  return named[code] ?? code;
}

/**
 * Translates a physical key into the code the game listens for: a key someone bound to an action
 * becomes that action's default code; a default key whose action moved elsewhere is ignored (so
 * the old key stops doing it); anything else passes through.
 */
export function logicalKey(physical: string): string | null {
  for (const [def, phys] of Object.entries(settings.binds)) if (phys === physical && def !== physical) return def;
  if (settings.binds[physical] && settings.binds[physical] !== physical) return null;
  return physical;
}
