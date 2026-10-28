/**
 * What one player is sent: the part of the match around them (and anything they are battling),
 * their own seat, and a radar of every trainer's position for the minimap. The view object and
 * its lists are kept and refilled each time, so unchanged parts cost nothing on the wire.
 */
import type { Mon, Trainer } from '../src/sim/entities';
import type { Match } from '../src/sim/match';
import type { Seat } from '../src/sim/seat';

/** Tiles from the player (or the Pokémon they steer) that they are kept up to date about. */
export const VIEW_RADIUS = 30;

interface RadarDot {
  id: number;
  x: number;
  y: number;
  alive: boolean;
  human: boolean;
  name: string;
}

export class PlayerView {
  readonly root: Record<string, unknown> = {};
  /** The Pokémon and trainers this player may know about this time (references to others travel as null). */
  readonly visible = new Set<object>();
  private lists = new Map<string, unknown[]>();
  private radar = new Map<number, RadarDot>();
  private seatView: Record<string, unknown> = {};
  private visitorsView: Record<string, unknown> = {};

  /** Tiles kept up to date around the focus (VIEW_RADIUS; replays see everything). */
  private readonly radius: number;

  /** Replays: kept up to date around every trainer, not just one. */
  private readonly around: (() => Array<{ x: number; y: number }>) | null;

  constructor(private readonly match: Match, private readonly seat: Seat, opts: { radius?: number; around?: () => Array<{ x: number; y: number }> } = {}) {
    this.radius = opts.radius ?? VIEW_RADIUS;
    this.around = opts.around ?? null;
  }

  private list<T>(key: string, items: T[]): T[] {
    let l = this.lists.get(key) as T[] | undefined;
    if (!l) this.lists.set(key, (l = []));
    l.length = 0;
    l.push(...items);
    return l;
  }

  build(): Record<string, unknown> {
    const m = this.match;
    const seat = this.seat;
    const me = seat.trainer;
    const focus = seat.controlled ?? me;
    const radius = this.radius;
    const foci = this.around ? this.around() : [focus];
    const near = (x: number, y: number, extra = 0) => foci.some((f) => Math.hypot(x - f.x, y - f.y) <= radius + extra);
    const myDuel = me.duelId;
    const v = this.visible;
    v.clear();

    const trainers = m.allTrainers.filter((t) => t === me || near(t.x, t.y) || (myDuel !== undefined && t.duelId === myDuel));
    // Townsfolk (healers, vendors, the challenger, visitors) are few: everyone always knows where they are.
    const npcs = m.npcs;
    for (const t of [...trainers, ...npcs]) {
      v.add(t);
      for (const p of t.party) v.add(p);
    }
    const wilds = m.wilds.filter((w) => near(w.x, w.y) || w === seat.lockTarget);
    for (const w of wilds) v.add(w);
    if (m.darkrai) v.add(m.darkrai);
    const vis = m.visitors;
    if (vis.hoopa) v.add(vis.hoopa);
    if (vis.merchant) v.add(vis.merchant.npc);
    if (vis.ace) v.add(vis.ace.npc);
    if (m.challenge?.npc) v.add(m.challenge.npc);

    // The minimap's radar: every trainer still in the match (one stable dot each).
    const dots: RadarDot[] = [];
    for (const t of m.allTrainers) {
      if (t.visitor || t.hidden || t.challenger) continue;
      let d = this.radar.get(t.id);
      if (!d) this.radar.set(t.id, (d = { id: t.id, x: 0, y: 0, alive: true, human: t.isPlayer, name: t.name }));
      d.x = Math.round(t.x * 10) / 10;
      d.y = Math.round(t.y * 10) / 10;
      d.alive = t.alive;
      dots.push(d);
    }

    const sv = this.seatView;
    sv.trainer = me;
    sv.controlled = seat.controlled;
    sv.lockTarget = seat.lockTarget;
    sv.auto = seat.auto;
    sv.fishing = seat.fishing;
    sv.pendingLearn = seat.pendingLearn;
    sv.snagOffer = seat.snagOffer;
    sv.outcome = seat.outcome;

    const vv = this.visitorsView;
    vv.portal = vis.portal;
    vv.hoopa = vis.hoopa;
    vv.hoopaUsed = vis.hoopaUsed;
    vv.merchant = vis.merchant ? vis.merchant.npc : null;
    vv.ace = vis.ace ? vis.ace.npc : null;
    vv.aceState = vis.aceState;
    vv.aceFoe = vis.aceFoe;
    vv.aceReadyAt = vis.aceReadyAt;

    const r = this.root;
    r.time = Math.round(m.time * 100) / 100;
    r.over = m.over;
    r.finalStarted = m.finalStarted;
    r.seat = sv;
    r.trainers = this.list('trainers', trainers);
    r.npcs = this.list('npcs', npcs);
    r.wilds = this.list('wilds', wilds);
    r.darkrai = m.darkrai;
    r.darkraiPortal = m.darkraiPortal;
    r.items = this.list('items', m.items.filter((it) => near(it.x, it.y)));
    r.throws = this.list('throws', m.throws.filter((th) => near(th.x, th.y)));
    r.duels = this.list('duels', m.duels.filter((d) => near(d.cx, d.cy) || d.a.trainer === me || d.b.trainer === me));
    r.darkness = m.darkness;
    r.outposts = m.outposts;
    r.chests = m.chests;
    r.challenge = m.challenge;
    r.shops = m.shops;
    r.visitors = vv;
    r.radar = this.list('radar', dots);
    return r;
  }
}

/** True when `o` is a Pokémon or trainer this view knows about (events naming others are not sent). */
export function knows(view: PlayerView, o: Mon | Trainer | null | undefined): boolean {
  return !!o && view.visible.has(o);
}
