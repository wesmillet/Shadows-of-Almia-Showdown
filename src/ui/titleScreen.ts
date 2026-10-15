/**
 * Title: on the plain round the Shadow Crystal, Darkrai rises out of its shadow,
 * puts a group of Pokémon to sleep with Dark Void, gathers a ball of darkness
 * and blasts them with it. The scene loops behind the logo; "Roll Starter" begins.
 */
import type { Input } from '../core/input';
import { dirFromVector, type Dir8 } from '../core/math';
import type { GroundRenderer } from '../ground/types';
import { Lighting } from '../render/lighting';
import { drawDecor, drawSoftShadow } from '../render/world';
import { bodyRadius, drawScale, species, type SpeciesDef } from '../sim/data';
import type { Assets } from '../sprites/assets';
import { AnimPlayer, type SpriteRegistry } from '../sprites/pokemonSprite';
import { FxLibrary } from '../vfx/fxLibrary';
import { FxAnim } from '../vfx/fxVisuals';
import { VfxLayer } from '../vfx/visuals';
import { button, hit, text, uiFont, type GameContext, type Screen } from './screens';

const DARKRAI = '0491';
const VICTIMS = ['0025', '0387', '0133', '0393', '0390', '0447'];
/** The scene draws everyone this much larger than the match does (sizes stay true to each other). */
const SCENE_SCALE = 2.6;
/** Seconds in one loop of the scene, and when each beat happens. */
const LOOP = 11.5;
/** Where Darkrai holds its ball of darkness, from its ground point, in tiles. */
const HAND = { x: 1.3, lift: 2.3 };
const T = { rise: 0.4, void: 2.2, sleep: 2.8, charge: 4.2, fire: 5.9, hit: 6.1, faint: 6.7, fade: 8.6, sink: 9.8 };
const FX = { pool: 'fx_008', ring: 'fx_190', voidHit: 'fx_215', sleep: 'fx_015', orb: 'fx_143', blast: 'fx_188', burst: 'fx_186', smoke: 'fx_009', swirl: 'fx_241' };

interface Actor {
  sp: SpeciesDef;
  anim: AnimPlayer;
  x: number;
  y: number;
  homeX: number;
  homeY: number;
  dir: Dir8;
  alpha: number;
  vx: number;
  vy: number;
  asleep: boolean;
  wanderT: number;
}

export class TitleScreen implements Screen {
  private t = 0;
  private loopT = 0;
  private readonly lighting: Lighting;
  private readonly fx: FxLibrary;
  private readonly vfx = new VfxLayer();
  private darkrai: Actor | null = null;
  private victims: Actor[] = [];
  private fired = new Set<string>();
  private shake = 0;
  private flash = 0;
  private round = 0;
  private readonly cx: number;
  private readonly cy: number;

  constructor(
    private readonly ctx: GameContext,
    private readonly ground: GroundRenderer,
    private readonly sprites: SpriteRegistry,
    assets: Assets,
    private readonly onStart: () => void,
    private readonly onDemo: () => void,
    private readonly onGallery: () => void,
  ) {
    this.lighting = new Lighting(ctx.view);
    this.fx = new FxLibrary(assets);
    this.fx.preload(Object.values(FX));
    const v = ctx.view;
    v.zoom = v.targetZoom = 1;
    // Open grass on the crystal's plain, south-west of the terrace and clear of the roads.
    this.cx = ground.cols / 2 - 20;
    this.cy = ground.rows / 2 + 13;
    v.snapTo(this.cx, this.cy);
    this.newRound();
  }

  /** Scene coordinates: fractions of the screen turned into world tiles round the camera. */
  private at(fx: number, fy: number): { x: number; y: number } {
    const v = this.ctx.view;
    return { x: this.cx + ((fx - 0.5) * v.width) / v.pxPerTile, y: this.cy + ((fy - 0.5) * v.height) / v.pxPerTile };
  }

  private actor(dex: string, x: number, y: number): Actor {
    const anim = new AnimPlayer(this.sprites.get(dex));
    return { sp: species(dex), anim, x, y, homeX: x, homeY: y, dir: 0, alpha: 0, vx: 0, vy: 0, asleep: false, wanderT: Math.random() * 2 };
  }

  private newRound(): void {
    this.round++;
    this.loopT = 0;
    this.fired.clear();
    const d = this.at(0.2, 0.7);
    this.darkrai = this.actor(DARKRAI, d.x, d.y);
    this.darkrai.dir = 2;
    // Four or five of the cast in a loose group on the right, a different line-up each round.
    const cast = [...VICTIMS].sort(() => Math.random() - 0.5).slice(0, 4 + (this.round % 2));
    const spots = [[0.74, 0.62], [0.84, 0.7], [0.71, 0.8], [0.88, 0.84], [0.8, 0.56]];
    this.victims = cast.map((dex, i) => {
      const [fx, fy] = spots[i] as [number, number];
      const p = this.at(fx, fy);
      const a = this.actor(dex, p.x, p.y);
      a.dir = 6;
      return a;
    });
  }

  private play(id: string, o: ConstructorParameters<typeof FxAnim>[1]): void {
    const sheet = this.fx.sheet(id);
    if (sheet) this.vfx.add(new FxAnim(sheet, o));
  }

  /** Runs a beat once when the loop clock passes it. */
  private beat(name: keyof typeof T, fn: () => void): void {
    if (this.loopT >= T[name] && !this.fired.has(name)) {
      this.fired.add(name);
      fn();
    }
  }

  private buttonRect(): { x: number; y: number; w: number; h: number } {
    const v = this.ctx.view;
    const s = v.baseScale;
    return { x: v.width / 2 - 120 * s, y: v.height * 0.64, w: 240 * s, h: 56 * s };
  }

  /** Demo mode: skip the roll and start with a max-level showcase team. */
  private demoRect(): { x: number; y: number; w: number; h: number } {
    const v = this.ctx.view;
    const s = v.baseScale;
    return { x: v.width / 2 - 120 * s, y: v.height * 0.64 + 68 * s, w: 240 * s, h: 44 * s };
  }

  /** Move Gallery: every move played in turn. */
  private galleryRect(): { x: number; y: number; w: number; h: number } {
    const v = this.ctx.view;
    const s = v.baseScale;
    const d = this.demoRect();
    return { x: d.x, y: d.y + d.h + 30 * s, w: d.w, h: 40 * s };
  }

  step(dt: number, input: Input): void {
    this.t += dt;
    this.loopT += dt;
    this.stepScene(dt);
    const b = this.buttonRect();
    const d = this.demoRect();
    for (const c of input.takeClicks()) {
      if (hit(c.x, c.y, b.x, b.y, b.w, b.h)) this.onStart();
      else if (hit(c.x, c.y, d.x, d.y, d.w, d.h)) this.onDemo();
      else {
        const g = this.galleryRect();
        if (hit(c.x, c.y, g.x, g.y, g.w, g.h)) this.onGallery();
      }
    }
    if (input.pressed('KeyM')) this.onGallery();
    if (input.pressed('Enter') || input.pressed('Space')) this.onStart();
    if (input.pressed('KeyD')) this.onDemo();
  }

  private stepScene(dt: number): void {
    const dk = this.darkrai;
    if (!dk) return;
    const lt = this.loopT;
    const mid = this.victims.reduce((a, m) => ({ x: a.x + m.x / this.victims.length, y: a.y + m.y / this.victims.length }), { x: 0, y: 0 });
    // Darkrai rises out of a pool of shadow, and sinks back into it at the end.
    this.beat('rise', () => this.play(FX.pool, { x: dk.x, y: dk.y, lift: 0, scale: 2.2, fps: 6, loopSeconds: 2.2, light: 0 }));
    dk.alpha = lt < T.rise ? 0 : lt < T.rise + 1.2 ? (lt - T.rise) / 1.2 : lt > T.sink ? Math.max(0, 1 - (lt - T.sink) / 1.1) : 1;
    this.beat('sink', () => this.play(FX.pool, { x: dk.x, y: dk.y, lift: 0, scale: 2.2, fps: 6, loopSeconds: 1.6, light: 0 }));
    // Dark Void: a ring bursts from Darkrai, then one under every victim, and they drop off to sleep.
    this.beat('void', () => {
      dk.anim.play('Charge', { restart: true });
      this.play(FX.ring, { x: dk.x, y: dk.y, lift: 0.6, scale: 5, fps: 12, light: 1.5 });
      for (const m of this.victims) this.play(FX.voidHit, { x: m.x, y: m.y, lift: 0.3, scale: 3.5, fps: 12, light: 1.2 });
    });
    this.beat('sleep', () => {
      for (const m of this.victims) {
        m.asleep = true;
        m.anim.play('Sleep', { restart: true });
        this.play(FX.sleep, { x: m.x, y: m.y, lift: 0.9 + drawScale(m.sp) * SCENE_SCALE * (m.sp.body?.[1] ?? 24) / 48, scale: 2.5, fps: 10, loopSeconds: T.hit - T.sleep, follow: m, light: 0 });
      }
    });
    // It gathers a ball of darkness, then fires it across the plain.
    this.beat('charge', () => {
      dk.anim.play('Charge', { restart: true });
      this.play(FX.swirl, { x: dk.x + HAND.x, y: dk.y, lift: HAND.lift, scale: 4, fps: 14, loopSeconds: T.fire - T.charge, light: 0 });
    });
    this.beat('fire', () => {
      dk.anim.play('Shoot', { restart: true });
      this.shake = 1;
    });
    this.beat('hit', () => {
      this.flash = 1;
      this.play(FX.blast, { x: mid.x, y: mid.y, lift: 0.9, scale: 4.5, fps: 14, light: 2, tint: '#9a5cff' });
      this.play(FX.smoke, { x: mid.x, y: mid.y, lift: 0.3, scale: 3.2, fps: 8, loopSeconds: 1.6, light: 0 });
      for (const m of this.victims) {
        this.play(FX.burst, { x: m.x, y: m.y, lift: 0.6, scale: 3, fps: 14, light: 1 });
        m.asleep = false;
        m.anim.play('Hurt', { restart: true });
        const dx = m.x - dk.x;
        const dy = m.y - dk.y;
        const n = Math.hypot(dx, dy) || 1;
        m.vx = (dx / n) * 5;
        m.vy = (dy / n) * 5 - 1;
      }
    });
    this.beat('faint', () => {
      for (const m of this.victims) m.anim.play('Faint', { restart: true });
    });
    if (lt >= LOOP) this.newRound();

    // Victims fade in and amble about until the void hits; knocked back by the blast; fade once fainted.
    for (const m of this.victims) {
      m.alpha = lt < T.fade ? Math.min(1, lt / 0.8) : Math.max(0, 1 - (lt - T.fade) / 1);
      if (lt < T.void) {
        m.wanderT -= dt;
        if (m.wanderT <= 0) {
          m.wanderT = 1 + Math.random() * 1.5;
          const tx = m.homeX + (Math.random() - 0.5) * 1.6;
          const ty = m.homeY + (Math.random() - 0.5) * 1.2;
          m.vx = (tx - m.x) * 0.9;
          m.vy = (ty - m.y) * 0.9;
        }
        const moving = Math.hypot(m.vx, m.vy) > 0.15;
        m.anim.play(moving ? 'Walk' : 'Idle');
        if (moving) m.dir = dirFromVector(m.vx, m.vy, m.dir);
        m.x += m.vx * dt;
        m.y += m.vy * dt;
        m.vx *= 1 - Math.min(1, dt * 1.2);
        m.vy *= 1 - Math.min(1, dt * 1.2);
      } else if (lt < T.hit) {
        m.dir = dirFromVector(dk.x - m.x, dk.y - m.y, m.dir);
        m.vx = m.vy = 0;
      } else {
        m.x += m.vx * dt;
        m.y += m.vy * dt;
        m.vx *= 1 - Math.min(1, dt * 4);
        m.vy *= 1 - Math.min(1, dt * 4);
      }
      m.anim.dir = m.dir;
      m.anim.update(dt);
    }
    dk.dir = dirFromVector(mid.x - dk.x, mid.y - dk.y, 2);
    if (dk.anim.done) dk.anim.play('Idle');
    dk.anim.dir = dk.dir;
    dk.anim.update(dt);
    this.vfx.update(dt);
    this.shake = Math.max(0, this.shake - dt * 0.9);
    this.flash = Math.max(0, this.flash - dt * 1.4);
  }

  private drawActor(m: Actor, bob = 0): void {
    const v = this.ctx.view;
    if (m.alpha <= 0.01) return;
    const ctx = v.ctx;
    const sx = Math.round(v.toScreenX(m.x));
    const sy = Math.round(v.toScreenY(m.y));
    const s = v.spriteScale * drawScale(m.sp) * SCENE_SCALE;
    drawSoftShadow(v, sx, sy, Math.max(0.12, Math.min(2.5, bodyRadius(m.sp) * 0.8)) * SCENE_SCALE, 0.3 * m.alpha);
    const f = m.anim.current();
    ctx.save();
    ctx.globalAlpha = m.alpha;
    ctx.imageSmoothingEnabled = s < 1;
    ctx.drawImage(f.image, f.sx, f.sy, f.w, f.h, sx - (f.w * s) / 2, sy - (f.h * s) / 2 - bob * v.pxPerTile, f.w * s, f.h * s);
    ctx.restore();
    ctx.imageSmoothingEnabled = false;
  }

  /** The ball of darkness in Darkrai's hands: black core, violet rim, motes pulled in from round it. */
  private drawOrb(): void {
    const dk = this.darkrai;
    const lt = this.loopT;
    if (!dk || lt < T.charge || lt > T.fire + 0.15) return;
    const v = this.ctx.view;
    const ctx = v.ctx;
    const k = Math.min(1, (lt - T.charge) / (T.fire - T.charge));
    const x = v.toScreenX(dk.x + HAND.x);
    const y = v.toScreenY(dk.y) - HAND.lift * v.pxPerTile;
    const r = (0.15 + 0.85 * k) * 0.9 * v.pxPerTile * (1 + 0.06 * Math.sin(this.t * 30));
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
    for (let i = 0; i < 14; i++) {
      const a = i * 2.39 + this.t * 2;
      const ph = (this.t * 1.3 + i * 0.137) % 1;
      const d = r * (1.2 + (1 - ph) * 3);
      ctx.fillStyle = `rgba(${i % 2 ? '190,120,255' : '20,0,40'},${0.9 * ph})`;
      const ps = Math.max(2, Math.round(3 * v.baseScale));
      ctx.fillRect(Math.round(x + Math.cos(a) * d), Math.round(y + Math.sin(a) * d * 0.7), ps, ps);
    }
    ctx.restore();
  }

  /** The dark blast itself: a thick black beam with a violet edge from Darkrai's hands to the group. */
  private drawBlast(): void {
    const dk = this.darkrai;
    const lt = this.loopT;
    if (!dk || lt < T.fire || lt > T.fire + 0.9 || !this.victims.length) return;
    const v = this.ctx.view;
    const ctx = v.ctx;
    const mid = this.victims.reduce((a, m) => ({ x: a.x + m.x / this.victims.length, y: a.y + m.y / this.victims.length }), { x: 0, y: 0 });
    const x0 = v.toScreenX(dk.x + HAND.x);
    const y0 = v.toScreenY(dk.y) - HAND.lift * v.pxPerTile;
    const x1 = v.toScreenX(mid.x);
    const y1 = v.toScreenY(mid.y) - 0.6 * v.pxPerTile;
    const k = (lt - T.fire) / 0.9;
    const w = v.pxPerTile * 1.6 * Math.sin(Math.PI * Math.min(1, k * 1.3)) * (1 + 0.08 * Math.sin(this.t * 50));
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
    // Two violet threads twisting round the core.
    const len = Math.hypot(x1 - x0, y1 - y0);
    const ux = (x1 - x0) / len;
    const uy = (y1 - y0) / len;
    for (const side of [1, -1]) {
      ctx.strokeStyle = side > 0 ? 'rgba(190,120,255,0.85)' : 'rgba(110,40,200,0.85)';
      ctx.lineWidth = Math.max(2, w * 0.12);
      ctx.beginPath();
      for (let d = 0; d <= len; d += 6) {
        const o = side * Math.sin(d * 0.03 - this.t * 24) * w * 0.55;
        const px = x0 + ux * d - uy * o;
        const py = y0 + uy * d + ux * o;
        if (d === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  render(): void {
    const v = this.ctx.view;
    const s = v.baseScale;
    // A small shake while the blast lands.
    const sh = this.shake * this.shake * 0.25;
    v.snapTo(this.cx + (Math.random() - 0.5) * sh, this.cy + (Math.random() - 0.5) * sh);
    v.ctx.fillStyle = '#0b0a12';
    v.ctx.fillRect(0, 0, v.width, v.height);
    this.ground.drawGround(v);
    drawDecor(v, this.ground, this.t);
    const dk = this.darkrai;
    const list: Array<{ y: number; draw: () => void }> = this.victims.map((m) => ({ y: m.y, draw: () => this.drawActor(m) }));
    if (dk) list.push({ y: dk.y, draw: () => this.drawActor(dk, 0.35 + 0.12 * Math.sin(this.t * 2.2)) });
    list.sort((a, b) => a.y - b.y);
    for (const d of list) d.draw();
    this.drawBlast();
    this.vfx.draw(v);
    this.drawOrb();
    // Lights: a dim dusk that deepens while Darkrai works, lit by its attacks.
    v.beginLights();
    v.lightCtx.fillStyle = 'rgba(255,220,170,0.08)';
    v.lightCtx.fillRect(0, 0, v.width, v.height);
    this.vfx.drawLights(v);
    const lt = this.loopT;
    const menace = lt < T.void ? Math.min(1, lt / T.void) * 0.3 : lt < T.fade ? 0.3 + 0.25 * Math.min(1, (lt - T.void) / 2) : Math.max(0, 0.55 - (lt - T.fade) * 0.25);
    const dxs = dk ? v.toScreenX(dk.x) : v.width / 2;
    const dys = dk ? v.toScreenY(dk.y) : v.height / 2;
    this.lighting.render({ cold: 0.5, darkCx: dxs, darkCy: dys, darkRadius: v.width * 0.75, darkFeather: v.width * 0.5, darkAmount: 0.35 + menace, clearCx: 0, clearCy: 0, clearRadius: 0, time: this.t });
    // Overlay
    const h = v.hud;
    h.clearRect(0, 0, v.width, v.height);
    if (this.flash > 0) {
      h.fillStyle = `rgba(40,0,70,${0.55 * this.flash})`;
      h.fillRect(0, 0, v.width, v.height);
    }
    const grad = h.createLinearGradient(0, 0, 0, v.height * 0.55);
    grad.addColorStop(0, 'rgba(8,4,20,0.85)');
    grad.addColorStop(1, 'rgba(8,4,20,0)');
    h.fillStyle = grad;
    h.fillRect(0, 0, v.width, v.height * 0.55);
    text(v, 'SHADOWS OF ALMIA', v.width / 2, v.height * 0.3, 72, { align: 'center', weight: '900', color: '#e9ddff' });
    text(v, 'SHOWDOWN', v.width / 2, v.height * 0.3 + 70 * s, 64, { align: 'center', weight: '900', color: '#b48cff' });
    text(v, 'A Pokémon battle royale on the Ranger Union training grounds', v.width / 2, v.height * 0.3 + 104 * s, 15, { align: 'center', weight: '500', color: '#cfc6ea' });
    const b = this.buttonRect();
    const hover = hit(this.ctx.input.mouseX, this.ctx.input.mouseY, b.x, b.y, b.w, b.h);
    button(v, 'Roll Starter', b.x, b.y, b.w, b.h, hover);
    const d = this.demoRect();
    button(v, 'Demo Team (D)', d.x, d.y, d.w, d.h, hit(this.ctx.input.mouseX, this.ctx.input.mouseY, d.x, d.y, d.w, d.h), '#4f7ad6');
    text(v, 'Lv 100 Infernape · Shiny Rayquaza · Latios · Shiny Jirachi · Tinkaton', v.width / 2, d.y + d.h + 16 * s, 11, { align: 'center', weight: '500', color: '#9f97bb' });
    const g = this.galleryRect();
    button(v, 'Move Gallery (M)', g.x, g.y, g.w, g.h, hit(this.ctx.input.mouseX, this.ctx.input.mouseY, g.x, g.y, g.w, g.h), '#4f7ad6');
    text(v, 'WASD move · 1-4 moves · Shift+1-6 items · Space talk / pick up · hold F to throw', v.width / 2, v.height - 18 * s, 12, { align: 'center', weight: '500', color: '#9f97bb' });
    // Build stamp, top right on a dark pill: which deploy this browser has loaded.
    const stamp = `Version ${__BUILD__}`;
    h.save();
    h.font = uiFont(14 * s);
    const sw = h.measureText(stamp).width + 20 * s;
    h.fillStyle = 'rgba(8,4,20,0.75)';
    h.beginPath();
    h.roundRect(v.width - sw - 12 * s, 12 * s, sw, 28 * s, 14 * s);
    h.fill();
    h.restore();
    text(v, stamp, v.width - 22 * s, 31 * s, 14, { align: 'right', weight: '600', color: '#ffe27a', shadow: false });
  }
}
