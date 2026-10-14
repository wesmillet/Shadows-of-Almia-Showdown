/**
 * The match screen: feeds input to the simulation, turns battle events into
 * VFX, numbers, shake and hit-stop, draws the world through the lighting
 * pass and the HUD on top.
 */
import type { Input } from '../core/input';
import { clamp } from '../core/math';
import { Lighting } from '../render/lighting';
import type { View } from '../render/view';
import { renderWorld } from '../render/world';
import { areaContains, makeArea, R, type Area, type BattleEvent } from '../sim/battle';
import { CONFIG, MOVES, move, typeColor, type FxPart, type MoveDef } from '../sim/data';
import type { GroundItem, InventorySlot, Mon } from '../sim/entities';
import { lead } from '../sim/entities';
import type { Match } from '../sim/match';
import type { Assets } from '../sprites/assets';
import type { RangerSprites } from '../sprites/rangerSprite';
import { Floaters } from '../vfx/floaters';
import { phaseLabel } from '../sim/darkness';
import { isRoaming, nextBehavior } from '../sim/party';
import { ballKind, ballWobble, type Throw } from '../sim/catching';
import { Beam, drawPointLight, ImpactBurst, Projectile, RingPulse, SpriteStripVisual, StatusCloud, VfxLayer } from '../vfx/visuals';
import { drawInfoBar, Hud, type HudState } from './hud';
import type { PixelUi } from './pixelUi';
import { ItemIcons } from '../sprites/itemIcons';
import { BALL_LIST, ITEMS, type BallKind } from '../sim/items';
import { FxLibrary } from '../vfx/fxLibrary';
import { FxAnim, FxBeam, FxProjectile, type FxAnimOptions } from '../vfx/fxVisuals';
import { drawSoftShadow } from '../render/world';
import { rgba, type GameContext, type Screen } from './screens';

/** Effects used outside moves: the capture sequence, Bad Dreams and status icons. */
export const EXTRA_FX = {
  /** Poké Ball flash when the ball opens on impact. */
  flash: 'fx_176',
  /** The "sucked in" swirl on the target while it shrinks. */
  swirl: 'fx_144',
  /** Sparkle on the click of a successful catch. */
  click: 'fx_014',
  /** White puff when the target bursts free. */
  burst: 'fx_066',
  /** Darkrai's Bad Dreams, looping on sleeping Pokémon. */
  dreams: 'fx_158',
  sleep: 'fx_015',
  burn: 'fx_134',
  paralysis: 'fx_096',
} as const;

export class MatchScreen implements Screen {
  private readonly lighting: Lighting;
  private readonly hud: Hud;
  private readonly vfx = new VfxLayer();
  private readonly floaters = new Floaters();
  private notice = '';
  private noticeT = 0;
  private selectedItem = -1;
  private aimPower = 0;
  private aiming = false;
  private gearTab = false;
  private popup: { items: InventorySlot[]; ball: BallKind; healed: boolean; t: number } | null = null;
  private teach: { slot: number } | null = null;
  private readonly strips = new Map<string, HTMLImageElement | null>();
  protected readonly fx: FxLibrary;
  /** Sunnyside glint strip (6 frames of 7x7) that sparkles on ground balls. */
  private glint: HTMLImageElement | null = null;

  private endTimer = -1;
  protected readonly icons: ItemIcons;

  constructor(
    protected readonly ctx: GameContext,
    readonly match: Match,
    protected readonly rangers: RangerSprites,
    protected readonly assets: Assets,
    protected readonly ui: PixelUi,
    private readonly onEnd?: () => void,
  ) {
    this.lighting = new Lighting(ctx.view);
    this.icons = new ItemIcons(assets);
    this.hud = new Hud(ctx.view, this.icons, ui);
    this.fx = new FxLibrary(assets);
    const ids = new Set<string>(Object.values(EXTRA_FX));
    for (const m of MOVES.values()) for (const part of m.fx ?? []) ids.add(part.id);
    this.fx.preload(ids);
    this.icons.preload([...BALL_LIST.map((b) => b.id), 'crystal-shard']);
    void assets.loadImage('tiles/sunnyside/vfx/spr_deco_glint_01_strip6.png').then((img) => (this.glint = img));
    ctx.view.snapTo(match.player.x, match.player.y);
    ctx.view.zoom = ctx.view.targetZoom = 1;
  }

  say(s: string, seconds = 1.6): void {
    this.notice = s;
    this.noticeT = seconds;
  }

  step(dt: number, input: Input): void {
    if (this.match.outcome) {
      // Let the last hit land and the camera settle before the results.
      if (this.endTimer < 0) this.endTimer = 1.6;
      this.endTimer -= dt;
      this.vfx.update(dt);
      if (this.endTimer <= 0 && this.onEnd) {
        this.onEnd();
        this.endTimer = 99;
      }
      return;
    }
    if (this.popup) {
      this.popup.t -= dt;
      if (this.popup.t <= 0) this.popup = null;
    }
    if (this.teach) {
      this.handleTeachInput(input);
      return;
    }
    this.handleInput(input);
    this.match.step(dt, input);
    this.consumeEvents();
    if (this.noticeT > 0) {
      this.noticeT -= dt;
      if (this.noticeT <= 0) this.notice = '';
    }
  }

  protected handleInput(input: Input): void {
    const v = this.ctx.view;
    for (const c of input.takeClicks()) {
      const h = this.hud.hitTest(c.x, c.y);
      if (h?.kind === 'move') this.castFeedback(this.match.playerCast(h.index));
      else if (h?.kind === 'behavior') {
        const m = this.match.player.party[h.index];
        if (m && !m.fainted) {
          m.behavior = nextBehavior(m.behavior);
          m.recall = false;
          this.say(`${m.name}: ${m.behavior.replace('-', ' ')}`, 1);
        }
      } else if (h?.kind === 'portrait') {
        const m = this.match.player.party[h.index];
        if (m && isRoaming(m)) {
          this.hud.ping = { mon: m, t: 3 };
          this.say(`${m.name} is ${Math.hypot(m.x - this.match.player.x, m.y - this.match.player.y).toFixed(0)} tiles away (see minimap)`, 1.5);
        } else if (this.match.swapLead(h.index)) this.say(`${lead(this.match.player)?.name} takes the lead`);
      } else if (h?.kind === 'item') this.onItemSlot(h.index);
      else if (h?.kind === 'tab') this.gearTab = h.index === 1;
    }
    if (input.pressed('Tab')) this.gearTab = !this.gearTab;
    if (input.pressed('KeyR')) {
      const i = this.hud.hoveredPortrait(input.mouseX, input.mouseY);
      const m = i >= 0 ? this.match.player.party[i] : undefined;
      if (m && isRoaming(m)) {
        m.recall = true;
        this.say(`${m.name} is coming back`, 1.2);
      }
    }
    if (this.hud.ping) this.hud.ping.t -= 1 / 60;
    // 1-4 always cast; Shift+1-6 (or the bag panel) uses items.
    const shift = input.down('ShiftLeft') || input.down('ShiftRight');
    for (let i = 0; i < 6; i++) {
      if (!input.pressed(`Digit${i + 1}`)) continue;
      if (shift) this.onItemSlot(i);
      else if (i < 4) this.castFeedback(this.match.playerCast(i));
    }
    // Hold Space to aim a throw, release to let fly.
    const m = this.match;
    if (input.down('Space')) {
      if (!this.aiming) {
        const slot = m.ballSlot(m.player, this.selectedItem);
        if (slot < 0) {
          if (input.pressed('Space')) this.say('No Poké Balls in the bag', 1);
        } else {
          this.selectedItem = slot;
          this.aiming = true;
          this.aimPower = 0;
        }
      } else this.aimPower = Math.min(1, this.aimPower + (1 / 60) / CONFIG.catch.aimSeconds);
    } else if (this.aiming) {
      this.aiming = false;
      const slot = m.ballSlot(m.player, this.selectedItem);
      if (slot >= 0) {
        const to = this.aimPoint();
        const ballName = ITEMS[m.player.items[slot]?.id ?? '']?.name ?? 'Poké Ball';
        if (m.throwBall(m.player, slot, to)) this.say(`Go, ${ballName}!`, 0.8);
        if (!m.player.items[slot]) this.selectedItem = m.ballSlot(m.player);
      }
      this.aimPower = 0;
    }
    void v;
  }

  /** The TM prompt: 1-4 replaces that move, Escape keeps the current moves. */
  private handleTeachInput(input: Input): void {
    if (!this.teach) return;
    if (input.pressed('Escape')) {
      this.teach = null;
      return;
    }
    const slot = this.teach.slot;
    for (let i = 0; i < 4; i++) {
      if (input.pressed(`Digit${i + 1}`)) {
        const msg = this.match.teach(this.match.player, slot, i);
        this.say(msg || 'Could not teach that move', 2.2);
        this.teach = null;
        break;
      }
    }
    input.takeClicks();
  }

  /** Where the aimed ball will land: toward the nearest wild Pokémon, else straight ahead; distance from the hold time. */
  protected aimPoint(): { x: number; y: number } {
    const p = this.match.player;
    const dist = 0.8 + this.aimPower * (CONFIG.catch.aimMaxTiles - 0.8);
    const enemy = this.match.nearestEnemyMon(p, p.x, p.y, 6);
    let dx: number;
    let dy: number;
    if (enemy && enemy.wild) {
      dx = enemy.x - p.x;
      dy = enemy.y - p.y;
    } else {
      const d = [[0, 1], [1, 1], [1, 0], [1, -1], [0, -1], [-1, -1], [-1, 0], [-1, 1]][p.dir] as [number, number];
      dx = d[0];
      dy = d[1];
    }
    const n = Math.hypot(dx, dy) || 1;
    return { x: p.x + (dx / n) * dist, y: p.y + (dy / n) * dist };
  }

  /** The next bag slot after `from` that holds a ball (wrapping), or `from` itself. */
  private nextBallSlot(from: number): number {
    const items = this.match.player.items;
    for (let k = 1; k <= items.length; k++) {
      const i = (from + k) % items.length;
      if (ITEMS[items[i]?.id ?? '']?.kind === 'ball') return i;
    }
    return from;
  }

  /** Number keys and clicks on the bag: balls arm themselves, anything else is used at once; the gear tab equips or teaches. */
  protected onItemSlot(index: number): void {
    const p = this.match.player;
    if (this.gearTab) {
      const entry = p.held[index];
      const def = entry ? ITEMS[entry.id] : undefined;
      if (!entry || !def) return;
      if (def.kind === 'tm') {
        const m = lead(p);
        if (!m) return this.say('No Pokémon to teach', 1.2);
        if (!m.types.includes(def.tmType ?? '')) return this.say(`${m.name} cannot learn ${def.name.replace('TM ', '')} (${def.tmType} type)`, 2);
        this.teach = { slot: index };
        return;
      }
      const msg = this.match.equip(p, index);
      if (msg) this.say(msg, 1.4);
      return;
    }
    const entry = p.items[index];
    if (!entry) {
      this.selectedItem = -1;
      return;
    }
    const def = ITEMS[entry.id];
    if (def?.kind === 'ball') {
      // A ball's key arms it; the armed ball's key again cycles to the next ball type in the bag.
      this.selectedItem = this.selectedItem === index ? this.nextBallSlot(index) : index;
      const cur = ITEMS[p.items[this.selectedItem]?.id ?? ''];
      if (cur) this.say(`${cur.name} ready: hold Space to aim${cur.desc ? ` · ${cur.desc}` : ''}`, 1.6);
      return;
    }
    const msg = this.match.useItem(p, index);
    if (msg) this.say(msg, 1.4);
  }

  private castFeedback(r: ReturnType<Match['playerCast']>): void {
    if (r === 'cooldown') this.say('Not ready', 0.6);
    else if (r === 'asleep') this.say('Fast asleep…', 0.8);
    else if (r === 'no-lead') this.say('No Pokémon able to fight', 1);
  }

  /** World position of a sprite's effect anchor (hands / centre from the Offsets sheet). */
  protected anchorWorld(m: Mon): { x: number; y: number } {
    const v = this.ctx.view;
    const [ax, ay] = m.anim.anchor();
    const k = v.spriteScale / v.pxPerTile;
    return { x: m.x + ax * k, y: m.y + ay * k + 0.35 };
  }

  protected consumeEvents(): void {
    const v = this.ctx.view;
    const events = this.match.battle.events;
    this.match.battle.events = [];
    for (const ev of events) this.onEvent(ev, v);
  }

  protected onEvent(ev: BattleEvent, v: View): void {
    switch (ev.type) {
      case 'resolve':
        this.spawnMoveVfx(ev.attacker, ev.move, ev.area, ev.hits);
        break;
      case 'hit': {
        const color = typeColor(ev.move.type);
        if (ev.effectiveness === 0) this.floaters.add(ev.target.x, ev.target.y, 'No effect', '#cfd8dc', 16);
        else if (ev.damage > 0) {
          this.floaters.add(ev.target.x, ev.target.y, `${ev.crit ? '✦' : ''}${ev.damage}`, color, ev.effectiveness > 1 ? 30 : 22);
          if (ev.effectiveness > 1) this.floaters.add(ev.target.x + 0.2, ev.target.y - 0.4, 'Super effective!', '#ffd36b', 15);
          else if (ev.effectiveness < 1) this.floaters.add(ev.target.x + 0.2, ev.target.y - 0.4, 'Not very effective', '#b0bec5', 13);
          const frac = ev.damage / ev.target.maxHp;
          v.shake(clamp(4 + frac * 40, 4, 20), 0.22 + frac * 0.2);
          this.match.battle.hitStop = Math.max(this.match.battle.hitStop, CONFIG.battle.hitStopMs / 1000);
        }
        break;
      }
      case 'status': {
        const label = ev.status === 'sleep' ? 'Fell asleep!' : ev.status === 'burn' ? 'Burned!' : 'Paralyzed!';
        this.floaters.add(ev.target.x, ev.target.y - 0.3, label, ev.status === 'sleep' ? '#b39dff' : ev.status === 'burn' ? '#ff8a65' : '#ffe76b', 16);
        this.playFx(EXTRA_FX[ev.status], { x: ev.target.x, y: ev.target.y, lift: 1.15, scale: 2, fps: 12, loopSeconds: 1.6, follow: ev.target });
        break;
      }
      case 'stages':
        this.floaters.add(ev.target.x, ev.target.y - 0.3, `${ev.stat.toUpperCase()} ${ev.delta > 0 ? '▲' : '▼'}`, ev.delta > 0 ? '#9be7ff' : '#ff9e9e', 16);
        break;
      case 'tick':
        this.floaters.add(ev.target.x, ev.target.y, String(ev.damage), ev.source === 'burn' ? '#ff8a65' : '#c38bff', 15);
        // Bad Dreams: the nightmare cloud loops over the sleeper until the next tick.
        if (ev.source === 'dreams') this.playFx(EXTRA_FX.dreams, { x: ev.target.x, y: ev.target.y, lift: 1.1, scale: 2, fps: 10, loopSeconds: 1.05, follow: ev.target });
        break;
      case 'faint':
        this.floaters.add(ev.mon.x, ev.mon.y - 0.2, `${ev.mon.name} fainted`, '#ffffff', 15);
        break;
      case 'wake':
        this.floaters.add(ev.mon.x, ev.mon.y - 0.2, 'Woke up', '#e8e4f8', 13);
        break;
      case 'text':
        this.floaters.add(ev.mon.x, ev.mon.y - 0.2, ev.text, '#ffe76b', 14);
        break;
      case 'notice':
        this.say(ev.text, ev.seconds ?? 1.4);
        break;
      case 'ball-hit':
        // The ball opens: white flash over it.
        if (!this.playFx(EXTRA_FX.flash, { x: ev.x, y: ev.y, lift: 0.85, scale: 2, fps: 20 })) this.vfx.add(new ImpactBurst(ev.mon.x, ev.mon.y, '#ff6b6b', 0.6));
        break;
      case 'ball-absorb':
        // The target is sucked in: swirl on it while it shrinks.
        this.playFx(EXTRA_FX.swirl, { x: ev.mon.x, y: ev.mon.y, lift: 0.45, scale: 2, fps: 48, loopSeconds: 0.32, follow: ev.mon });
        break;
      case 'ball-click':
        if (!this.playFx(EXTRA_FX.click, { x: ev.x, y: ev.y, lift: 0.35, scale: 2, fps: 24 })) {
          this.vfx.add(new ImpactBurst(ev.x, ev.y, '#ffffff', 0.9));
          this.vfx.add(new RingPulse(ev.x, ev.y, 0.9, '#ffd36b', 0.7));
        }
        break;
      case 'ball-burst':
        this.playFx(EXTRA_FX.flash, { x: ev.x, y: ev.y, lift: 0.4, scale: 2, fps: 20 });
        if (!this.playFx(EXTRA_FX.burst, { x: ev.x, y: ev.y, lift: 0.5, scale: 2, fps: 24 })) this.vfx.add(new StatusCloud(ev.x, ev.y, '#ffffff', 0.9));
        break;
      case 'caught':
        if (ev.by.isPlayer) this.say(`Gotcha! ${ev.mon.name} joined the party!`, 2);
        break;
      case 'broke-free':
        this.floaters.add(ev.mon.x, ev.mon.y - 0.2, 'Broke free!', '#ff9e9e', 16);
        break;
      case 'pickup':
        if (ev.trainer.isPlayer) {
          this.popup = { items: ev.items, ball: ev.ball, healed: ev.healed, t: 2.8 };
          this.vfx.add(new ImpactBurst(ev.trainer.x, ev.trainer.y, '#ffe9a8', 0.6));
          if (ev.healed) this.say('The Cherish Ball restores your whole party!', 2.4);
          if (this.selectedItem < 0) this.selectedItem = this.match.ballSlot(this.match.player);
        }
        break;
      case 'xp':
        if (ev.mon.owner?.isPlayer) {
          this.floaters.add(ev.mon.x, ev.mon.y - 0.5, `+${ev.xp} XP`, '#9fd0ff', 12);
          if (ev.levels > 0) this.floaters.add(ev.mon.x, ev.mon.y - 0.9, `Level ${ev.mon.level}!`, '#ffe76b', 18);
        }
        break;
      case 'eliminated':
        this.say(ev.trainer.isPlayer ? 'Your whole party fainted…' : `${ev.trainer.name} was eliminated!`, 2.5);
        break;
      default:
        break;
    }
  }

  /** Plays one effect sheet when it is loaded; false means the caller should fall back. */
  private playFx(id: string, o: FxAnimOptions): boolean {
    const sheet = this.fx.sheet(id);
    if (!sheet) return false;
    this.vfx.add(new FxAnim(sheet, o));
    return true;
  }

  /**
   * A move's Guardian Signs effects, in order: attacker parts play on the user (beams and
   * streams run to the aim point), target parts play on every Pokémon hit (or the aimed tile),
   * a projectile flies to each target and the target parts listed after it play on arrival.
   */
  private spawnFx(attacker: Mon, parts: FxPart[], area: Area, hits: Mon[]): void {
    const from = { x: attacker.x, y: attacker.y };
    const targets: Array<{ x: number; y: number; mon: Mon | null }> = hits.length
      ? hits.map((h) => ({ x: h.x, y: h.y, mon: h }))
      : [{ x: area.tx, y: area.ty, mon: null }];
    const focus = hits[0] ? { x: hits[0].x, y: hits[0].y } : { x: area.fx, y: area.fy };
    const playAt = (part: FxPart, t: { x: number; y: number; mon: Mon | null }): void => {
      const sheet = this.fx.sheet(part.id);
      if (!sheet) return;
      if (part.mode === 'status') {
        this.vfx.add(new FxAnim(sheet, { x: t.x, y: t.y, lift: 1.15, scale: part.scale ?? 2, fps: part.fps ?? 15, loopSeconds: 1.6, follow: t.mon, tint: part.tint }));
      } else {
        this.vfx.add(new FxAnim(sheet, { x: t.x, y: t.y, lift: 0.45, scale: part.scale ?? 3, fps: part.fps ?? 15, tint: part.tint }));
      }
    };
    let projectile: FxPart | null = null;
    const impacts: FxPart[] = [];
    for (const part of parts) {
      if (part.anchor === 'projectile') {
        projectile = part;
        continue;
      }
      if (part.anchor === 'attacker') {
        const sheet = this.fx.sheet(part.id);
        if (!sheet) continue;
        if (part.mode === 'beam' || part.mode === 'stream') {
          this.vfx.add(new FxBeam(sheet, { from, to: focus, mode: part.mode, lift: 0.5, scale: part.scale ?? 3, fps: part.fps ?? 15, tint: part.tint }));
        } else playAt(part, { x: attacker.x, y: attacker.y, mon: attacker });
        continue;
      }
      if (projectile) impacts.push(part);
      else for (const t of targets) playAt(part, t);
    }
    if (projectile) {
      const sheet = this.fx.sheet(projectile.id);
      const proj = projectile;
      for (const t of targets) {
        if (!sheet) {
          for (const p of impacts) playAt(p, t);
          continue;
        }
        this.vfx.add(new FxProjectile(sheet, {
          from, to: { x: t.x, y: t.y }, lift: 0.5, scale: proj.scale ?? 3, fps: proj.fps ?? 15, tint: proj.tint,
          onHit: () => {
            for (const p of impacts) playAt(p, t);
          },
        }));
      }
    }
  }

  private spawnMoveVfx(attacker: Mon, m: MoveDef, area: Area, hits: Mon[]): void {
    if (m.fx?.length && this.fx.ready(m.fx.map((p) => p.id))) {
      this.spawnFx(attacker, m.fx, area, hits);
      return;
    }
    // Procedural families: only for moves with no effect assigned (or one still loading).
    const color = typeColor(m.type);
    const size = m.size ?? 1;
    const from = this.anchorWorld(attacker);
    const target = hits[0] ? { x: hits[0].x, y: hits[0].y } : { x: area.tx, y: area.ty };
    if (m.strip) {
      const img = this.strips.get(m.strip);
      if (img === undefined) {
        this.strips.set(m.strip, null);
        void this.assets.loadImage(`vfx/${m.strip}`).then((i) => this.strips.set(m.strip as string, i));
      } else if (img) {
        this.vfx.add(new SpriteStripVisual(img, img.naturalHeight, img.naturalHeight, 18, target.x, target.y, color));
        return;
      }
    }
    switch (m.vfx) {
      case 'burst':
        if (hits.length) for (const h of hits) this.vfx.add(new ImpactBurst(h.x, h.y, color, size));
        else this.vfx.add(new ImpactBurst(target.x, target.y, color, size * 0.7));
        break;
      case 'projectile':
        this.vfx.add(new Projectile(from.x, from.y - 0.35, target.x, target.y, color, size, () => {
          this.vfx.add(new ImpactBurst(target.x, target.y, color, size));
        }));
        break;
      case 'beam':
        this.vfx.add(new Beam(from.x, from.y - 0.35, area.fx, area.fy, (m.shape === 'cone' ? 2.8 : 3.3) * R(), color, size * R(), m.shape === 'cone'));
        for (const h of hits) this.vfx.add(new ImpactBurst(h.x, h.y, color, size * 0.7));
        break;
      case 'ring':
        this.vfx.add(new RingPulse(attacker.x, attacker.y, 2.3 * R(), color, size));
        for (const h of hits) this.vfx.add(new ImpactBurst(h.x, h.y, color, size * 0.6));
        break;
      case 'cloud':
        if (m.shape === 'self') this.vfx.add(new StatusCloud(attacker.x, attacker.y, color, size));
        else if (hits.length) for (const h of hits) this.vfx.add(new StatusCloud(h.x, h.y, color, size));
        else this.vfx.add(new StatusCloud(target.x, target.y, color, size));
        break;
    }
  }

  /** Telegraphs on the ground for every cast in progress. */
  protected drawTelegraphs(v: View): void {
    const ctx = v.ctx;
    const t = performance.now() / 1000;
    for (const m of this.match.mons()) {
      if (!m.casting) continue;
      const def = move(m.casting.moveId);
      const area = makeArea(def, m, m.casting.targetX, m.casting.targetY);
      const mine = m.owner?.isPlayer;
      const base = mine ? '#9fd8ff' : '#ff5a5a';
      const pulse = 0.28 + 0.14 * Math.sin(t * 14);
      ctx.save();
      ctx.fillStyle = rgba(base, pulse);
      ctx.strokeStyle = rgba(base, 0.85);
      ctx.lineWidth = 2 * v.baseScale;
      const k = R();
      const ppt = v.pxPerTile;
      const X = (x: number) => v.toScreenX(x);
      const Y = (y: number) => v.toScreenY(y);
      ctx.beginPath();
      if (area.shape === 'single') ctx.arc(X(area.tx), Y(area.ty), 0.65 * k * ppt, 0, Math.PI * 2);
      else if (area.shape === 'self') ctx.arc(X(area.ox), Y(area.oy), 0.45 * k * ppt, 0, Math.PI * 2);
      else if (area.shape === 'ring') {
        ctx.arc(X(area.ox), Y(area.oy), 2.3 * k * ppt, 0, Math.PI * 2);
        ctx.arc(X(area.ox), Y(area.oy), 0.3 * k * ppt, 0, Math.PI * 2, true);
      } else {
        const nx = -area.fy;
        const ny = area.fx;
        const pts: Array<[number, number]> =
          area.shape === 'line'
            ? [
                [area.ox + area.fx * 0.25 * k + nx * 0.55 * k, area.oy + area.fy * 0.25 * k + ny * 0.55 * k],
                [area.ox + area.fx * 3.4 * k + nx * 0.55 * k, area.oy + area.fy * 3.4 * k + ny * 0.55 * k],
                [area.ox + area.fx * 3.4 * k - nx * 0.55 * k, area.oy + area.fy * 3.4 * k - ny * 0.55 * k],
                [area.ox + area.fx * 0.25 * k - nx * 0.55 * k, area.oy + area.fy * 0.25 * k - ny * 0.55 * k],
              ]
            : [
                [area.ox + area.fx * 0.25 * k + nx * 0.5 * k, area.oy + area.fy * 0.25 * k + ny * 0.5 * k],
                [area.ox + area.fx * 2.9 * k + nx * 1.9 * k, area.oy + area.fy * 2.9 * k + ny * 1.9 * k],
                [area.ox + area.fx * 2.9 * k - nx * 1.9 * k, area.oy + area.fy * 2.9 * k - ny * 1.9 * k],
                [area.ox + area.fx * 0.25 * k - nx * 0.5 * k, area.oy + area.fy * 0.25 * k - ny * 0.5 * k],
              ];
        pts.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(X(x), Y(y)) : ctx.lineTo(X(x), Y(y))));
        ctx.closePath();
      }
      ctx.fill('evenodd');
      ctx.stroke();
      ctx.restore();
      void areaContains;
    }
  }

  protected drawGroundExtras(v: View): void {
    const ctx = v.ctx;
    const t = performance.now() / 1000;
    // Outpost pads.
    for (const o of this.match.outposts) {
      const sx = v.toScreenX(o.x);
      const sy = v.toScreenY(o.y);
      const r = CONFIG.outpost.radius * v.pxPerTile;
      const active = o.users.length > 0;
      ctx.save();
      const g = ctx.createRadialGradient(sx, sy, r * 0.2, sx, sy, r);
      g.addColorStop(0, active ? 'rgba(120,255,190,0.45)' : 'rgba(90,220,160,0.22)');
      g.addColorStop(1, 'rgba(90,220,160,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(sx, sy, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = active ? `rgba(160,255,210,${0.6 + 0.3 * Math.sin(t * 6)})` : 'rgba(120,230,180,0.55)';
      ctx.lineWidth = 2 * v.baseScale;
      ctx.setLineDash([8 * v.baseScale, 6 * v.baseScale]);
      ctx.beginPath();
      ctx.arc(sx, sy, r * 0.92, t * 0.4, t * 0.4 + Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
    // Aim arc.
    if (this.aiming) {
      const p = this.match.player;
      const to = this.aimPoint();
      ctx.save();
      ctx.strokeStyle = 'rgba(255,230,150,0.9)';
      ctx.lineWidth = 2 * v.baseScale;
      ctx.setLineDash([5 * v.baseScale, 7 * v.baseScale]);
      ctx.beginPath();
      const steps = 16;
      for (let i = 0; i <= steps; i++) {
        const k = i / steps;
        const x = p.x + (to.x - p.x) * k;
        const y = p.y + (to.y - p.y) * k;
        const h = Math.sin(k * Math.PI) * (0.6 + this.aimPower * 1.2);
        const sx = v.toScreenX(x);
        const sy = v.toScreenY(y) - h * v.pxPerTile;
        if (i === 0) ctx.moveTo(sx, sy);
        else ctx.lineTo(sx, sy);
      }
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(255,230,150,0.25)';
      ctx.beginPath();
      ctx.arc(v.toScreenX(to.x), v.toScreenY(to.y), 0.9 * v.pxPerTile, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
  }

  /** Items on the ground are item balls: the sprite of the ball that holds them, bobbing slowly with a periodic glint. */
  private drawGroundItem(v: View, it: GroundItem): void {
    const sx = Math.round(v.toScreenX(it.x));
    const sy = Math.round(v.toScreenY(it.y));
    const s = v.spriteScale;
    const lift = Math.round((Math.sin(it.bob * 1.8) * 0.5 + 0.5) * 2) * s;
    drawSoftShadow(v, sx, sy, 0.22, 0.3);
    const img = this.icons.ball(it.ball);
    const ctx = v.ctx;
    ctx.imageSmoothingEnabled = false;
    const w = (img ? img.width : 18) * s;
    const h = (img ? img.height : 18) * s;
    const x0 = sx - Math.floor(w / 2);
    const y0 = sy - h - lift;
    if (img) ctx.drawImage(img, x0, y0, w, h);
    else ctx.drawImage(this.assets.placeholder(`${it.ball} ball`, 18, 18), x0, y0, w, h);
    // Sunnyside glint: six 7x7 frames over the highlight, once every three seconds.
    const k = it.bob % 3;
    if (this.glint && k < 0.5) {
      const frame = Math.min(5, Math.floor(k * 12));
      ctx.drawImage(this.glint, frame * 7, 0, 7, 7, x0 + 2 * s, y0 + s, 7 * s, 7 * s);
    }
  }

  private drawOutpostPost(v: View, o: { x: number; y: number; users: unknown[] }): void {
    const ctx = v.ctx;
    const sx = v.toScreenX(o.x);
    const sy = v.toScreenY(o.y - 0.9);
    const h = 1.3 * v.pxPerTile;
    const s = v.baseScale;
    ctx.save();
    ctx.fillStyle = '#6b4a2b';
    ctx.fillRect(sx - 3 * s, sy - h, 6 * s, h);
    ctx.fillStyle = o.users.length ? '#7dffc0' : '#2fbf86';
    ctx.beginPath();
    ctx.moveTo(sx + 3 * s, sy - h);
    ctx.lineTo(sx + 3 * s + 0.45 * v.pxPerTile, sy - h + 0.16 * v.pxPerTile);
    ctx.lineTo(sx + 3 * s, sy - h + 0.32 * v.pxPerTile);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = `800 ${Math.round(0.12 * v.pxPerTile)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText('R', sx + 3 * s + 0.16 * v.pxPerTile, sy - h + 0.21 * v.pxPerTile);
    ctx.restore();
  }

  /** The ball in flight, hanging over the target, dropping, wobbling, clicking or bursting open. */
  private drawThrow(v: View, th: Throw): void {
    const ctx = v.ctx;
    const sx = v.toScreenX(th.x);
    const sy = v.toScreenY(th.y);
    const s = v.spriteScale;
    const kind = ballKind(th.ballId);
    const open = th.phase === 'absorb' || th.phase === 'burst' || (th.phase === 'hit' && th.phaseT > 0.08);
    const img = this.icons.ball(kind, open);
    drawSoftShadow(v, sx, sy, 0.2, 0.35);
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.translate(sx, sy - th.z * v.pxPerTile);
    let rot = th.phase === 'flying' ? th.t * 9 : ballWobble(th);
    if (th.phase === 'click') rot = Math.sin(th.phaseT * 60) * 0.06;
    ctx.rotate(rot);
    if (img) {
      const w = img.width * s;
      const h = img.height * s;
      ctx.drawImage(img, -Math.floor(w / 2), -h, w, h);
    } else {
      const ph = this.assets.placeholder(`ball ${kind}`, 18, 18);
      ctx.drawImage(ph, -9 * s, -18 * s, 18 * s, 18 * s);
    }
    ctx.restore();
    // Beam of light pulling the Pokémon in / letting it out.
    if (th.phase === 'absorb' || th.phase === 'burst') {
      const k = th.phase === 'absorb' ? 1 - th.phaseT / 0.3 : th.phaseT / 0.3;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const g = ctx.createRadialGradient(sx, sy - 0.3 * v.pxPerTile, 0, sx, sy - 0.3 * v.pxPerTile, 0.7 * v.pxPerTile);
      g.addColorStop(0, `rgba(255,120,120,${0.55 * k})`);
      g.addColorStop(1, 'rgba(255,120,120,0)');
      ctx.fillStyle = g;
      ctx.fillRect(sx - v.pxPerTile, sy - 1.3 * v.pxPerTile, v.pxPerTile * 2, v.pxPerTile * 2);
      ctx.restore();
    }
    if (th.phase === 'click' && th.phaseT < 0.2) {
      ctx.save();
      ctx.fillStyle = `rgba(255,255,255,${1 - th.phaseT / 0.2})`;
      ctx.beginPath();
      ctx.arc(sx, sy - 8 * s, 3 * s, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  protected drawLights(v: View): void {
    const p = this.match.player;
    drawPointLight(v, p.x, p.y, 1.6, '#ffd9a0', 0.18, 0.2);
    const first = lead(p);
    if (first) drawPointLight(v, first.x, first.y, 1.2, '#ffe8c0', 0.12);
    for (const o of this.match.outposts) drawPointLight(v, o.x, o.y, 2.2, '#7dffc0', o.users.length ? 0.5 : 0.22, 0);
    for (const it of this.match.items) drawPointLight(v, it.x, it.y, 0.5, '#ffe9a8', 0.25, 0.1);
    for (const z of this.match.lightZones) drawPointLight(v, z.x, z.y, z.r * 0.8, '#d9b8ff', 0.3 * Math.min(1, z.t / 1.5), 0);
    for (const th of this.match.throws) if (th.phase === 'absorb' || th.phase === 'burst' || th.phase === 'click') drawPointLight(v, th.x, th.y, 1.2, '#ff8a8a', 0.6, 0.3);
    // The Shadow Crystal pulses; brighter as the night deepens.
    const t = this.match.time;
    const d = this.match.darkness;
    const crystalGlow = 0.25 + 0.15 * Math.sin(t * 2) + (Number.isFinite(d.radius) ? 0.25 : 0);
    drawPointLight(v, this.match.centerX, this.match.centerY, 2.8, '#b36bff', crystalGlow, 0.6);
    // Drifting motes in the dark and purple auras on wild Pokémon.
    for (const mo of this.match.motes) drawPointLight(v, mo.x, mo.y, 0.35, '#8a4dff', 0.12 * Math.min(1, mo.life), 0);
    for (const m of this.match.mons()) if (m.aura) drawPointLight(v, m.x, m.y, 0.9, '#9b5cff', 0.45, 0.25);
    if (this.match.darkrai && !this.match.darkrai.fainted) drawPointLight(v, this.match.darkrai.x, this.match.darkrai.y, 2.2, '#6a2cff', 0.5, 0.5);
    for (const o of this.match.outposts) if (o.users.length) drawPointLight(v, o.x, o.y, 5, '#7dffc0', 0.12, 0);
    this.vfx.drawLights(v);
  }

  /** The Shadow Crystal at the map centre: a faceted procedural gem on a dark pedestal. */
  private drawCrystal(v: View): void {
    const ctx = v.ctx;
    const cx = v.toScreenX(this.match.centerX);
    const cy = v.toScreenY(this.match.centerY);
    const ppt = v.pxPerTile;
    const t = this.match.time;
    const finale = this.match.darkness.finale;
    drawSoftShadow(v, cx, cy, 0.7, 0.4);
    ctx.save();
    // pedestal
    ctx.fillStyle = '#2a2140';
    ctx.beginPath();
    ctx.ellipse(cx, cy, 0.55 * ppt, 0.25 * ppt, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(190,140,255,0.5)';
    ctx.lineWidth = 2 * v.baseScale;
    ctx.stroke();
    const bob = Math.sin(t * 1.5) * 0.04 * ppt;
    const h = (finale ? 0.7 : 1.2) * ppt;
    const w = 0.42 * ppt;
    const top = cy - 0.2 * ppt - h - bob;
    const mid = cy - 0.2 * ppt - h * 0.35 - bob;
    const bottom = cy - 0.15 * ppt - bob;
    const facets: Array<[number[], string]> = [
      [[cx, top, cx - w * 0.5, mid, cx, bottom], finale ? '#4a2a66' : '#8d5cff'],
      [[cx, top, cx + w * 0.5, mid, cx, bottom], finale ? '#2f1b44' : '#5a2fd1'],
      [[cx - w * 0.5, mid, cx - w * 0.2, mid + h * 0.1, cx, bottom], finale ? '#3a2255' : '#6b3fe0'],
      [[cx + w * 0.5, mid, cx + w * 0.2, mid + h * 0.1, cx, bottom], finale ? '#241535' : '#4320a8'],
    ];
    for (const [pts, color] of facets) {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(pts[0] as number, pts[1] as number);
      ctx.lineTo(pts[2] as number, pts[3] as number);
      ctx.lineTo(pts[4] as number, pts[5] as number);
      ctx.closePath();
      ctx.fill();
    }
    ctx.strokeStyle = `rgba(230,200,255,${0.5 + 0.3 * Math.sin(t * 3)})`;
    ctx.lineWidth = 1.5 * v.baseScale;
    ctx.beginPath();
    ctx.moveTo(cx, top);
    ctx.lineTo(cx, bottom);
    ctx.stroke();
    if (finale) {
      // cracks
      ctx.strokeStyle = 'rgba(255,255,255,0.6)';
      ctx.beginPath();
      ctx.moveTo(cx - w * 0.2, mid);
      ctx.lineTo(cx + w * 0.1, mid + h * 0.2);
      ctx.lineTo(cx - w * 0.05, bottom - h * 0.1);
      ctx.stroke();
    }
    ctx.restore();
  }

  protected lightingParams(v: View): { cold: number; darkRadius: number; darkFeather: number; darkAmount: number } {
    const d = this.match.darkness;
    const cold = clamp(this.match.time / CONFIG.lighting.dayToColdSeconds, 0, 1);
    if (!Number.isFinite(d.radius)) return { cold, darkRadius: 1e6, darkFeather: 1, darkAmount: 0 };
    return { cold: Math.max(cold, 0.4), darkRadius: d.radius * v.pxPerTile, darkFeather: 1.2 * v.pxPerTile, darkAmount: 0.92 };
  }

  protected hudState(v: View): HudState {
    return {
      mouseX: this.ctx.input.mouseX,
      mouseY: this.ctx.input.mouseY,
      darkRadius: this.match.darkness.radius,
      darkPhaseLabel: phaseLabel(this.match.darkness),
      nextPulseIn: this.match.darkness.nextPulseIn,
      notice: this.notice,
      selectedItem: this.selectedItem,
      gearTab: this.gearTab,
      popup: this.popup,
      armedBall: this.selectedItem >= 0 ? ITEMS[this.match.player.items[this.selectedItem]?.id ?? '']?.name ?? null : null,
      teach: this.teach ? ((slot) => {
        const m = lead(this.match.player);
        const entry = this.match.player.held[slot];
        const def = entry ? ITEMS[entry.id] : undefined;
        return { moveName: def?.name.replace('TM ', '') ?? '?', moves: m ? m.moves.map((id) => move(id).name) : [], mon: m?.name ?? '?' };
      })(this.teach.slot) : null,
      aiming: this.aiming ? Math.max(0.02, this.aimPower) : 0,
      lightingMode: this.lighting.mode,
    };
  }

  protected drawExtraWorld(v: View): Array<{ y: number; draw: () => void }> {
    const list: Array<{ y: number; draw: () => void }> = [];
    for (const it of this.match.items) list.push({ y: it.y - 0.3, draw: () => this.drawGroundItem(v, it) });
    for (const o of this.match.outposts) list.push({ y: o.y - 0.9, draw: () => this.drawOutpostPost(v, o) });
    for (const th of this.match.throws) list.push({ y: th.y + 0.02, draw: () => this.drawThrow(v, th) });
    list.push({ y: this.match.centerY, draw: () => this.drawCrystal(v) });
    return list;
  }

  render(alpha: number, frameDt: number): void {
    const v = this.ctx.view;
    const p = this.match.player;
    this.vfx.update(frameDt);
    this.floaters.update(frameDt);
    v.follow(p.px + (p.x - p.px) * alpha, p.py + (p.y - p.py) * alpha, frameDt, this.match.ground.cols, this.match.ground.rows);
    v.ctx.setTransform(1, 0, 0, 1, 0, 0);
    v.ctx.fillStyle = '#0b0a12';
    v.ctx.fillRect(0, 0, v.width, v.height);
    renderWorld(v, this.match, {
      alpha,
      rangers: this.rangers,
      groundOverlay: (view) => {
        this.drawGroundExtras(view);
        this.drawTelegraphs(view);
      },
      extra: this.drawExtraWorld(v),
    });
    this.vfx.draw(v);
    this.drawMotes(v);
    v.beginLights();
    this.drawLights(v);
    const lp = this.lightingParams(v);
    const zone = this.match.lightZones[this.match.lightZones.length - 1];
    this.lighting.render({
      cold: lp.cold,
      darkCx: v.toScreenX(this.match.centerX),
      darkCy: v.toScreenY(this.match.centerY),
      darkRadius: lp.darkRadius,
      darkFeather: lp.darkFeather,
      darkAmount: lp.darkAmount,
      clearCx: zone ? v.toScreenX(zone.x) : 0,
      clearCy: zone ? v.toScreenY(zone.y) : 0,
      clearRadius: zone ? zone.r * v.pxPerTile * Math.min(1, zone.t / 1.5) : 0,
      time: this.match.time,
    });
    this.hud.draw(this.match, this.hudState(v));
    this.drawInfoBars(v, alpha);
    this.floaters.draw(v, v.hud);
    this.drawOverlay(v);
  }

  /** HP bar, name and level over every wild or enemy Pokémon within 6 tiles of the player or hit in the last 4 s. */
  private drawInfoBars(v: View, alpha: number): void {
    const p = this.match.player;
    const px = Math.max(2, Math.round(v.baseScale * 3));
    for (const m of this.match.mons()) {
      if (m.owner === p || m.captured || m.visual.alpha < 0.5) continue;
      const near = Math.hypot(m.x - p.x, m.y - p.y) <= 6 * R();
      if (!near && m.sinceHit > 4) continue;
      const x = m.px + (m.x - m.px) * alpha;
      const y = m.py + (m.y - m.py) * alpha;
      const sx = Math.round(v.toScreenX(x));
      const f = m.anim.current();
      const top = Math.round(v.toScreenY(y)) - (f.h * v.spriteScale) / 2;
      if (sx < -50 || sx > v.width + 50 || top < -40 || top > v.height + 40) continue;
      drawInfoBar(this.ui, v.hud, px, sx, top, m.boss ? `${m.name} ★` : m.name, m.level, m.hp / m.maxHp, v.baseScale);
    }
  }

  /** Drifting motes as whole pixels of the 3x grid. */
  private drawMotes(v: View): void {
    const ctx = v.ctx;
    const s = v.spriteScale;
    ctx.save();
    for (const mo of this.match.motes) {
      const a = 0.7 * Math.min(1, mo.life);
      ctx.fillStyle = `rgba(210,170,255,${a})`;
      const size = mo.size > 0.06 ? 2 * s : s;
      ctx.fillRect(Math.round(v.toScreenX(mo.x) / s) * s, Math.round(v.toScreenY(mo.y) / s) * s, size, size);
    }
    ctx.restore();
  }

  protected drawOverlay(_v: View): void {}
}
