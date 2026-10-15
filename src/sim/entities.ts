import type { Dir8 } from '../core/math';
import type { AnimPlayer, PokemonSprites } from '../sprites/pokemonSprite';
import type { SpeciesDef, StatBlock } from './data';
import type { Behavior } from './party';
import type { BallKind, LootTier } from './items';

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
  /** Stat stages for atk/def/spe (-6..6); spe shortens cooldowns. */
  stages: { atk: number; def: number; spe: number };
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
  /** Party behaviour (see sim/party.ts). */
  behavior: Behavior;
  xp: number;
  /** Formation wandering state. */
  wander: { x: number; y: number; t: number } | null;
  wanderPause: number;
  /** Roaming: current destination, and whether it has been told to come back. */
  roamTarget: { x: number; y: number } | null;
  recall: boolean;
  /** Seconds since this Pokémon last took damage (info bars show after a hit). */
  sinceHit: number;
  /** Capture tween applied when drawing: scale and alpha in [0,1], red flash in [0,1]. */
  visual: { scale: number; alpha: number; flash: number };
  /** Evolving in the field: the species it becomes, seconds in, and whether the swap happened. */
  evolving: { to: string; t: number; swapped: boolean } | null;
  /** A land's boss: stays near its lair and only fights what comes close. */
  landBoss?: boolean;
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
  /** Bag tab: balls and consumables. */
  items: Array<InventorySlot | null>;
  /** Gear tab: held items and TMs. */
  held: Array<InventorySlot | null>;
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
  /** AI: seconds until it reconsiders sending a member roaming. */
  roamTimer: number;
  /** Poké Dollars (data/shops.json). */
  money: number;
  /** The castle challenger: not one of the battle royale's rivals. */
  challenger?: boolean;
}

export interface InventorySlot {
  id: string;
  count: number;
}

export interface GroundItem {
  id: number;
  /** Which ball sprite sits on the ground. */
  ball: BallKind;
  /** Loot tier the contents roll from when the ball is opened (null when the contents are fixed). */
  tier: LootTier | null;
  /** Known contents (an eliminated trainer's bag, a placed ball); null until rolled. */
  contents: InventorySlot[] | null;
  /** Cherish Ball: also heals the finder's party fully. */
  heal?: boolean;
  x: number;
  y: number;
  bob: number;
}

/** The lead: the first member that is standing and with the trainer (not roaming, not in a ball). */
export function lead(t: Trainer): Mon | null {
  return t.party.find((m) => !m.fainted && !m.captured && m.behavior !== 'roam' && m.behavior !== 'roam-aggressive') ?? null;
}

export function activeParty(t: Trainer): Mon[] {
  return t.party.filter((m) => !m.fainted);
}
