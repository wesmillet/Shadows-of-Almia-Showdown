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
import { areaContains, makeArea, type Area, type BattleEvent } from '../sim/battle';
import { CONFIG, move, typeColor, type MoveDef } from '../sim/data';
import type { Mon } from '../sim/entities';
import { lead } from '../sim/entities';
import type { Match } from '../sim/match';
import type { Assets } from '../sprites/assets';
import type { RangerSprites } from '../sprites/rangerSprite';
import { Floaters } from '../vfx/floaters';
import { Beam, drawPointLight, ImpactBurst, Projectile, RingPulse, SpriteStripVisual, StatusCloud, VfxLayer } from '../vfx/visuals';
import { Hud, type HudState } from './hud';
import { rgba, type GameContext, type Screen } from './screens';

export class MatchScreen implements Screen {
  private readonly lighting: Lighting;
  private readonly hud: Hud;
  private readonly vfx = new VfxLayer();
  private readonly floaters = new Floaters();
  private notice = '';
  private noticeT = 0;
  private selectedItem = -1;
  private readonly strips = new Map<string, HTMLImageElement | null>();

  constructor(
    protected readonly ctx: GameContext,
    readonly match: Match,
    protected readonly rangers: RangerSprites,
    protected readonly assets: Assets,
  ) {
    this.lighting = new Lighting(ctx.view);
    this.hud = new Hud(ctx.view);
    ctx.view.snapTo(match.player.x, match.player.y);
    ctx.view.zoom = ctx.view.targetZoom = 1;
  }

  say(s: string, seconds = 1.6): void {
    this.notice = s;
    this.noticeT = seconds;
  }

  step(dt: number, input: Input): void {
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
      else if (h?.kind === 'portrait') {
        if (this.match.swapLead(h.index)) this.say(`${lead(this.match.player)?.name} takes the lead`);
      } else if (h?.kind === 'item') this.onItemSlot(h.index);
    }
    for (let i = 0; i < 4; i++) {
      if (input.pressed(`Digit${i + 1}`) && !input.down('ShiftLeft') && !input.down('ShiftRight')) {
        if (this.match.player.engaged || this.match.nearestEnemyMon(this.match.player, this.match.player.x, this.match.player.y, 3.5)) {
          this.castFeedback(this.match.playerCast(i));
        } else this.onItemSlot(i);
      }
    }
    for (let i = 4; i < 6; i++) if (input.pressed(`Digit${i + 1}`)) this.onItemSlot(i);
    for (let i = 0; i < 6; i++) if (input.pressed(`Digit${i + 1}`) && (input.down('ShiftLeft') || input.down('ShiftRight'))) this.onItemSlot(i);
    void v;
  }

  /** Items arrive in milestone 3; for now the slot just reports itself. */
  protected onItemSlot(index: number): void {
    this.selectedItem = this.selectedItem === index ? -1 : index;
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
      case 'engage':
        if (ev.trainer.isPlayer) {
          v.targetZoom = CONFIG.battle.engageZoom;
          this.say(`A wild ${ev.enemy.name} wants to fight!`, 1.4);
        }
        break;
      case 'disengage':
        if (ev.trainer.isPlayer) v.targetZoom = 1;
        break;
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
        break;
      }
      case 'stages':
        this.floaters.add(ev.target.x, ev.target.y - 0.3, `${ev.stat.toUpperCase()} ${ev.delta > 0 ? '▲' : '▼'}`, ev.delta > 0 ? '#9be7ff' : '#ff9e9e', 16);
        break;
      case 'tick':
        this.floaters.add(ev.target.x, ev.target.y, String(ev.damage), ev.source === 'burn' ? '#ff8a65' : '#c38bff', 15);
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
      default:
        break;
    }
  }

  private spawnMoveVfx(attacker: Mon, m: MoveDef, area: Area, hits: Mon[]): void {
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
        this.vfx.add(new Beam(from.x, from.y - 0.35, area.fx, area.fy, m.shape === 'cone' ? 2.8 : 3.3, color, size, m.shape === 'cone'));
        for (const h of hits) this.vfx.add(new ImpactBurst(h.x, h.y, color, size * 0.7));
        break;
      case 'ring':
        this.vfx.add(new RingPulse(attacker.x, attacker.y, 2.3, color, size));
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
      const ppt = v.pxPerTile;
      const X = (x: number) => v.toScreenX(x);
      const Y = (y: number) => v.toScreenY(y);
      ctx.beginPath();
      if (area.shape === 'single') ctx.arc(X(area.tx), Y(area.ty), 0.65 * ppt, 0, Math.PI * 2);
      else if (area.shape === 'self') ctx.arc(X(area.ox), Y(area.oy), 0.45 * ppt, 0, Math.PI * 2);
      else if (area.shape === 'ring') {
        ctx.arc(X(area.ox), Y(area.oy), 2.3 * ppt, 0, Math.PI * 2);
        ctx.arc(X(area.ox), Y(area.oy), 0.3 * ppt, 0, Math.PI * 2, true);
      } else {
        const nx = -area.fy;
        const ny = area.fx;
        const pts: Array<[number, number]> =
          area.shape === 'line'
            ? [
                [area.ox + area.fx * 0.25 + nx * 0.55, area.oy + area.fy * 0.25 + ny * 0.55],
                [area.ox + area.fx * 3.4 + nx * 0.55, area.oy + area.fy * 3.4 + ny * 0.55],
                [area.ox + area.fx * 3.4 - nx * 0.55, area.oy + area.fy * 3.4 - ny * 0.55],
                [area.ox + area.fx * 0.25 - nx * 0.55, area.oy + area.fy * 0.25 - ny * 0.55],
              ]
            : [
                [area.ox + area.fx * 0.25 + nx * 0.5, area.oy + area.fy * 0.25 + ny * 0.5],
                [area.ox + area.fx * 2.9 + nx * 1.9, area.oy + area.fy * 2.9 + ny * 1.9],
                [area.ox + area.fx * 2.9 - nx * 1.9, area.oy + area.fy * 2.9 - ny * 1.9],
                [area.ox + area.fx * 0.25 - nx * 0.5, area.oy + area.fy * 0.25 - ny * 0.5],
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

  protected drawGroundExtras(_v: View): void {}

  protected drawLights(v: View): void {
    const p = this.match.player;
    drawPointLight(v, p.x, p.y, 1.6, '#ffd9a0', 0.18, 0.2);
    const first = lead(p);
    if (first) drawPointLight(v, first.x, first.y, 1.2, '#ffe8c0', 0.12);
    this.vfx.drawLights(v);
  }

  protected lightingParams(v: View): { cold: number; darkRadius: number; darkFeather: number; darkAmount: number } {
    void v;
    return { cold: clamp(this.match.time / CONFIG.lighting.dayToColdSeconds, 0, 1), darkRadius: 1e6, darkFeather: 1, darkAmount: 0 };
  }

  protected hudState(v: View): HudState {
    return {
      mouseX: this.ctx.input.mouseX,
      mouseY: this.ctx.input.mouseY,
      darkRadius: Infinity,
      darkPhaseLabel: 'daylight',
      nextPulseIn: -1,
      notice: this.notice,
      selectedItem: this.selectedItem,
      aiming: 0,
      lightingMode: this.lighting.mode,
    };
  }

  protected drawExtraWorld(_v: View): Array<{ y: number; draw: () => void }> {
    return [];
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
    v.beginLights();
    this.drawLights(v);
    const lp = this.lightingParams(v);
    this.lighting.render({
      cold: lp.cold,
      darkCx: v.toScreenX(this.match.centerX),
      darkCy: v.toScreenY(this.match.centerY),
      darkRadius: lp.darkRadius,
      darkFeather: lp.darkFeather,
      darkAmount: lp.darkAmount,
      time: this.match.time,
    });
    this.hud.draw(this.match, this.hudState(v));
    this.floaters.draw(v, v.hud);
    this.drawOverlay(v);
  }

  protected drawOverlay(_v: View): void {}
}
