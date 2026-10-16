import type { Dir8 } from '../core/math';
import type { AnimPlayer, PokemonSprites } from '../sprites/pokemonSprite';
import type { SpeciesDef, StatBlock } from './data';
import type { Behavior } from './party';
import type { BallKind, LootTier } from './items';
import type { DecorItem } from '../ground/types';

export type Status = 'sleep' | 'burn' | 'paralysis' | 'poison' | 'freeze' | 'confusion' | null;

/** Asleep or frozen: cannot move or use moves. */
export function incapable(m: { status: Status }): boolean {
  return m.status === 'sleep' || m.status === 'freeze';
}

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
  /** A dodge in progress: dash velocity (tiles/s) and seconds of dash and of untouchability left. */
  dodge?: { vx: number; vy: number; dash: number; safe: number } | null;
  /** Capture Styler: loops drawn round it so far, and seconds left calmed (no fighting, easy to catch). */
  styler?: number;
  calm?: number;
  /** A legendary from Hoopa's portal or the lake: worn down to its last HP it joins whoever beat it. */
  legend?: boolean;
  /** A Pokémon that is part of the scenery (Hoopa): nobody fights or catches it. */
  npc?: 'hoopa';
  /** A leap in progress (Lugia out of the lake): seconds in, total seconds, peak height in tiles, start and end points. */
  leap?: { t: number; dur: number; h: number; fx: number; fy: number; tx: number; ty: number; slam?: boolean } | null;
  /** Seconds until this Pokémon can dodge again. */
  dodgeCd?: number;
  /** Capture tween applied when drawing: scale and alpha in [0,1], red flash in [0,1]. */
  visual: { scale: number; alpha: number; flash: number };
  /** Evolving in the field: the species it becomes, seconds in, and whether the swap happened. */
  evolving: { to: string; t: number; swapped: boolean; mega?: boolean } | null;
  /** A land's boss: stays near its lair and only fights what comes close. */
  landBoss?: boolean;
  /** A tougher wild: higher level (often evolved), more XP. */
  elite?: boolean;
  /** An Alpha: a huge, fully evolved level-75 wild near the Shadow Crystal. */
  alpha?: boolean;
  /** A shiny: its sheets recoloured with the species' shiny palette. Kept through evolution. */
  shiny?: boolean;
  /** Steered by the player (Pokémon mode): the party logic leaves it alone. */
  steered?: boolean;
  /** Mega Evolved this match; `megaFrom` is the form it came from (what the PC stores). */
  mega?: boolean;
  /** A legend's fighting phase in a bout: 0 calm, 1 pressed (under 2/3 HP), 2 enraged (under 1/3). */
  legendPhase?: number;
  megaFrom?: { dex: string; name: string };
  /** Back in its Poké Ball while its trainer is in a one-on-one battle (not drawn, cannot act or be hit). */
  stowed?: boolean;
  /** The one-on-one battle this Pokémon is fighting in: it only fights the other side of that battle. */
  duelId?: number;
}

export interface TrainerStats {
  catches: number;
  knockouts: number;
  damage: number;
  timeSurvived: number;
}

export type TrainerAi = 'roam' | 'seekItem' | 'engage' | 'flee' | 'heal' | 'hunt';

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
  /** What this trainer keeps in the town storage chests (one store shared by every chest). */
  storage?: Array<InventorySlot | null>;
  alive: boolean;
  /** Wiped out by wild Pokémon: back in the match at this time (see Match.down). */
  downUntil?: number;
  /** What knocked out the trainer's latest Pokémon: a wild one, a trainer's, or anything else. */
  lastKo?: 'wild' | 'trainer' | 'other';
  stats: TrainerStats;
  /** AI brain. */
  ai: TrainerAi;
  aiTimer: number;
  aiTarget: { x: number; y: number } | null;
  /** AI: what it is walking to ('m12' a wild, 'i4' an item, 'o2' an outpost) and its progress, for giving up when stuck. */
  aiKey?: string | null;
  aiProgress?: { best: number; since: number };
  /** AI: targets it gave up on (unreachable), by key, until a match time. */
  aiBans?: Record<string, number>;
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
  /** A vendor's market stand: drawn in front of the stand with the stand's counter redrawn over its legs. */
  counter?: DecorItem | null;
  /** The castle challenger: not one of the battle royale's rivals. */
  challenger?: boolean;
  /** A roaming visitor's battle team (the ace trainer): holds its ground, not a rival in the match. */
  visitor?: boolean;
  /** The one-on-one battle this trainer is in, if any. */
  duelId?: number;
  /** Match time before which this trainer cannot be drawn into another one-on-one battle. */
  duelReadyAt?: number;
  /** Mega Evolution is once a match per trainer. */
  megaUsed?: boolean;
  /** Riding or flying on a party Pokémon (Match.toggleRide); it is out of the fight meanwhile. */
  mount?: { mon: Mon; fly: boolean } | null;
  /** Not drawn (the stand-in "trainer" that holds a legendary in a legend bout). */
  hidden?: boolean;
  /** This side of a battle is a legendary fighting on its own (Match.startLegendBout). */
  legendBout?: boolean;
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
  return t.party.find((m) => !m.fainted && !m.captured && !m.stowed && m.behavior !== 'roam' && m.behavior !== 'roam-aggressive') ?? null;
}

export function activeParty(t: Trainer): Mon[] {
  return t.party.filter((m) => !m.fainted);
}
