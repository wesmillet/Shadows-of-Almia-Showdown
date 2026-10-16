/**
 * The match screen: feeds input to the simulation, turns battle events into
 * VFX, numbers and hit-stop, draws the world through the lighting
 * pass and the HUD on top.
 */
import type { Input } from '../core/input';
import { clamp, dirFromVector } from '../core/math';
import { Lighting } from '../render/lighting';
import type { View } from '../render/view';
import { renderWorld } from '../render/world';
import { areaContains, makeArea, R, type Area, type BattleEvent } from '../sim/battle';
import { SHOPS, type Shop } from '../sim/town';
import { CONFIG, MOVES, MOVE_SLOTS, bodyRadius, drawScale, move, typeColor, type FxPart, type MoveDef } from '../sim/data';
import type { GroundItem, InventorySlot, Mon, Trainer } from '../sim/entities';
import { lead } from '../sim/entities';
import type { DuelSide, Match } from '../sim/match';
import type { Assets } from '../sprites/assets';
import type { RangerSprites } from '../sprites/rangerSprite';
import { Floaters } from '../vfx/floaters';
import { phaseLabel } from '../sim/darkness';
import { BEHAVIOR_LABEL, isRoaming, nextBehavior } from '../sim/party';
import { ballKind, ballWobble, type Throw } from '../sim/catching';
import { Beam, drawPointLight, ImpactBurst, Projectile, RingPulse, SpriteStripVisual, StatusCloud, VfxLayer, type MoveVisual } from '../vfx/visuals';
import { drawInfoBar, Hud, type HudState } from './hud';
import type { PixelUi } from './pixelUi';
import { ItemIcons } from '../sprites/itemIcons';
import { BALL_LIST, ITEMS, type BallKind } from '../sim/items';
import { FxLibrary } from '../vfx/fxLibrary';
import { Delayed, FxAnim, FxBeam, FxProjectile, type FxAnimOptions } from '../vfx/fxVisuals';
import { drawSoftShadow } from '../render/world';
import { panel, rgba, text, uiFont, type GameContext, type Screen } from './screens';

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
  poison: 'fx_038',
  freeze: 'fx_204',
  confusion: 'fx_041',
  /** Hoopa's ring portal. */
  portal: 'fx_190',
  paralysis: 'fx_096',
  /** Rising sparkles while a Pokémon evolves. */
  evolve: 'fx_041',
} as const;

export class MatchScreen implements Screen {
  private readonly lighting: Lighting;
  private readonly hud: Hud;
  private readonly vfx = new VfxLayer();
  /** Effects drawn flat on the ground, under the Pokémon (rings, puddles, cracks). */
  private readonly groundVfx = new VfxLayer();
  /** The match HUD (bag, party, move wheel, info bars); screens built on this one can hide it. */
  protected showHud = true;
  /** Where the camera looks instead of the player (null = follow the player or the battle). */
  protected cameraFocus(): { x: number; y: number } | null {
    return null;
  }
  /** Camera zoom override for inspecting effects (showdown.screen.debugZoom). */
  debugZoom: number | null = null;
  /** Hit feedback waiting for its projectile to land. */
  private later: Array<{ t: number; fn: () => void }> = [];
  /** Camera shake, 0..1, decaying. */
  private shake = 0;
  private readonly floaters = new Floaters();
  private notice = '';
  private noticeT = 0;
  private selectedItem = -1;
  /** The wild Pokémon clicked as the throw target. */
  /** Capture Styler: the line drawn while C is held (world points), closed loops flashing, and where each wild was last step. */
  private stylerLine: Array<{ x: number; y: number }> = [];
  private stylerFlash: Array<{ pts: Array<{ x: number; y: number }>; t: number }> = [];
  private stylerSeen = new Map<number, { x: number; y: number }>();
  private gearTab = false;
  private popup: { items: InventorySlot[]; ball: BallKind; healed: boolean; t: number } | null = null;
  private teach: { slot: number } | null = null;
  /** The vendor whose stall is open (the match waits while you shop). */
  private shopOpen: Shop | null = null;
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
      this.groundVfx.update(dt);
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
    if (this.match.pendingLearn.length) {
      this.handleLearnInput(input);
      return;
    }
    if (this.shopOpen) {
      this.handleShopInput(input);
      return;
    }
    this.handleInput(input);
    this.match.step(dt, input);
    this.stepStyler(dt, input);
    this.consumeEvents();
    if (this.noticeT > 0) {
      this.noticeT -= dt;
      if (this.noticeT <= 0) this.notice = '';
    }
  }

  protected handleInput(input: Input): void {
    const v = this.ctx.view;
    const duelSide = this.playerDuelSide();
    // Moves aim at the cursor; over the HUD the last point on the field is kept.
    const overHud = !!this.hud.hitTest(input.mouseX, input.mouseY);
    if (!overHud) this.match.aim = v.toWorld(input.mouseX, input.mouseY);
    // The ball locks onto the nearest wild; pointing at another wild (or Tab) switches the lock.
    if (!overHud) {
      const w = this.wildNear(input.mouseX, input.mouseY);
      if (w && w !== this.match.lockTarget) this.match.pickLock(w);
    }
    for (const c of input.takeClicks()) {
      const h = this.hud.hitTest(c.x, c.y);
      if (h?.kind !== 'release') this.hud.releaseArmed = -1;
      if (duelSide?.awaitingPick) {
        if (h?.kind === 'portrait') this.pickNext(h.index);
        continue;
      }
      // On the field: left click casts move 1, right click move 2 (hold to keep casting).
      if (!h) {
        if (c.button === 0) this.castFeedback(this.match.playerCast(0));
        else if (c.button === 2) this.castFeedback(this.match.playerCast(1));
        continue;
      }
      if (c.button !== 0) continue;
      if (h?.kind === 'move') this.castFeedback(this.match.playerCast(h.index));
      else if (h?.kind === 'behavior') {
        const m = this.match.player.party[h.index];
        if (m && !m.fainted) {
          m.behavior = nextBehavior(m.behavior);
          m.recall = false;
          this.say(`${m.name}: ${BEHAVIOR_LABEL[m.behavior]}`, 1);
        }
      } else if (h?.kind === 'portrait') {
        const m = this.match.player.party[h.index];
        if (m && isRoaming(m)) {
          this.hud.ping = { mon: m, t: 3 };
          this.say(`${m.name} is ${Math.hypot(m.x - this.match.player.x, m.y - this.match.player.y).toFixed(0)} tiles away (see minimap)`, 1.5);
        } else if (this.match.swapLead(h.index)) this.say(`${lead(this.match.player)?.name} takes the lead`);
      } else if (h?.kind === 'item') this.onItemSlot(h.index);
      else if (h?.kind === 'discard') this.discardSlot(h.index);
      else if (h?.kind === 'release') {
        // First click arms it ("Release?"), a second click on it lets the Pokémon go.
        if (this.hud.releaseArmed === h.index) {
          this.hud.releaseArmed = -1;
          this.say(this.match.release(h.index), 2);
        } else {
          this.hud.releaseArmed = h.index;
          const m = this.match.player.party[h.index];
          if (m) this.say(`Click "Release?" again to let ${m.name} go`, 2);
        }
      }
      else if (h?.kind === 'tab') this.gearTab = h.index === 1;
    }
    // Tab: lock onto the next enemy in range. G: the bag's other tab.
    if (input.pressed('Tab')) {
      const t = this.match.cycleLock();
      this.say(t ? `Ball target: ${t.name}` : 'No wild Pokémon in range', 0.8);
    }
    if (input.pressed('KeyG')) this.gearTab = !this.gearTab;
    // Space talks to whoever is in reach, else picks up a ball in reach, else dodges.
    if (input.pressed('Space') && !this.interact()) {
      const r = this.match.playerDodge();
      if (r === 'cooldown') this.say('Dodge not ready', 0.5);
    }
    // R: auto-battle on or off (the lead picks its own moves while you steer).
    if (input.pressed('KeyR')) {
      this.match.auto = !this.match.auto;
      this.say(this.match.auto ? 'Auto-battle on: your lead picks its own moves' : 'Auto-battle off: you pick the moves', 1.6);
    }
    // Holding a mouse button on the field keeps casting that move as it comes off cooldown.
    if (!overHud && !duelSide?.awaitingPick) {
      if (input.mouseDown) this.match.playerCast(0);
      if (input.rightDown) this.match.playerCast(1);
    }
    if (this.hud.ping) this.hud.ping.t -= 1 / 60;
    // 1-2 always cast; Shift+1-6 (or the bag panel) uses items. After a knockout in a battle, 1-6 picks who goes next.
    const shift = input.down('ShiftLeft') || input.down('ShiftRight');
    if (duelSide?.awaitingPick) {
      for (let i = 0; i < 6; i++) if (input.pressed(`Digit${i + 1}`)) this.pickNext(i);
      return;
    }
    for (let i = 0; i < 6; i++) {
      if (!input.pressed(`Digit${i + 1}`)) continue;
      if (shift) this.onItemSlot(i);
      else if (i < MOVE_SLOTS) this.castFeedback(this.match.playerCast(i));
    }
    // Q and E: moves 1 and 2 again, next to WASD.
    if (input.pressed('KeyQ')) this.castFeedback(this.match.playerCast(0));
    if (input.pressed('KeyE')) this.castFeedback(this.match.playerCast(1));
    // Throwing: point at a wild Pokémon and press F.
    if (input.pressed('KeyF')) this.throwAtTarget();
    void v;
  }

  /** The shop: 1-9 buys that line, E or Escape closes it. */
  private handleShopInput(input: Input): void {
    const shop = this.shopOpen;
    if (!shop) return;
    if (input.pressed('Escape') || input.pressed('KeyE') || input.pressed('Space')) {
      this.shopOpen = null;
      return;
    }
    for (let i = 0; i < 9; i++) {
      if (!input.pressed(`Digit${i + 1}`)) continue;
      const msg = this.match.buy(shop, i);
      if (msg) this.say(msg, 1.6);
    }
  }

  /** Space (or E): a vendor opens the stall, a healer heals, the champion battles; else the nearest ball is picked up. */
  private interact(): boolean {
    const who = this.match.visitors.near();
    if (who === 'ace') {
      this.say(this.match.visitors.challengeAce(), 3);
      return true;
    }
    if (who === 'hoopa') {
      this.say(this.match.visitors.askHoopa(), 3);
      return true;
    }
    const s = this.match.nearService();
    if (s?.kind === 'shop') this.shopOpen = s.shop;
    else if (s?.kind === 'challenge') this.say(this.match.startChallenge(), 3);
    else if (s?.kind === 'healer') this.say(this.match.healAtHealer(), 2);
    else return this.match.pickUp();
    return true;
  }

  /** The player's side of the battle in progress, if any. */
  private playerDuelSide(): DuelSide | null {
    const d = this.match.playerDuel;
    if (!d || d.state === 'over') return null;
    return d.a.trainer === this.match.player ? d.a : d.b;
  }

  private pickNext(index: number): void {
    const msg = this.match.duelPick(index);
    if (msg) this.say(msg, 1.2);
  }

  /** The wild Pokémon under the cursor, or the nearest one within two tiles of it. */
  private wildNear(sx: number, sy: number): Mon | null {
    const w = this.ctx.view.toWorld(sx, sy);
    let best: Mon | null = null;
    let bd = Infinity;
    for (const m of this.match.wilds) {
      if (m.fainted || m.captured || m.npc || m.visual.alpha < 0.5) continue;
      // Measure from the middle of the drawn body, so big and small Pokémon are equally easy to point at.
      const hTiles = (m.species.body[1] * drawScale(m.species)) / 16;
      const d = Math.hypot(w.x - m.x, w.y - (m.y - hTiles / 2));
      if (d < Math.max(2, hTiles * 0.8) && d < bd) {
        bd = d;
        best = m;
      }
    }
    return best;
  }

  /** F: throw the armed ball (or the first ball in the bag) at the target, if it is in range. */
  private throwAtTarget(): void {
    const m = this.match;
    const p = m.player;
    if (p.duelId) return this.say("You can't catch another trainer's Pokémon", 1.4);
    const t = m.lockTarget;
    if (!t || t.fainted || t.captured || !m.wilds.includes(t)) {
      return this.say('No wild Pokémon in range to throw at', 1.4);
    }
    if (Math.hypot(t.x - p.x, t.y - p.y) > CONFIG.catch.throwRange) return this.say(`${t.name} is out of range`, 1);
    const slot = m.ballSlot(p, this.selectedItem);
    if (slot < 0) return this.say('No Poké Balls in the bag', 1);
    this.selectedItem = slot;
    const ballName = ITEMS[p.items[slot]?.id ?? '']?.name ?? 'Poké Ball';
    p.dir = dirFromVector(t.x - p.x, t.y - p.y, p.dir);
    if (m.throwBall(p, slot, { x: t.x, y: t.y })) this.say(`Go, ${ballName}!`, 0.8);
    if (!p.items[slot]) this.selectedItem = m.ballSlot(p);
  }

  /** Corner brackets round the throw target: green in range, red out of range. */
  private drawThrowTarget(v: View): void {
    const t = this.match.lockTarget;
    if (!t || t.fainted || t.captured || !this.match.wilds.includes(t)) return;
    const p = this.match.player;
    const inRange = Math.hypot(t.x - p.x, t.y - p.y) <= CONFIG.catch.throwRange;
    const ctx = v.ctx;
    const sx = v.toScreenX(t.x);
    const sy = v.toScreenY(t.y);
    const r = Math.max(0.55, bodyRadius(t.species) * 1.3) * v.pxPerTile;
    const time = performance.now() / 1000;
    const pulse = 1 + 0.08 * Math.sin(time * 6);
    ctx.save();
    ctx.translate(sx, sy);
    ctx.scale(1, 0.5);
    ctx.rotate(time * 0.8);
    ctx.strokeStyle = inRange ? 'rgba(125,255,176,0.95)' : 'rgba(255,107,107,0.95)';
    ctx.lineWidth = Math.max(2, 3 * v.baseScale);
    for (let i = 0; i < 4; i++) {
      ctx.beginPath();
      ctx.arc(0, 0, r * pulse, i * (Math.PI / 2) + 0.25, i * (Math.PI / 2) + Math.PI / 2 - 0.25);
      ctx.stroke();
    }
    ctx.restore();
  }

  /**
   * Capture Styler (hold C): the cursor draws a glowing line on the ground. Closing a loop round
   * a wild Pokémon counts one loop toward calming it; a Pokémon that runs through the line breaks
   * it. Calmed Pokémon stop fighting and are far easier to catch (Match.stylerLoop).
   */
  private stepStyler(dt: number, input: Input): void {
    for (const f of this.stylerFlash) f.t -= dt;
    this.stylerFlash = this.stylerFlash.filter((f) => f.t > 0);
    const p = this.match.player;
    const a = this.match.aim;
    const holding = input.down('KeyC') && !p.duelId && !!a;
    if (!holding || !a) {
      this.stylerLine = [];
      this.stylerSeen.clear();
      return;
    }
    const line = this.stylerLine;
    const wilds = this.match.wilds.filter((w) => !w.fainted && !w.captured && !w.npc && w.visual.alpha > 0.5);
    // A wild Pokémon that crossed the line since last step breaks it.
    for (const w of wilds) {
      const prev = this.stylerSeen.get(w.id);
      this.stylerSeen.set(w.id, { x: w.x, y: w.y });
      if (!prev || line.length < 2 || (w.calm ?? 0) > 0) continue;
      if (Math.hypot(w.x - prev.x, w.y - prev.y) < 1e-4) continue;
      for (let i = 0; i + 1 < line.length; i++) {
        if (segHit(prev, w, line[i] as { x: number; y: number }, line[i + 1] as { x: number; y: number })) {
          this.match.stylerBreak(w);
          this.stylerLine = [];
          return;
        }
      }
    }
    // The line reaches so far from the trainer.
    if (Math.hypot(a.x - p.x, a.y - p.y) > CONFIG.styler.maxRange) return;
    const last = line[line.length - 1];
    if (last && Math.hypot(a.x - last.x, a.y - last.y) < 0.12) return;
    const next = { x: a.x, y: a.y };
    // Did the new segment cross an older one? Then the part between is a closed loop.
    if (last && line.length >= 4) {
      for (let i = 0; i + 1 < line.length - 2; i++) {
        const p1 = line[i] as { x: number; y: number };
        const p2 = line[i + 1] as { x: number; y: number };
        const at = segPoint(last, next, p1, p2);
        if (!at) continue;
        const poly = [at, ...line.slice(i + 1)];
        if (polyArea(poly) > 0.5) {
          let any = false;
          for (const w of wilds) {
            if ((w.calm ?? 0) > 0) continue;
            if (inPoly(poly, w.x, w.y - 0.2)) {
              this.match.stylerLoop(w);
              any = true;
            }
          }
          this.stylerFlash.push({ pts: poly, t: any ? 0.45 : 0.2 });
        }
        this.stylerLine = [next];
        return;
      }
    }
    line.push(next);
    if (line.length > 160) line.shift();
  }

  /** The styler line (a bright core in a soft glow), loops flashing as they close, and progress rings. */
  private drawStyler(v: View): void {
    const ctx = v.ctx;
    const s = v.baseScale;
    const path = (pts: Array<{ x: number; y: number }>, close: boolean) => {
      ctx.beginPath();
      pts.forEach((p, i) => (i ? ctx.lineTo(v.toScreenX(p.x), v.toScreenY(p.y)) : ctx.moveTo(v.toScreenX(p.x), v.toScreenY(p.y))));
      if (close) ctx.closePath();
    };
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const f of this.stylerFlash) {
      path(f.pts, true);
      ctx.fillStyle = `rgba(120,230,255,${0.35 * (f.t / 0.45)})`;
      ctx.fill();
      ctx.strokeStyle = `rgba(200,250,255,${f.t / 0.45})`;
      ctx.lineWidth = 3 * s;
      ctx.stroke();
    }
    if (this.stylerLine.length > 1) {
      path(this.stylerLine, false);
      ctx.strokeStyle = 'rgba(90,200,255,0.35)';
      ctx.lineWidth = 9 * s;
      ctx.stroke();
      ctx.strokeStyle = '#d8f6ff';
      ctx.lineWidth = 3 * s;
      ctx.stroke();
    }
    // The styler's tip at the cursor.
    const a = this.match.aim;
    if (this.stylerLine.length && a) {
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(v.toScreenX(a.x), v.toScreenY(a.y), 4 * s, 0, Math.PI * 2);
      ctx.fill();
    }
    // Progress rings over Pokémon being styled; a soft pink ring under calmed ones.
    for (const w of this.match.wilds) {
      if (w.fainted || w.captured || w.npc) continue;
      const x = v.toScreenX(w.x);
      const y = v.toScreenY(w.y);
      const calm = w.calm ?? 0;
      if (calm > 0) {
        ctx.strokeStyle = 'rgba(255,170,220,0.85)';
        ctx.lineWidth = 2.5 * s;
        ctx.beginPath();
        ctx.ellipse(x, y, 0.7 * v.pxPerTile, 0.32 * v.pxPerTile, 0, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (calm / CONFIG.styler.calmSeconds));
        ctx.stroke();
        continue;
      }
      const loops = w.styler ?? 0;
      if (loops <= 0) continue;
      const need = this.match.stylerLoopsNeeded(w);
      ctx.strokeStyle = 'rgba(20,40,60,0.6)';
      ctx.lineWidth = 5 * s;
      ctx.beginPath();
      ctx.ellipse(x, y, 0.75 * v.pxPerTile, 0.34 * v.pxPerTile, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = '#7fe3ff';
      ctx.lineWidth = 3 * s;
      ctx.beginPath();
      ctx.ellipse(x, y, 0.75 * v.pxPerTile, 0.34 * v.pxPerTile, 0, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (loops / need));
      ctx.stroke();
    }
    ctx.restore();
  }

  /** The aim: a dotted line from the lead toward the cursor and a small reticle where a single-target move would land. */
  private drawAim(v: View): void {
    if (!this.showHud || this.playerDuelSide()?.awaitingPick) return;
    const m = lead(this.match.player);
    if (!m || m.fainted) return;
    const snap = this.match.aimSnap();
    const a = snap ? { x: snap.x, y: snap.y } : this.match.aim;
    if (!a) return;
    const range = 3.5 * CONFIG.battle.rangeScale;
    let dx = a.x - m.x;
    let dy = a.y - m.y;
    const d = Math.hypot(dx, dy);
    if (d < 0.05) return;
    const k = Math.min(1, range / d);
    const ctx = v.ctx;
    const s = v.baseScale;
    const ox = v.toScreenX(m.x);
    const oy = v.toScreenY(m.y);
    ctx.save();
    dx *= k;
    dy *= k;
    const tx = v.toScreenX(m.x + dx);
    const ty = v.toScreenY(m.y + dy);
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = Math.max(1.5, 2 * s);
    ctx.setLineDash([6 * s, 7 * s]);
    ctx.beginPath();
    ctx.moveTo(ox + (tx - ox) * (0.6 / (d * k)), oy + (ty - oy) * (0.6 / (d * k)));
    ctx.lineTo(tx, ty);
    ctx.stroke();
    ctx.setLineDash([]);
    // Reticle: the single-target hit circle, with four ticks.
    // White when aiming at open ground, red when snapped onto an enemy, orange when out of reach.
    const r = 0.65 * CONFIG.battle.rangeScale * v.pxPerTile;
    ctx.strokeStyle = k < 1 ? 'rgba(255,190,120,0.8)' : snap ? 'rgba(255,90,110,0.95)' : 'rgba(255,255,255,0.75)';
    ctx.lineWidth = Math.max(2, 2.5 * s);
    ctx.beginPath();
    ctx.arc(tx, ty, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    for (const [ux, uy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      ctx.moveTo(tx + ux * r * 0.55, ty + uy * r * 0.55);
      ctx.lineTo(tx + ux * r * 1.15, ty + uy * r * 1.15);
    }
    ctx.stroke();
    ctx.restore();
  }

  /** While the player battles: a faint ring marking where the fight stays. */
  private drawDuelRing(v: View): void {
    const d = this.match.playerDuel;
    if (!d || d.state === 'over') return;
    const ctx = v.ctx;
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.28)';
    ctx.lineWidth = Math.max(2, 3 * v.baseScale);
    ctx.setLineDash([10 * v.baseScale, 8 * v.baseScale]);
    ctx.beginPath();
    ctx.ellipse(v.toScreenX(d.cx), v.toScreenY(d.cy), CONFIG.duel.arenaRadius * v.pxPerTile, CONFIG.duel.arenaRadius * v.pxPerTile, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  /** The TM prompt: 1-2 replaces that move, Escape keeps the current moves. */
  private handleTeachInput(input: Input): void {
    if (!this.teach) return;
    if (input.pressed('Escape')) {
      this.teach = null;
      return;
    }
    const slot = this.teach.slot;
    for (let i = 0; i < MOVE_SLOTS; i++) {
      if (input.pressed(`Digit${i + 1}`)) {
        const msg = this.match.teach(this.match.player, slot, i);
        this.say(msg || 'Could not teach that move', 2.2);
        this.teach = null;
        break;
      }
    }
    input.takeClicks();
  }

  /** A level-up move with both slots full: 1-2 forgets that move, Escape keeps the current two. */
  private handleLearnInput(input: Input): void {
    if (input.pressed('Escape')) {
      this.say(this.match.answerLearn(-1), 1.8);
      return;
    }
    for (let i = 0; i < MOVE_SLOTS; i++) {
      if (input.pressed(`Digit${i + 1}`)) {
        this.say(this.match.answerLearn(i), 2.2);
        break;
      }
    }
    input.takeClicks();
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
  /** The X on a bag slot: the item (the whole stack) is thrown away. */
  private discardSlot(index: number): void {
    const p = this.match.player;
    const list = this.gearTab ? p.held : p.items;
    const e = list[index];
    if (!e) return;
    list[index] = null;
    if (!this.gearTab && this.selectedItem === index) this.selectedItem = -1;
    this.say(`Threw away ${ITEMS[e.id]?.name ?? e.id}${e.count > 1 ? ` ×${e.count}` : ''}`, 1.2);
  }

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
        // A free move slot takes the TM at once; with four moves, ask which to forget.
        if (m.moves.length < MOVE_SLOTS) return this.say(this.match.teach(p, index, -1), 2);
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
      if (cur) this.say(`${cur.name} ready: click a wild Pokémon, then F to throw${cur.desc ? ` · ${cur.desc}` : ''}`, 1.8);
      return;
    }
    const msg = this.match.useItem(p, index);
    if (msg) this.say(msg, 1.4);
  }

  private castFeedback(r: ReturnType<Match['playerCast']>): void {
    if (r === 'cooldown') this.say('Not ready', 0.6);
    else if (r === 'asleep') this.say(lead(this.match.player)?.status === 'freeze' ? 'Frozen solid!' : 'Fast asleep…', 0.8);
    else if (r === 'no-lead') this.say('No Pokémon able to fight', 1);
  }

  /** World position of a sprite's effect anchor (hands / centre from the Offsets sheet). */
  protected anchorWorld(m: Mon): { x: number; y: number } {
    const v = this.ctx.view;
    const [ax, ay] = m.anim.anchor();
    const size = drawScale(m.species);
    const k = (v.spriteScale * size) / v.pxPerTile;
    return { x: m.x + ax * k, y: m.y + ay * k + 0.35 * Math.min(1, size) };
  }

  protected consumeEvents(): void {
    const v = this.ctx.view;
    const events = this.match.battle.events;
    this.match.battle.events = [];
    for (const ev of events) this.onEvent(ev, v);
  }

  protected onEvent(ev: BattleEvent, v: View, arrived = false): void {
    if (arrived && ev.type === 'hit') return this.showHit(ev);
    switch (ev.type) {
      case 'resolve':
        this.spawnMoveVfx(ev.attacker, ev.move, ev.area, ev.hits);
        break;
      case 'hit': {
        // The numbers and the flash land with the effect: a thrown or falling move hits on arrival.
        const wait = this.impactDelay(ev.attacker, ev.target, ev.move);
        if (wait > 0.04) {
          const flash = ev.target.flash;
          ev.target.flash = 0;
          this.later.push({ t: wait, fn: () => {
            ev.target.flash = Math.max(ev.target.flash, flash);
            this.onEvent(ev, v, true);
          } });
          break;
        }
        this.showHit(ev);
        break;
      }
      case 'status': {
        const LABEL: Record<string, [string, string]> = {
          sleep: ['Fell asleep!', '#b39dff'], burn: ['Burned!', '#ff8a65'], paralysis: ['Paralyzed!', '#ffe76b'],
          poison: ['Poisoned!', '#c77dff'], freeze: ['Frozen solid!', '#a8e8ff'], confusion: ['Confused!', '#ff9ad5'],
        };
        const [label, color] = LABEL[ev.status] ?? ['', '#fff'];
        this.floaters.add(ev.target.x, ev.target.y - 0.3, label, color, 16);
        this.playFx(EXTRA_FX[ev.status], { x: ev.target.x, y: ev.target.y, lift: 1.15, scale: 2, fps: 12, loopSeconds: 1.6, follow: ev.target });
        break;
      }
      case 'stages':
        this.floaters.add(ev.target.x, ev.target.y - 0.3, `${ev.stat.toUpperCase()} ${ev.delta > 0 ? '▲' : '▼'}`, ev.delta > 0 ? '#9be7ff' : '#ff9e9e', 16);
        break;
      case 'tick':
        this.floaters.add(ev.target.x, ev.target.y, String(ev.damage), ev.source === 'burn' ? '#ff8a65' : ev.source === 'poison' ? '#c77dff' : '#c38bff', 15);
        // Bad Dreams: the nightmare cloud loops over the sleeper until the next tick.
        if (ev.source === 'dreams') this.playFx(EXTRA_FX.dreams, { x: ev.target.x, y: ev.target.y, lift: 1.1, scale: 2, fps: 10, loopSeconds: 1.05, follow: ev.target });
        break;
      case 'faint':
        this.floaters.add(ev.mon.x, ev.mon.y - 0.2, `${ev.mon.name} fainted`, '#ffffff', 15);
        break;
      case 'scene-fx':
        if (ev.ground) {
          const sh = this.fx.sheet(ev.id);
          if (sh) this.groundVfx.add(new FxAnim(sh, { x: ev.x, y: ev.y, lift: 0, scale: ev.scale, fps: 14, tint: ev.tint }));
        } else this.playFx(ev.id, { x: ev.x, y: ev.y, lift: 0.6, scale: ev.scale, fps: 14, tint: ev.tint });
        break;
      case 'yield':
        this.floaters.add(ev.mon.x, ev.mon.y - 0.8, `${ev.mon.name} stops fighting`, '#ffd36b', 16);
        break;
      case 'styler-loop':
        this.floaters.add(ev.mon.x, ev.mon.y - 0.6, `Loop ${ev.loops}/${ev.needed}`, '#7fe3ff', 14);
        this.playFx(EXTRA_FX.click, { x: ev.mon.x, y: ev.mon.y, lift: 0.5, scale: 1.4, fps: 16 });
        break;
      case 'styler-break':
        this.floaters.add(ev.mon.x, ev.mon.y - 0.6, 'The line broke!', '#ff9e9e', 14);
        break;
      case 'calmed':
        this.floaters.add(ev.mon.x, ev.mon.y - 0.8, `${ev.mon.name} calmed down!`, '#ffb3e6', 16);
        this.playFx(EXTRA_FX.evolve, { x: ev.mon.x, y: ev.mon.y, lift: 0.5, scale: 1.6, fps: 14 });
        this.say(`${ev.mon.name} is calm: throw a ball now (F) for a much better catch`, 2.2);
        break;
      case 'dodge-start':
        this.playFx(EXTRA_FX.burst, { x: ev.mon.x, y: ev.mon.y, lift: 0.2, scale: 1, fps: 18 });
        break;
      case 'dodged':
        this.floaters.add(ev.mon.x, ev.mon.y - 0.4, 'Dodged!', '#e9ddff', 13);
        break;
      case 'thaw':
        this.floaters.add(ev.mon.x, ev.mon.y - 0.2, 'Thawed out', '#a8e8ff', 13);
        break;
      case 'confused':
        this.floaters.add(ev.mon.x, ev.mon.y - 0.4, 'Hit the wrong way!', '#ff9ad5', 12);
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
      case 'learned':
        if (ev.mon.owner === this.match.player) {
          this.say(ev.forgot ? `${ev.mon.name} forgot ${ev.forgot} and learned ${move(ev.moveId).name}!` : `${ev.mon.name} learned ${move(ev.moveId).name}!`, 2);
          this.floaters.add(ev.mon.x, ev.mon.y - 0.4, `New move: ${move(ev.moveId).name}`, '#9be7ff', 15);
        }
        break;
      case 'duel-send': {
        // The ball pops open where the Pokémon appears.
        this.playFx(EXTRA_FX.flash, { x: ev.mon.x, y: ev.mon.y, lift: 0.5, scale: 2.5, fps: 20 });
        const mine = ev.trainer === this.match.player;
        if (mine || ev.duel.a.trainer === this.match.player || ev.duel.b.trainer === this.match.player) {
          this.say(mine ? `Go, ${ev.mon.name}!` : `${ev.trainer.name} sent out ${ev.mon.name}!`, 1.6);
        }
        break;
      }
      case 'duel-end': {
        const p = this.match.player;
        if (ev.duel.a.trainer !== p && ev.duel.b.trainer !== p) break;
        const foe = ev.duel.a.trainer === p ? ev.duel.b.trainer : ev.duel.a.trainer;
        this.say(ev.winner === p ? `You defeated ${foe.name}!` : `${foe.name} won the battle`, 2.6);
        break;
      }
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
          if (ev.xp > 0) this.floaters.add(ev.mon.x, ev.mon.y - 0.5, `+${ev.xp} XP`, '#9fd0ff', 12);
          if (ev.levels > 0) this.floaters.add(ev.mon.x, ev.mon.y - 0.9, `Level ${ev.mon.level}!`, '#ffe76b', 18);
        }
        break;
      case 'evolve-start':
        if (ev.mon.owner?.isPlayer) this.say(`What? ${ev.mon.name} is evolving!`, 1.6);
        this.playFx(EXTRA_FX.evolve, { x: ev.mon.x, y: ev.mon.y, lift: 0.5, scale: 2, fps: 12 });
        break;
      case 'evolved':
        if (ev.mon.owner?.isPlayer) this.say(`${ev.from} evolved into ${ev.mon.name}!`, 2.6);
        this.playFx(EXTRA_FX.flash, { x: ev.mon.x, y: ev.mon.y, lift: 0.5, scale: 3, fps: 18 });
        break;
      case 'money':
        if (ev.trainer.isPlayer) this.floaters.add(ev.x, ev.y - 1.2, `+₽${ev.amount}`, '#ffe27a', 13);
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
  /** Damage number, effectiveness and hit-stop for one hit. */
  private showHit(ev: Extract<BattleEvent, { type: 'hit' }>): void {
    const color = typeColor(ev.move.type);
    if (ev.effectiveness === 0) this.floaters.add(ev.target.x, ev.target.y, 'No effect', '#cfd8dc', 16);
    else if (ev.damage > 0) {
      this.floaters.add(ev.target.x, ev.target.y, `${ev.crit ? '✦' : ''}${ev.damage}`, color, ev.effectiveness > 1 ? 30 : 22);
      if (ev.effectiveness > 1) this.floaters.add(ev.target.x + 0.2, ev.target.y - 0.4, 'Super effective!', '#ffd36b', 15);
      else if (ev.effectiveness < 1) this.floaters.add(ev.target.x + 0.2, ev.target.y - 0.4, 'Not very effective', '#b0bec5', 13);
      // Hit-stop only for hits the player is part of; distant AI fights stay quiet.
      if (ev.attacker.owner?.isPlayer || ev.target.owner?.isPlayer) {
        this.match.battle.hitStop = Math.max(this.match.battle.hitStop, CONFIG.battle.hitStopMs / 1000);
      }
    }
  }

  /** Seconds from a move's resolve until its effect reaches `target` (projectile flight, a fall, a beam reaching out). */
  private impactDelay(attacker: Mon, target: Mon, m: MoveDef): number {
    const carrier = m.fx?.find((p) => p.anchor === 'projectile' || p.anchor === 'sky');
    if (carrier?.anchor === 'projectile') return Math.max(0.12, Math.hypot(target.x - attacker.x, target.y - attacker.y) / (carrier.speed ?? 11));
    if (carrier?.anchor === 'sky') return Math.max(0.12, Math.abs((carrier.height ?? 6) - this.bodyLift(target)) / (carrier.speed ?? 14));
    if (m.fx?.some((p) => p.anchor === 'attacker' && p.mode === 'beam')) return 0.1;
    return 0;
  }

  /** Height of the middle of a Pokémon's drawn body above its feet, in tiles (where hits land). */
  private bodyLift(m: Mon | null): number {
    if (!m) return 0.45;
    return Math.max(0.2, (m.species.body[1] * drawScale(m.species)) / 16 / 2);
  }

  /** Impacts grow a little on big bodies so a hit on a Steelix still reads, and never swamp a Jirachi. */
  private bodyScale(m: Mon | null): number {
    if (!m) return 1;
    return Math.max(0.75, Math.min(1.5, Math.sqrt(bodyRadius(m.species) / 0.45)));
  }

  private addVfx(v: MoveVisual, part: FxPart): void {
    const layer = part.ground ? this.groundVfx : this.vfx;
    layer.add(part.delay ? new Delayed(part.delay, v) : v);
  }

  /**
   * A move's effect parts, in the grammar of moves.json: parts on the attacker, a projectile or
   * sky drop that carries the target parts to each Pokémon hit, or target parts played at once.
   * Target parts land on the middle of the body and scale gently with its size.
   */
  private spawnFx(attacker: Mon, parts: FxPart[], area: Area, hits: Mon[]): void {
    const from = { x: attacker.x, y: attacker.y };
    const fromLift = this.bodyLift(attacker);
    const targets: Array<{ x: number; y: number; mon: Mon | null }> = hits.length
      ? hits.map((h) => ({ x: h.x, y: h.y, mon: h }))
      : [{ x: area.tx, y: area.ty, mon: null }];
    const focus = hits[0] ? { x: hits[0].x, y: hits[0].y } : { x: area.fx, y: area.fy };
    const playAt = (part: FxPart, t: { x: number; y: number; mon: Mon | null }, onBody: boolean): void => {
      const sheet = this.fx.sheet(part.id);
      if (!sheet) return;
      const k = onBody ? this.bodyScale(t.mon) : 1;
      if (part.mode === 'status') {
        this.addVfx(new FxAnim(sheet, { x: t.x, y: t.y, lift: this.bodyLift(t.mon) * 2 + 0.35, scale: part.scale ?? 2, fps: part.fps ?? 15, loopSeconds: 1.6, follow: t.mon, tint: part.tint }), part);
        return;
      }
      const lift = part.ground ? (part.lift ?? 0) : part.lift ?? (onBody ? this.bodyLift(t.mon) : fromLift);
      // Impacts stay about the size of the body they land on: never more than ~2.3 tiles across (3.2 on the ground).
      let scale = (part.scale ?? 2) * k;
      if (onBody) scale = Math.min(scale, ((part.ground ? 3.2 : 2.3) * k * 48) / Math.max(sheet.fw, sheet.fh));
      this.addVfx(new FxAnim(sheet, { x: t.x, y: t.y, lift, scale, fps: part.fps ?? 15, tint: part.tint }), part);
    };
    let carrier: FxPart | null = null;
    const impacts: FxPart[] = [];
    for (const part of parts) {
      if (part.anchor === 'projectile' || part.anchor === 'sky') {
        carrier = part;
        continue;
      }
      if (part.anchor === 'attacker') {
        const sheet = this.fx.sheet(part.id);
        if (!sheet) continue;
        if (part.mode === 'beam' || part.mode === 'stream') {
          this.addVfx(new FxBeam(sheet, { from, to: focus, mode: part.mode, lift: part.lift ?? fromLift, scale: part.scale ?? 2, fps: part.fps ?? 15, seconds: part.seconds, tint: part.tint, facing: part.facing === 'none' ? undefined : part.facing }), part);
        } else playAt(part, { x: attacker.x, y: attacker.y, mon: attacker }, false);
        continue;
      }
      if (carrier) impacts.push(part);
      else for (const t of targets) playAt(part, t, true);
    }
    if (!carrier) return;
    const sheet = this.fx.sheet(carrier.id);
    const c = carrier;
    for (const t of targets) {
      if (!sheet) {
        for (const p of impacts) playAt(p, t, true);
        continue;
      }
      const sky = c.anchor === 'sky';
      this.addVfx(new FxProjectile(sheet, {
        from: sky ? { x: t.x, y: t.y } : from,
        to: { x: t.x, y: t.y },
        lift: c.lift ?? this.bodyLift(t.mon),
        fromLift: sky ? (c.height ?? 6) : fromLift,
        arc: c.arc,
        speed: c.speed ?? (sky ? 14 : 11),
        scale: c.scale ?? 2,
        fps: c.fps ?? 15,
        tint: c.tint,
        facing: c.facing,
        onHit: () => {
          for (const p of impacts) playAt({ ...p, delay: p.delay }, t, true);
        },
      }), c);
    }
  }

  private spawnMoveVfx(attacker: Mon, m: MoveDef, area: Area, hits: Mon[]): void {
    if (m.fx?.length && this.fx.ready(m.fx.map((p) => p.id))) {
      this.spawnFx(attacker, m.fx, area, hits);
      if (m.shake && (attacker.owner === this.match.player || hits.some((h) => h.owner === this.match.player) || Math.hypot(attacker.x - this.match.player.x, attacker.y - this.match.player.y) < 10)) {
        this.shake = Math.max(this.shake, m.shake);
      }
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

  /** Ground shapes for casts in progress, only for moves with no animation (or one still loading). */
  protected drawTelegraphs(v: View): void {
    const ctx = v.ctx;
    const t = performance.now() / 1000;
    for (const m of this.match.mons()) {
      if (!m.casting) continue;
      const def = move(m.casting.moveId);
      if (def.fx?.length && this.fx.ready(def.fx.map((p) => p.id))) continue;
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
    // The champion's battlefield: painted lines, a centre circle and a box at each end.
    const arena = this.match.ground.features?.arena;
    if (arena) {
      const x0 = v.toScreenX(arena.x0 + 0.5);
      const y0 = v.toScreenY(arena.y0 + 0.5);
      const x1 = v.toScreenX(arena.x1 - 0.5);
      const y1 = v.toScreenY(arena.y1 - 0.5);
      const w = x1 - x0;
      const h = y1 - y0;
      const my = (y0 + y1) / 2;
      ctx.save();
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.lineWidth = Math.max(3, 5 * v.baseScale);
      ctx.strokeRect(x0, y0, w, h);
      ctx.beginPath();
      ctx.moveTo(x0, my);
      ctx.lineTo(x1, my);
      ctx.stroke();
      const r = Math.min(w, h) * 0.17;
      ctx.beginPath();
      ctx.arc((x0 + x1) / 2, my, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = 'rgba(214,72,72,0.35)';
      ctx.beginPath();
      ctx.arc((x0 + x1) / 2, my, r, Math.PI, Math.PI * 2);
      ctx.fill();
      const bw = w * 0.32;
      const bh = h * 0.18;
      ctx.strokeRect((x0 + x1) / 2 - bw / 2, y0, bw, bh);
      ctx.strokeRect((x0 + x1) / 2 - bw / 2, y1 - bh, bw, bh);
      ctx.restore();
    }
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
    this.drawThrowTarget(v);
    this.drawDuelRing(v);
    if (!this.stylerLine.length) this.drawAim(v);
    this.drawStyler(v);
  }

  /** Items on the ground are item balls: the sprite of the ball that holds them, bobbing slowly with a periodic glint. */
  private drawGroundItem(v: View, it: GroundItem): void {
    const sx = Math.round(v.toScreenX(it.x));
    const sy = Math.round(v.toScreenY(it.y));
    const s = v.spriteScale / 3; // item balls draw at 1x: small pickups under the 3x characters
    // Resting on the ground: a tight contact shadow and the ball's base a pixel into the grass.
    drawSoftShadow(v, sx, sy - s, 0.09, 0.35);
    const img = this.icons.ball(it.ball);
    const ctx = v.ctx;
    ctx.imageSmoothingEnabled = false;
    const w = (img ? img.width : 18) * s;
    const h = (img ? img.height : 18) * s;
    const x0 = sx - Math.floor(w / 2);
    const y0 = sy - h + s;
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
    ctx.font = uiFont(0.12 * v.pxPerTile);
    ctx.textAlign = 'center';
    ctx.fillText('R', sx + 3 * s + 0.16 * v.pxPerTile, sy - h + 0.21 * v.pxPerTile);
    ctx.restore();
  }

  /** The ball in flight, hanging over the target, dropping, wobbling, clicking or bursting open. */
  private drawThrow(v: View, th: Throw): void {
    const ctx = v.ctx;
    const sx = v.toScreenX(th.x);
    const sy = v.toScreenY(th.y);
    const kind = ballKind(th.ballId);
    drawSoftShadow(v, sx, sy, 0.12, 0.35);
    // The crisp 18 px overworld ball at the ground balls' scale (whole screen pixels only).
    const s = Math.max(1, Math.round(v.spriteScale / 3));
    const open = th.phase === 'absorb' || th.phase === 'burst' || (th.phase === 'hit' && th.phaseT > 0.08);
    const img = this.icons.ball(kind, open);
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    // In flight it tumbles in quarter turns, which keep every pixel square; on the ground it rocks.
    const lift = th.phase === 'flying' ? 9 * s : 0;
    ctx.translate(Math.round(sx), Math.round(sy - th.z * v.pxPerTile));
    let rot = th.phase === 'flying' ? (Math.floor(th.t * 14) % 4) * (Math.PI / 2) : ballWobble(th);
    if (th.phase === 'click') rot = Math.sin(th.phaseT * 60) * 0.06;
    if (img) {
      const w = img.width * s;
      const h = img.height * s;
      if (th.phase === 'flying') {
        ctx.translate(0, -lift);
        ctx.rotate(rot);
        ctx.drawImage(img, -Math.round(w / 2), -Math.round(h / 2), w, h);
      } else {
        ctx.rotate(rot);
        ctx.drawImage(img, -Math.round(w / 2), -h, w, h);
      }
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
      ctx.arc(sx, sy - 6 * s, 2 * s, 0, Math.PI * 2);
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
      })(this.teach.slot) : this.match.pendingLearn[0] ? ((pl) => ({
        moveName: move(pl.moveId).name,
        moves: pl.mon.moves.map((id) => move(id).name),
        mon: pl.mon.name,
        title: `${pl.mon.name} wants to learn ${move(pl.moveId).name}`,
      }))(this.match.pendingLearn[0]) : null,
      aiming: 0,
      money: this.match.player.money,
      prompt: this.servicePrompt(),
      shop: this.shopOpen ? {
        name: this.shopOpen.name,
        entries: this.shopOpen.stock.map((e) => ({ name: ITEMS[e.id]?.name ?? e.id, price: e.price, affordable: this.match.player.money >= e.price })),
      } : null,
      lightingMode: this.lighting.mode,
    };
  }

  private servicePrompt(): string | null {
    if (this.shopOpen || this.teach || this.match.pendingLearn.length) return null;
    const who = this.match.visitors.near();
    if (who === 'ace') return 'Space · Battle Ace Trainer Celeste (win a rare Pokémon)';
    if (who === 'hoopa') return 'Space · Talk to Hoopa';
    const s = this.match.nearService();
    if (!s) return this.match.nearestItem() ? 'Space · Pick up' : null;
    if (s.kind === 'shop') return `Space · Shop at the ${s.shop.name}`;
    if (s.kind === 'challenge') return `Space · Challenge the ${SHOPS.challenger.name}`;
    return 'Space · Heal your party';
  }

  protected drawExtraWorld(v: View): Array<{ y: number; draw: () => void }> {
    const list: Array<{ y: number; draw: () => void }> = [];
    for (const it of this.match.items) list.push({ y: it.y - 0.3, draw: () => this.drawGroundItem(v, it) });
    for (const o of this.match.outposts) list.push({ y: o.y - 0.9, draw: () => this.drawOutpostPost(v, o) });
    for (const th of this.match.throws) list.push({ y: th.y + 0.02, draw: () => this.drawThrow(v, th) });
    list.push({ y: this.match.centerY, draw: () => this.drawCrystal(v) });
    const po = this.match.visitors.portal;
    if (po) list.push({ y: po.y - 0.1, draw: () => this.drawPortal(v, po) });
    return list;
  }

  /** Hoopa's ring: a gold hoop standing on the ground, opening, swirling dark inside, then closing. */
  private drawPortal(v: View, po: { x: number; y: number; t: number }): void {
    const ctx = v.ctx;
    const open = Math.min(1, po.t / 0.6) * Math.min(1, Math.max(0, (4 - po.t) / 0.6));
    if (open <= 0) return;
    const x = v.toScreenX(po.x);
    const y = v.toScreenY(po.y) - 1.3 * v.pxPerTile * open;
    const rx = 1.1 * v.pxPerTile * open;
    const ry = 1.3 * v.pxPerTile * open;
    ctx.save();
    const g = ctx.createRadialGradient(x, y, 0, x, y, ry);
    g.addColorStop(0, 'rgba(255,240,200,0.95)');
    g.addColorStop(0.35, 'rgba(160,90,230,0.85)');
    g.addColorStop(1, 'rgba(40,10,70,0.9)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
    // Swirl
    ctx.strokeStyle = 'rgba(255,230,160,0.6)';
    ctx.lineWidth = 2 * v.baseScale;
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      ctx.ellipse(x, y, rx * (0.3 + i * 0.22), ry * (0.3 + i * 0.22), po.t * (2 + i), 0.3, 4.2);
      ctx.stroke();
    }
    // The hoop itself
    ctx.strokeStyle = '#ffcf4a';
    ctx.lineWidth = 6 * v.baseScale;
    ctx.beginPath();
    ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = '#9a6a10';
    ctx.lineWidth = 2 * v.baseScale;
    ctx.stroke();
    ctx.restore();
  }

  render(alpha: number, frameDt: number): void {
    const v = this.ctx.view;
    const p = this.match.player;
    this.vfx.update(frameDt);
    this.groundVfx.update(frameDt);
    this.floaters.update(frameDt);
    for (let i = this.later.length - 1; i >= 0; i--) {
      const l = this.later[i] as { t: number; fn: () => void };
      l.t -= frameDt;
      if (l.t <= 0) {
        this.later.splice(i, 1);
        l.fn();
      }
    }
    // In a one-on-one battle the camera closes in on the two Pokémon.
    const duel = this.match.playerDuel;
    const fighting = !!duel && duel.state !== 'over';
    const targetZoom = fighting ? CONFIG.duel.zoom : this.debugZoom ?? 1;
    v.zoom += (targetZoom - v.zoom) * (1 - Math.exp(-frameDt * 3.5));
    if (Math.abs(targetZoom - v.zoom) < 0.003) v.zoom = targetZoom;
    let fx = p.px + (p.x - p.px) * alpha;
    let fy = p.py + (p.y - p.py) * alpha;
    const focus = this.cameraFocus();
    if (focus) {
      fx = focus.x;
      fy = focus.y;
    } else if (duel && fighting) {
      const ma = duel.a.mon;
      const mb = duel.b.mon;
      fx = ma && mb ? (ma.x + mb.x) / 2 : duel.cx;
      fy = ma && mb ? (ma.y + mb.y) / 2 : duel.cy;
    }
    v.follow(fx, fy, frameDt, this.match.ground.cols, this.match.ground.rows);
    // Heavy hits shake the camera for a moment (offset undone after the frame is drawn).
    this.shake = Math.max(0, this.shake - frameDt * 2.2);
    const shk = this.shake * this.shake * 0.22;
    const ox = (Math.random() - 0.5) * shk;
    const oy = (Math.random() - 0.5) * shk;
    v.camX += ox;
    v.camY += oy;
    v.ctx.setTransform(1, 0, 0, 1, 0, 0);
    v.ctx.fillStyle = '#0b0a12';
    v.ctx.fillRect(0, 0, v.width, v.height);
    renderWorld(v, this.match, {
      alpha,
      rangers: this.rangers,
      groundOverlay: (view) => {
        this.drawGroundExtras(view);
        this.groundVfx.draw(view);
        this.drawTelegraphs(view);
      },
      extra: this.drawExtraWorld(v),
    });
    this.vfx.draw(v);
    this.drawMotes(v);
    v.beginLights();
    this.groundVfx.drawLights(v);
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
    if (this.showHud) {
      this.hud.draw(this.match, this.hudState(v));
      this.drawInfoBars(v, alpha);
    } else v.hud.clearRect(0, 0, v.width, v.height);
    this.floaters.draw(v, v.hud);
    this.drawDuelHud(v);
    this.drawOverlay(v);
    v.camX -= ox;
    v.camY -= oy;
  }

  /** The battle banner (both trainers and their remaining Pokémon) and, after a knockout, the pick panel. */
  private drawDuelHud(v: View): void {
    const d = this.match.playerDuel;
    if (!d || d.state === 'over') return;
    const h = v.hud;
    const s = v.baseScale;
    const me = d.a.trainer === this.match.player ? d.a : d.b;
    const foe = me === d.a ? d.b : d.a;
    const w = 420 * s;
    const x = v.width / 2 - w / 2;
    const y = 12 * s;
    panel(v, x, y, w, 50 * s);
    const balls = (t: Trainer, cx: number) => {
      const n = t.party.length;
      for (let i = 0; i < n; i++) {
        const m = t.party[i] as Mon;
        const ok = !m.fainted && !m.captured;
        h.fillStyle = ok ? '#ff5d5d' : '#4a4458';
        h.beginPath();
        h.arc(cx + (i - (n - 1) / 2) * 14 * s, y + 33 * s, 5 * s, 0, Math.PI * 2);
        h.fill();
        h.fillStyle = ok ? '#ffffff' : '#2c2838';
        h.fillRect(cx + (i - (n - 1) / 2) * 14 * s - 5 * s, y + 33 * s - 0.5 * s, 10 * s, 1.5 * s);
      }
    };
    text(v, 'You', x + w * 0.22, y + 19 * s, 14, { align: 'center', color: '#bfe3ff', maxWidth: w * 0.36 });
    balls(me.trainer, x + w * 0.22);
    text(v, 'VS', v.width / 2, y + 28 * s, 18, { align: 'center', color: '#ffd36b' });
    text(v, foe.trainer.name, x + w * 0.78, y + 19 * s, 14, { align: 'center', color: '#ffb3b3', maxWidth: w * 0.36 });
    balls(foe.trainer, x + w * 0.78);
    if (!me.awaitingPick) return;
    // Choose the next Pokémon.
    const party = this.match.player.party;
    const pw = 360 * s;
    const rowH = 30 * s;
    const ph = (58 + party.length * 30) * s;
    const px = v.width / 2 - pw / 2;
    const py = v.height * 0.32;
    panel(v, px, py, pw, ph);
    text(v, 'Choose your next Pokémon', v.width / 2, py + 28 * s, 16, { align: 'center', color: '#e9ddff' });
    party.forEach((m, i) => {
      const ok = !m.fainted && !m.captured;
      const ry = py + 44 * s + i * rowH;
      text(v, `${i + 1}`, px + 22 * s, ry + 20 * s, 14, { color: ok ? '#ffd36b' : '#5c5670' });
      const bw = 90 * s;
      text(v, `${m.name}  Lv ${m.level}`, px + 46 * s, ry + 20 * s, 14, { color: ok ? '#f4f1ff' : '#5c5670', maxWidth: pw - bw - 80 * s });
      const bx = px + pw - bw - 20 * s;
      h.fillStyle = '#2c2838';
      h.fillRect(bx, ry + 11 * s, bw, 8 * s);
      const f = m.hp / m.maxHp;
      h.fillStyle = !ok ? '#5c5670' : f > 0.5 ? '#5fe08a' : f > 0.2 ? '#ffd36b' : '#ff6b6b';
      h.fillRect(bx, ry + 11 * s, bw * Math.max(0, f), 8 * s);
    });
  }

  /** HP bar, name and level over every wild or enemy Pokémon within 6 tiles of the player or hit in the last 4 s. */
  private drawInfoBars(v: View, alpha: number): void {
    const p = this.match.player;
    const px = Math.max(2, Math.round(v.baseScale * 3));
    for (const m of this.match.mons()) {
      if (m.captured || m.visual.alpha < 0.5) continue;
      if (m.owner === p) {
        // Your own Pokémon on the field: a slim bar (no label) once they have taken damage.
        if (m.stowed || m.fainted || m.hp >= m.maxHp) continue;
        const x = m.px + (m.x - m.px) * alpha;
        const y = m.py + (m.y - m.py) * alpha;
        const sx = Math.round(v.toScreenX(x));
        const top = Math.round(v.toScreenY(y)) - Math.max(0.5 * v.pxPerTile, (m.species.body[1] * drawScale(m.species) * v.spriteScale) * 0.95);
        const w = 16 * px;
        this.ui.bar(v.hud, Math.round(sx - w / 2), Math.round(top - 9 * px), w, px, m.hp / m.maxHp);
        continue;
      }
      const near = Math.hypot(m.x - p.x, m.y - p.y) <= 6 * R();
      if (!near && m.sinceHit > 4) continue;
      const x = m.px + (m.x - m.px) * alpha;
      const y = m.py + (m.y - m.py) * alpha;
      const sx = Math.round(v.toScreenX(x));
      const f = m.anim.current();
      // Bar just over the drawn body (sprites are drawn at their canonical size).
      const top = Math.round(v.toScreenY(y)) - Math.max(0.5 * v.pxPerTile, (m.species.body[1] * drawScale(m.species) * v.spriteScale) * 0.95);
      if (sx < -50 || sx > v.width + 50 || top < -40 || top > v.height + 40) continue;
      if (m.npc === 'hoopa') {
        drawInfoBar(this.ui, v.hud, px, sx, top, 'Hoopa (Space to talk)', m.level, 1, v.baseScale, '#ffcf8a');
        continue;
      }
      const label = m.boss ? `${m.name} ★` : m.legend ? `Legendary ${m.name}` : m.landBoss ? `${m.name} ♛` : m.elite ? `Elite ${m.name}` : m.name;
      drawInfoBar(this.ui, v.hud, px, sx, top, label, m.level, m.hp / m.maxHp, v.baseScale, m.legend ? '#ffcf4a' : m.elite ? '#ffd36b' : '#fff');
    }
    // Names over the roaming visitors when close.
    for (const n of this.match.npcs) {
      if (n.role !== 'merchant' && n.role !== 'ace') continue;
      if (Math.hypot(n.x - p.x, n.y - p.y) > 9) continue;
      const sx = Math.round(v.toScreenX(n.x));
      const top = Math.round(v.toScreenY(n.y)) - 2.4 * v.pxPerTile;
      const h = v.hud;
      h.save();
      h.font = uiFont(11 * v.baseScale);
      h.textAlign = 'center';
      h.lineWidth = 3;
      h.strokeStyle = 'rgba(0,0,0,0.7)';
      const name = n.role === 'merchant' ? 'Wandering Merchant' : 'Ace Trainer Celeste';
      h.strokeText(name, sx, top);
      h.fillStyle = n.role === 'merchant' ? '#ffe27a' : '#ff9ad5';
      h.fillText(name, sx, top);
      h.restore();
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

type Pt = { x: number; y: number };

/** Where segments ab and cd cross, or null. */
function segPoint(a: Pt, b: Pt, c: Pt, d: Pt): Pt | null {
  const r = { x: b.x - a.x, y: b.y - a.y };
  const q = { x: d.x - c.x, y: d.y - c.y };
  const den = r.x * q.y - r.y * q.x;
  if (Math.abs(den) < 1e-9) return null;
  const t = ((c.x - a.x) * q.y - (c.y - a.y) * q.x) / den;
  const u = ((c.x - a.x) * r.y - (c.y - a.y) * r.x) / den;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return { x: a.x + r.x * t, y: a.y + r.y * t };
}

function segHit(a: Pt, b: Pt, c: Pt, d: Pt): boolean {
  return segPoint(a, b, c, d) !== null;
}

function polyArea(pts: Pt[]): number {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i] as Pt;
    const q = pts[(i + 1) % pts.length] as Pt;
    s += p.x * q.y - q.x * p.y;
  }
  return Math.abs(s) / 2;
}

/** Even-odd point in polygon. */
function inPoly(pts: Pt[], x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i] as Pt;
    const b = pts[j] as Pt;
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}
