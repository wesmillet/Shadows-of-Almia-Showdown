/**
 * Visitors who roam the island alongside the battle royale:
 *   - the Wandering Merchant, whose stall (Space beside him) sells rare items;
 *   - Ace Trainer Celeste, who takes on anyone who asks (a one-on-one battle with
 *     a strong team); beat her and she hands over a shiny or a powerful Pokémon;
 *   - Hoopa, who floats about until the player talks to it, then opens a ring
 *     portal: a legendary comes through as a boss, and when it is worn down to
 *     its last HP it joins whoever beat it;
 *   - Lugia, asleep under Tide Lake: a Super Rod cast into the lake can hook it (a small
 *     chance, src/sim/fishing.ts); it bursts out and lands on the shore as a legendary. Once the
 *     darkness swallows the lake it is Shadow Lugia instead (level 100, snagged, never caught).
 * Each happens once per match (the merchant and Celeste stay all match).
 */
import { isDev } from '../dev';
import { dirFromVector } from '../core/math';
import { CONFIG, SPECIES } from './data';
import type { BattleEvent } from './battle';
import type { Mon, Trainer } from './entities';
import { activeParty } from './entities';
import type { Match } from './match';
import { canStand, tryMove } from './movement';
import type { Shop } from './town';

/** The merchant's stock: rare things the town stalls do not carry (at most ten lines with the Storm Mask). */
const MERCHANT_STOCK: Array<[string, number]> = [
  ['rare-candy', 900], ['super-rod', 4000], ['master-ball', 8000], ['extraction-voucher', 6000],
  ['leftovers', 2200], ['life-orb', 2600], ['crystal-shard', 1500], ['max-revive', 2500],
];
const STONES = ['fire-stone', 'water-stone', 'thunder-stone', 'leaf-stone', 'ice-stone', 'moon-stone', 'sun-stone', 'shiny-stone', 'dusk-stone', 'dawn-stone'];

/** Celeste's team and her prizes. */
const ACE_TEAM = ['0445', '0448', '0130'];
const SHINY_PRIZES = ['0448-shiny', '0445-shiny', '0149-shiny', '0248-shiny', '0130-shiny'];
const POWER_PRIZES = ['0376', '0373', '0706', '0887', '0149', '0248', '1007', '1008'];
/** What can come through Hoopa's portal. */
const PORTAL_LEGENDS = ['0250', '0245', '0381', '0384-shiny', '0243', '1007', '1008', '0888', '0889'];
const LUGIA = '0249';
/** Shadow Lugia: SpriteCollab's own Shadow form of Lugia (sprite/0249/0001). */
const SHADOW_LUGIA = '0249-shadow';
/** Hoopa's true form, if a Pokémon you steer hits it. */
const HOOPA_UNBOUND = '0720-unbound';
/** What Hoopa calls out of the storm when you talk to it inside the darkness. */
const SHADOW_MEWTWO = '0150-shadow';

type Walker = { npc: Trainer; goal: { x: number; y: number } | null; wait: number };

export interface Portal {
  x: number;
  y: number;
  /** Seconds since it opened; the legend steps out at 1.6 s, the ring closes at 4 s. */
  t: number;
  dex: string;
  out: Mon | null;
  /** Opened inside the storm: a shadow legendary comes through (Shadow Mewtwo). */
  shadow?: boolean;
}

export class Visitors {
  merchant: Walker | null = null;
  ace: Walker | null = null;
  aceState: 'idle' | 'battle' | 'won' = 'idle';
  aceFoe: Trainer | null = null;
  aceReadyAt = 0;
  hoopa: Mon | null = null;
  hoopaGoal: { x: number; y: number } | null = null;
  hoopaUsed = false;
  portal: Portal | null = null;
  lugiaDone = false;
  /** Lugia's entrance in progress: the lake churns, Lugia bursts out (Guardian Signs' Lugia sheet), then leaps ashore. */
  lugiaIntro: { t: number; L: Mon; from: { x: number; y: number }; to: { x: number; y: number }; stage: number; shadow?: boolean } | null = null;

  constructor(private readonly m: Match) {
    const rng = m.rng;
    const spot = (minFromPlayer = 30) => {
      for (let i = 0; i < 200; i++) {
        const x = rng.int(10, m.ground.cols - 10) + 0.5;
        const y = rng.int(10, m.ground.rows - 10) + 0.5;
        if (!m.ground.reachable(Math.floor(x), Math.floor(y))) continue;
        if (Math.hypot(x - m.player.x, y - m.player.y) < minFromPlayer) continue;
        return { x, y };
      }
      return { x: m.centerX + 6, y: m.centerY + 6 };
    };
    // The merchant: a stall that walks.
    const ms = spot();
    const merchant = m.makeTrainer('Wandering Merchant', 'merchant', false, ms.x, ms.y);
    const stock = MERCHANT_STOCK.map(([id, price]) => ({ id, price }));
    // One stone of the day.
    stock.push({ id: STONES[rng.int(0, STONES.length - 1)] as string, price: 1100 });
    // Now and then (every match in tester mode) a Storm Mask: the one way to last in the storm.
    const dk = CONFIG.darkness as { stormMaskChance?: number; stormMaskPrice?: number };
    if (isDev() || rng.chance(dk.stormMaskChance ?? 0.05)) stock.unshift({ id: 'storm-mask', price: dk.stormMaskPrice ?? 20000 });
    m.npcs.push(merchant);
    m.shops.push({ npc: merchant, town: 'Wandering', name: 'Wandering Merchant', stock } as Shop);
    this.merchant = { npc: merchant, goal: null, wait: 0 };
    // Celeste.
    const as = spot();
    const ace = m.makeTrainer('Ace Trainer Celeste', 'ace', false, as.x, as.y);
    m.npcs.push(ace);
    this.ace = { npc: ace, goal: null, wait: 0 };
    // Hoopa, floating somewhere away from the start, in only some matches (hoopaChance;
    // ?hoopa=1 in the address, or tester mode, src/dev.ts, brings it every match).
    const forced = isDev() || (typeof location !== 'undefined' && new URLSearchParams(location.search).get('hoopa') === '1');
    if (forced || rng.chance(CONFIG.visitors.hoopaChance)) {
      const hs = spot(45);
      const h = m.makeMon('0720', 50, null, hs.x, hs.y);
      h.npc = 'hoopa';
      h.calm = 1e9;
      h.busy = 1e9;
      // Never worn down: the first hit from a Pokémon you steer unbinds it instead (hoopaStruck).
      h.maxHp = h.hp = 99999;
      m.wilds.push(h);
      this.hoopa = h;
    }
  }

  // ---------------------------------------------------------------- stepping

  /** Visitors the player has already been told about (once each, the first time they come near). */
  private announced = new Set<string>();

  private announce(key: string, x: number, y: number, text: string): void {
    if (this.announced.has(key)) return;
    const p = this.m.player;
    if (Math.hypot(x - p.x, y - p.y) > 14) return;
    this.announced.add(key);
    this.m.battle.events.push({ type: 'notice', text, seconds: 3.2 });
  }

  step(dt: number): void {
    const m = this.m;
    if (this.merchant) this.announce('merchant', this.merchant.npc.x, this.merchant.npc.y, 'A Wandering Merchant is nearby: rare items for sale (Space to shop)');
    if (this.ace && this.aceState === 'idle') this.announce('ace', this.ace.npc.x, this.ace.npc.y, 'Ace Trainer Celeste is looking for a challenge (Space to battle)');
    if (this.hoopa && !this.hoopaUsed) this.announce('hoopa', this.hoopa.x, this.hoopa.y, 'Hoopa is floating nearby, giggling... (Space to talk)');
    if (this.merchant) this.walk(this.merchant, dt, 2.0);
    if (this.ace && this.aceState === 'idle') this.walk(this.ace, dt, 2.4);
    if (this.aceFoe) {
      // Her battle team holds its ground, facing the player.
      const f = this.aceFoe;
      f.moving = false;
      f.dir = dirFromVector(m.player.x - f.x, m.player.y - f.y, f.dir);
    }
    this.stepHoopa(dt);
    this.stepPortal(dt);
    this.stepLugia(dt);
  }

  /** Walks a visitor between far-apart points on the island; they stop for anyone standing close. */
  private walk(w: Walker, dt: number, speed: number): void {
    const m = this.m;
    const n = w.npc;
    if (Math.hypot(m.player.x - n.x, m.player.y - n.y) < 3) {
      n.moving = false;
      n.dir = dirFromVector(m.player.x - n.x, m.player.y - n.y, n.dir);
      return;
    }
    if (w.wait > 0) {
      w.wait -= dt;
      n.moving = false;
      return;
    }
    if (!w.goal) {
      for (let i = 0; i < 30 && !w.goal; i++) {
        const a = m.rng.range(0, Math.PI * 2);
        const r = m.rng.range(18, 40);
        const x = n.x + Math.cos(a) * r;
        const y = n.y + Math.sin(a) * r;
        if (m.ground.reachable(Math.floor(x), Math.floor(y))) w.goal = { x, y };
      }
      if (!w.goal) return;
    }
    const d = m.nav.dir(n.x, n.y, w.goal.x, w.goal.y);
    if (!d) {
      w.goal = null;
      w.wait = m.rng.range(5, 12);
      n.moving = false;
      return;
    }
    const moved = tryMove(m.ground, n, d.x * speed * dt, d.y * speed * dt, 0.2);
    n.dir = dirFromVector(d.x, d.y, n.dir);
    m.afterTrainerMove(n, moved);
    if (moved < speed * dt * 0.1) {
      w.goal = null;
      w.wait = 1;
    }
  }

  private stepHoopa(dt: number): void {
    const h = this.hoopa;
    if (!h) return;
    h.calm = 1e9;
    if (this.hoopaUsed) {
      // Its work done, Hoopa fades away.
      h.visual.alpha = Math.max(0, h.visual.alpha - dt * 0.5);
      if (h.visual.alpha <= 0) {
        this.m.wilds = this.m.wilds.filter((w) => w !== h);
        this.hoopa = null;
      }
      return;
    }
    // Drifts about slowly, never far from where it started.
    if (!this.hoopaGoal || Math.hypot(this.hoopaGoal.x - h.x, this.hoopaGoal.y - h.y) < 0.3) {
      const a = this.m.rng.range(0, Math.PI * 2);
      const x = h.homeX + Math.cos(a) * this.m.rng.range(1, 6);
      const y = h.homeY + Math.sin(a) * this.m.rng.range(1, 4);
      this.hoopaGoal = canStand(this.m.ground, x, y, 0.2) ? { x, y } : { x: h.homeX, y: h.homeY };
    }
    const dx = this.hoopaGoal.x - h.x;
    const dy = this.hoopaGoal.y - h.y;
    const d = Math.hypot(dx, dy) || 1;
    const step = Math.min(d, 0.9 * dt);
    h.x += (dx / d) * step;
    h.y += (dy / d) * step;
    h.dir = dirFromVector(dx, dy, h.dir);
    if (h.anim.action !== 'Walk') h.anim.play('Walk');
  }

  // ---------------------------------------------------------------- talking

  /** The visitor the player can talk to, if one is in reach. */
  near(reach = 1.8): 'ace' | 'hoopa' | null {
    const p = this.m.player;
    if (this.ace && this.aceState === 'idle' && Math.hypot(this.ace.npc.x - p.x, this.ace.npc.y - p.y) <= reach) return 'ace';
    if (this.hoopa && !this.hoopaUsed && Math.hypot(this.hoopa.x - p.x, this.hoopa.y - p.y) <= reach + 0.6) return 'hoopa';
    return null;
  }

  /** Space beside Celeste: a one-on-one battle with her strong team. */
  challengeAce(): string {
    const m = this.m;
    const a = this.ace;
    if (!a || this.aceState !== 'idle') return '';
    if (m.time < this.aceReadyAt) return `Celeste: "Catch your breath first. ${Math.ceil(this.aceReadyAt - m.time)}s."`;
    if (m.player.duelId) return '';
    if (!activeParty(m.player).length) return 'Celeste: "Come back with a Pokémon that can fight."';
    const lvl = Math.min(100, Math.max(15, Math.max(...m.player.party.map((x) => x.level)) + 3));
    const foe = m.makeTrainer('Ace Trainer Celeste', 'ace', false, a.npc.x, a.npc.y);
    foe.visitor = true;
    for (const dex of ACE_TEAM) {
      if (!SPECIES.has(dex)) continue;
      const mon = m.makeMon(dex, lvl, foe, foe.x, foe.y + 1);
      mon.behavior = 'aggressive';
      foe.party.push(mon);
    }
    m.placeParty(foe);
    m.trainers.push(foe);
    m.npcs = m.npcs.filter((n) => n !== a.npc);
    this.aceFoe = foe;
    this.aceState = 'battle';
    m.startDuel(m.player, foe);
    return `Celeste: "Let's see if you're worth my best!" (Lv ${lvl})`;
  }

  /** Space beside Hoopa: it opens a portal and something legendary comes through. */
  askHoopa(): string {
    const m = this.m;
    const h = this.hoopa;
    if (!h || this.hoopaUsed) return '';
    this.hoopaUsed = true;
    // The ring opens a few tiles from the player, on open ground.
    const p = m.player;
    let at = { x: p.x + 3, y: p.y };
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      const x = p.x + Math.cos(a) * 3.5;
      const y = p.y + Math.sin(a) * 3.5;
      if (canStand(m.ground, x, y, 0.4) && m.ground.reachable(Math.floor(x), Math.floor(y))) {
        at = { x, y };
        break;
      }
    }
    // Asked inside the storm, Hoopa reaches into the darkness instead: Shadow Mewtwo comes through.
    const storm = m.isDark(p.x, p.y) && SPECIES.has(SHADOW_MEWTWO);
    const pool = PORTAL_LEGENDS.filter((d) => SPECIES.has(d));
    const dex = storm ? SHADOW_MEWTWO : (pool[m.rng.int(0, pool.length - 1)] as string);
    this.portal = { x: at.x, y: at.y, t: 0, dex, out: null, shadow: storm };
    h.anim.play('Charge', { restart: true });
    m.battle.events.push({ type: 'scene-fx', id: 'fx_190', x: at.x, y: at.y, scale: 3, ground: true, tint: storm ? '#5a1f8f' : '#5b8cff', shake: storm ? 0.5 : 0 });
    if (storm) return 'Hoopa: "Out here in the storm? Let\'s see what the dark is hiding!" A black ring tears open...';
    return 'Hoopa: "Ta-da! Want to see something AMAZING?" A ring portal opens!';
  }

  private stepPortal(dt: number): void {
    const po = this.portal;
    if (!po) return;
    po.t += dt;
    if (!po.out && po.t >= 1.6) {
      const m = this.m;
      const top = Math.max(1, ...m.player.party.map((x) => x.level));
      // Well above your team: your best level + portalLevelOver, never below portalLevelMin.
      const v = CONFIG.visitors as { portalLevelOver?: number; portalLevelMin?: number };
      const lvl = Math.min(100, Math.max(v.portalLevelMin ?? 60, top + (v.portalLevelOver ?? 20)));
      const sl = CONFIG.shadowLugia;
      const L = m.makeMon(po.dex, po.shadow ? sl.level : lvl, null, po.x, po.y);
      this.makeLegend(L);
      if (po.shadow) this.makeShadow(L);
      L.visual.scale = 0.15;
      L.visual.flash = 1;
      m.wilds.push(L);
      po.out = L;
      // It challenges the player to a one-on-one bout (a trainer-style battle); if they can't fight
      // right now it stays out as a wild boss anyone can wear down.
      const bout = m.startLegendBout(L);
      if (po.shadow) {
        m.battle.events.push({ type: 'scene-fx', id: 'fx_114', x: L.x, y: L.y, scale: 3.6, ground: true, fps: 12, tint: '#3a1458', shake: 0.6 });
        m.battle.events.push({ type: 'notice', text: bout ? `${L.name} tears out of the dark portal and attacks!` : `${L.name} tears out of the dark portal!`, seconds: 3.5 });
        this.shadowBoutNotice(true, bout);
      } else m.battle.events.push({ type: 'notice', text: bout ? `${L.name} came through the portal and challenges you! Wear it down to its last HP and it joins you` : `${L.name} came through the portal! Wear it down and it will join you`, seconds: 3.5 });
    }
    if (po.out && po.out.visual.scale < 1) po.out.visual.scale = Math.min(1, po.out.visual.scale + dt * 1.5);
    if (po.out && po.out.visual.flash > 0) po.out.visual.flash = Math.max(0, po.out.visual.flash - dt * 1.5);
    if (po.t >= 4) {
      if (po.out) po.out.visual.flash = 0;
      this.portal = null;
    }
  }

  /**
   * A shadow legendary (Shadow Lugia, Shadow Mewtwo): config shadowLugia's HP multiplier, Shadow
   * Storm on a timer, balls bounce off, and only a Snag Machine under snagBelow HP takes it.
   */
  private makeShadow(L: Mon): void {
    const sl = CONFIG.shadowLugia;
    L.shadow = true;
    L.maxHp = L.hp = Math.round(L.stats.hp * sl.hpMult);
    L.shadowStormT = (sl.stormEvery[0] as number) * 0.6;
  }

  /**
   * A Pokémon the player steers hit Hoopa (match.ts calls this with the step's battle events; only
   * a steered Pokémon can hit it, battle.ts isEnemy): it unbinds into Hoopa Unbound at level 100
   * and battles the player one-on-one. Once a match, and Hoopa is gone afterwards.
   */
  hoopaStruck(events: readonly BattleEvent[]): void {
    const h = this.hoopa;
    if (!h || this.hoopaUsed || !SPECIES.has(HOOPA_UNBOUND)) return;
    const hit = events.find((e) => e.type === 'hit' && e.target === h);
    if (!hit) return;
    const m = this.m;
    this.hoopaUsed = true;
    this.portal = null;
    m.wilds = m.wilds.filter((w) => w !== h);
    this.hoopa = null;
    const L = m.makeMon(HOOPA_UNBOUND, 100, null, h.x, h.y);
    this.makeLegend(L);
    L.dir = h.dir;
    L.visual.scale = 0.3;
    L.visual.flash = 1;
    m.wilds.push(L);
    m.battle.events.push({ type: 'scene-fx', id: 'fx_190', x: L.x, y: L.y, scale: 4.2, ground: true, tint: '#c03a2b', shake: 0.8 });
    m.battle.events.push({ type: 'scene-fx', id: 'fx_114', x: L.x, y: L.y, scale: 3.4, ground: true, fps: 12, tint: '#5a1f8f' });
    m.battle.events.push({ type: 'notice', text: 'Hoopa: "That HURT! Fine... no more holding back!" Hoopa is unbound!', seconds: 3.5 });
    const bout = m.startLegendBout(L);
    if (!bout) L.visual.scale = 1;
    m.battle.events.push({ type: 'notice', text: bout ? 'Hoopa Unbound (Lv 100) battles you! Wear it down or catch it' : 'Hoopa Unbound (Lv 100) is loose!', seconds: 3.5 });
  }

  /** A legendary boss: triple HP, angry at anyone near, and it yields instead of fainting. */
  private makeLegend(L: Mon): void {
    L.legend = true;
    L.landBoss = true;
    L.maxHp = L.hp = L.maxHp * 3;
    L.behavior = 'aggressive';
  }

  // ---------------------------------------------------------------- Lugia

  private stepLugia(dt: number): void {
    const m = this.m;
    const lake = m.ground.features?.lake;
    // A leap in progress: along an arc from the water to the shore.
    for (const w of m.wilds) {
      const lp = w.leap;
      if (!lp) continue;
      lp.t += dt;
      const k = Math.min(1, lp.t / lp.dur);
      w.x = w.px = lp.fx + (lp.tx - lp.fx) * k;
      w.y = w.py = lp.fy + (lp.ty - lp.fy) * k;
      if (k >= 1) {
        w.leap = null;
        w.anim.play('Idle', { restart: true });
        // A big landing ring for Lugia, a small one for a fish leaping ashore.
        m.battle.events.push({ type: 'scene-fx', id: 'fx_070', x: w.x, y: w.y, scale: lp.h >= 3 ? 2.4 : 0.9, ground: true });
      }
    }
    this.stepLugiaIntro(dt);
    void lake;
  }

  /** True while Lugia can still be hooked this match (a Super Rod in Tide Lake, src/sim/fishing.ts). */
  lugiaAvailable(): boolean {
    return !this.lugiaDone && !!this.m.ground.features?.lake && SPECIES.has(LUGIA);
  }

  /** True when a point is in Tide Lake (its ellipse, a tile of margin). */
  inTideLake(x: number, y: number): boolean {
    const lake = this.m.ground.features?.lake;
    return !!lake && ((x - lake.x) / (lake.rx + 1)) ** 2 + ((y - lake.y) / (lake.ry + 1)) ** 2 < 1;
  }

  /** True when a Super Rod cast to this point would draw Shadow Lugia: Tide Lake, swallowed by the darkness, Lugia still below. */
  shadowLugiaWaits(x: number, y: number): boolean {
    return this.lugiaAvailable() && SPECIES.has(SHADOW_LUGIA) && this.inTideLake(x, y) && this.m.isDark(x, y);
  }

  /**
   * Shadow Lugia takes the bait (fishing.ts, a Super Rod in the darkened lake): the same entrance
   * as Lugia (SpriteCollab's Shadow Lugia sprites) in a black aura, at config shadowLugia.level. See Match.stepLegendMon for how it
   * fights and Match.snagShadow for the only way to take it.
   */
  summonShadowLugia(from: { x: number; y: number }): boolean {
    return this.summonLugia(from, true);
  }

  /** Lugia takes the bait: it bursts out of the water at `from` (the bobber) and leaps ashore by the player. */
  summonLugia(from: { x: number; y: number }, shadow = false): boolean {
    if (!this.lugiaAvailable()) return false;
    const m = this.m;
    const lake = m.ground.features?.lake as { x: number; y: number };
    const p = m.player;
    this.lugiaDone = true;
    let to = { x: p.x + 2.5, y: p.y };
    for (let i = 0; i < 24; i++) {
      const a = Math.atan2(lake.y - p.y, lake.x - p.x) + ((i % 2 ? 1 : -1) * Math.ceil(i / 2) * Math.PI) / 12;
      const x = p.x + Math.cos(a) * 4.5;
      const y = p.y + Math.sin(a) * 4.5;
      if (canStand(m.ground, x, y, 0.4)) {
        to = { x, y };
        break;
      }
    }
    const top = Math.max(1, ...p.party.map((x) => x.level));
    const sl = CONFIG.shadowLugia;
    const L = m.makeMon(shadow ? SHADOW_LUGIA : LUGIA, shadow ? sl.level : Math.min(100, Math.max(70, top + 15)), null, from.x, from.y);
    this.makeLegend(L);
    if (shadow) {
      L.shadow = true;
      L.maxHp = L.hp = Math.round(L.stats.hp * sl.hpMult);
      L.shadowStormT = (sl.stormEvery[0] as number) * 0.6;
      // Its kit: the beam it sweeps, a dark pulse, a shadow ball, and Psychic.
      L.moves = ['aeroblast', 'dark-pulse', 'shadow-ball', 'psychic'];
      L.cooldowns = L.moves.map(() => 0);
    }
    // Hidden under the water until it bursts out (and nobody's enemy until it lands).
    L.visual.alpha = 0;
    L.calm = 1e9;
    L.busy = 5;
    L.leap = { t: 0, dur: 99, h: 0, fx: from.x, fy: from.y, tx: from.x, ty: from.y };
    m.wilds.push(L);
    this.lugiaIntro = { t: 0, L, from, to, stage: 0, shadow };
    m.battle.events.push({ type: 'notice', text: shadow ? 'You hooked it... the black lake heaves!' : 'Something huge took the bait... Tide Lake churns!', seconds: 2.5 });
    return true;
  }

  /** The entrance, beat by beat: ripples, the burst out of the water, the leap ashore. */
  private stepLugiaIntro(dt: number): void {
    const s = this.lugiaIntro;
    if (!s) return;
    const m = this.m;
    s.t += dt;
    const { from, to, L } = s;
    if (s.stage === 0) {
      // Rings spreading on the water.
      const ring = s.shadow ? '#8a3dff' : undefined;
      for (const [i, r] of [1.6, 2.6, 3.6].entries()) m.battle.events.push({ type: 'scene-fx', id: ['fx_225', 'fx_226', 'fx_229'][i] as string, x: from.x, y: from.y, scale: r, ground: true, fps: 9, tint: ring });
      s.stage = 1;
    } else if (s.stage === 1 && s.t >= 1.1) {
      // Lugia bursts out of the lake (Guardian Signs' own Lugia sheet), in a column of spray.
      const ink = s.shadow ? '#5a1f8f' : undefined;
      m.battle.events.push({ type: 'scene-fx', id: 'fx_135', x: from.x, y: from.y, scale: 2.6, lift: 2.2, fps: 7, shake: 0.7, tint: ink });
      m.battle.events.push({ type: 'scene-fx', id: 'fx_081', x: from.x, y: from.y, scale: 3.2, tint: ink });
      m.battle.events.push({ type: 'scene-fx', id: 'fx_070', x: from.x, y: from.y, scale: 3.6, ground: true, tint: ink });
      m.battle.events.push({ type: 'notice', text: s.shadow ? 'SHADOW LUGIA rises from the storm-black lake!' : 'Lugia bursts out of the lake!', seconds: 3 });
      s.stage = 2;
    } else if (s.stage === 2 && s.t >= 2.0) {
      // Then it leaps ashore beside the player and turns to fight.
      L.visual.alpha = 1;
      L.leap = { t: 0, dur: 1.2, h: 3.5, fx: from.x, fy: from.y, tx: to.x, ty: to.y };
      L.anim.play('Hop', { restart: true, loop: false });
      L.busy = 1.6;
      s.stage = 3;
    } else if (s.stage === 3 && !L.leap) {
      L.calm = 0;
      const bout = m.startLegendBout(L);
      if (s.shadow && !bout) {
        // The player is busy (another battle, say): Shadow Lugia circles, untouchable, and waits.
        L.calm = 1e9;
        s.stage = 4;
        s.t = 0;
        m.battle.events.push({ type: 'notice', text: 'Shadow Lugia circles over the shore, waiting for you...', seconds: 3 });
        return;
      }
      this.shadowBoutNotice(s.shadow, bout);
      m.battle.events.push({ type: 'scene-fx', id: 'fx_067', x: L.x, y: L.y, scale: 2.4, ground: true, shake: 0.5 });
      this.lugiaIntro = null;
    } else if (s.stage === 4) {
      // Waiting on the player: the bout starts the moment they are free; gone if they fall or take too long.
      if (!m.player.alive || m.finalStarted || s.t > 30 || L.fainted || L.captured) {
        m.wilds = m.wilds.filter((w) => w !== L);
        m.battle.events.push({ type: 'scene-fx', id: 'fx_114', x: L.x, y: L.y, scale: 3.4, ground: true, fps: 12, tint: '#3a1458' });
        m.battle.events.push({ type: 'notice', text: 'Shadow Lugia sank back into the black water...', seconds: 3 });
        this.lugiaIntro = null;
        return;
      }
      if (m.startLegendBout(L)) {
        this.shadowBoutNotice(true, true);
        m.battle.events.push({ type: 'scene-fx', id: 'fx_067', x: L.x, y: L.y, scale: 2.4, ground: true, shake: 0.5 });
        this.lugiaIntro = null;
      } else L.calm = 1e9;
    }
  }

  /** What the player hears as Shadow Lugia's bout starts. */
  private shadowBoutNotice(shadow: boolean | undefined, bout: boolean): void {
    if (!shadow || !bout) return;
    const snag = this.m.snagSlot(this.m.player) >= 0;
    this.m.battle.events.push({
      type: 'notice',
      text: snag ? 'Balls will bounce off it. Wear it under 10% HP, then use your Snag Machine!' : 'Balls bounce off it, and you have no Snag Machine... survive if you can!',
      seconds: 4,
    });
  }

  // ---------------------------------------------------------------- outcomes

  /** A legendary worn down to its last HP joins whoever's Pokémon did it. */
  legendYields(L: Mon, by: Mon | null): void {
    const m = this.m;
    const t = by?.owner;
    if (!t || !L.legend) return;
    L.legend = false;
    L.landBoss = false;
    L.wild = false;
    L.owner = t;
    L.maxHp = Math.round(L.maxHp / 3);
    L.hp = Math.max(1, Math.round(L.maxHp * 0.5));
    L.target = null;
    this.m.battle.interrupt(L);
    L.status = null;
    L.behavior = 'guard';
    m.wilds = m.wilds.filter((w) => w !== L);
    if (t.party.length >= m.partyCap) {
      // No room: it flies off, leaving the trainer a voucher to remember it by.
      L.captured = true;
      if (t.isPlayer) m.giveItem(t, 'extraction-voucher', 1);
      m.battle.events.push({ type: 'notice', text: t.isPlayer ? `${L.name} wanted to join, but your party is full. It leaves you an Extraction Voucher` : `${L.name} flew off`, seconds: 3.5 });
      return;
    }
    t.party.push(L);
    if (t.duelId) L.stowed = true;
    m.battle.events.push({ type: 'notice', text: t.isPlayer ? `${L.name} acknowledges your strength and joins your team!` : `${L.name} joined ${t.name}'s team!`, seconds: 3.5 });
  }

  /** After each step: Celeste's battle won or lost. */
  check(): void {
    const m = this.m;
    const foe = this.aceFoe;
    if (!foe || this.aceState !== 'battle') return;
    const pl = m.player;
    const lost = pl.alive && !pl.party.some((x) => !x.fainted && !x.captured);
    const won = !foe.party.some((x) => !x.fainted && !x.captured);
    if (!lost && !won) return;
    foe.alive = false;
    for (const x of foe.party) x.captured = true;
    m.trainers = m.trainers.filter((t) => t !== foe);
    this.aceFoe = null;
    if (this.ace) {
      this.ace.npc.x = this.ace.npc.px = foe.x;
      this.ace.npc.y = this.ace.npc.py = foe.y;
      m.npcs.push(this.ace.npc);
    }
    if (won) {
      this.aceState = 'won';
      const shiny = m.rng.chance(0.5);
      const pool = (shiny ? SHINY_PRIZES : POWER_PRIZES).filter((d) => SPECIES.has(d));
      const dex = pool[m.rng.int(0, pool.length - 1)] as string;
      const top = Math.max(1, ...pl.party.map((x) => x.level));
      m.battle.events.push({ type: 'scene-fx', id: 'fx_239', x: pl.x, y: pl.y, scale: 2.4, lift: 1, fps: 10 });
      m.battle.events.push({ type: 'scene-fx', id: 'fx_175', x: pl.x, y: pl.y, scale: 2.4, ground: true, fps: 10, tint: '#ffd6f0' });
      if (pl.party.length >= m.partyCap) {
        // No room for a Pokémon: she hands over a voucher (and some money) instead.
        m.giveItem(pl, 'extraction-voucher', 1);
        pl.money += 2000;
        m.battle.events.push({ type: 'notice', text: 'Celeste: "Your team is full? Then take this." An Extraction Voucher and ₽2000!', seconds: 4 });
      } else {
        const prize = m.makeMon(dex, top, pl, pl.x, pl.y + 0.8);
        prize.behavior = 'guard';
        pl.party.push(prize);
        m.battle.events.push({ type: 'notice', text: `Celeste: "You earned this." She gives you ${shiny ? 'a shiny ' : ''}${prize.name}!`, seconds: 4 });
      }
    } else {
      // A friendly bout: she patches your team up and you may try again later.
      this.aceState = 'idle';
      this.aceReadyAt = m.time + 60;
      for (const x of pl.party) {
        if (x.captured) continue;
        x.fainted = false;
        x.hp = Math.max(1, Math.round(x.maxHp * 0.25));
        x.status = null;
        x.anim.play('Idle', { restart: true });
        x.x = x.px = pl.x;
        x.y = x.py = pl.y + 0.6;
      }
      m.battle.events.push({ type: 'notice', text: 'Celeste wins this one. She patched your Pokémon up. Try again in a minute', seconds: 3.5 });
    }
  }
}

/** Every species a visitor can bring into a match (main.ts preloads their sprites). */
export const VISITOR_DEXES = ['0720', HOOPA_UNBOUND, SHADOW_MEWTWO, LUGIA, ...PORTAL_LEGENDS, ...ACE_TEAM, ...SHINY_PRIZES, ...POWER_PRIZES];
