/**
 * The match screen: feeds input to the simulation, turns battle events into
 * VFX, numbers and hit-stop, draws the world through the lighting
 * pass and the HUD on top.
 */
import type { Connection } from '../net/connection';
import { isDev, rareChest } from '../dev';
import type { Input } from '../core/input';
import { DIR_VECTORS, clamp, dirFromVector } from '../core/math';
import { Lighting } from '../render/lighting';
import type { View } from '../render/view';
import { renderWorld } from '../render/world';
import { music, type TrackId } from '../audio/music';
import { areaContains, makeArea, R, type Area, type BattleEvent } from '../sim/battle';
import { SHOPS, type Shop } from '../sim/town';
import { CONFIG, MOVES, MOVE_SLOTS, bodyRadius, canLearnTm, drawScale, monScale, move, tmRefusal, typeColor, type FxPart, type MoveDef } from '../sim/data';
import type { GroundItem, InventorySlot, Mon, Trainer } from '../sim/entities';
import { lead } from '../sim/entities';
import { Match, type DuelSide } from '../sim/match';
import type { Assets } from '../sprites/assets';
import type { RangerSprites } from '../sprites/rangerSprite';
import { Floaters } from '../vfx/floaters';
import { phaseLabel } from '../sim/darkness';
import { BEHAVIOR_LABEL, isRoaming, nextBehavior } from '../sim/party';
import { ballKind, ballWobble, type Throw } from '../sim/catching';
import { Beam, drawPointLight, ImpactBurst, Projectile, RingPulse, ShardBurst, SpriteStripVisual, StatusCloud, VfxLayer, type MoveVisual } from '../vfx/visuals';
import { drawInfoBar, Hud, type HudState } from './hud';
import { extractToPc } from '../pc';
import type { PixelUi } from './pixelUi';
import { ItemIcons } from '../sprites/itemIcons';
import { BALL_LIST, ITEMS, type BallKind } from '../sim/items';
import { bestRod, canFish, FISHING, hookOrReel, startFishing } from '../sim/fishing';
import { FxLibrary } from '../vfx/fxLibrary';
import { Delayed, FxAnim, FxBeam, FxProjectile, type FxAnimOptions } from '../vfx/fxVisuals';
import { drawSoftShadow } from '../render/world';
import { INK, panel, rgba, text, uiFont, wrapText, type GameContext, type Screen } from './screens';

/** Effects that sim events ask for by id (scene-fx), loaded with the rest. */
const SCENE_FX = ['fx_135', 'fx_225', 'fx_226', 'fx_229', 'fx_081', 'fx_070', 'fx_067', 'fx_190', 'fx_215', 'fx_009', 'fx_017', 'fx_172', 'fx_201', 'fx_204', 'fx_239', 'fx_175', 'fx_093'];

/** Effects used outside moves: the capture sequence, Bad Dreams and status icons. */
export const EXTRA_FX = {
  /** Poké Ball flash when the ball opens on impact. */
  flash: 'fx_176',
  /** The "sucked in" swirl on the target while it shrinks. */
  swirl: 'fx_144',
  /** Sparkle on the click of a successful catch. */
  click: 'fx_014',
  /** White puff: a Pokémon bursting free of a ball, or dashing (dodge). */
  burst: 'fx_001',
  /** Darkrai's Bad Dreams, looping on sleeping Pokémon. */
  dreams: 'fx_158',
  sleep: 'fx_015',
  burn: 'fx_134',
  poison: 'fx_038',
  freeze: 'fx_204',
  confusion: 'fx_041',
  /** The flash on the ground as Hoopa's portal opens. */
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
  /** Messages on screen, newest last; up to three show at once, stacked, each on its own timer. */
  private notices: Array<{ text: string; t: number }> = [];
  private selectedItem = -1;
  /** The wild Pokémon clicked as the throw target. */
  /** Capture Styler: the line drawn while C is held (world points), closed loops flashing, and where each wild was last step. */
  private stylerLine: Array<{ x: number; y: number }> = [];
  private stylerFlash: Array<{ pts: Array<{ x: number; y: number }>; t: number }> = [];
  private stylerSeen = new Map<number, { x: number; y: number }>();
  private gearTab = false;
  private popup: { items: InventorySlot[]; ball: BallKind; healed: boolean; t: number } | null = null;
  private teach: { slot: number } | null = null;
  /** The Extraction Voucher in this bag slot is waiting for a Pokémon to be picked. */
  private extractPick: { slot: number } | null = null;
  /** The vendor whose stall is open (the match waits while you shop). */
  private shopOpen: Shop | null = null;
  /** The storage chest that is open (index into match.chests); the match waits meanwhile. */
  private chestOpen: number | null = null;
  /** How far each chest's lid is open, 0..1 (animates on open and close). */
  private chestLid = new Map<number, number>();
  /** The Fan-tasy wooden chest opening: 4 frames of 30x38. */
  private chestSheet: HTMLImageElement | null = null;
  private readonly strips = new Map<string, HTMLImageElement | null>();
  protected readonly fx: FxLibrary;
  /** Sunnyside glint strip (6 frames of 7x7) that sparkles on ground balls. */
  private glint: HTMLImageElement | null = null;

  private endTimer = -1;
  protected readonly icons: ItemIcons;
  /**
   * Online (src/net/mirror.ts): the match is the server's, so Space and throwing things away go
   * there as commands, and extractions are saved by the server, not this browser.
   */
  online: { cmd: Connection['cmd'] } | null = null;
  /**
   * Watching (a spectator or a replay): the player's controls are off; `step` gets the keys instead
   * (switch whom to follow, leave, the replay's controls) and `draw` adds its bar on top.
   */
  spectator: { step(input: Input, dt: number): void; draw(v: View): void } | null = null;

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
    // The minimap shows the island's painted picture once it has loaded (flat colours until then).
    const mapName = match.ground.mapName;
    if (mapName) void assets.loadImage(`maps/${mapName}_minimap.png`).then((img) => (this.hud.mapPicture = img));
    if (isDev()) this.say('Tester mode: Hoopa is on the island (?dev=0 turns it off)', 4);
    if (rareChest()) this.say('Every rare item is waiting in the storage chests in each town', 5);
    this.fx = new FxLibrary(assets);
    const ids = new Set<string>(Object.values(EXTRA_FX));
    for (const m of MOVES.values()) for (const part of m.fx ?? []) ids.add(part.id);
    // Scene effects the events use (Lugia's burst, the lake's rings, landings, portals).
    for (const id of SCENE_FX) ids.add(id);
    this.fx.preload(ids);
    this.icons.preload([...BALL_LIST.map((b) => b.id), 'crystal-shard']);
    void assets.loadImage('tiles/sunnyside/vfx/spr_deco_glint_01_strip6.png').then((img) => (this.glint = img));
    void assets.loadImage('ui/alpha.png').then((img) => (this.alphaBadge = img));
    void assets.loadImage('fx/darkrai_portal.png').then((img) => (this.portalSheet = img));
    void assets.loadImage('fx/hoopa_portal.png').then((img) => {
      this.hoopaPortal = img;
      this.hoopaPortalDark = img ? darkPortal(img) : null;
    });
    void assets.loadImage('ui/shadow_crystal.png').then((img) => (this.crystalImg = img));
    void assets.loadImage('ui/shadow_crystal_broken.png').then((img) => (this.crystalBroken = img));
    void assets.loadImage('ui/shadow_crystal_base.png').then((img) => (this.crystalBase = img));
    void assets.loadImage('ui/storage_chest.png').then((img) => (this.chestSheet = img));
    void assets.loadImage('ui/reticle.png').then((img) => (this.reticle = img));
    void assets.loadImage('ui/reticle_hot.png').then((img) => (this.reticleHot = img));
    ctx.view.snapTo(match.player.x, match.player.y);
    ctx.view.zoom = ctx.view.targetZoom = 1;
  }

  /** The camera jumps to a spot (watching: a new trainer to follow). */
  snapCamera(x: number, y: number): void {
    this.ctx.view.snapTo(x, y);
  }

  get view(): View {
    return this.ctx.view;
  }

  say(s: string, seconds = 1.6): void {
    if (!s) return;
    // The same message again just refreshes its timer.
    const same = this.notices.find((n) => n.text === s);
    if (same) {
      same.t = Math.max(same.t, seconds);
      return;
    }
    this.notices.push({ text: s, t: seconds });
    // Keep the three newest; an older one leaves a little early rather than piling up.
    while (this.notices.length > 3) this.notices.shift();
  }

  /** Leaving the match: the music fades out. */
  exit(): void {
    music.want(null);
  }

  /**
   * The music for this moment: Darkrai's theme near Darkrai (or anywhere in the dark once it is out),
   * the Shadow Lugia and Mewtwo themes in their bouts, the trainer battle theme in any other battle,
   * Abyss while you stand in the storm, and quiet otherwise.
   */
  private musicNow(): TrackId | null {
    const m = this.match;
    if (m.outcome) return null;
    const p = m.player;
    const dark = m.isDark(p.x, p.y);
    const D = m.darkrai;
    if (D && !D.fainted && (Math.hypot(D.x - p.x, D.y - p.y) < 18 || dark)) return 'darkrai';
    const d = m.playerDuel;
    if (d && d.state !== 'over') {
      const foe = (d.a.trainer === p ? d.b : d.a).mon;
      if (m.shadowBoutFoe() || (foe?.shadow && foe.dex.startsWith('0249'))) return 'shadow_lugia';
      if (foe && foe.dex.startsWith('0150')) return 'mewtwo';
      return 'trainer';
    }
    return dark ? 'abyss' : null;
  }

  step(dt: number, input: Input): void {
    music.want(this.musicNow());
    // N: music on or off (remembered in this browser).
    if (input.pressed('KeyN')) this.say(music.toggleMute() ? 'Music off (N)' : 'Music on (N)', 1.2);
    if (this.spectator) {
      this.spectator.step(input, dt);
      input.takeClicks();
      this.match.step(dt, input);
      this.stepChestLids(dt);
      this.consumeEvents();
      for (const n of this.notices) n.t -= dt;
      this.notices = this.notices.filter((n) => n.t > 0);
      return;
    }
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
    if (this.extractPick) {
      this.handleExtractInput(input);
      return;
    }
    if (this.match.snagOffer) {
      this.handleSnagInput(input);
      return;
    }
    if (this.shopOpen) {
      this.handleShopInput(input);
      return;
    }
    this.stepChestLids(dt);
    if (this.chestOpen !== null) {
      this.handleChestInput(input);
      return;
    }
    this.handleInput(input);
    this.match.step(dt, input);
    this.stepStyler(dt, input);
    this.consumeEvents();
    for (const n of this.notices) n.t -= dt;
    this.notices = this.notices.filter((n) => n.t > 0);
  }

  protected handleInput(input: Input): void {
    const v = this.ctx.view;
    // Wiped out and waiting to respawn: nothing to do but wait.
    if (this.match.player.downUntil !== undefined) {
      input.takeClicks();
      return;
    }
    const duelSide = this.playerDuelSide();
    // Moves aim at the cursor; over the HUD the last point on the field is kept.
    const overHud = !!this.hud.hitTest(input.mouseX, input.mouseY);
    if (!overHud) this.match.aim = v.toWorld(input.mouseX, input.mouseY);
    // The ball locks onto the nearest wild; clicking another wild (or Tab) switches the lock.
    for (const c of input.takeClicks()) {
      const h = this.hud.hitTest(c.x, c.y);
      if (h?.kind !== 'release') this.hud.releaseArmed = -1;
      if (!h && !this.match.playerDuel && c.button === 0) {
        // Pokémon mode: click one of your Pokémon out on the field to steer it; click your
        // trainer (or press Esc) to go back.
        const own = this.ownMonNear(c.x, c.y);
        if (own && own !== this.match.controlled && this.match.takeControl(own)) {
          this.say(`Pokémon mode: you steer ${own.name}. It attacks the way it faces. Esc or click your trainer to go back`, 2.6);
          this.holdBlocked = true;
          continue;
        }
        if (this.match.controlled && this.trainerNear(c.x, c.y)) {
          this.match.releaseControl();
          this.say('Trainer mode', 1);
          this.holdBlocked = true;
          continue;
        }
      }
      if (!h && !this.match.playerDuel) {
        // A click on a wild Pokémon makes it the ball's target (the click still casts move 1 at it).
        const w = this.wildNear(c.x, c.y);
        if (w && w !== this.match.lockTarget) {
          this.match.pickLock(w);
          if (this.match.lockTarget === w) this.say(`Ball target: ${w.name}`, 0.8);
        }
      }
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
      else if (h?.kind === 'held') this.say(this.match.unequip(this.match.player, h.index), 1.6);
      else if (h?.kind === 'learn') this.say(this.match.answerLearn(h.index === 2 ? -1 : h.index), 2.2);
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
    // Space talks to whoever is in reach, else picks up a ball in reach, else dodges (only while steering a Pokémon).
    if (input.pressed('Space') && !this.interact()) {
      const r = this.match.playerDodge();
      if (r === 'cooldown') this.say('Dodge not ready', 0.5);
    }
    // R: auto-battle on or off (the lead picks its own moves while you steer).
    if (input.pressed('KeyR')) {
      this.match.auto = !this.match.auto;
      this.say(this.match.auto ? 'Auto-battle on: your lead picks its own moves' : 'Auto-battle off: you pick the moves', 1.6);
    }
    if (input.pressed('Escape') && this.match.controlled) {
      this.match.releaseControl();
      this.say('Trainer mode', 1);
    }
    // Holding a mouse button on the field keeps casting that move as it comes off cooldown
    // (not the click that switched modes).
    if (this.holdBlocked && !input.mouseDown) this.holdBlocked = false;
    if (!overHud && !duelSide?.awaitingPick && !this.holdBlocked) {
      if (input.mouseDown) this.match.playerCast(0);
      if (input.rightDown) this.match.playerCast(1);
    }
    if (this.hud.ping) this.hud.ping.t -= 1 / 60;
    // 1-6 select (or use) that bag slot; moves are the mouse buttons, Q and E. After a knockout in
    // a battle, 1-6 picks who goes next.
    if (duelSide?.awaitingPick) {
      for (let i = 0; i < 6; i++) if (input.pressed(`Digit${i + 1}`)) this.pickNext(i);
      // A legendary can still be caught while you choose who goes out next.
      if (input.pressed('KeyF') && (this.match.legendBoutFoe() || this.match.shadowBoutFoe())) this.throwAtTarget();
      return;
    }
    for (let i = 0; i < 6; i++) if (input.pressed(`Digit${i + 1}`)) this.onItemSlot(i);
    // Q and E: moves 1 and 2 again, next to WASD.
    if (input.pressed('KeyQ')) this.castFeedback(this.match.playerCast(0));
    if (input.pressed('KeyE')) this.castFeedback(this.match.playerCast(1));
    // M: Mega Evolve the Pokémon you are steering (or your lead) when it holds its Mega Stone.
    if (input.pressed('KeyM')) {
      const msg = this.match.megaEvolve(this.match.player);
      if (msg) this.say(msg, 1.6);
    }
    // V: ride (or fly on) a mount from the party, or get off.
    if (input.pressed('KeyV')) {
      const msg = this.match.toggleRide();
      if (msg) this.say(msg, 1.8);
    }
    // Throwing: point at a wild Pokémon (or face a legendary in its bout) and press F.
    if (input.pressed('KeyF')) this.throwAtTarget();
    void v;
  }

  /** The shop: 1-9 (and 0) buys that line; a click on a bag slot (or Shift+1-6) sells one of it; E or Escape closes. */
  private handleShopInput(input: Input): void {
    const shop = this.shopOpen;
    if (!shop) return;
    if (input.pressed('Escape') || input.pressed('KeyE') || input.pressed('Space')) {
      this.shopOpen = null;
      return;
    }
    if (input.pressed('KeyG')) this.gearTab = !this.gearTab;
    const tab = this.gearTab ? 'held' : 'items';
    for (const c of input.takeClicks()) {
      const h = this.hud.hitTest(c.x, c.y);
      if (h?.kind === 'item') this.say(this.match.sell(this.match.player, tab, h.index), 1.6);
      else if (h?.kind === 'tab') this.gearTab = h.index === 1;
    }
    const shift = input.down('ShiftLeft') || input.down('ShiftRight');
    // 1-9, and 0 for a tenth line (the merchant's Storm Mask days).
    for (let i = 0; i < 10; i++) {
      if (!input.pressed(`Digit${(i + 1) % 10}`)) continue;
      if (shift && i >= 9) continue;
      const msg = shift ? this.match.sell(this.match.player, tab, i) : this.match.buy(shop, i);
      if (msg) this.say(msg, 1.6);
    }
    // Messages keep counting down while the shop is open.
    for (const n of this.notices) n.t -= 1 / 60;
    this.notices = this.notices.filter((n) => n.t > 0);
  }

  /**
   * The storage chest: a click on a bag slot (or 1-6) stores that stack, a click on a chest slot
   * (or Shift+1-9) takes it back; G switches bag tabs; E, Space or Escape closes.
   */
  private handleChestInput(input: Input): void {
    if (input.pressed('Escape') || input.pressed('KeyE') || input.pressed('Space')) {
      this.chestOpen = null;
      return;
    }
    const p = this.match.player;
    if (input.pressed('KeyG')) this.gearTab = !this.gearTab;
    const tab = this.gearTab ? 'held' : 'items';
    for (const c of input.takeClicks()) {
      const h = this.hud.hitTest(c.x, c.y);
      if (h?.kind === 'item') this.say(this.match.deposit(p, tab, h.index), 1.4);
      else if (h?.kind === 'chest') this.say(this.match.withdraw(p, h.index), 1.4);
      else if (h?.kind === 'tab') this.gearTab = h.index === 1;
    }
    const shift = input.down('ShiftLeft') || input.down('ShiftRight');
    for (let i = 0; i < 9; i++) {
      if (!input.pressed(`Digit${i + 1}`)) continue;
      const msg = shift ? this.match.withdraw(p, i) : this.match.deposit(p, tab, i);
      if (msg) this.say(msg, 1.4);
    }
    for (const n of this.notices) n.t -= 1 / 60;
    this.notices = this.notices.filter((n) => n.t > 0);
  }

  /** Lids swing open while their chest is in use and shut after. */
  private stepChestLids(dt: number): void {
    this.match.chests.forEach((_, i) => {
      const cur = this.chestLid.get(i) ?? 0;
      const want = this.chestOpen === i ? 1 : 0;
      const next = want > cur ? Math.min(1, cur + dt * 5) : Math.max(0, cur - dt * 4);
      if (next !== cur) this.chestLid.set(i, next);
    });
  }

  /** Space (or E): a vendor opens the stall, a healer heals, the champion battles; else the nearest ball is picked up. */
  private interact(): boolean {
    if (this.online) {
      // Shops and chests open here; anything else in reach is the server's to do. Nothing in reach: a dodge.
      const svc = this.match.nearService();
      if (!this.match.fishing && !this.match.visitors.near() && (svc?.kind === 'shop' || svc?.kind === 'chest')) {
        if (svc.kind === 'shop') this.shopOpen = svc.shop;
        else this.chestOpen = svc.index;
        return true;
      }
      if (this.match.fishing || this.match.visitors.near() || this.nearTalker() || svc || this.match.nearestItem() || canFish(this.match)) {
        this.online.cmd('interact');
        return true;
      }
      return false;
    }
    // Fishing: Space hooks a bite (or reels in early).
    if (this.match.fishing) {
      const msg = hookOrReel(this.match);
      if (msg) this.say(msg, 1.4);
      return true;
    }
    const who = this.match.visitors.near();
    if (who === 'ace') {
      this.say(this.match.visitors.challengeAce(), 3);
      return true;
    }
    if (who === 'hoopa') {
      this.say(this.match.visitors.askHoopa(), 3);
      return true;
    }
    const folkCrew = this.match.visitors.folk;
    const folk = folkCrew?.near();
    if (folkCrew && folk) {
      this.say(folkCrew.talk(folk), 4);
      return true;
    }
    const s = this.match.nearService();
    if (s?.kind === 'shop') this.shopOpen = s.shop;
    else if (s?.kind === 'chest') this.chestOpen = s.index;
    else if (s?.kind === 'challenge') this.say(this.match.startChallenge(), 3);
    else if (s?.kind === 'healer') this.say(this.match.healAtHealer(), 2);
    else if (this.match.nearestItem()) return this.match.pickUp();
    else if (canFish(this.match)) {
      const msg = startFishing(this.match);
      if (msg) this.say(msg, 1.4);
    } else return this.match.pickUp();
    return true;
  }

  /** The townsperson or Breeder within talking reach (works from the synced npc list, so online too). */
  private nearTalker(): { name: string; role: string } | null {
    const p = this.match.player;
    let best: { name: string; role: string } | null = null;
    let bd = Infinity;
    for (const n of this.match.npcs) {
      if (!n.role.startsWith('villager') && n.role !== 'breeder') continue;
      const d = Math.hypot(n.x - p.x, n.y - p.y);
      if (d <= 1.8 && d < bd) {
        bd = d;
        best = n;
      }
    }
    return best;
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
  /** The Alpha mark (assets/ui/alpha.png), shown by an Alpha's name. */
  private alphaBadge: HTMLImageElement | null = null;
  /** Darkrai's portal: three 36x50 frames (closed slit, half open, open). */
  private portalSheet: HTMLImageElement | null = null;
  /** Hoopa's portal: eight 64x64 frames of a blue ring standing upright (assets/fx/hoopa_portal.png), and its storm (purple) copy. */
  private hoopaPortal: HTMLImageElement | null = null;
  private hoopaPortalDark: CanvasImageSource | null = null;
  /** The Shadow Crystal's art (scripts/shadow_crystal.py): the cluster, its broken stump, its pedestal. */
  private crystalImg: HTMLImageElement | null = null;
  private crystalBroken: HTMLImageElement | null = null;
  private crystalBase: HTMLImageElement | null = null;
  /** Whether the crystal was still whole last frame (it shatters once, when Darkrai wakes). */
  private crystalWhole: boolean | null = null;
  /** The Pokémon-mode aim reticle (and its red version over an enemy). */
  private reticle: HTMLImageElement | null = null;
  private reticleHot: HTMLImageElement | null = null;

  /** Set by the click that switched modes, until the button comes up. */
  private holdBlocked = false;

  /** The player's own Pokémon out on the field under (or nearest) a screen point. */
  private ownMonNear(sx: number, sy: number): Mon | null {
    const w = this.ctx.view.toWorld(sx, sy);
    let best: Mon | null = null;
    let bd = Infinity;
    for (const m of this.match.player.party) {
      if (m.fainted || m.stowed || m.captured || m.visual.alpha < 0.5) continue;
      const hTiles = (m.species.body[1] * monScale(m)) / 16;
      const d = Math.hypot(w.x - m.x, w.y - (m.y - hTiles / 2));
      if (d < Math.max(1.1, hTiles * 0.7) && d < bd) {
        bd = d;
        best = m;
      }
    }
    return best;
  }

  /** True when a screen point is on the player's trainer. */
  private trainerNear(sx: number, sy: number): boolean {
    const w = this.ctx.view.toWorld(sx, sy);
    const p = this.match.player;
    return Math.hypot(w.x - p.x, w.y - (p.y - 0.8)) < 1.1;
  }

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
    const shadow = m.shadowBoutFoe();
    if (shadow) {
      // Shadow Lugia: the ball flies, and bounces off (Match.stepThrows).
      const slot = m.ballSlot(p, this.selectedItem);
      if (slot < 0) return this.say('No Poké Balls in the bag', 1);
      p.dir = dirFromVector(shadow.x - p.x, shadow.y - p.y, p.dir);
      m.throwBall(p, slot, { x: shadow.x, y: shadow.y }, shadow);
      if (!p.items[slot]) this.selectedItem = m.ballSlot(p);
      return;
    }
    // A legendary in its bout with you can be caught with a ball.
    const legend = m.legendBoutFoe();
    if (legend) {
      // One ball at a time: while it is inside a ball a second one would only miss.
      if (m.throws.some((th) => th.thrower === p && th.phase !== 'done')) return this.say('Wait for the ball to settle', 0.8);
      const slot = m.ballSlot(p, this.selectedItem);
      if (slot < 0) return this.say('No Poké Balls in the bag', 1);
      this.selectedItem = slot;
      p.dir = dirFromVector(legend.x - p.x, legend.y - p.y, p.dir);
      // The ball follows it in flight: a legendary strafes, and a ball aimed at where it was would miss.
      if (m.throwBall(p, slot, { x: legend.x, y: legend.y }, legend)) this.say(`Go, ${ITEMS[p.items[slot]?.id ?? '']?.name ?? 'Poké Ball'}!`, 0.8);
      if (!p.items[slot]) this.selectedItem = m.ballSlot(p);
      return;
    }
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
    // In a legendary bout the ball goes to the legendary (any distance); otherwise the locked wild.
    const legend = this.match.legendBoutFoe();
    const t = legend ?? this.match.lockTarget;
    if (!t || t.fainted || t.captured || (!legend && !this.match.wilds.includes(t))) return;
    const p = this.match.player;
    const inRange = !!legend || Math.hypot(t.x - p.x, t.y - p.y) <= CONFIG.catch.throwRange;
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

  /**
   * Pokémon mode and trainer battles: a ring under the Pokémon you fight with and the reticle on
   * the cursor (where its moves go). Trainer mode out of battle draws no aim.
   */
  private drawAim(v: View): void {
    const duel = this.playerDuelSide();
    const m = duel ? (duel.awaitingPick ? null : duel.mon) : this.match.controlled;
    if (!this.showHud || !m || m.fainted) return;
    const ctx = v.ctx;
    const s = v.baseScale;
    const x = v.toScreenX(m.x);
    const y = v.toScreenY(m.y);
    const r = Math.max(0.55, bodyRadius(m.species) * 1.2) * v.pxPerTile;
    const f = DIR_VECTORS[m.dir] as { x: number; y: number };
    const fl = Math.hypot(f.x, f.y) || 1;
    const ux = f.x / fl;
    const uy = f.y / fl;
    ctx.save();
    ctx.strokeStyle = 'rgba(125,220,255,0.85)';
    ctx.lineWidth = Math.max(2, 2.5 * s);
    ctx.beginPath();
    ctx.ellipse(x, y, r, r * 0.5, 0, 0, Math.PI * 2);
    ctx.stroke();
    void ux;
    void uy;
    // The reticle on the cursor: where its moves go. Red over an enemy, a faint line back to it.
    const aim = this.match.aim;
    if (aim) {
      const ax = Math.round(v.toScreenX(aim.x));
      const ay = Math.round(v.toScreenY(aim.y));
      const foe = [...this.match.mons()].some((o) => o !== m && !o.npc && this.match.battle.isEnemy(m, o) && Math.hypot(o.x - aim.x, o.y - aim.y) < Math.max(0.6, bodyRadius(o.species)));
      const col = foe ? '255,90,90' : '125,220,255';
      ctx.strokeStyle = `rgba(${col},0.35)`;
      ctx.lineWidth = Math.max(1, 1.5 * s);
      ctx.setLineDash([4 * s, 6 * s]);
      ctx.beginPath();
      ctx.moveTo(x, y - r * 0.3);
      ctx.lineTo(ax, ay);
      ctx.stroke();
      ctx.setLineDash([]);
      this.reticleAt = { x: ax, y: ay, foe };
    }
    ctx.restore();
  }

  /** Where drawAim put the reticle this frame; drawn on the HUD canvas so it sits over every sprite. */
  private reticleAt: { x: number; y: number; foe: boolean } | null = null;

  private drawReticleTop(v: View): void {
    const r = this.reticleAt;
    this.reticleAt = null;
    if (!r) return;
    const ctx = v.hud;
    const img = r.foe ? this.reticleHot : this.reticle;
    ctx.save();
    if (img) {
      // Kenney's CC0 crosshair (Starter Kit FPS), pixelated to 28 px: assets/ui/reticle*.png.
      const k = Math.max(1, Math.round(v.baseScale * 2));
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(img, Math.round(r.x - (img.width * k) / 2), Math.round(r.y - (img.height * k) / 2), img.width * k, img.height * k);
    } else drawReticle(ctx, r.x, r.y, Math.max(2, Math.round(v.baseScale * 3)), r.foe ? '255,90,90' : '125,220,255', performance.now() / 1000);
    ctx.restore();
  }

  /**
   * Fishing, drawn on whole sprite pixels: the rod in the trainer's hand, the line sagging out to a
   * red-and-white bobber with rings on the water, the cast arc, the "!" when something bites, and the
   * taut line as it is reeled in.
   */
  private drawFishing(v: View): void {
    const f = this.match.fishing;
    if (!f) return;
    const p = this.match.player;
    const ctx = v.ctx;
    const u = Math.max(2, Math.round(v.spriteScale));
    const now = performance.now() / 1000;
    const sx = Math.round(v.toScreenX(p.x));
    const sy = Math.round(v.toScreenY(p.y));
    const side = Math.abs(f.fx) > Math.abs(f.fy);
    const up = !side && f.fy < 0;
    const hand = { x: sx + (side ? Math.sign(f.fx) * 4 : 6) * u, y: sy - (up ? 14 : 13) * u };
    // Rod tip at rest: out over the water and up.
    let tip = { x: hand.x + (f.fx * 9 + (side ? 0 : 2)) * u, y: hand.y + (f.fy * 6 - 12) * u };
    const castT = Math.min(1, f.t / FISHING.castSeconds);
    if (f.stage === 'cast' && castT < 0.35) tip = { x: hand.x - f.fx * 5 * u, y: hand.y - (f.fy * 3 + 15) * u };
    const bite = f.stage === 'bite';
    if (bite) tip = { x: tip.x + f.fx * 2 * u + Math.sin(now * 40) * u * 0.6, y: tip.y + (f.fy * 2 + 3) * u };
    if (f.stage === 'reel') tip = { x: tip.x + f.fx * 3 * u, y: tip.y + 4 * u };
    // Where the bobber is on screen.
    const b0 = { x: v.toScreenX(f.bx), y: v.toScreenY(f.by) };
    let bob = { x: b0.x, y: b0.y };
    let sag = 6 * u;
    if (f.stage === 'cast') {
      const k = Math.max(0, (castT - 0.35) / 0.65);
      bob = { x: tip.x + (b0.x - tip.x) * k, y: tip.y + (b0.y - tip.y) * k - Math.sin(Math.PI * k) * 14 * u };
      sag = 2 * u;
    } else if (f.stage === 'reel') {
      const k = Math.min(1, f.t / FISHING.reelSeconds);
      const shore = { x: v.toScreenX(p.x + f.fx * 1.3), y: v.toScreenY(p.y + f.fy * 1.3) };
      bob = { x: b0.x + (shore.x - b0.x) * k, y: b0.y + (shore.y - b0.y) * k };
      sag = 0;
    } else if (bite) {
      sag = u;
    }
    const inWater = f.stage !== 'cast';
    const dip = !inWater ? 0 : bite ? (2 + Math.round(Math.abs(Math.sin(now * 18)) * 3)) * u : Math.round(Math.sin(now * 3) * 0.8) * u;
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    // Rings on the water.
    if (inWater) {
      const period = bite ? 0.45 : 1.6;
      for (let j = 0; j < 2; j++) {
        const k = ((now / period + j * 0.5) % 1);
        const r = (2 + k * (bite ? 9 : 7)) * u;
        ctx.strokeStyle = `rgba(235,250,255,${(bite ? 0.85 : 0.55) * (1 - k)})`;
        ctx.lineWidth = Math.max(1, u * 0.6);
        ctx.beginPath();
        ctx.ellipse(bob.x, bob.y + u, r, r * 0.42, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    // The line: a sagging curve from the tip to the bobber.
    ctx.strokeStyle = 'rgba(245,245,250,0.9)';
    ctx.lineWidth = Math.max(1, Math.round(u * 0.4));
    ctx.beginPath();
    ctx.moveTo(tip.x, tip.y);
    ctx.quadraticCurveTo((tip.x + bob.x) / 2, Math.max(tip.y, bob.y) + sag, bob.x, bob.y - 3 * u + dip);
    ctx.stroke();
    // The rod: a dark handle and a lighter, thinner tip.
    const mid = { x: hand.x + (tip.x - hand.x) * 0.35, y: hand.y + (tip.y - hand.y) * 0.35 };
    ctx.lineCap = 'square';
    ctx.strokeStyle = '#3c2a1c';
    ctx.lineWidth = u * 1.7;
    ctx.beginPath();
    ctx.moveTo(hand.x, hand.y);
    ctx.lineTo(mid.x, mid.y);
    ctx.stroke();
    ctx.strokeStyle = '#a8743f';
    ctx.lineWidth = u * 1.1;
    ctx.beginPath();
    ctx.moveTo(mid.x, mid.y);
    ctx.lineTo(tip.x, tip.y);
    ctx.stroke();
    // The bobber: red top, white bottom, dark outline.
    const bx = Math.round(bob.x / u) * u;
    const by = Math.round((bob.y + dip) / u) * u;
    ctx.fillStyle = '#281c22';
    ctx.fillRect(bx - 3 * u, by - 5 * u, 6 * u, 6 * u);
    ctx.fillStyle = '#e83c3c';
    ctx.fillRect(bx - 2 * u, by - 4 * u, 4 * u, 2 * u);
    ctx.fillStyle = '#fafafa';
    ctx.fillRect(bx - 2 * u, by - 2 * u, 4 * u, 2 * u);
    // "!" over the trainer when something bites.
    if (bite) {
      const hx = sx;
      const hy = sy - 52 * u;
      const w = 10 * u;
      const hh = 12 * u;
      ctx.fillStyle = '#1e1428';
      ctx.fillRect(hx - w / 2 - u, hy - u, w + 2 * u, hh + 2 * u);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(hx - w / 2, hy, w, hh);
      ctx.fillRect(hx - u, hy + hh, 2 * u, 2 * u);
      ctx.fillStyle = '#e1303e';
      ctx.fillRect(hx - u, hy + 2 * u, 2 * u, 5 * u);
      ctx.fillRect(hx - u, hy + 8 * u, 2 * u, 2 * u);
    }
    ctx.restore();
  }

  /** Darkrai's entrance portal, standing upright behind it: slit, half open, open, held, then closing. */
  private drawDarkraiPortal(v: View, now: number): void {
    const po = this.match.darkraiPortal;
    const img = this.portalSheet;
    if (!po || !img) return;
    const T = Match.PORTAL_SECONDS;
    const tt = po.t;
    // Frame by time: open 0-0.9 s, hold, close over the last 0.8 s.
    let frame = 2;
    if (tt < 0.3) frame = 0;
    else if (tt < 0.6) frame = 1;
    else if (tt > T - 0.3) frame = 0;
    else if (tt > T - 0.6) frame = 1;
    const fade = tt > T - 0.3 ? Math.max(0, (T - tt) / 0.3) : 1;
    const scale = v.spriteScale * 1.4;
    const fw = 36;
    const fh = 50;
    const x = Math.round(v.toScreenX(po.x) - (fw * scale) / 2);
    // Bottom of the open portal a little above the ground, so Darkrai seems to float out of it.
    const y = Math.round(v.toScreenY(po.y) - fh * scale * 0.9 + Math.sin(now * 2) * 2);
    const ctx = v.ctx;
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.globalAlpha = fade;
    ctx.shadowColor = 'rgba(160,90,220,0.8)';
    ctx.shadowBlur = 18 * v.baseScale;
    ctx.drawImage(img, frame * fw, 0, fw, fh, x, y, fw * scale, fh * scale);
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
  /** The voucher prompt: 1-6 or a click on a party card extracts that Pokémon, Escape cancels. */
  /** The Snag Machine prompt after a won battle: 1-6 (or a click on a line) takes that Pokémon, Escape keeps the machine. */
  private handleSnagInput(input: Input): void {
    if (input.pressed('Escape')) {
      this.match.snagOffer = null;
      this.say('You kept your Snag Machine', 1.4);
      return;
    }
    let pick = -1;
    for (let i = 0; i < 6; i++) if (input.pressed(`Digit${i + 1}`)) pick = i;
    for (const c of input.takeClicks()) {
      const h = this.hud.hitTest(c.x, c.y);
      if (h?.kind === 'snag') pick = h.index;
      else if (h?.kind === 'release') {
        // A full party can make room right here: the release X works while the offer is open.
        if (this.hud.releaseArmed === h.index) {
          this.hud.releaseArmed = -1;
          this.say(this.match.release(h.index), 2);
        } else {
          this.hud.releaseArmed = h.index;
          const m = this.match.player.party[h.index];
          if (m) this.say(`Click "Release?" again to let ${m.name} go`, 2);
        }
      }
    }
    if (pick < 0) return;
    const msg = this.match.snag(pick);
    if (msg) this.say(msg, 2.4);
  }

  private handleExtractInput(input: Input): void {
    const ex = this.extractPick;
    if (!ex) return;
    if (input.pressed('Escape')) {
      this.extractPick = null;
      return;
    }
    let pick = -1;
    for (let i = 0; i < 6; i++) if (input.pressed(`Digit${i + 1}`)) pick = i;
    for (const c of input.takeClicks()) {
      const h = this.hud.hitTest(c.x, c.y);
      if (h?.kind === 'portrait') pick = h.index;
    }
    if (pick < 0 || pick >= this.match.player.party.length) return;
    this.extractPick = null;
    const msg = this.match.extractWithVoucher(ex.slot, pick);
    if (msg) this.say(msg, 2.4);
  }

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
    if (this.online) this.online.cmd('discard', this.gearTab ? 'held' : 'items', index);
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
        if (!canLearnTm(m.species, def.move ?? '')) return this.say(tmRefusal(m, def.move ?? ''), 2.4);
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
    if (def?.kind === 'voucher') {
      if (p.duelId) return this.say("You can't extract a Pokémon during a battle", 1.6);
      this.extractPick = { slot: index };
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
      case 'hit':
        // The sim lands the hit when the effect arrives (battle.ts impactDelay), so show it now.
        this.showHit(ev);
        break;
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
        this.floaters.add(ev.target.x, ev.target.y, String(ev.damage), ev.source === 'burn' ? '#ff8a65' : ev.source === 'poison' ? '#c77dff' : ev.source === 'recoil' ? '#f2efe6' : '#c38bff', 15);
        // Bad Dreams: the nightmare cloud loops over the sleeper until the next tick.
        if (ev.source === 'dreams') this.playFx(EXTRA_FX.dreams, { x: ev.target.x, y: ev.target.y, lift: 1.1, scale: 2, fps: 10, loopSeconds: 1.05, follow: ev.target });
        break;
      case 'faint':
        this.floaters.add(ev.mon.x, ev.mon.y - 0.2, `${ev.mon.name} fainted`, '#ffffff', 15);
        break;
      case 'scene-fx':
        if (ev.ground) {
          const sh = this.fx.sheet(ev.id);
          if (sh) this.groundVfx.add(new FxAnim(sh, { x: ev.x, y: ev.y, lift: 0, scale: ev.scale, fps: ev.fps ?? 14, tint: ev.tint }));
        } else this.playFx(ev.id, { x: ev.x, y: ev.y, lift: ev.lift ?? 0.6, scale: ev.scale, fps: ev.fps ?? 14, tint: ev.tint });
        if (ev.shake) this.shake = Math.max(this.shake, ev.shake);
        break;
      case 'extracted': {
        // Into the PC for keeps (this browser's storage, or the server's online): a beam of light takes it away.
        const saved = this.online ? true : extractToPc(ev.mon, ev.via);
        this.playFx('fx_093', { x: ev.mon.x, y: ev.mon.y, lift: 2.4, scale: 1.4, fps: 10, tint: '#bff6ff' });
        this.floaters.add(ev.mon.x, ev.mon.y - 0.8, saved ? `${ev.mon.name} → PC` : 'PC unavailable', '#9ff3ff', 16);
        if (!saved) this.say("Couldn't reach your PC (this browser blocks saving)", 2.4);
        break;
      }
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
        if (!ev.trainer.legendBout && (mine || ev.duel.a.trainer === this.match.player || ev.duel.b.trainer === this.match.player)) {
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
      case 'fish':
        // A small splash where the bobber lands, a bigger one when something bites.
        if (ev.stage !== 'cast') this.vfx.add(new ImpactBurst(ev.x, ev.y, '#d8f2ff', ev.stage === 'bite' ? 0.7 : 0.4));
        break;
      case 'mega-start':
        if (ev.mon.owner?.isPlayer) this.say(`${ev.mon.name}'s ${ITEMS[ev.mon.heldItem ?? '']?.name ?? 'Mega Stone'} is reacting!`, 1.6);
        else if (ev.mon.owner) this.say(`${ev.mon.owner.name}'s ${ev.mon.name} is Mega Evolving!`, 2);
        this.playFx(EXTRA_FX.evolve, { x: ev.mon.x, y: ev.mon.y, lift: 0.5, scale: 2.6, fps: 12 });
        this.shake = Math.max(this.shake, 0.6);
        break;
      case 'evolved':
        if (ev.mon.mega && ev.mon.megaFrom?.name === ev.from) {
          if (ev.mon.owner?.isPlayer) this.say(`${ev.from} Mega Evolved into ${ev.mon.name}!`, 3);
          this.playFx(EXTRA_FX.flash, { x: ev.mon.x, y: ev.mon.y, lift: 0.5, scale: 4, fps: 18 });
          this.shake = Math.max(this.shake, 1);
          break;
        }
        if (ev.mon.owner?.isPlayer) this.say(`${ev.from} evolved into ${ev.mon.name}!`, 2.6);
        this.playFx(EXTRA_FX.flash, { x: ev.mon.x, y: ev.mon.y, lift: 0.5, scale: 3, fps: 18 });
        break;
      case 'money':
        if (ev.trainer.isPlayer) this.floaters.add(ev.x, ev.y - 1.2, `+₽${ev.amount}`, '#ffe27a', 13);
        break;
      case 'downed':
        if (!ev.trainer.isPlayer) this.say(`${ev.trainer.name} was wiped out by wild Pokémon`, 2);
        break;
      case 'respawned':
        if (ev.trainer.isPlayer) this.say('Back in the fight! Your party is healed, but your items are gone', 3);
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
    else if (ev.damage > 0 && ev.attacker.channel) {
      // A channelled beam's pulses: small numbers, no hit-stop (it would stutter the whole beam).
      this.floaters.add(ev.target.x + (Math.random() - 0.5) * 0.4, ev.target.y, `${ev.damage}`, color, ev.effectiveness > 1 ? 18 : 15);
    } else if (ev.damage > 0) {
      this.floaters.add(ev.target.x, ev.target.y, `${ev.crit ? '✦' : ''}${ev.damage}`, color, ev.effectiveness > 1 ? 30 : 22);
      if (ev.effectiveness > 1) this.floaters.add(ev.target.x + 0.2, ev.target.y - 0.4, 'Super effective!', '#ffd36b', 15);
      else if (ev.effectiveness < 1) this.floaters.add(ev.target.x + 0.2, ev.target.y - 0.4, 'Not very effective', '#b0bec5', 13);
      // Hit-stop only for hits the player is part of; distant AI fights stay quiet.
      if (ev.attacker.owner?.isPlayer || ev.target.owner?.isPlayer) {
        this.match.battle.hitStop = Math.max(this.match.battle.hitStop, CONFIG.battle.hitStopMs / 1000);
      }
    }
  }

  /** Height of the middle of a Pokémon's drawn body above its feet, in tiles (where hits land). */
  private bodyLift(m: Mon | null): number {
    if (!m) return 0.45;
    return Math.max(0.2, (m.species.body[1] * drawScale(m.species)) / 16 / 2);
  }

  /**
   * Where a beam or projectile leaves its user: the mouth (the head marked on the frame being shown),
   * the hands, or the middle of the body. Falls back to the body when the sprite marks no such point.
   */
  private launch(m: Mon, origin: FxPart['origin'] = 'mouth'): { from: { x: number; y: number }; lift: number } {
    const body = { from: { x: m.x, y: m.y }, lift: this.bodyLift(m) };
    if (origin === 'body') return body;
    const pt = m.anim.point(origin === 'hands' ? 'hands' : 'head');
    if (!pt) return body;
    const v = this.ctx.view;
    // Tiles per sprite pixel, as drawMon draws the frame (its centre on the ground point).
    const k = (v.spriteScale * Math.max(0.01, m.visual.scale) * monScale(m)) / v.pxPerTile;
    const leap = m.leap ? m.leap.h * Math.sin(Math.PI * Math.min(1, m.leap.t / m.leap.dur)) : 0;
    return { from: { x: m.x + pt[0] * k, y: m.y }, lift: Math.max(0.1, -pt[1] * k + leap) };
  }

  /** Impacts grow a little on big bodies so a hit on a Steelix still reads, and never swamp a Jirachi. */
  private bodyScale(m: Mon | null): number {
    if (!m) return 1;
    return Math.max(0.75, Math.min(1.5, Math.sqrt(bodyRadius(m.species) / 0.45)));
  }

  /** The beam each channelling Pokémon is pouring out, per effect part (spawnFx reuses it pulse to pulse). */
  private channelBeams = new Map<string, FxBeam>();

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
    // Beams and shots from a big body are a little thicker, from a small one a little thinner.
    const userK = Math.sqrt(this.bodyScale(attacker));
    // With no one hit, a beam runs to the end of its reach along the aim (fx, fy is a direction,
    // not a point: aiming at it sent beams off toward the map's corner).
    const reach = area.shape === 'line' ? 3.4 * R() : area.shape === 'cone' ? 2.9 * R() : 0;
    const focus = hits[0] ? { x: hits[0].x, y: hits[0].y }
      : reach ? { x: area.ox + area.fx * reach, y: area.oy + area.fy * reach } : { x: area.tx, y: area.ty };
    // Impacts go on each Pokémon hit. A miss: lines and cones burst at the end of their reach, a
    // ring (centred on the user) shows no stray impact, anything else lands on the aim point.
    const targets: Array<{ x: number; y: number; mon: Mon | null }> = hits.length
      ? hits.map((h) => ({ x: h.x, y: h.y, mon: h }))
      : area.shape === 'ring' ? []
        : [{ x: focus.x, y: focus.y, mon: null }];
    const playAt = (part: FxPart, t: { x: number; y: number; mon: Mon | null }, onBody: boolean): void => {
      const sheet = this.fx.sheet(part.id);
      if (!sheet) return;
      const k = onBody ? this.bodyScale(t.mon) : 1;
      if (part.mode === 'status') {
        this.addVfx(new FxAnim(sheet, { x: t.x, y: t.y, lift: this.bodyLift(t.mon) * 2 + 0.35, scale: part.scale ?? 2, fps: part.fps ?? 15, loopSeconds: 1.6, follow: t.mon, tint: part.tint }), part);
        return;
      }
      const lift = part.ground ? (part.lift ?? 0) : part.lift ?? (onBody ? this.bodyLift(t.mon) : fromLift);
      // Impacts stay about the size of the body they land on: never more than ~1.9 tiles across for a
      // trainer-sized body (2.8 on the ground), so a hit reads without swallowing the Pokémon that made it.
      let scale = (part.scale ?? 2) * k;
      if (onBody) scale = Math.min(scale, ((part.ground ? 2.8 : 1.9) * k * 48) / Math.max(sheet.fw, sheet.fh));
      this.addVfx(new FxAnim(sheet, { x: t.x, y: t.y, lift, scale, fps: part.fps ?? 15, tint: part.tint }), part);
    };
    // A channelled beam pulses every quarter second: its impacts play on every other pulse, so their
    // flashes and lights don't pile up into a white-out while the beam keeps pouring.
    const ch = attacker.channel;
    const pulse = ch ? Math.round((CONFIG.battle.channel.seconds - ch.left) / CONFIG.battle.channel.tick) : 0;
    const skipImpacts = !!ch && pulse % 2 === 1;
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
          // A channelled beam keeps one beam per part, swung to each pulse's line (stacking a new one
          // every pulse piled their glows into a white-out).
          const key = `${attacker.id}:${part.id}`;
          const live = ch ? this.channelBeams.get(key) : undefined;
          const out = this.launch(attacker, part.origin);
          // The far end lands on the middle of the body it hits (a miss stays level).
          const toLift = hits[0] ? this.bodyLift(hits[0]) : undefined;
          if (live && live.alive) live.refresh(out.from, focus, CONFIG.battle.channel.tick * 2.5, part.lift ?? out.lift, part.lift ?? toLift);
          else {
            const beam = new FxBeam(sheet, { from: out.from, to: focus, mode: part.mode, lift: part.lift ?? out.lift, toLift: part.lift ?? toLift, scale: (part.scale ?? 2) * userK, fps: part.fps ?? 15, seconds: part.seconds, tint: part.tint, facing: part.facing === 'none' ? undefined : part.facing });
            if (ch) {
              if (this.channelBeams.size > 64) for (const [k2, b2] of this.channelBeams) if (!b2.alive) this.channelBeams.delete(k2);
              this.channelBeams.set(key, beam);
            }
            this.addVfx(beam, part);
          }
        } else playAt(part, { x: attacker.x, y: attacker.y, mon: attacker }, false);
        continue;
      }
      if (carrier) impacts.push(part);
      else if (!skipImpacts) for (const t of targets) playAt(part, t, true);
    }
    if (!carrier) return;
    const sheet = this.fx.sheet(carrier.id);
    const c = carrier;
    if (c.sweep && sheet && c.anchor === 'projectile') {
      // One carrier crosses the whole reach along the aim (Twister): each Pokémon hit gets its
      // impact as the carrier passes it, in step with the damage (battle.impactDelay).
      const len = reach || 3.4 * R();
      const end = { x: area.ox + area.fx * len, y: area.oy + area.fy * len };
      const speed = c.speed ?? 11;
      this.addVfx(new FxProjectile(sheet, {
        from, to: end, lift: c.lift ?? fromLift, scale: c.scale ?? 2, fps: c.fps ?? 15, tint: c.tint, facing: c.facing,
        speed, loopFrom: c.loopFrom, grounded: c.grounded, sway: c.sway, fadeOut: c.fadeOut,
      }), c);
      for (const h of hits) {
        const d = Math.hypot(h.x - from.x, h.y - from.y) / speed;
        for (const p of impacts) playAt({ ...p, delay: (p.delay ?? 0) + d + (c.delay ?? 0) }, { x: h.x, y: h.y, mon: h }, true);
      }
      return;
    }
    for (const t of targets) {
      if (!sheet) {
        for (const p of impacts) playAt(p, t, true);
        continue;
      }
      const sky = c.anchor === 'sky';
      const out = this.launch(attacker, c.origin);
      this.addVfx(new FxProjectile(sheet, {
        from: sky ? { x: t.x, y: t.y } : out.from,
        to: { x: t.x, y: t.y },
        lift: c.lift ?? this.bodyLift(t.mon),
        fromLift: sky ? (c.height ?? 6) : out.lift,
        arc: c.arc,
        speed: c.speed ?? (sky ? 14 : 11),
        scale: (c.scale ?? 2) * (sky ? 1 : userK),
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
    // The battlefields (the champion's in the castle, the final one round the crystal): painted
    // lines, a centre circle and a box at each end of the long side.
    const fields = [this.match.ground.features?.arena, this.match.ground.features?.finalArena];
    for (const arena of fields) {
      if (!arena) continue;
      const x0 = v.toScreenX(arena.x0 + 0.5);
      const y0 = v.toScreenY(arena.y0 + 0.5);
      const x1 = v.toScreenX(arena.x1 - 0.5);
      const y1 = v.toScreenY(arena.y1 - 0.5);
      if (x1 < 0 || y1 < 0 || x0 > v.width || y0 > v.height) continue;
      const w = x1 - x0;
      const h = y1 - y0;
      const mx = (x0 + x1) / 2;
      const my = (y0 + y1) / 2;
      const wide = w > h;
      ctx.save();
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.lineWidth = Math.max(3, 5 * v.baseScale);
      ctx.strokeRect(x0, y0, w, h);
      ctx.beginPath();
      if (wide) {
        ctx.moveTo(mx, y0);
        ctx.lineTo(mx, y1);
      } else {
        ctx.moveTo(x0, my);
        ctx.lineTo(x1, my);
      }
      ctx.stroke();
      const r = Math.min(w, h) * (arena === fields[1] ? 0.3 : 0.17);
      ctx.beginPath();
      ctx.arc(mx, my, r, 0, Math.PI * 2);
      ctx.stroke();
      if (arena === fields[1]) {
        // Round the crystal: a violet glow fading out to the circle, not a half-painted disc.
        const g = ctx.createRadialGradient(mx, my, r * 0.2, mx, my, r);
        g.addColorStop(0, 'rgba(150,80,230,0.32)');
        g.addColorStop(1, 'rgba(150,80,230,0.06)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(mx, my, r, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillStyle = 'rgba(214,72,72,0.35)';
        ctx.beginPath();
        ctx.arc(mx, my, r, Math.PI, Math.PI * 2);
        ctx.fill();
      }
      if (wide) {
        const bw = w * 0.16;
        const bh = h * 0.36;
        ctx.strokeRect(x0, my - bh / 2, bw, bh);
        ctx.strokeRect(x1 - bw, my - bh / 2, bw, bh);
      } else {
        const bw = w * 0.32;
        const bh = h * 0.18;
        ctx.strokeRect(mx - bw / 2, y0, bw, bh);
        ctx.strokeRect(mx - bw / 2, y1 - bh, bw, bh);
      }
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

  /**
   * The Shadow Crystal (scripts/shadow_crystal.py draws the art): a violet cluster with a dark heart,
   * hovering over an obsidian pedestal with a slow bob, a soft glow behind it, the heart pulsing and
   * a few motes circling. Once Darkrai is out it is a broken stump sitting on the pedestal.
   */
  private drawCrystal(v: View): void {
    const ctx = v.ctx;
    const base = this.crystalBase;
    const finale = this.match.darkness.finale;
    // The moment it breaks: shards flung out and a ring of violet light.
    if (finale && this.crystalWhole === true) {
      this.vfx.add(new ShardBurst(this.match.centerX, this.match.centerY, 2.4, ['#e8ceff', '#b080ff', '#7a3ad6', '#ff7ae6']));
      this.vfx.add(new RingPulse(this.match.centerX, this.match.centerY, 4, '#b46bff', 1.2));
    }
    this.crystalWhole = !finale;
    const img = finale ? this.crystalBroken : this.crystalImg;
    if (!base || !img) return;
    // One art pixel per sprite pixel, so the crystal sits in the same pixel grid as the Pokémon.
    const k = v.spriteScale;
    const snap = (n: number): number => Math.round(n / k) * k;
    const cx = snap(v.toScreenX(this.match.centerX));
    const cy = snap(v.toScreenY(this.match.centerY));
    const t = this.match.time;
    const pulse = 0.5 + 0.5 * Math.sin(t * 2.2);
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    // The pedestal: its top face (art row 8) on the crystal's ground point.
    drawSoftShadow(v, cx, cy + 9 * k, 2.2, 0.35);
    ctx.drawImage(base, cx - (base.width / 2) * k, cy - 8 * k, base.width * k, base.height * k);
    // The cluster hovers a little over the pedestal and bobs; the stump rests on it.
    const lift = finale ? 0 : 3 + Math.round(1.5 + 1.5 * Math.sin(t * 1.4));
    const x = cx - (img.width / 2) * k;
    const y = cy - (img.height - 1 + lift) * k;
    // A soft violet glow behind it (added light, so it brightens rather than smudges).
    const gy = y + img.height * 0.45 * k;
    const gr = img.height * 0.75 * k;
    const glow = ctx.createRadialGradient(cx, gy, 0, cx, gy, gr);
    const a0 = finale ? 0.12 : 0.28 + 0.12 * pulse;
    glow.addColorStop(0, `rgba(170,100,255,${a0})`);
    glow.addColorStop(1, 'rgba(170,100,255,0)');
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = glow;
    ctx.fillRect(cx - gr, gy - gr, gr * 2, gr * 2);
    ctx.globalCompositeOperation = 'source-over';
    ctx.drawImage(img, x, y, img.width * k, img.height * k);
    ctx.globalCompositeOperation = 'lighter';
    if (!finale) {
      // The dark heart breathes: a magenta light deep inside it.
      const hy = y + 43 * k;
      const hr = 9 * k;
      const heart = ctx.createRadialGradient(cx, hy, 0, cx, hy, hr);
      heart.addColorStop(0, `rgba(255,90,220,${0.35 + 0.35 * pulse})`);
      heart.addColorStop(0.5, `rgba(200,60,255,${0.12 + 0.12 * pulse})`);
      heart.addColorStop(1, 'rgba(160,60,255,0)');
      ctx.fillStyle = heart;
      ctx.fillRect(cx - hr, hy - hr, hr * 2, hr * 2);
      // Motes circling the cluster: whole art pixels on a tilted ring.
      for (let i = 0; i < 5; i++) {
        const ang = t * 0.9 + (i / 5) * Math.PI * 2;
        const mx = snap(cx + Math.cos(ang) * 22 * k);
        const my = snap(y + (36 + Math.sin(ang) * 6 + Math.sin(t * 2 + i) * 2) * k);
        const front = Math.sin(ang) > 0;
        ctx.fillStyle = front ? 'rgba(236,200,255,0.95)' : 'rgba(170,110,255,0.55)';
        ctx.fillRect(mx, my, k * (front ? 2 : 1), k * (front ? 2 : 1));
      }
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
      watching: !!this.spectator,
      mouseX: this.ctx.input.mouseX,
      mouseY: this.ctx.input.mouseY,
      darkRadius: this.match.darkness.radius,
      darkPhaseLabel: phaseLabel(this.match.darkness),
      nextPulseIn: this.match.darkness.nextPulseIn,
      notices: this.notices.map((n) => n.text),
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
      learn: ((o) => (o ? { mon: o.mon.name, level: o.mon.level, moveId: o.moveId, moves: [...o.mon.moves], queued: this.match.pendingLearn.length - 1 } : null))(this.match.learnOffer),
      storm: this.match.player.party.map((m) => (m.stowed || m.fainted ? 0 : this.stormLevel(m))),
      snag: this.match.snagOffer ? {
        from: this.match.snagOffer.from.name,
        names: this.match.snagOffer.from.party.filter((m) => !m.captured).map((m) => `${m.shiny ? '★ ' : ''}${m.name}  Lv ${m.level}${m.fainted ? ' (fainted)' : ''}`),
      } : null,
      extract: this.extractPick ? { names: this.match.player.party.map((m) => `${m.shiny ? '★ ' : ''}${m.name}  Lv ${m.level}${m.fainted ? ' (fainted)' : ''}`) } : null,
      aiming: 0,
      money: this.match.player.money,
      prompt: this.servicePrompt(),
      shop: this.shopOpen ? {
        name: this.shopOpen.name,
        entries: this.shopOpen.stock.map((e) => ({ name: ITEMS[e.id]?.name ?? e.id, price: e.price, affordable: this.match.player.money >= e.price })),
        sellPrice: (id: string) => this.match.sellPrice(id),
      } : null,
      chest: this.chestOpen !== null ? { slots: this.match.storageOf(this.match.player), town: this.match.chests[this.chestOpen]?.town ?? '' } : null,
      lightingMode: this.lighting.mode,
    };
  }

  private servicePrompt(): string | null {
    if (this.shopOpen || this.chestOpen !== null || this.match.snagOffer || this.teach || this.match.player.downUntil !== undefined) return null;
    const f = this.match.fishing;
    if (f) return f.stage === 'bite' ? 'Space · Reel it in!' : f.stage === 'reel' ? null : 'Waiting for a bite... (move or Space to reel in)';
    const who = this.match.visitors.near();
    if (who === 'ace') return 'Space · Battle Ace Trainer Celeste (win a rare Pokémon)';
    if (who === 'hoopa') return 'Space · Talk to Hoopa';
    const talker = this.nearTalker();
    if (talker) return talker.role === 'breeder' ? `Space · Trade with ${talker.name}` : `Space · Talk to ${talker.name}`;
    const s = this.match.nearService();
    if (!s) {
      if (this.match.nearestItem()) return 'Space · Pick up';
      if (canFish(this.match)) return `Space · Fish (${ITEMS[bestRod(this.match.player) ?? '']?.name ?? 'rod'})`;
      return null;
    }
    if (s.kind === 'shop') return `Space · Shop at the ${s.shop.name}`;
    if (s.kind === 'challenge') return `Space · Challenge the ${SHOPS.challenger.name}`;
    if (s.kind === 'chest') return 'Space · Open your storage chest';
    return 'Space · Heal your party';
  }

  protected drawExtraWorld(v: View): Array<{ y: number; draw: () => void }> {
    const list: Array<{ y: number; draw: () => void }> = [];
    for (const it of this.match.items) list.push({ y: it.y - 0.3, draw: () => this.drawGroundItem(v, it) });
    for (const o of this.match.outposts) list.push({ y: o.y - 0.9, draw: () => this.drawOutpostPost(v, o) });
    this.match.chests.forEach((c, i) => list.push({ y: c.y - 0.4, draw: () => this.drawChest(v, c, this.chestLid.get(i) ?? 0) }));
    for (const th of this.match.throws) list.push({ y: th.y + 0.02, draw: () => this.drawThrow(v, th) });
    list.push({ y: this.match.centerY, draw: () => this.drawCrystal(v) });
    const po = this.match.visitors.portal;
    if (po) list.push({ y: po.y - 0.1, draw: () => this.drawPortal(v, po) });
    const dp = this.match.darkraiPortal;
    if (dp) list.push({ y: dp.y - 0.05, draw: () => this.drawDarkraiPortal(v, performance.now() / 1000) });
    const fishing = this.match.fishing;
    if (fishing) list.push({ y: this.match.player.y + 0.02, draw: () => this.drawFishing(v) });
    return list;
  }

  /** A town storage chest, its lid opening with `lid` (0 shut .. 1 open). */
  private drawChest(v: View, c: { x: number; y: number }, lid: number): void {
    const img = this.chestSheet;
    if (!img) return;
    const fw = 30;
    const fh = img.height;
    const frame = Math.min(3, Math.round(lid * 3));
    const k = v.spriteScale;
    const x = Math.round(v.toScreenX(c.x) - (fw * k) / 2);
    const y = Math.round(v.toScreenY(c.y) - fh * k);
    drawSoftShadow(v, v.toScreenX(c.x), v.toScreenY(c.y) - 2 * k, 0.75, 0.22);
    const ctx = v.ctx;
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img, frame * fw, 0, fw, fh, x, y, fw * k, fh * k);
    ctx.restore();
  }

  /**
   * Hoopa's portal standing upright: it tears open sideways (0.5 s), swirls while the legendary
   * comes through, then pinches shut. In the storm it is the purple copy.
   */
  private drawPortal(v: View, po: { x: number; y: number; t: number; shadow?: boolean }): void {
    const img = po.shadow ? this.hoopaPortalDark : this.hoopaPortal;
    if (!img) return;
    const opening = Math.min(1, po.t / 0.5);
    const closing = Math.min(1, Math.max(0, (4 - po.t) / 0.5));
    const open = Math.min(opening, closing);
    if (open <= 0) return;
    const fw = 64;
    const frame = Math.floor(po.t * 12) % 8;
    const k = v.spriteScale * 1.5;
    // Wide open with a small overshoot as it tears open; full height from the start.
    const sx = open * (opening < 1 ? 1 + 0.15 * Math.sin(opening * Math.PI) : 1);
    const sy = 0.6 + 0.4 * open;
    const w = fw * k * sx;
    const h = fw * k * sy;
    const cx = v.toScreenX(po.x);
    // The ring's bottom (row 56 of 64) a little above the ground.
    const bottom = v.toScreenY(po.y) - 0.15 * v.pxPerTile;
    const ctx = v.ctx;
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.globalAlpha = Math.min(1, open * 1.5);
    ctx.shadowColor = po.shadow ? 'rgba(170,60,230,0.85)' : 'rgba(90,150,255,0.85)';
    ctx.shadowBlur = 22 * v.baseScale;
    ctx.drawImage(img, frame * fw, 0, fw, fw, Math.round(cx - w / 2), Math.round(bottom - (56 / 64) * h), w, h);
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
    const steered = this.match.controlled;
    if (focus) {
      fx = focus.x;
      fy = focus.y;
    } else if (steered && !fighting) {
      // Pokémon mode: the camera rides with the steered Pokémon.
      fx = steered.px + (steered.x - steered.px) * alpha;
      fy = steered.py + (steered.y - steered.py) * alpha;
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
    if (!this.spectator) this.drawReticleTop(v);
    this.drawDuelHud(v);
    this.drawDowned(v);
    this.drawOverlay(v);
    this.spectator?.draw(v);
    v.camX -= ox;
    v.camY -= oy;
  }

  /** Wiped out by wild Pokémon: a dark screen with the respawn countdown. */
  private drawDowned(v: View): void {
    const p = this.match.player;
    if (p.downUntil === undefined) return;
    const h = v.hud;
    const s = v.baseScale;
    const left = Math.max(0, Math.ceil(p.downUntil - this.match.time));
    h.fillStyle = 'rgba(8,4,18,0.62)';
    h.fillRect(0, 0, v.width, v.height);
    // A cream card: the ribbon with WIPED OUT, the countdown and what happened.
    const k = Math.max(2, Math.round(3 * s));
    const pw = Math.min(v.width - 40 * s, 560 * s);
    const ph = 150 * s;
    const px = v.width / 2 - pw / 2;
    const py = v.height / 2 - ph / 2;
    panel(v, px, py, pw, ph);
    const rw = 300 * s;
    this.ui.flat(h, 'banner', v.width / 2 - rw / 2, py - 11 * k + 4 * s, rw, 22 * k, k);
    text(v, 'WIPED OUT', v.width / 2, py + 4 * s + 2 * k + 14 * s, 30, { align: 'center', color: INK.bad, shadow: false });
    text(v, `Respawning in ${left}s`, v.width / 2, py + 76 * s, 22, { align: 'center', color: INK.text, shadow: false });
    wrapText(v, 'Wild Pokémon took your whole party. You come back at an outpost with them healed; your items stayed where you fell.', v.width / 2, py + 104 * s, 12, pw - 40 * s, 18 * s, 2, { align: 'center', color: INK.dim, shadow: false });
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
    const k = Math.max(2, Math.round(s * 3));
    if (!this.ui.flat(h, 'cream', x, y, w, 50 * s + 2 * k, k)) panel(v, x, y, w, 50 * s);
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
    text(v, 'You', x + w * 0.22, y + 19 * s, 14, { align: 'center', color: '#1f5aa0', maxWidth: w * 0.36, shadow: false });
    balls(me.trainer, x + w * 0.22);
    text(v, 'VS', v.width / 2, y + 28 * s, 18, { align: 'center', color: '#c2611a', shadow: false });
    text(v, foe.trainer.name, x + w * 0.78, y + 19 * s, 14, { align: 'center', color: '#b0302a', maxWidth: w * 0.36, shadow: false });
    // Online, a player's title rides along under their name.
    const foeTitle = (foe.trainer as Trainer & { title?: string }).title;
    if (foeTitle) text(v, foeTitle, x + w * 0.78, y + 31 * s, 9, { align: 'center', color: '#8a6a4a', maxWidth: w * 0.36, shadow: false });
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
    text(v, 'Choose your next Pokémon', v.width / 2, py + 30 * s, 16, { align: 'center', color: INK.text, shadow: false });
    const k2 = Math.max(2, Math.round(2 * s));
    party.forEach((m, i) => {
      const ok = !m.fainted && !m.captured;
      const ry = py + 44 * s + i * rowH;
      text(v, `${i + 1}`, px + 22 * s, ry + 20 * s, 14, { color: ok ? INK.accent : '#b8a890', shadow: false });
      const bw = 96 * s;
      text(v, `${m.name}  Lv ${m.level}`, px + 46 * s, ry + 20 * s, 14, { color: ok ? INK.text : '#b8a890', shadow: false, maxWidth: pw - bw - 80 * s });
      const bx = px + pw - bw - 22 * s;
      const f = m.hp / m.maxHp;
      this.ui.flatBar(h, bx, ry + 6 * s, bw, k2, ok ? f : 0, f > 0.5 ? 'green' : f > 0.2 ? 'gold' : 'red');
    });
  }

  /** HP bar, name and level over every wild or enemy Pokémon within 6 tiles of the player or hit in the last 4 s. */
  /** 0..1 how close a Pokémon in the darkness is to falling asleep (1 once it has). */
  private stormLevel(m: Mon): number {
    if (!m.inDark) return 0;
    if (m.status === 'sleep' && m.statusTimer > 1e8) return 1;
    return Math.min(1, m.drowsy / this.match.drowsySeconds(m));
  }

  /**
   * The storm meter over a Pokémon in the darkness: the flat skin's gold-rimmed bar with a purple fill
   * toward sleep, pulsing once it is asleep (with a "Zzz" beside it).
   */
  private drawStormMeter(v: View, cx: number, y: number, w: number, px: number, frac: number, asleep: boolean): void {
    const h = v.hud;
    const k = Math.max(2, Math.round(v.baseScale * 2));
    const x = Math.round(cx - w / 2);
    const pulse = asleep ? 0.65 + 0.35 * Math.sin(performance.now() / 160) : 1;
    const fill = `rgba(${asleep ? '190,120,255' : '155,92,255'},${pulse})`;
    if (!this.ui.flatBar(h, x, y - 4 * k, w, k, frac, fill, '#1a0f2e')) {
      h.fillStyle = 'rgba(14,6,26,0.85)';
      h.fillRect(x - px, y - px, w + 2 * px, 3 * px);
      h.fillStyle = fill;
      h.fillRect(x, y, Math.round(w * frac), px);
    }
    if (asleep) {
      h.save();
      h.font = uiFont(9 * v.baseScale);
      h.textAlign = 'left';
      h.textBaseline = 'middle';
      h.lineWidth = 3;
      h.strokeStyle = 'rgba(26,15,46,0.9)';
      h.strokeText('Zzz', x + w + 4 * v.baseScale, y + k);
      h.fillStyle = '#e2ccff';
      h.fillText('Zzz', x + w + 4 * v.baseScale, y + k);
      h.restore();
    }
  }

  private drawInfoBars(v: View, alpha: number): void {
    const p = this.match.player;
    // A menu is open over the field (shop, chest, snag offer, a TM): no bars over it.
    if (this.shopOpen || this.chestOpen !== null || this.match.snagOffer || this.teach || this.extractPick) return;
    const px = Math.max(2, Math.round(v.baseScale * 3));
    // Your own storm meter over your head while you stand in the storm (you last twice as long as your Pokémon).
    if (p.alive && p.downUntil === undefined && (p.stormT ?? 0) > 0) {
      const frac = Math.min(1, (p.stormT ?? 0) / this.match.trainerStormSeconds(p));
      const x = p.px + (p.x - p.px) * alpha;
      const y = p.py + (p.y - p.py) * alpha;
      const sx = Math.round(v.toScreenX(x));
      const top = Math.round(v.toScreenY(y) - 2.15 * v.pxPerTile);
      const w = 20 * px;
      if (!this.hud.covers(sx - w / 2, top - 8 * px, w, 10 * px)) this.drawStormMeter(v, sx, top, w, px, frac, false);
    }
    for (const m of this.match.mons()) {
      if (m.captured || m.visual.alpha < 0.5) continue;
      if (m.owner === p) {
        // Your own Pokémon on the field: a slim bar (no label) once they have taken damage, and in
        // the darkness a purple storm meter filling toward sleep.
        if (m.stowed || m.fainted) continue;
        const storm = this.stormLevel(m);
        if (m.hp >= m.maxHp && storm <= 0) continue;
        const x = m.px + (m.x - m.px) * alpha;
        const y = m.py + (m.y - m.py) * alpha;
        const sx = Math.round(v.toScreenX(x));
        const top = Math.round(v.toScreenY(y)) - Math.max(0.5 * v.pxPerTile, (m.species.body[1] * drawScale(m.species) * v.spriteScale) * 0.95);
        const w = 16 * px;
        if (this.hud.covers(sx - w / 2, top - 16 * px, w, 16 * px)) continue;
        if (m.hp < m.maxHp) this.ui.bar(v.hud, Math.round(sx - w / 2), Math.round(top - 9 * px), w, px, m.hp / m.maxHp);
        if (storm > 0) this.drawStormMeter(v, sx, Math.round(top - (m.hp < m.maxHp ? 13 : 9) * px), w, px, storm, m.status === 'sleep');
        continue;
      }
      const near = Math.hypot(m.x - p.x, m.y - p.y) <= 6 * R();
      if (!near && m.sinceHit > 4) continue;
      const x = m.px + (m.x - m.px) * alpha;
      const y = m.py + (m.y - m.py) * alpha;
      const sx = Math.round(v.toScreenX(x));
      const f = m.anim.current();
      // Bar just over the drawn body (sprites are drawn at their canonical size).
      const top = Math.round(v.toScreenY(y)) - Math.max(0.5 * v.pxPerTile, (m.species.body[1] * monScale(m) * v.spriteScale) * 0.95);
      if (sx < -50 || sx > v.width + 50 || top < -40 || top > v.height + 40) continue;
      // Not over the HUD's panels (the banner, minimap, party, bag and moves).
      if (this.hud.covers(sx - 70 * v.baseScale, top - 34 * v.baseScale, 140 * v.baseScale, 34 * v.baseScale)) continue;
      if (m.npc === 'hoopa') {
        drawInfoBar(this.ui, v.hud, px, sx, top, 'Hoopa (Space to talk)', m.level, 1, v.baseScale, '#ffcf8a');
        continue;
      }
      // Land bosses and the stronger wilds go by their plain names (their level tells the story).
      const base = m.boss ? `${m.name} ★` : m.shadow ? m.name : m.legend ? `Legendary ${m.name}` : m.alpha ? `Alpha ${m.name}` : m.name;
      const label = m.shiny ? `Shiny ${base}` : base;
      drawInfoBar(this.ui, v.hud, px, sx, top, label, m.level, m.hp / m.maxHp, v.baseScale, m.shadow ? '#c48bff' : m.legend ? '#ffcf4a' : m.alpha ? '#ff6b6b' : m.shiny ? '#9ff3ff' : '#fff', m.alpha ? this.alphaBadge : null);
    }
    // Names over the roaming visitors when close.
    for (const n of this.match.npcs) {
      if (n.role !== 'merchant' && n.role !== 'ace') continue;
      const dist = Math.hypot(n.x - p.x, n.y - p.y);
      if (dist > 16) continue;
      const sx = Math.round(v.toScreenX(n.x));
      const top = Math.round(v.toScreenY(n.y)) - 2.4 * v.pxPerTile;
      const h = v.hud;
      // A bubble over their head that bobs: a coin for the merchant, "!" for Celeste when she is ready.
      const vis = this.match.visitors;
      const ready = n.role === 'merchant' || (vis.aceState === 'idle' && this.match.time >= vis.aceReadyAt);
      const bob = Math.sin(this.match.time * 4) * 3 * v.baseScale;
      const r = 11 * v.baseScale;
      const by = top - 22 * v.baseScale + bob;
      h.save();
      h.fillStyle = 'rgba(14,10,28,0.85)';
      h.strokeStyle = n.role === 'merchant' ? '#ffe27a' : '#ff9ad5';
      h.lineWidth = Math.max(2, 2 * v.baseScale);
      h.beginPath();
      h.arc(sx, by, r, 0, Math.PI * 2);
      h.fill();
      h.stroke();
      h.beginPath();
      h.moveTo(sx - 4 * v.baseScale, by + r - 1);
      h.lineTo(sx, by + r + 6 * v.baseScale);
      h.lineTo(sx + 4 * v.baseScale, by + r - 1);
      h.fill();
      h.font = uiFont(13 * v.baseScale);
      h.textAlign = 'center';
      h.textBaseline = 'middle';
      h.fillStyle = n.role === 'merchant' ? '#ffe27a' : ready ? '#ff9ad5' : '#9f97bb';
      h.fillText(n.role === 'merchant' ? '₽' : ready ? '!' : `${Math.ceil(vis.aceReadyAt - this.match.time)}`, sx, by + 1);
      h.restore();
      if (dist > 9) continue;
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

/**
 * A pixel-art reticle drawn on whole art pixels of size `u`: four corner brackets that breathe
 * in and out, a centre dot, and a dark outline so it reads on grass, sand and water alike.
 */
function drawReticle(ctx: CanvasRenderingContext2D, x: number, y: number, u: number, rgb: string, t: number): void {
  const gap = 4 + Math.round((Math.sin(t * 5) + 1) * 0.75);
  const arm = 3;
  const px = (cx: number, cy: number, w: number, h: number) => ctx.fillRect(x + cx * u, y + cy * u, w * u, h * u);
  const draw = (pad: number) => {
    for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
      const cx = sx > 0 ? gap - arm + 1 : -gap;
      const cy = sy > 0 ? gap : -gap;
      // horizontal arm
      px(cx - pad, cy - pad, arm + pad * 2, 1 + pad * 2);
      // vertical arm
      const vx = sx > 0 ? gap : -gap;
      const vy = sy > 0 ? gap - arm + 1 : -gap;
      px(vx - pad, vy - pad, 1 + pad * 2, arm + pad * 2);
    }
    px(-pad, -pad, 1 + pad * 2, 1 + pad * 2);
  };
  ctx.save();
  ctx.translate(-u / 2, -u / 2);
  ctx.fillStyle = 'rgba(10,12,24,0.75)';
  draw(1);
  ctx.fillStyle = `rgb(${rgb})`;
  draw(0);
  ctx.restore();
}

/** The storm's copy of Hoopa's portal: the blues turned to a dark purple. */
function darkPortal(img: HTMLImageElement): CanvasImageSource {
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  const g = c.getContext('2d');
  if (!g) return img;
  g.drawImage(img, 0, 0);
  const d = g.getImageData(0, 0, c.width, c.height);
  const px = d.data;
  for (let i = 0; i < px.length; i += 4) {
    const b = px[i + 2] as number;
    const gr = px[i + 1] as number;
    px[i] = Math.round(b * 0.62 + gr * 0.2);
    px[i + 1] = Math.round(gr * 0.15);
    px[i + 2] = Math.round(b * 0.7);
  }
  g.putImageData(d, 0, 0);
  return c;
}
