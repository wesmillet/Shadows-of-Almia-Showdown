import type { Dir8 } from '../core/math';
import type { AnimPlayer, PokemonSprites } from '../sprites/pokemonSprite';
import type { SpeciesDef, StatBlock } from './data';

export type Status = 'sleep' | 'burn' | 'paralysis' | null;

export interface Mon {
  id: number;
  dex: string;
  species: SpeciesDef;
  name: string;
  level: number;
  hp: number;
  maxHp: number;
  stats: StatBlock;
  /** Stat stages for atk/def (-6..6). */
  stages: { atk: number; def: number };
  types: string[];
  moves: string[];
  cooldowns: number[];
  x: number;
  y: number;
  px: number;
  py: number;
  dir: Dir8;
  anim: AnimPlayer;
  sprites: PokemonSprites;
  owner: Trainer | null;
  wild: boolean;
  boss: boolean;
  fainted: boolean;
  status: Status;
  statusTimer: number;
  /** Seconds left of the white hit flash. */
  flash: number;
  /** Wild wandering. */
  homeX: number;
  homeY: number;
  targetX: number;
  targetY: number;
  idleTimer: number;
  moving: boolean;
  /** Darkness. */
  inDark: boolean;
  drowsy: number;
  outsideDark: number;
  aura: boolean;
  heldItem: string | null;
  /** Seconds since this mon last moved (wilds idle in place). */
  busy: number;
  /** Fired when an attack animation should resolve (set by the battle system). */
  casting: null | { moveId: string; t: number; targetX: number; targetY: number; targetId: number | null };
  /** Current hostile this Pokémon is focused on (its own targeting). */
  target: Mon | null;
  /** True while shut inside a Poké Ball: cannot act or be targeted. */
  captured: boolean;
}

export interface TrainerStats {
  catches: number;
  knockouts: number;
  damage: number;
  timeSurvived: number;
}

export type TrainerAi = 'roam' | 'seekItem' | 'engage' | 'flee' | 'heal';

export interface Trainer {
  id: number;
  name: string;
  /** Character key in assets/rangers/manifest.json. */
  role: string;
  isPlayer: boolean;
  x: number;
  y: number;
  px: number;
  py: number;
  dir: Dir8;
  moving: boolean;
  walkPhase: number;
  party: Mon[];
  history: Array<{ x: number; y: number }>;
  items: Array<InventorySlot | null>;
  alive: boolean;
  stats: TrainerStats;
  /** AI brain. */
  ai: TrainerAi;
  aiTimer: number;
  aiTarget: { x: number; y: number } | null;
  /** Ranger outpost heal progress. */
  healing: number;
  /** Match time the trainer may next use an outpost. */
  outpostReady: number;
  /** Seconds until the AI's lead picks its next move. */
  attackTimer: number;
}

export interface InventorySlot {
  id: string;
  count: number;
}

export interface GroundItem {
  id: number;
  itemId: string;
  x: number;
  y: number;
  bob: number;
}

export function lead(t: Trainer): Mon | null {
  return t.party.find((m) => !m.fainted) ?? null;
}

export function activeParty(t: Trainer): Mon[] {
  return t.party.filter((m) => !m.fainted);
}
