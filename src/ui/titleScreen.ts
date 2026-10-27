/**
 * Title: a live corner of the island behind the logo. Small wild Pokémon wander
 * in; Darkrai drifts through the trees putting them to sleep with Dark Void and,
 * once a few are dreaming, blasts them with a ball of darkness. Now and then
 * Cresselia flies in under a crescent of moonlight, wakes the sleepers, and the
 * two fight until one of them is driven off. Everyone is drawn at the island's
 * own scale (the camera is zoomed in) and depth-sorted with the trees.
 */
import { music } from '../audio/music';
import { loadPc } from '../pc';
import type { Input } from '../core/input';
import { dirFromVector, type Dir8 } from '../core/math';
import type { DecorItem, GroundRenderer } from '../ground/types';
import { Lighting } from '../render/lighting';
import { drawDecorItem, drawSoftShadow } from '../render/world';
import { bodyRadius, drawScale, species, type SpeciesDef } from '../sim/data';
import type { Assets } from '../sprites/assets';
import { AnimPlayer, type SpriteRegistry } from '../sprites/pokemonSprite';
import { FxLibrary } from '../vfx/fxLibrary';
import { FxAnim, FxBeam, FxProjectile } from '../vfx/fxVisuals';
import { VfxLayer } from '../vfx/visuals';
import { button, hit, INK, strip, text, type GameContext, type Screen } from './screens';

const DARKRAI = '0491';
const CRESSELIA = '0488';
/** Small Pokémon that wander in (all in the title's preload). */
const SMALL = ['0025', '0387', '0133', '0393', '0390', '0447', '0092'];
/** The camera zoom: the island's own art at twice the match scale at 720p, a whole step more on big screens. */
const ZOOM = 1.35;
function titleZoom(baseScale: number): number {
  return Math.max(ZOOM, ZOOM * baseScale);
}
/** Where the scene plays, as fractions of the screen: between the logo and the buttons along the bottom. */
const BAND = { y0: 0.55, y1: 0.74 };
/** Darkrai is drawn larger than life here, the star of the title. */
const DARKRAI_SCALE = 1.5;
const SIDES = { left: [0.04, 0.4], right: [0.6, 0.96] } as const;
type Side = keyof typeof SIDES;
const FX = {
voidRing: 'fx_114', voidHit: 'fx_215', sleep: 'fx_015', swirl: 'fx_241', blast: 'fx_188', burst: 'fx_186',
  pulseBall: 'fx_187', pulseHit: 'fx_177', moon: 'fx_205', moonHit: 'fx_188', psychic: 'fx_214', aurora: 'fx_108', auroraHit: 'fx_204',
  gleam: 'fx_203', gleamRing: 'fx_028', sparkle: 'fx_041',
};

type WildState = 'enter' | 'wander' | 'asleep' | 'hurt' | 'flee' | 'gone';
type DarkraiState = 'hidden' | 'rise' | 'stalk' | 'void' | 'charge' | 'fire' | 'duel' | 'sink';
type CresseliaState = 'away' | 'arrive' | 'duel' | 'finale' | 'leave';

interface Actor {
  sp: SpeciesDef;
  anim: AnimPlayer;
  x: number;
  y: number;
  dir: Dir8;
  alpha: number;
  /** Height above the ground in tiles (Darkrai and Cresselia float). */
  hover: number;
  /** Drawn this many times its usual size (Darkrai on the title). */
  scale?: number;
  tx: number;
  ty: number;
  timer: number;
  vx: number;
  vy: number;
}

interface Wild extends Actor {
  state: WildState;
  sleptFor: number;
}

export class TitleScreen implements Screen {
  private t = 0;
  private readonly lighting: Lighting;
  /** How many Pokémon the PC holds (read once when the title opens). */
  private readonly pcCount = loadPc().length;
  private readonly fx: FxLibrary;
  private readonly vfx = new VfxLayer();
  private readonly groundVfx = new VfxLayer();
  private readonly wilds: Wild[] = [];
  private readonly darkrai: Actor;
  private dState: DarkraiState = 'hidden';
  private dTimer = 1.2;
  private voidCd = 2;
  private blastCd = 8;
  private blastTarget: { x: number; y: number } | null = null;
  private readonly cresselia: Actor;
  private cState: CresseliaState = 'away';
  /** Seconds until Cresselia next comes; during the fight, until the next beat. */
  private cTimer = 22;
  private exchange = 0;
  /** Darkrai's answer to the current beat, due this many seconds from now. */
  private answerIn = -1;
  private spawnT = 0.5;
  private shake = 0;
  private flash = 0;
  private flashColor = '40,0,70';
  private readonly cx: number;
  private readonly cy: number;
  private logo: HTMLImageElement | null = null;
  private readonly fogTile: HTMLCanvasElement;
  private readonly wisps: Array<{ fx: number; fy: number; phase: number; speed: number; teal: boolean }> = [];
  /** Tiles a Pokémon can stand on in view: reachable and clear of trees, rocks and buildings. */
  private readonly openSet = new Set<number>();

  constructor(
    private readonly ctx: GameContext,
    private readonly ground: GroundRenderer,
    private readonly sprites: SpriteRegistry,
    assets: Assets,
    private readonly onStart: () => void,
    private readonly onDemo: () => void,
    private readonly onGallery: () => void,
    private readonly onPc: () => void = () => {},
    private readonly onCharacter: () => void = () => {},
  ) {
    this.lighting = new Lighting(ctx.view);
    this.fx = new FxLibrary(assets);
    this.fx.preload(Object.values(FX));
    const v = ctx.view;
    v.zoom = v.targetZoom = titleZoom(v.baseScale);
    // Open grass on the crystal's plain, south-west of the terrace, with trees round it.
    this.cx = ground.cols / 2 - 20;
    this.cy = ground.rows / 2 + 11;
    v.snapTo(this.cx, this.cy);
    this.buildOpen();
    this.darkrai = this.actor(DARKRAI, this.cx, this.cy);
    this.darkrai.hover = 0.1;
    this.darkrai.scale = DARKRAI_SCALE;
    this.cresselia = this.actor(CRESSELIA, this.cx, this.cy);
    this.cresselia.hover = 0.1;
    void assets.loadImage('ui/logo.png').then((im) => {
      this.logo = im;
    });
    this.fogTile = TitleScreen.makeFog();
    for (let i = 0; i < 13; i++) {
      this.wisps.push({ fx: Math.random(), fy: 0.4 + Math.random() * 0.45, phase: Math.random() * 10, speed: 0.006 + Math.random() * 0.012, teal: i % 3 === 0 });
    }
  }

  /** A soft fog tile, drawn twice with drift for the ground mist. */
  private static makeFog(): HTMLCanvasElement {
    const c = document.createElement('canvas');
    c.width = c.height = 320;
    const ctx = c.getContext('2d')!;
    for (let i = 0; i < 30; i++) {
      const x = Math.random() * 320;
      const y = Math.random() * 320;
      const r = 30 + Math.random() * 60;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, 'rgba(188,178,220,0.16)');
      g.addColorStop(1, 'rgba(188,178,220,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
      // wrap-around copies keep the tile seamless
      for (const [dx, dy] of [[-320, 0], [320, 0], [0, -320], [0, 320]] as const) {
        ctx.save();
        ctx.translate(dx, dy);
        ctx.fillStyle = g;
        ctx.fillRect(x - r, y - r, r * 2, r * 2);
        ctx.restore();
      }
    }
    return c;
  }

  /** Ground mist: two layers drifting opposite ways across the lower half of the screen. */
  private fogBuf: HTMLCanvasElement | null = null;

  private drawFog(front: boolean, ctx2?: CanvasRenderingContext2D): void {
    const v = this.ctx.view;
    const ctx = ctx2 ?? v.ctx;
    const tile = this.fogTile;
    if (!this.fogBuf) this.fogBuf = document.createElement('canvas');
    const buf = this.fogBuf;
    if (buf.width !== v.width || buf.height !== v.height) {
      buf.width = v.width;
      buf.height = v.height;
    }
    const b = buf.getContext('2d')!;
    b.clearRect(0, 0, buf.width, buf.height);
    const y0 = v.height * (front ? 0.45 : 0.4);
    const k = front ? 1.4 : 2.2;
    const w = tile.width * k;
    const off = ((this.t * (front ? 14 : -9)) % w + w) % w;
    for (let x = -off; x < v.width; x += w) {
      for (let y = y0 - tile.height * k * 0.4; y < v.height; y += tile.height * k) {
        b.drawImage(tile, x, y + Math.sin(this.t * 0.4 + x * 0.01) * 6, w, tile.height * k);
      }
    }
    // the mist fades in from nothing well above the ground line
    b.globalCompositeOperation = 'destination-in';
    const fade = b.createLinearGradient(0, y0 - 60, 0, v.height * 0.9);
    fade.addColorStop(0, 'rgba(0,0,0,0)');
    fade.addColorStop(1, 'rgba(0,0,0,1)');
    b.fillStyle = fade;
    b.fillRect(0, 0, buf.width, buf.height);
    b.globalCompositeOperation = 'source-over';
    ctx.save();
    ctx.globalAlpha = front ? 0.85 : 0.45;
    ctx.drawImage(buf, 0, 0);
    ctx.restore();
  }

  /** Drifting wisps of lost light; they carry small halos through the dark. */
  private drawWisps(ctx2?: CanvasRenderingContext2D): void {
    const v = this.ctx.view;
    const ctx = ctx2 ?? v.ctx;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const wp of this.wisps) {
      const t = this.t * wp.speed * 60;
      const x = ((wp.fx + t * 0.004) % 1) * v.width;
      const y = (wp.fy + 0.05 * Math.sin(this.t * 0.7 + wp.phase)) * v.height;
      const r = (2.2 + 1.3 * Math.sin(this.t * 2 + wp.phase * 3)) * v.baseScale;
      const a = 0.35 + 0.3 * Math.sin(this.t * 1.3 + wp.phase);
      const col = wp.teal ? '140,220,255' : '186,140,255';
      const g = ctx.createRadialGradient(x, y, 0, x, y, r * 4);
      g.addColorStop(0, `rgba(${col},${0.8 * a})`);
      g.addColorStop(0.3, `rgba(${col},${0.35 * a})`);
      g.addColorStop(1, `rgba(${col},0)`);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, r * 4, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  // ---------------------------------------------------------------- the stage

  private buildOpen(): void {
    const v = this.ctx.view;
    const half = { w: v.width / 2 / v.pxPerTile + 2, h: v.height / 2 / v.pxPerTile + 2 };
    const blockers = this.ground.decor.filter((d) => d.kind === 'tree' || d.kind === 'rock' || d.kind === 'building' || d.blockRadius > 0);
    for (let ty = Math.floor(this.cy - half.h); ty <= this.cy + half.h; ty++) {
      for (let tx = Math.floor(this.cx - half.w); tx <= this.cx + half.w; tx++) {
        if (!this.ground.reachable(tx, ty)) continue;
        const x = tx + 0.5;
        const y = ty + 0.5;
        // Clear of every trunk, and of the canopy that hangs above a trunk.
        if (blockers.some((d) => Math.abs(d.x - x) < Math.max(1.1, d.blockRadius + 0.6) && y - d.y < 1.2 && d.y - y < Math.max(1.6, (d.extent ?? 1) * 0.8))) continue;
        this.openSet.add(ty * this.ground.cols + tx);
      }
    }
  }

  private isOpen(x: number, y: number): boolean {
    return this.openSet.has(Math.floor(y) * this.ground.cols + Math.floor(x));
  }

  /** A screen fraction turned into world tiles round the camera. */
  private at(fx: number, fy: number): { x: number; y: number } {
    const v = this.ctx.view;
    return { x: this.cx + ((fx - 0.5) * v.width) / v.pxPerTile, y: this.cy + ((fy - 0.5) * v.height) / v.pxPerTile };
  }

  /** A random open spot on one side of the buttons (either side when not given). */
  private openSpot(side?: Side): { x: number; y: number } | null {
    for (let i = 0; i < 60; i++) {
      const [fx0, fx1] = SIDES[side ?? (Math.random() < 0.5 ? 'left' : 'right')];
      const p = this.at(fx0 + Math.random() * (fx1 - fx0), BAND.y0 + Math.random() * (BAND.y1 - BAND.y0));
      if (this.isOpen(p.x, p.y)) return p;
    }
    return null;
  }

  /** The open spot nearest the middle of the scene (where Darkrai rises). */
  private centreSpot(): { x: number; y: number } | null {
    // Its feet just above Roll Starter, so the whole (tall) body stands clear of the logo.
    const v = this.ctx.view;
    const c = this.at(0.5, (this.buttonRect().y - 16 * v.baseScale) / v.height);
    for (let r = 0; r <= 6; r += 0.5) {
      for (let a = 0; a < Math.PI * 2; a += Math.PI / 8) {
        const x = c.x + Math.cos(a) * r;
        const y = c.y + Math.sin(a) * r * 0.5;
        if (this.isOpen(x, y)) return { x, y };
        if (r === 0) break;
      }
    }
    return this.openSpot();
  }

  /** The highest (smallest) world y Darkrai's feet may take: a little above Roll Starter. */
  private darkraiFloor(): number {
    const v = this.ctx.view;
    return this.at(0.5, (this.buttonRect().y - 40 * v.baseScale) / v.height).y;
  }

  /** Keeps a target x out of the middle of the screen (Darkrai squaring up to Cresselia keeps to its side). */
  private offCentre(x: number): number {
    const v = this.ctx.view;
    const f = 0.5 + ((x - this.cx) * v.pxPerTile) / v.width;
    if (f <= SIDES.left[1] || f >= SIDES.right[0]) return x;
    const edge = f < 0.5 ? SIDES.left[1] : SIDES.right[0];
    return this.cx + ((edge - 0.5) * v.width) / v.pxPerTile;
  }

  private sideOf(a: { x: number }): Side {
    return a.x < this.cx ? 'left' : 'right';
  }

  private other(side: Side): Side {
    return side === 'left' ? 'right' : 'left';
  }

  private actor(dex: string, x: number, y: number): Actor {
    const anim = new AnimPlayer(this.sprites.get(dex));
    return { sp: species(dex), anim, x, y, dir: 0, alpha: 0, hover: 0, tx: x, ty: y, timer: 0, vx: 0, vy: 0 };
  }

  private play(id: string, o: ConstructorParameters<typeof FxAnim>[1], ground = false): void {
    const sheet = this.fx.sheet(id);
    if (sheet) (ground ? this.groundVfx : this.vfx).add(new FxAnim(sheet, o));
  }

  private shoot(id: string, from: Actor, to: Actor, o: { scale: number; speed: number; tint?: string; onHit?: () => void }): void {
    const sheet = this.fx.sheet(id);
    if (!sheet) {
      o.onHit?.();
      return;
    }
    this.vfx.add(new FxProjectile(sheet, {
      from: { x: from.x, y: from.y }, to: { x: to.x, y: to.y }, lift: 0.8, scale: o.scale, speed: o.speed, tint: o.tint, facing: 'none', onHit: o.onHit,
    }));
  }

  /** Moves an actor toward its target at `speed` tiles/s; returns true on arrival. */
  private glide(a: Actor, speed: number, dt: number): boolean {
    const dx = a.tx - a.x;
    const dy = a.ty - a.y;
    const d = Math.hypot(dx, dy);
    if (d < 0.08) return true;
    const step = Math.min(d, speed * dt);
    a.x += (dx / d) * step;
    a.y += (dy / d) * step;
    a.dir = dirFromVector(dx, dy, a.dir);
    return false;
  }

  private face(a: Actor, b: { x: number; y: number }): void {
    a.dir = dirFromVector(b.x - a.x, b.y - a.y, a.dir);
  }

  // ---------------------------------------------------------------- input

  /**
   * The menu along the bottom: Roll Starter, big and orange, over a row of the other four, so the
   * middle of the screen is left to the scene.
   */
  private buttonRect(): { x: number; y: number; w: number; h: number } {
    const v = this.ctx.view;
    const s = v.baseScale;
    const w = Math.round(250 * s);
    const h = Math.round(56 * s);
    return { x: Math.round(v.width / 2 - w / 2), y: Math.round(v.height - 182 * s), w, h };
  }

  /** The row of three under it: Move Gallery, My PC, Trainer. (The demo team is off for now; ?demo=1 still starts it.) */
  private rowRect(i: number): { x: number; y: number; w: number; h: number } {
    const v = this.ctx.view;
    const s = v.baseScale;
    const w = Math.round(168 * s);
    const h = Math.round(52 * s);
    const gap = Math.round(12 * s);
    const total = 3 * w + 2 * gap;
    return { x: Math.round(v.width / 2 - total / 2 + i * (w + gap)), y: Math.round(v.height - 112 * s), w, h };
  }

  private galleryRect(): { x: number; y: number; w: number; h: number } {
    return this.rowRect(0);
  }

  private pcRect(): { x: number; y: number; w: number; h: number } {
    return this.rowRect(1);
  }

  private characterRect(): { x: number; y: number; w: number; h: number } {
    return this.rowRect(2);
  }

  step(dt: number, input: Input): void {
    this.t += dt;
    music.want('darkrai');
    if (input.pressed('KeyN')) music.toggleMute();
    this.stepScene(dt);
    const b = this.buttonRect();
    for (const c of input.takeClicks()) {
      if (hit(c.x, c.y, b.x, b.y, b.w, b.h)) this.leave(this.onStart);
      else {
        const g = this.galleryRect();
        const p = this.pcRect();
        if (hit(c.x, c.y, g.x, g.y, g.w, g.h)) this.leave(this.onGallery);
        else if (hit(c.x, c.y, p.x, p.y, p.w, p.h)) this.leave(this.onPc);
        else {
          const ch = this.characterRect();
          if (hit(c.x, c.y, ch.x, ch.y, ch.w, ch.h)) this.leave(this.onCharacter);
        }
      }
    }
    if (input.pressed('KeyM')) this.leave(this.onGallery);
    if (input.pressed('KeyP')) this.leave(this.onPc);
    if (input.pressed('KeyC')) this.leave(this.onCharacter);
    if (input.pressed('Enter') || input.pressed('Space')) this.leave(this.onStart);
  }

  /** The other screens set their own zoom; the title hands the camera back at 1. */
  private leave(fn: () => void): void {
    this.ctx.view.zoom = this.ctx.view.targetZoom = 1;
    music.want(null);
    fn();
  }

  // ---------------------------------------------------------------- the scene

  private stepScene(dt: number): void {
    this.stepWildSpawns(dt);
    for (const w of this.wilds) this.stepWild(w, dt);
    for (let i = this.wilds.length - 1; i >= 0; i--) if ((this.wilds[i] as Wild).state === 'gone') this.wilds.splice(i, 1);
    this.stepDarkrai(dt);
    this.stepCresselia(dt);
    for (const a of [this.darkrai, this.cresselia]) {
      if (a.anim.done) a.anim.play('Idle');
      a.anim.dir = a.dir;
      a.anim.update(dt);
    }
    this.vfx.update(dt);
    this.groundVfx.update(dt);
    this.shake = Math.max(0, this.shake - dt * 1.4);
    this.flash = Math.max(0, this.flash - dt * 1.3);
  }

  private awake(): Wild[] {
    return this.wilds.filter((w) => w.state === 'wander' || w.state === 'enter');
  }

  private sleepers(): Wild[] {
    return this.wilds.filter((w) => w.state === 'asleep');
  }

  /** New small Pokémon wander in from the sides every few seconds, up to six at once. */
  private stepWildSpawns(dt: number): void {
    this.spawnT -= dt;
    if (this.spawnT > 0) return;
    this.spawnT = 2 + Math.random() * 2.5;
    if (this.wilds.length >= 6 || this.cState === 'arrive' || this.cState === 'duel') return;
    const side: Side = Math.random() < 0.5 ? 'left' : 'right';
    const goal = this.openSpot(side);
    if (!goal) return;
    // They walk in from the edge of the screen on that side.
    const v = this.ctx.view;
    const edge = v.width / 2 / v.pxPerTile + 0.8;
    const start = { x: side === 'left' ? this.cx - edge : this.cx + edge, y: goal.y };
    const dex = SMALL[Math.floor(Math.random() * SMALL.length)] as string;
    const a = this.actor(dex, start.x, start.y) as Wild;
    a.state = 'enter';
    a.sleptFor = 0;
    a.tx = goal.x;
    a.ty = goal.y;
    this.wilds.push(a);
  }

  private stepWild(w: Wild, dt: number): void {
    w.timer -= dt;
    switch (w.state) {
      case 'enter':
      case 'wander':
      case 'flee': {
        w.alpha = w.state === 'flee' ? Math.max(0, w.alpha - dt * 0.4) : Math.min(1, w.alpha + dt * 1.5);
        const speed = w.state === 'flee' ? 3.2 : 1.6;
        const there = this.glide(w, speed, dt);
        w.anim.play(there ? 'Idle' : 'Walk');
        if ((there || w.alpha <= 0) && w.state === 'flee') w.state = 'gone';
        else if (there && w.timer <= 0) {
          w.state = 'wander';
          w.timer = 1 + Math.random() * 2.5;
          const p = this.openSpot(this.sideOf(w));
          if (p && Math.hypot(p.x - w.x, p.y - w.y) < 5) {
            w.tx = p.x;
            w.ty = p.y;
          }
        }
        break;
      }
      case 'asleep':
        w.sleptFor += dt;
        // Bad Dreams: left asleep long enough, a sleeper fades away into the dark.
        if (w.sleptFor > 13) w.alpha -= dt * 0.6;
        if (w.alpha <= 0) w.state = 'gone';
        break;
      case 'hurt':
        w.x += w.vx * dt;
        w.y += w.vy * dt;
        w.vx *= 1 - Math.min(1, dt * 4);
        w.vy *= 1 - Math.min(1, dt * 4);
        if (w.timer < 0) w.alpha -= dt * 0.9;
        if (w.alpha <= 0) w.state = 'gone';
        break;
      default:
        break;
    }
    w.anim.dir = w.dir;
    w.anim.update(dt);
  }

  private putToSleep(w: Wild): void {
    w.state = 'asleep';
    w.sleptFor = 0;
    w.anim.play('Sleep', { restart: true });
    this.play(FX.sleep, { x: w.x, y: w.y, lift: 0.3 + ((w.sp.body?.[1] ?? 24) * drawScale(w.sp)) / 16, scale: 1.1, fps: 10, loopSeconds: 12, follow: w, light: 0 });
  }

  /** Woken by the moonlight, a wild Pokémon runs out the nearest side. */
  private wake(w: Wild): void {
    w.state = 'flee';
    w.anim.play('Walk', { restart: true });
    const v = this.ctx.view;
    const half = v.width / 2 / v.pxPerTile;
    w.tx = w.x < this.cx ? this.cx - half - 1 : this.cx + half + 1;
    w.ty = w.y;
  }

  // ---------------------------------------------------------------- Darkrai

  private stepDarkrai(dt: number): void {
    const dk = this.darkrai;
    this.dTimer -= dt;
    this.voidCd -= dt;
    this.blastCd -= dt;
    switch (this.dState) {
      case 'hidden': {
        dk.alpha = 0;
        if (this.dTimer > 0 || this.cState === 'leave' || this.cState === 'finale') break;
        // Rise out of the shadows in the middle of the screen (between the logo and the buttons); with
        // Cresselia about, on the side away from her instead.
        const side: Side | undefined = this.cresselia.alpha > 0 ? this.other(this.sideOf(this.cresselia)) : undefined;
        let spot = side ? this.openSpot(side) : this.centreSpot();
        for (let i = 0; i < 8 && spot && side && this.wilds.some((w) => Math.hypot(spot!.x - w.x, spot!.y - w.y) < 2.2); i++) spot = this.openSpot(side);
        if (!spot) break;
        dk.x = dk.tx = spot.x;
        dk.y = dk.ty = spot.y;
        this.dState = 'rise';
        this.dTimer = 1.2;
        this.play(FX.voidHit, { x: dk.x, y: dk.y, lift: 0, scale: 1.2, fps: 10, light: 0.8 }, true);
        break;
      }
      case 'rise':
        dk.alpha = Math.min(1, 1 - this.dTimer / 1.2);
        if (this.dTimer <= 0) {
          this.dState = this.cState === 'duel' ? 'duel' : 'stalk';
          this.dTimer = 0;
        }
        break;
      case 'stalk': {
        dk.alpha = 1;
        const sleepers = this.sleepers();
        if (sleepers.length >= 3 && this.blastCd <= 0) {
          const mid = sleepers.reduce((a, m) => ({ x: a.x + m.x / sleepers.length, y: a.y + m.y / sleepers.length }), { x: 0, y: 0 });
          this.blastTarget = mid;
          this.face(dk, mid);
          dk.anim.play('Charge', { restart: true });
          this.play(FX.swirl, { x: dk.x + this.handX(), y: dk.y, lift: 1.6 + dk.hover, scale: 1.4, fps: 14, loopSeconds: 1.6, light: 0 });
          this.dState = 'charge';
          this.dTimer = 1.6;
          break;
        }
        // Drift toward the nearest one still awake; Dark Void when close enough.
        let target: Wild | null = null;
        let bd = Infinity;
        for (const w of this.awake()) {
          const d = Math.hypot(w.x - dk.x, w.y - dk.y);
          if (d < bd) {
            bd = d;
            target = w;
          }
        }
        if (target && bd < 3.2 && this.voidCd <= 0) {
          this.face(dk, target);
          dk.anim.play('Charge', { restart: true });
          this.dState = 'void';
          this.dTimer = 0.7;
          break;
        }
        if (target) {
          // Hang back two tiles on the inner side of the prey, toward the middle of the stage.
          dk.tx = target.x + (this.sideOf(target) === 'left' ? 2 : -2);
          dk.ty = target.y;
        } else if (this.dTimer <= 0) {
          const p = this.openSpot();
          if (p) {
            dk.tx = p.x;
            dk.ty = p.y;
          }
          this.dTimer = 3;
        }
        // Tall as it is here, it keeps its feet near the buttons' row so it never stands over the logo.
        dk.ty = Math.max(dk.ty, this.darkraiFloor());
        this.glide(dk, 1.3, dt);
        break;
      }
      case 'void':
        if (this.dTimer <= 0) {
          // A ring of darkness spreads out; everything awake nearby falls asleep.
          this.play(FX.voidRing, { x: dk.x, y: dk.y, lift: 0, scale: 3.4, fps: 14, light: 1.2 }, true);
          for (const w of this.awake()) {
            if (Math.hypot(w.x - dk.x, w.y - dk.y) > 4.2) continue;
            this.play(FX.voidHit, { x: w.x, y: w.y, lift: 0, scale: 1.4, fps: 10, light: 1 }, true);
            this.putToSleep(w);
          }
          this.voidCd = 4 + Math.random() * 2;
          this.dState = 'stalk';
          this.dTimer = 1.5;
        }
        break;
      case 'charge':
        if (this.dTimer <= 0) {
          dk.anim.play('Shoot', { restart: true });
          this.shake = 0.6;
          this.dState = 'fire';
          this.dTimer = 0.9;
          const mid = this.blastTarget;
          if (mid) {
            this.flash = 0.8;
            this.flashColor = '40,0,70';
            this.play(FX.blast, { x: mid.x, y: mid.y, lift: 0.5, scale: 2.4, fps: 14, light: 2, tint: '#9a5cff' });
            for (const w of this.sleepers()) {
              if (Math.hypot(w.x - mid.x, w.y - mid.y) > 3.5) continue;
              this.play(FX.burst, { x: w.x, y: w.y, lift: 0.4, scale: 1.4, fps: 14, light: 1 });
              w.state = 'hurt';
              w.timer = 0.6;
              w.anim.play('Faint', { restart: true });
              const dx = w.x - dk.x;
              const dy = w.y - dk.y;
              const n = Math.hypot(dx, dy) || 1;
              w.vx = (dx / n) * 3;
              w.vy = (dy / n) * 3;
            }
          }
        }
        break;
      case 'fire':
        if (this.dTimer <= 0) {
          this.blastCd = 12 + Math.random() * 6;
          this.dState = 'stalk';
          this.dTimer = 2;
        }
        break;
      case 'duel':
        dk.alpha = 1;
        // Square up on its own side of the screen, facing her across it.
        dk.tx = this.offCentre(dk.x);
        dk.ty = Math.max(dk.y, this.darkraiFloor());
        this.glide(dk, 2, dt);
        this.face(dk, this.cresselia);
        break;
      case 'sink':
        dk.alpha = Math.max(0, this.dTimer / 1.2);
        if (this.dTimer <= 0) {
          this.dState = 'hidden';
          this.dTimer = 3 + Math.random() * 3;
        }
        break;
    }
  }

  private sink(): void {
    const dk = this.darkrai;
    this.dState = 'sink';
    this.dTimer = 1.2;
    this.play(FX.voidHit, { x: dk.x, y: dk.y, lift: 0, scale: 1.3, fps: 10, light: 0.8 }, true);
  }

  /** Darkrai's hand is on the side it faces. */
  private handX(): number {
    const f = this.darkrai.dir;
    return f >= 1 && f <= 3 ? 0.7 : f >= 5 && f <= 7 ? -0.7 : 0;
  }

  // ---------------------------------------------------------------- Cresselia

  private stepCresselia(dt: number): void {
    const cr = this.cresselia;
    const dk = this.darkrai;
    this.cTimer -= dt;
    // Both float already in their sprites; a gentle bob on top.
    cr.hover = 0.08 + 0.06 * Math.sin(this.t * 2.4);
    this.darkrai.hover = 0.06 + 0.05 * Math.sin(this.t * 1.7 + 1);
    if (this.answerIn >= 0) {
      this.answerIn -= dt;
      if (this.answerIn < 0) this.darkraiAnswers();
    }
    switch (this.cState) {
      case 'away':
        cr.alpha = 0;
        if (this.cTimer <= 0) {
          // She glides in from the side away from Darkrai, to a clearing a few tiles from him.
          const fromLeft = dk.alpha > 0 ? dk.x > this.cx : Math.random() < 0.5;
          const start = this.at(fromLeft ? -0.05 : 1.05, 0.62);
          const goal = this.openSpot(fromLeft ? 'left' : 'right');
          if (!goal) {
            this.cTimer = 3;
            break;
          }
          cr.x = start.x;
          cr.y = start.y;
          cr.tx = goal.x;
          cr.ty = goal.y;
          cr.anim.play('Walk', { restart: true });
          this.cState = 'arrive';
        }
        break;
      case 'arrive':
        cr.alpha = Math.min(1, cr.alpha + dt * 1.2);
        if (this.glide(cr, 2.6, dt)) {
          // Moonlight: a crescent flash wakes every sleeper, and the wild ones run for it.
          cr.anim.play('Charge', { restart: true });
          this.play(FX.gleam, { x: cr.x, y: cr.y, lift: 0.8, scale: 1.6, fps: 12, light: 2, tint: '#ffd6f4' });
          this.play(FX.gleamRing, { x: cr.x, y: cr.y, lift: 0, scale: 3, fps: 18, light: 1.5, tint: '#ffc4f0' }, true);
          this.flash = 0.5;
          this.flashColor = '255,200,240';
          for (const w of this.wilds) {
            if (w.state === 'asleep') this.play(FX.sparkle, { x: w.x, y: w.y, lift: 0.4, scale: 1.2, fps: 16, light: 1, tint: '#ffd6f4' });
            if (w.state === 'asleep' || w.state === 'wander' || w.state === 'enter') this.wake(w);
          }
          this.cState = 'duel';
          this.exchange = 0;
          this.cTimer = 1.4;
          // Darkrai turns to face her (or rises to meet her).
          if (this.dState === 'hidden') this.dTimer = Math.min(this.dTimer, 0.4);
          else if (this.dState !== 'sink' && this.dState !== 'rise') this.dState = 'duel';
        }
        break;
      case 'duel':
        cr.alpha = 1;
        if (this.dState === 'stalk' || this.dState === 'void' || this.dState === 'charge' || this.dState === 'fire') this.dState = 'duel';
        if (this.dState !== 'duel') break;
        this.face(cr, dk);
        if (this.cTimer <= 0) {
          this.exchange++;
          this.cTimer = 1.8;
          this.fightBeat();
        }
        break;
      case 'finale':
        if (this.cTimer <= 0) {
          cr.anim.play('Walk', { restart: true });
          const off = this.at(cr.x < this.cx ? -0.1 : 1.1, 0.62);
          cr.tx = off.x;
          cr.ty = off.y;
          this.cState = 'leave';
        }
        break;
      case 'leave':
        cr.alpha = Math.max(0, cr.alpha - dt * 0.5);
        if (this.glide(cr, 2.4, dt) || cr.alpha <= 0) {
          this.cState = 'away';
          this.cTimer = 40 + Math.random() * 20;
          if (this.dState === 'duel') {
            this.dState = 'stalk';
            this.dTimer = 1;
          }
        }
        break;
    }
  }

  private hurt(a: Actor): void {
    a.anim.play('Hurt', { restart: true });
    this.shake = Math.max(this.shake, 0.35);
  }

  /** One beat of the fight: Cresselia attacks, Darkrai answers; the fifth beat decides it. */
  private fightBeat(): void {
    const cr = this.cresselia;
    const dk = this.darkrai;
    if (this.exchange >= 5) {
      // Usually her moonlight drives Darkrai back into the shadows; now and then its dark ball
      // is too much for her and she is the one who withdraws.
      const moonWins = Math.random() < 0.7;
      if (moonWins) {
        cr.anim.play('Charge', { restart: true });
        this.play(FX.gleam, { x: cr.x, y: cr.y, lift: 0.8, scale: 2.4, fps: 10, light: 3, tint: '#ffe0f8' });
        this.play(FX.gleamRing, { x: cr.x, y: cr.y, lift: 0, scale: 5, fps: 16, light: 2, tint: '#ffc4f0' }, true);
        this.play(FX.moonHit, { x: dk.x, y: dk.y, lift: 0.9, scale: 2, fps: 18, light: 2, tint: '#ffb8ec' });
        this.flash = 0.9;
        this.flashColor = '255,210,245';
        this.hurt(dk);
        this.sink();
      } else {
        dk.anim.play('Shoot', { restart: true });
        this.shoot(FX.pulseBall, dk, cr, { scale: 2.2, speed: 10, onHit: () => {
          this.play(FX.blast, { x: cr.x, y: cr.y, lift: 0.8, scale: 2.4, fps: 14, light: 2, tint: '#9a5cff' });
          this.flash = 0.7;
          this.flashColor = '40,0,70';
          this.hurt(cr);
        } });
        this.dState = 'stalk';
        this.dTimer = 2;
      }
      this.cState = 'finale';
      this.cTimer = moonWins ? 2.4 : 1.4;
      return;
    }
    const kind = this.exchange % 3;
    cr.anim.play(kind === 1 ? 'Charge' : 'Shoot', { restart: true });
    if (kind === 0) {
      // Moonblast: a pink moon flies across and bursts on Darkrai.
      this.shoot(FX.moon, cr, dk, { scale: 1.2, speed: 8, tint: '#ffc4f0', onHit: () => {
        this.play(FX.moonHit, { x: dk.x, y: dk.y, lift: 0.9, scale: 1.5, fps: 22, light: 1.5, tint: '#ffb8ec' });
        this.hurt(dk);
      } });
    } else if (kind === 1) {
      // Psychic: the air round Darkrai twists.
      this.play(FX.psychic, { x: dk.x, y: dk.y, lift: 0.9, scale: 1.8, fps: 18, light: 1.2 });
      this.hurt(dk);
    } else {
      // Aurora Beam.
      const sheet = this.fx.sheet(FX.aurora);
      if (sheet) this.vfx.add(new FxBeam(sheet, { from: { x: cr.x, y: cr.y }, to: { x: dk.x, y: dk.y }, mode: 'beam', lift: 0.9, scale: 1.2, seconds: 0.55, fps: 14, tint: '#ffb8f0' }));
      this.play(FX.auroraHit, { x: dk.x, y: dk.y, lift: 0.9, scale: 1.4, fps: 16, light: 1, tint: '#ffd0f4' });
      this.hurt(dk);
    }
    this.answerIn = 0.7;
  }

  /** Darkrai's answer: Dark Pulse at her, or a Dark Void she shakes off in a puff of moonlight. */
  private darkraiAnswers(): void {
    if (this.dState !== 'duel' || this.cState !== 'duel') return;
    const cr = this.cresselia;
    const dk = this.darkrai;
    if (this.exchange % 2 === 1) {
      dk.anim.play('Shoot', { restart: true });
      this.play(FX.voidRing, { x: dk.x, y: dk.y, lift: 0, scale: 2.4, fps: 18, light: 1 }, true);
      this.shoot(FX.pulseBall, dk, cr, { scale: 1.8, speed: 11, onHit: () => {
        this.play(FX.pulseHit, { x: cr.x, y: cr.y, lift: 0.9, scale: 1.6, fps: 20, light: 1.2 });
        this.hurt(cr);
      } });
    } else {
      dk.anim.play('Charge', { restart: true });
      this.play(FX.voidRing, { x: dk.x, y: dk.y, lift: 0, scale: 3.4, fps: 14, light: 1.2 }, true);
      this.play(FX.voidHit, { x: cr.x, y: cr.y, lift: 0, scale: 1.6, fps: 10, light: 1 }, true);
      this.play(FX.sparkle, { x: cr.x, y: cr.y, lift: 1, scale: 1.4, fps: 16, light: 1, tint: '#ffd6f4' });
    }
  }

  // ---------------------------------------------------------------- drawing

  private drawActor(a: Actor): void {
    const v = this.ctx.view;
    if (a.alpha <= 0.01) return;
    const ctx = v.ctx;
    const sx = Math.round(v.toScreenX(a.x));
    const sy = Math.round(v.toScreenY(a.y));
    const s = v.spriteScale * drawScale(a.sp) * (a.scale ?? 1);
    const [gx, gy] = a.anim.ground();
    // One soft shadow on the ground; floaters keep theirs on the grass below them.
    drawSoftShadow(v, sx + gx * s, sy + gy * s, Math.max(0.12, Math.min(2, bodyRadius(a.sp) * 0.7 * (a.scale ?? 1))), 0.26 * a.alpha);
    const f = a.anim.current();
    ctx.save();
    ctx.globalAlpha = a.alpha;
    ctx.imageSmoothingEnabled = false;
    const lift = Math.round(a.hover * v.pxPerTile);
    ctx.drawImage(f.image, f.sx, f.sy, f.w, f.h, Math.round(sx - (f.w * s) / 2), Math.round(sy - (f.h * s) / 2) - lift, Math.round(f.w * s), Math.round(f.h * s));
    ctx.restore();
  }

  /** The ball of darkness in Darkrai's hand while it charges the blast. */
  private drawOrb(): void {
    if (this.dState !== 'charge') return;
    const dk = this.darkrai;
    const v = this.ctx.view;
    const ctx = v.ctx;
    const k = Math.min(1, 1 - this.dTimer / 1.6);
    const x = v.toScreenX(dk.x + this.handX());
    const y = v.toScreenY(dk.y) - (1.6 + dk.hover) * v.pxPerTile;
    const r = (0.15 + 0.85 * k) * 0.45 * v.pxPerTile * (1 + 0.06 * Math.sin(this.t * 30));
    ctx.save();
    const g = ctx.createRadialGradient(x, y, r * 0.2, x, y, r * 1.8);
    g.addColorStop(0, 'rgba(10,0,20,1)');
    g.addColorStop(0.45, 'rgba(30,0,60,0.95)');
    g.addColorStop(0.6, 'rgba(150,60,255,0.7)');
    g.addColorStop(1, 'rgba(120,40,220,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r * 1.8, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  /** The blast: a black beam with a violet edge from Darkrai's hand to the sleepers. */
  private drawBlast(): void {
    const mid = this.blastTarget;
    if (this.dState !== 'fire' || !mid) return;
    const dk = this.darkrai;
    const v = this.ctx.view;
    const ctx = v.ctx;
    const x0 = v.toScreenX(dk.x + this.handX());
    const y0 = v.toScreenY(dk.y) - (1.6 + dk.hover) * v.pxPerTile;
    const x1 = v.toScreenX(mid.x);
    const y1 = v.toScreenY(mid.y) - 0.4 * v.pxPerTile;
    const k = 1 - this.dTimer / 0.9;
    const w = v.pxPerTile * 0.7 * Math.sin(Math.PI * Math.min(1, k * 1.3)) * (1 + 0.08 * Math.sin(this.t * 50));
    if (w <= 0) return;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(160,80,255,0.55)';
    ctx.lineWidth = w * 1.5;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(12,0,24,0.95)';
    ctx.lineWidth = w;
    ctx.stroke();
    ctx.strokeStyle = 'rgba(220,180,255,0.6)';
    ctx.lineWidth = Math.max(2, w * 0.08);
    ctx.stroke();
    ctx.restore();
  }

  render(): void {
    const v = this.ctx.view;
    const s = v.baseScale;
    v.zoom = v.targetZoom = titleZoom(v.baseScale);
    const sh = this.shake * this.shake * 0.12;
    v.snapTo(this.cx + (Math.random() - 0.5) * sh, this.cy + (Math.random() - 0.5) * sh);
    v.ctx.fillStyle = '#0b0a12';
    v.ctx.fillRect(0, 0, v.width, v.height);
    this.ground.drawGround(v);
    this.groundVfx.draw(v);
    // Trees, rocks and every Pokémon in one depth order, so Darkrai passes behind trunks and in front of them.
    const vis = v.visibleTiles();
    const list: Array<{ y: number; draw: () => void }> = [];
    for (const d of this.ground.decor as DecorItem[]) {
      const pad = Math.max(3, d.extent ?? 0);
      if (d.x < vis.x0 - pad || d.x > vis.x1 + pad || d.y < vis.y0 - pad || d.y > vis.y1 + pad) continue;
      list.push({ y: d.sortY ?? d.y, draw: () => drawDecorItem(v, d, this.ground.tileSize, this.t) });
    }
    for (const w of this.wilds) list.push({ y: w.y, draw: () => this.drawActor(w) });
    list.push({ y: this.darkrai.y, draw: () => this.drawActor(this.darkrai) });
    list.push({ y: this.cresselia.y, draw: () => this.drawActor(this.cresselia) });
    list.sort((a, b) => a.y - b.y);
    this.drawFog(false);
    for (const d of list) d.draw();
    this.drawBlast();
    this.vfx.draw(v);
    this.drawOrb();
    // Lights: dusk that deepens while Darkrai is out; Cresselia carries a circle of moonlight.
    v.beginLights();
    v.lightCtx.fillStyle = 'rgba(150,170,255,0.05)';
    v.lightCtx.fillRect(0, 0, v.width, v.height);
    this.vfx.drawLights(v);
    this.groundVfx.drawLights(v);
    const dk = this.darkrai;
    const cr = this.cresselia;
    const moon = cr.alpha > 0.05;
    this.lighting.render({
      cold: 0.85,
      darkCx: v.width / 2, darkCy: v.height * 0.62, darkRadius: v.width * 0.42, darkFeather: v.width * 0.35, darkAmount: 0.32 + 0.26 * dk.alpha,
      clearCx: moon ? v.toScreenX(cr.x) : 0, clearCy: moon ? v.toScreenY(cr.y) - cr.hover * v.pxPerTile : 0, clearRadius: moon ? v.pxPerTile * 3 * cr.alpha : 0,
      time: this.t,
    });
    // Overlay
    const h = v.hud;
    h.clearRect(0, 0, v.width, v.height);
    // Night falls on the hud layer: a purple-blue tint, a soft vignette, the ground mist and the wisps.
    h.fillStyle = 'rgba(14,8,34,0.30)';
    h.fillRect(0, 0, v.width, v.height);
    const vg = h.createRadialGradient(v.width / 2, v.height * 0.55, v.height * 0.35, v.width / 2, v.height * 0.55, v.height * 0.95);
    vg.addColorStop(0, 'rgba(6,2,16,0)');
    vg.addColorStop(1, 'rgba(6,2,16,0.55)');
    h.fillStyle = vg;
    h.fillRect(0, 0, v.width, v.height);
    this.drawFog(true, h);
    this.drawWisps(h);
    if (this.flash > 0) {
      h.fillStyle = `rgba(${this.flashColor},${0.45 * this.flash})`;
      h.fillRect(0, 0, v.width, v.height);
    }
    const grad = h.createLinearGradient(0, 0, 0, v.height * 0.55);
    grad.addColorStop(0, 'rgba(8,4,20,0.85)');
    grad.addColorStop(1, 'rgba(8,4,20,0)');
    h.fillStyle = grad;
    h.fillRect(0, 0, v.width, v.height * 0.55);
    let subY = v.height * 0.22 + 104 * s;
    if (this.logo) {
      const lw = this.logo.width;
      const lh = this.logo.height;
      const k = Math.min((v.width - 60 * s) / lw, (v.height * 0.3) / lh);
      const bob = Math.sin(this.t * 1.1) * 3 * s;
      const x = Math.round(v.width / 2 - (lw * k) / 2);
      const y = Math.round(v.height * 0.2 - (lh * k) / 2 + bob);
      h.save();
      // The logo is a high-resolution piece: scaled down smoothly, not by nearest neighbour.
      h.imageSmoothingEnabled = true;
      h.imageSmoothingQuality = 'high';
      // a breathing violet glow behind it
      h.shadowColor = `rgba(150,90,255,${0.45 + 0.25 * Math.sin(this.t * 1.7)})`;
      h.shadowBlur = 28 * s;
      h.drawImage(this.logo, x, y, lw * k, lh * k);
      h.restore();
      subY = y + lh * k + 26 * s;
    } else {
      text(v, 'SHADOWS OF ALMIA', v.width / 2, v.height * 0.22, 72, { align: 'center', weight: '900', color: '#e9ddff', maxWidth: v.width - 40 * s });
      text(v, 'SHOWDOWN', v.width / 2, v.height * 0.22 + 70 * s, 64, { align: 'center', weight: '900', color: '#b48cff' });
    }
    text(v, 'A Pokémon battle royale on the Ranger Union training grounds', v.width / 2, subY, 15, { align: 'center', weight: '500', color: '#cfc6ea', maxWidth: v.width - 40 * s });
    const mx = this.ctx.input.mouseX;
    const my = this.ctx.input.mouseY;
    const b = this.buttonRect();
    button(v, 'Roll Starter', b.x, b.y, b.w, b.h, hit(mx, my, b.x, b.y, b.w, b.h));
    const rows: Array<[string, { x: number; y: number; w: number; h: number }]> = [
      ['Move Gallery (M)', this.galleryRect()],
      [`My PC (P) · ${this.pcCount}`, this.pcRect()],
      ['Trainer (C)', this.characterRect()],
    ];
    for (const [label, r] of rows) button(v, label, r.x, r.y, r.w, r.h, hit(mx, my, r.x, r.y, r.w, r.h), '#f4e6c8');
    text(v, 'WASD move · click your Pokémon to steer it · click / right click or Q, E cast · Space talk, pick up, fish (dodge while steering a Pokémon) · Tab or click a wild for the ball, F throws · V ride · M mega · R auto · hold C styler · N music', v.width / 2, v.height - 22 * s, 11, { align: 'center', weight: '500', color: '#f4ecdc', maxWidth: v.width - 40 * s, shadowColor: 'rgba(20,10,30,0.85)' });
    // Build stamp, top right: which deploy this browser has loaded.
    const stamp = `Version ${__BUILD__}`;
    const sm = strip(v, stamp, 0, -9999, 11);
    strip(v, stamp, v.width - 14 * s - sm.w / 2, 14 * s, 11, INK.accent);
  }
}
