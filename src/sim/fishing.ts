/**
 * Fishing (data/fishing.json). With a rod in the bag, the player faces the water and presses Space
 * (or uses the rod): the line goes out a few tiles, the bobber waits, and when something bites the
 * player has a moment to press Space again and hook it. What bites depends on the rod's odds: a
 * Pokémon from the common, uncommon or rare pool (it bursts out of the water and leaps ashore to
 * fight), an item ball, or, with a Super Rod in Tide Lake, Lugia. Moving reels the line in.
 *
 * Once the darkness has swallowed Tide Lake, a Super Rod cast there draws Shadow Lugia instead
 * (config shadowLugia, once a match): a long, tense wait in the storm, a violet ripple, and only
 * half a second to hook it.
 *
 * Stages: cast (the bobber flies out) → wait → bite (Space to hook) → reel → done.
 */
import { DIR_VECTORS, dirFromVector } from '../core/math';
import fishingJson from '../../data/fishing.json';
import { CONFIG } from './data';
import type { Mon, Trainer } from './entities';
import { lead } from './entities';
import { formAtLevel } from './evolution';
import { ITEMS, ballOfTier, rollLoot, type LootTier } from './items';
import type { Match } from './match';
import { canStand } from './movement';

type Odds = { common: number; uncommon: number; rare: number; item: number; legend: number };
interface RodDef { odds: Odds; wait: [number, number]; levels: [number, number]; itemTier: LootTier }
const FISH = fishingJson as unknown as {
  reach: number; castSeconds: number; biteWindow: number; reelSeconds: number; centerLevelFactor: number;
  rods: Record<string, RodDef>;
  pools: Record<'common' | 'uncommon' | 'rare', Array<[string, number]>>;
};

export const RODS = ['super-rod', 'good-rod', 'old-rod'] as const;

export type FishStage = 'cast' | 'wait' | 'bite' | 'reel';

export interface FishingState {
  rod: string;
  stage: FishStage;
  /** Seconds in the current stage. */
  t: number;
  /** Where the bobber sits (tiles), and where the line leaves the shore. */
  bx: number;
  by: number;
  /** Seconds of waiting before the bite. */
  wait: number;
  /** The direction the trainer faces (unit vector). */
  fx: number;
  fy: number;
  /** Shadow Lugia's line: the long wait and the short hook window. */
  shadow?: boolean;
}

const SHADOW = CONFIG.shadowLugia;

/** The best rod in a trainer's bag, if any. */
export function bestRod(t: Trainer): string | null {
  for (const r of RODS) if (t.items.some((s) => s?.id === r)) return r;
  return null;
}

/**
 * Where a cast from here would land: the trainer must stand by water (within 1.5 tiles), facing it
 * or, failing that, turned to the nearest water. Returns the bobber point and the facing, or null.
 */
export function castSpot(m: Match, t: Trainer): { bx: number; by: number; fx: number; fy: number } | null {
  const g = m.ground;
  const water = (x: number, y: number) => g.biomeAt(Math.floor(x), Math.floor(y)) === 'water';
  const dirs: Array<{ x: number; y: number }> = [];
  const f = DIR_VECTORS[t.dir] as { x: number; y: number };
  dirs.push(f);
  for (const d of DIR_VECTORS) if (d !== f) dirs.push(d as { x: number; y: number });
  for (const d of dirs) {
    const n = Math.hypot(d.x, d.y) || 1;
    const ux = d.x / n;
    const uy = d.y / n;
    // Water close in front...
    let edge = -1;
    for (let k = 0.6; k <= 1.6; k += 0.2) {
      if (water(t.x + ux * k, t.y + uy * k)) {
        edge = k;
        break;
      }
    }
    if (edge < 0) continue;
    // ...and the bobber `reach` tiles out, pulled back until it is on water.
    for (let r = FISH.reach; r >= edge + 0.6; r -= 0.25) {
      const bx = t.x + ux * r;
      const by = t.y + uy * r;
      if (water(bx, by)) return { bx, by, fx: ux, fy: uy };
    }
  }
  return null;
}

/** Can the player start fishing right now? (A rod, water in reach, nothing else going on.) */
export function canFish(m: Match): boolean {
  const p = m.player;
  if (m.fishing || p.duelId || p.downUntil !== undefined || m.controlled || p.mount) return false;
  return !!bestRod(p) && !!castSpot(m, p);
}

/** Casts the line with `rod` (or the best rod carried). Returns a message for the player. */
export function startFishing(m: Match, rod: string | null = null): string {
  const p = m.player;
  if (m.fishing) return '';
  if (p.duelId) return "You can't fish during a battle";
  if (m.controlled) return 'Go back to your trainer (Esc) to fish';
  if (p.mount) return 'Get off your mount (V) to fish';
  const r = rod ?? bestRod(p);
  if (!r) return 'You need a fishing rod';
  const spot = castSpot(m, p);
  if (!spot) return 'Stand at the water\'s edge to fish';
  const def = FISH.rods[r] as RodDef;
  p.dir = dirFromVector(spot.fx, spot.fy, p.dir);
  p.moving = false;
  const shadow = r === 'super-rod' && m.visitors.shadowLugiaWaits(spot.bx, spot.by);
  const wait = shadow ? m.rng.range(SHADOW.waitSeconds[0] as number, SHADOW.waitSeconds[1] as number) : m.rng.range(def.wait[0], def.wait[1]);
  m.fishing = { rod: r, stage: 'cast', t: 0, bx: spot.bx, by: spot.by, wait, fx: spot.fx, fy: spot.fy, shadow };
  m.battle.events.push({ type: 'fish', stage: 'cast', x: spot.bx, y: spot.by });
  return '';
}

/** Space while fishing: hooks a bite, or reels in early (a cast with nothing on it yet). */
export function hookOrReel(m: Match): string {
  const f = m.fishing;
  if (!f) return '';
  if (f.stage === 'bite') {
    f.stage = 'reel';
    f.t = 0;
    return '';
  }
  if (f.stage === 'cast') return '';
  m.fishing = null;
  return 'You reeled in. Nothing bit yet';
}

/** Advances the line; movement (or anything that pulls the trainer away) reels it in. */
export function stepFishing(m: Match, dt: number): void {
  const f = m.fishing;
  if (!f) return;
  const p = m.player;
  if (p.duelId || p.downUntil !== undefined || m.controlled || m.moveX !== 0 || m.moveY !== 0) {
    m.fishing = null;
    if (f.stage === 'bite') m.battle.events.push({ type: 'notice', text: 'It got away...', seconds: 1.4 });
    return;
  }
  p.moving = false;
  f.t += dt;
  if (f.stage === 'cast' && f.t >= FISH.castSeconds) {
    f.stage = 'wait';
    f.t = 0;
    m.battle.events.push({ type: 'fish', stage: 'land', x: f.bx, y: f.by });
    if (f.shadow) m.battle.events.push({ type: 'notice', text: 'The black water goes still... something vast stirs below. Wait for it.', seconds: 3 });
  } else if (f.stage === 'wait' && f.shadow && f.t < f.wait - 1) {
    // The long wait: now and then a dark ring spreads from somewhere under the bobber.
    if (Math.floor(f.t / 4) !== Math.floor((f.t - dt) / 4)) {
      m.battle.events.push({ type: 'scene-fx', id: 'fx_225', x: f.bx + m.rng.range(-1.5, 1.5), y: f.by + m.rng.range(-1, 1), scale: 1.6, ground: true, fps: 7, tint: '#3a1458' });
    }
  } else if (f.stage === 'wait' && f.t >= f.wait) {
    f.stage = 'bite';
    f.t = 0;
    m.battle.events.push({ type: 'fish', stage: 'bite', x: f.bx, y: f.by });
    if (f.shadow) {
      // The violet ripple: the only warning.
      m.battle.events.push({ type: 'scene-fx', id: 'fx_225', x: f.bx, y: f.by, scale: 2.4, ground: true, fps: 14, tint: '#b04dff' });
      m.battle.events.push({ type: 'scene-fx', id: 'fx_226', x: f.bx, y: f.by, scale: 3.2, ground: true, fps: 14, tint: '#7a2cff' });
    }
  } else if (f.stage === 'bite' && f.t >= (f.shadow ? SHADOW.biteWindow : FISH.biteWindow)) {
    m.fishing = null;
    m.battle.events.push({ type: 'notice', text: f.shadow ? 'The shadow sank back into the depths... (it bites only for half a second)' : 'It got away... (press Space when the "!" shows)', seconds: 2.4 });
  } else if (f.stage === 'reel' && f.t >= FISH.reelSeconds) {
    m.fishing = null;
    land(m, f);
  }
}

/** What came up: rolled by the rod's odds. */
function land(m: Match, f: FishingState): void {
  const def = FISH.rods[f.rod] as RodDef;
  const p = m.player;
  if (f.shadow && m.visitors.summonShadowLugia({ x: f.bx, y: f.by })) return;
  const o = def.odds;
  const total = o.common + o.uncommon + o.rare + o.item + o.legend;
  let roll = m.rng.next() * total;
  let kind: keyof Odds = 'common';
  for (const k of ['legend', 'item', 'rare', 'uncommon', 'common'] as const) {
    if (roll < o[k]) {
      kind = k;
      break;
    }
    roll -= o[k];
  }
  // Lugia only bites in Tide Lake, once a match; anywhere else (or later) it is a rare catch.
  if (kind === 'legend' && !(m.visitors.inTideLake(f.bx, f.by) && m.visitors.summonLugia({ x: f.bx, y: f.by }))) kind = 'rare';
  if (kind === 'legend') return;
  const shore = shoreSpot(m, f);
  m.battle.events.push({ type: 'scene-fx', id: 'fx_070', x: f.bx, y: f.by, scale: 1.1, ground: true });
  if (kind === 'item') {
    const tier = def.itemTier;
    m.placeBall(ballOfTier(tier), [rollLoot(m.rng, tier, p.party.map((x) => x.dex))], shore.x, shore.y);
    m.battle.events.push({ type: 'notice', text: `You fished up a ${ITEMS[`${ballOfTier(tier)}-ball`]?.name ?? 'ball'}! (Space to open it)`, seconds: 2.4 });
    return;
  }
  const pool = FISH.pools[kind];
  const pick = m.rng.weighted(pool, (r) => r[1]);
  const lv = def.levels;
  const level = Math.min(100, m.rng.int(lv[0], lv[1]) + Math.round(m.centerBonus(f.bx, f.by) * FISH.centerLevelFactor));
  const dex = formAtLevel(pick[0], level, m.rng, true);
  const shiny = m.rng.chance(CONFIG.wild.shinyChance * m.shinyBoost);
  const w: Mon = m.makeMon(dex, level, null, f.bx, f.by, shiny);
  // It bursts out of the water and leaps ashore beside the trainer (visitors.ts moves leaps), then fights.
  w.leap = { t: 0, dur: 0.85, h: 2.2, fx: f.bx, fy: f.by, tx: shore.x, ty: shore.y };
  w.anim.play('Hop', { restart: true, loop: false });
  w.busy = 1.4;
  w.dir = dirFromVector(p.x - f.bx, p.y - f.by, w.dir);
  w.target = lead(p);
  m.wilds.push(w);
  const label = kind === 'rare' ? 'Rare catch! ' : '';
  m.battle.events.push({ type: 'notice', text: `${label}A wild ${shiny ? 'shiny ' : ''}${w.name} (Lv ${w.level}) bit!`, seconds: 2.6 });
}

/** A standing spot on the shore a couple of tiles to the side of the trainer, toward the water. */
function shoreSpot(m: Match, f: FishingState): { x: number; y: number } {
  const p = m.player;
  const side = m.rng.chance(0.5) ? 1 : -1;
  for (let i = 0; i < 16; i++) {
    const a = Math.atan2(f.fy, f.fx) + side * (Math.PI / 2) * (0.35 + 0.08 * i) * (i % 2 ? -1 : 1);
    const r = 1.8 + (i % 3) * 0.4;
    const x = p.x + Math.cos(a) * r;
    const y = p.y + Math.sin(a) * r;
    if (canStand(m.ground, x, y, 0.3)) return { x, y };
  }
  return { x: p.x - f.fy * 1.5, y: p.y + f.fx * 1.5 };
}

/** The rod's odds, for UI text. */
export function rodOdds(rod: string): Odds | null {
  return FISH.rods[rod]?.odds ?? null;
}

export const FISHING = FISH;
