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
  /** The slot of the move it used last (the AI mixes its moves). */
  lastSlot?: number;
  /** Seconds spent well away from its trainer while following (party.ts: a hop back after a while). */
  farT?: number;
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
  /**
   * A channelled beam in progress (config battle.channel): seconds left, time to the next pulse,
   * the beam's current direction, and where its user wants it to point (steered each frame).
   */
  channel?: { moveId: string; left: number; next: number; dirX: number; dirY: number; aimX: number; aimY: number; manual?: boolean } | null;
  /** The last move was aimed by the player's hand (a beam from it follows the cursor), not by auto-battle or AI. */
  manualCast?: boolean;
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
  /** Seconds it has been trying to move without getting anywhere (stuck on something). */
  stuckT?: number;
  /** A target it couldn't reach, left alone for `chaseBlockT` seconds. */
  chaseBlockId?: number;
  chaseBlockT?: number;
  /** A battling AI Pokémon's side-step in progress (seconds left, which way), and seconds to the next one. */
  sidestep?: { t: number; side: number } | null;
  sidestepIn?: number;
  /** Steps in a row it has tried to walk without getting anywhere (it stands after a few: party.ts setWalking). */
  stillSteps?: number;
  /** Stepping round an obstacle (movement.ts moveAround). */
  detourSide?: number;
  detourT?: number;
  recall: boolean;
  /** Seconds since this Pokémon last took damage (info bars show after a hit). */
  sinceHit: number;
  /** Has anything damaged it yet (a Quick Ball works only on one that hasn't been hit). */
  everHit?: boolean;
  /** A dodge in progress: dash velocity (tiles/s) and seconds of dash and of untouchability left. */
  dodge?: { vx: number; vy: number; dash: number; safe: number } | null;
  /** Capture Styler: loops drawn round it so far, and seconds left calmed (no fighting, easy to catch). */
  styler?: number;
  calm?: number;
  /** A legendary from Hoopa's portal or the lake: worn down to its last HP it joins whoever beat it. */
  legend?: boolean;
  /**
   * Shadow Lugia's darkness: drawn dark purple in a black aura, it never falls asleep in the storm,
   * balls bounce off it and only a Snag Machine takes it. It keeps the mark after joining (and in the PC).
   */
  shadow?: boolean;
  /** Seconds to Shadow Lugia's next Shadow Storm; whether the "snag it now" hint was shown. */
  shadowStormT?: number;
  snagHinted?: boolean;
  /** A Pokémon that is part of the scenery (Hoopa): nobody fights or catches it. */
  npc?: 'hoopa';
  /** A leap in progress (Lugia out of the lake): seconds in, total seconds, peak height in tiles, start and end points. */
  leap?: { t: number; dur: number; h: number; fx: number; fy: number; tx: number; ty: number; slam?: boolean } | null;
  /**
   * A contact move's lunge (Tackle, Bite, Close Combat...): the Pokémon rushes along the ground at
   * its target over the cast and strikes on arrival. `target` is tracked as it moves; `stop` is
   * how far short of its middle the lunge ends (the two bodies just touching).
   */
  lunge?: { t: number; dur: number; target: Mon | null; tx: number; ty: number; stop: number; /** Tiles a second it can cover (it cannot catch a target that outruns it). */ speed?: number; /** Tiles it may still travel (a little over its planned lunge, for a target that sidesteps). */ budget?: number; /** Seconds of wind-up before it sets off (it strikes on the move's planned time). */ wait?: number } | null;
  /** A shove from a contact hit: velocity in tiles a second and seconds left. */
  knock?: { vx: number; vy: number; t: number } | null;
  /** Moves used so far (counts casts), and the cast Life Orb last took its recoil for. */
  castSeq?: number;
  orbPaid?: number;
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
  /** Seconds toward the next Leftovers heal. */
  leftoversT?: number;
  /** The one-on-one battle this Pokémon is fighting in: it only fights the other side of that battle. */
  duelId?: number;
}

export interface TrainerStats {
  catches: number;
  knockouts: number;
  /** Other trainers knocked out of the match by this trainer's Pokémon. */
  eliminations?: number;
  damage: number;
  timeSurvived: number;
}

export type TrainerAi = 'roam' | 'seekItem' | 'engage' | 'flee' | 'heal' | 'hunt' | 'shop';

export interface Trainer {
  id: number;
  name: string;
  /** Character key in assets/rangers/manifest.json. */
  role: string;
  isPlayer: boolean;
  /** Online squads: trainers on the same team never fight each other, and the last team standing wins. */
  team?: number;
  x: number;
  y: number;
  px: number;
  py: number;
  dir: Dir8;
  moving: boolean;
  walkPhase: number;
  party: Mon[];
  /**
   * Eggs (from the Breeder). Each takes a party slot (see partySize) but is not a Pokémon: it never
   * fights, is never the lead and is not in `party`. It hatches after `need` tiles walked.
   */
  eggs?: EggSlot[];
  /** Bag tab: balls and consumables. */
  items: Array<InventorySlot | null>;
  /** Gear tab: held items and TMs. */
  held: Array<InventorySlot | null>;
  /** What this trainer keeps in the town storage chests (one store shared by every chest). */
  storage?: Array<InventorySlot | null>;
  alive: boolean;
  /** Wiped out by wild Pokémon: back in the match at this time (see Match.down). */
  downUntil?: number | null;
  /** Seconds spent in the storm (drains outside it); at Match.trainerStormSeconds the trainer collapses. */
  stormT?: number;
  /** Passed out in the storm: Darkrai has them (seconds since); they are out when it ends (match.ts). */
  grabbed?: number;
  /** What knocked out the trainer's latest Pokémon: a wild one, a trainer's, or anything else. */
  lastKo?: 'wild' | 'trainer' | 'other';
  /** The trainer whose Pokémon made that knockout (credited if it ends this trainer's match). */
  lastKoBy?: Trainer;
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
  /** AI: where it was a second ago, and until when it is working itself free of a notch (Match.stepAi). */
  wedge?: { x: number; y: number; at: number; until: number };
  /** A computer trainer's hands (src/sim/bot.ts): the wild it is out to catch, balls thrown at it, timers. */
  bot?: BotState;
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
  /** An online player inside their reconnect window: their lead fights for them, even in a duel. */
  away?: boolean;
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

/** What a computer trainer is doing with its hands (src/sim/bot.ts). */
export interface BotState {
  /** The wild Pokémon it is wearing down to catch: its team holds back once it is weak. */
  catchTarget: Mon | null;
  /** Balls thrown at the current catch target. */
  balls: number;
  /** Seconds until it next looks through its bag. */
  bagT: number;
  /** Boost items used in the current trainer battle (one per Pokémon sent out). */
  boosted: Set<number>;
  /** Items it has used and balls it has thrown this match (the bot report counts them). */
  used: number;
  thrown: number;
  /** Spots it backed away from (a wild that would beat it), until a match time. */
  avoid?: Array<{ x: number; y: number; until: number }>;
  /** Seconds it has spent wandering with nothing to hunt, and where it set off exploring to. */
  idleT?: number;
  sinceHunt?: number;
  exploring?: { x: number; y: number } | null;
  /** Why it last fled (for the bot report). */
  why?: 'hurt' | 'rival' | 'wild';
  /** The hunt it is on: since when, and its target's HP when it last went down. */
  hunt?: { key: string; since: number; hp: number };
}

/** An Egg in a party slot: what it holds is known only to the server (TownsfolkCrew). */
export interface EggSlot {
  id: number;
  /** Tiles walked with it so far. */
  steps: number;
  /** Tiles to walk before it hatches. */
  need: number;
}

/** Party slots in use: Pokémon (not the ones that have left) plus Eggs. */
export function partySize(t: Trainer): number {
  return t.party.length + (t.eggs?.length ?? 0);
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
