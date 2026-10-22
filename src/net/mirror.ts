/**
 * An online match in the browser: a Match in mirror mode (nothing spawned, never simulated) that
 * the server's updates fill in, drawn by the ordinary MatchScreen and HUD.
 *
 * - State: each update patches the mirror's objects (src/net/sync.ts); the view's lists become the
 *   match's lists (wilds, trainers, items, duels...) and its seat becomes the player's seat.
 * - Motion: positions arrive 20 times a second; each object glides from where it is to the new
 *   spot over the gap between updates, so the 60 fps picture stays smooth.
 * - Pokémon: sprites and the animation player are rebuilt here from dex and shiny; the server's
 *   animation changes (and restarts) are played on them.
 * - Actions: every Match method the screen calls to change something is replaced on this object by
 *   a command to the server; reads (cooldowns, what is near, ball slots) keep working on the mirror.
 * - Watching (observe: spectating, replays): nothing is sent and nothing is predicted; the camera
 *   follows whichever trainer `you` names, and that can change.
 */
import type { Input } from '../core/input';
import { CONFIG, species } from '../sim/data';
import { move } from '../sim/data';
import type { Mon, Trainer } from '../sim/entities';
import { Match, type MatchDeps } from '../sim/match';
import { AnimPlayer } from '../sprites/pokemonSprite';
import type { RangerSprites } from '../sprites/rangerSprite';
import type { MirrorNet } from './connection';
import type { RosterEntry, ServerMsg } from './protocol';
import { isMon, isTrainer, SyncDecoder } from './sync';

type Obj = Record<string, unknown>;

/** Fields that glide between updates. */
const SMOOTH = ['x', 'y', 'z'] as const;
/** How close to the reticle an opponent must be drawn to count as the one aimed at (as the offline aim snap). */
const AIM_PICK = 1.6;

interface Glide {
  from: Record<string, number>;
  to: Record<string, number>;
  t: number;
  d: number;
}

export class MirrorMatch {
  readonly match: Match;
  private dec: SyncDecoder;
  private glides = new Map<Obj, Glide>();
  private lastUpdateAt = 0;
  private interval = 0.05;
  /** Movement frames: numbered keys for every step, sent a few at a time (see Seat.inputs). */
  private seq = 0;
  private outbox: Array<[number, number, number]> = [];
  /** Frames the server has not applied yet, replayed on top of each update (prediction). */
  private pending: Array<{ seq: number; mx: number; my: number }> = [];
  /** What the frames move: this player's trainer, or the Pokémon they steer. */
  private avatar: Obj | null = null;
  /** Server-side acknowledgement of the frames (Seat.ack). */
  private ack = 0;
  /** How far prediction had to be corrected lately (tiles), for the network readout. */
  correction = 0;
  /** Testing: when set, every step and every correction is recorded here. */
  /** Testing only (null unless a test sets it): every step, replay and correction of the prediction. */
  trace: Array<{ k: 'step' | 'fix'; t: number; x: number; y: number; mx?: number; err?: number; seq?: number; sx?: number; sy?: number; cx?: number; cy?: number; n?: number }> | null = null;
  private hist = new Map<number, { x: number; y: number }>();
  /** The avatar's position (and facing) as the server last sent it. */
  private auth: { o: Obj; x: number; y: number; dir: unknown } | null = null;
  private human = new Set<number>();
  private titles = new Map<number, string>();
  readonly roster: RosterEntry[];
  private looks = new Map<number, string>();
  private unsub: () => void;
  /** Called with a command's reply (the offline game's message line). */
  onReply: ((text: string, seconds: number) => void) | null = null;
  /** Called when the server says this player's match is over. */
  onEnd: ((outcome: 'win' | 'loss', place: number) => void) | null = null;
  /** Resolves with the first update (the match screen waits for it, so it never draws an empty match). */
  readonly ready: Promise<void>;
  private markReady!: () => void;
  /** Set when the server ends the match for this player. */
  ended: { outcome: 'win' | 'loss'; place: number } | null = null;

  /** Watching, not playing (a spectator or a replay). */
  readonly observe: boolean;
  /** Called when a watched match changes whom it follows. */
  onFollow: ((trainerId: number) => void) | null = null;

  constructor(
    deps: MatchDeps,
    private readonly net: MirrorNet,
    /** This player's trainer (watching: the one followed). */
    public you: number,
    roster: RosterEntry[],
    private readonly rangers: RangerSprites,
    opts: { observe?: boolean } = {},
  ) {
    this.observe = !!opts.observe;
    this.match = new Match(deps, [], { mirror: true });
    this.ready = new Promise((res) => (this.markReady = res));
    this.roster = roster;
    for (const r of roster) {
      if (r.human) this.human.add(r.trainerId);
      if (r.human && typeof r.look === 'string') this.looks.set(r.trainerId, r.look);
      if (r.title) this.titles.set(r.trainerId, r.title);
    }
    this.dec = this.decoder();
    this.installCommands();
    this.unsub = net.on((msg) => this.onMessage(msg));
  }

  /** A fresh decoder (at the start, and after a reconnect, when the server sends everything again). */
  private decoder(): SyncDecoder {
    const sprites = this.match.sprites;
    return new SyncDecoder({
      hydrate: (o) => {
        if (isMon(o)) {
          const m = o as unknown as Mon;
          m.species = species(m.dex);
          m.sprites = sprites.get(m.dex, !!m.shiny);
          m.anim = new AnimPlayer(m.sprites);
          const want = o.$want as { action: string; loop: boolean } | undefined;
          if (want) m.anim.play(want.action, { loop: want.loop, restart: true });
          o.$dex = m.dex;
          m.px = m.x;
          m.py = m.y;
        } else if (isTrainer(o)) {
          const t = o as unknown as Trainer;
          t.px = t.x;
          t.py = t.y;
          // Bags and money are only sent to their owner: everyone else's are empty here (a replay
          // shows nobody's), so the screen can read them all the same.
          if (!Array.isArray(t.items)) t.items = [];
          if (!Array.isArray(t.held)) t.held = [];
          if (typeof t.money !== 'number') t.money = 0;
          if (!t.stats) t.stats = { catches: 0, knockouts: 0, damage: 0, timeSurvived: 0 };
          this.dressTrainer(t);
        }
      },
      animate: (o, action, loop, restart) => {
        const m = o as unknown as Mon;
        // The avatar's walking is predicted here; the server's Walk/Idle would only lag behind it.
        if (o === this.avatar && (action === 'Walk' || action === 'Idle') && !restart) return;
        if (!m.anim) {
          o.$want = { action, loop };
          return;
        }
        if (restart || m.anim.action !== action || m.anim.loop !== loop) m.anim.play(action, { loop, restart: true });
      },
      counter: (o, x, y) => {
        // A vendor's stall: the same decor object the drawn map has.
        (o as unknown as Trainer).counter = this.match.ground.decor.find((d) => Math.abs(d.x - x) < 0.01 && Math.abs(d.y - y) < 0.01) ?? null;
      },
    });
  }

  dispose(): void {
    this.unsub();
  }

  /** Starts the view over (everything arrives again), following `follow`. */
  restart(follow: number): void {
    this.dec = this.decoder();
    this.glides.clear();
    this.follow(follow);
  }

  /** Watching: the camera follows this trainer. */
  follow(trainerId: number): void {
    if (this.you === trainerId) return;
    this.you = trainerId;
    this.onFollow?.(trainerId);
    this.syncRoot();
  }

  /** Other players get their own look; until it loads they borrow a rival's. */
  private dressTrainer(t: Trainer): void {
    const title = this.titles.get(t.id);
    if (title) (t as Trainer & { title?: string }).title = title;
    if (t.id === this.you && !this.observe) {
      t.isPlayer = true;
      t.role = 'player';
      return;
    }
    if (!this.human.has(t.id) && !t.isPlayer) return;
    t.isPlayer = false;
    const stand = ['trainer_a', 'trainer_b', 'trainer_c', 'trainer_d', 'trainer_e', 'trainer_f', 'trainer_g'];
    t.role = stand[t.id % stand.length] as string;
    const chars = this.rangers.characters();
    const look = this.looks.get(t.id) ?? chars[t.id % Math.max(1, chars.length)];
    if (!look) return;
    const role = `human:${t.id}`;
    void this.rangers.setRole(role, look).then(() => (t.role = role));
  }

  private onMessage(msg: ServerMsg): void {
    if (msg.t === 's') this.applyUpdate(msg.p, msg.e, msg.ack ?? 0);
    else if (msg.t === 'start' && !this.observe) {
      // Back after a dropped connection: the server starts the view over.
      this.dec = this.decoder();
      this.glides.clear();
    } else if (msg.t === 'spectate' && this.observe) {
      // Watching someone else now (or a replay jumping): the view starts over.
      this.restart(msg.follow);
    }
    else if (msg.t === 'reply') this.onReply?.(msg.text, msg.seconds);
    else if (msg.t === 'end') {
      this.ended = { outcome: msg.outcome, place: msg.place };
      this.match.seat.outcome = msg.outcome;
      this.onEnd?.(msg.outcome, msg.place);
    }
  }

  private applyUpdate(p: Extract<ServerMsg, { t: 's' }>['p'], events: Array<Record<string, unknown>>, ack: number): void {
    const now = performance.now() / 1000;
    if (this.lastUpdateAt) this.interval = Math.max(0.03, Math.min(0.15, this.interval * 0.8 + (now - this.lastUpdateAt) * 0.2));
    this.lastUpdateAt = now;
    // Where everything is drawn now: the glide to the new spots starts from here.
    const before = new Map<Obj, Record<string, number>>();
    for (const key of Object.keys(p.set)) {
      const o = this.dec.objects.get(Number(key));
      if (!o) continue;
      const cur: Record<string, number> = {};
      for (const k of SMOOTH) if (typeof o[k] === 'number') cur[k] = o[k] as number;
      before.set(o, cur);
    }
    // Where this player's own trainer (or steered Pokémon) is shown now, before the server's word on it.
    const avatar = this.avatar;
    const shown = avatar ? { x: avatar.x as number, y: avatar.y as number, moving: avatar.moving, walkPhase: avatar.walkPhase } : null;
    // Updates carry only what changed, so a field the server left out still holds the prediction:
    // put back the server's last word on the avatar first, so the replay starts from the server's spot.
    if (avatar && this.auth && this.auth.o === avatar) {
      avatar.x = this.auth.x;
      avatar.y = this.auth.y;
      if (this.auth.dir !== undefined) avatar.dir = this.auth.dir;
    }
    this.dec.apply(p);
    if (avatar) this.auth = { o: avatar, x: avatar.x as number, y: avatar.y as number, dir: avatar.dir };
    for (const [o, cur] of before) {
      // This player's own trainer (or steered Pokémon) is predicted, not glided: see reconcile().
      if (o === avatar) continue;
      const to: Record<string, number> = {};
      let moved = false;
      for (const k of SMOOTH) {
        if (typeof o[k] !== 'number' || cur[k] === undefined) continue;
        to[k] = o[k] as number;
        if (to[k] !== cur[k]) moved = true;
        o[k] = cur[k];
      }
      // A jump (respawn, teleport) snaps instead of sliding across the map.
      const far = Math.hypot((to.x ?? 0) - (cur.x ?? 0), (to.y ?? 0) - (cur.y ?? 0)) > 4;
      if (far) for (const k of Object.keys(to)) o[k] = to[k];
      if (moved && !far) this.glides.set(o, { from: cur, to, t: 0, d: this.interval });
      // Evolved or Mega Evolved: new sprites.
      if (isMon(o) && o.$dex !== o.dex) {
        const m = o as unknown as Mon;
        const action = m.anim?.action ?? 'Idle';
        m.species = species(m.dex);
        m.sprites = this.match.sprites.get(m.dex, !!m.shiny);
        m.anim = new AnimPlayer(m.sprites);
        m.anim.play(action);
        o.$dex = m.dex;
      }
    }
    for (const o of this.glides.keys()) if (!this.dec.objects.has(this.idOf(o))) this.glides.delete(o);
    this.syncRoot();
    this.reconcile(ack, shown);
    if (this.match.player.party.length) this.markReady();
    const decoded: unknown[] = [];
    for (const e of events) {
      const d = this.dec.decodeEvent(e, (id) => move(id));
      if (!d) continue;
      decoded.push(d);
      // A knockout: its Faint animation plays out here before it is gone (as offline).
      if (d.type === 'faint' && d.mon && !this.match.battle.fainting.some((f) => f.mon === d.mon)) this.match.battle.fainting.push({ mon: d.mon as unknown as Mon, t: 1.1 });
    }
    this.match.battle.events.push(...(decoded as typeof this.match.battle.events));
  }

  private ids = new WeakMap<Obj, number>();
  private idOf(o: Obj): number {
    let id = this.ids.get(o);
    if (id === undefined) {
      for (const [k, v] of this.dec.objects) {
        if (v === o) {
          id = k;
          break;
        }
      }
      if (id !== undefined) this.ids.set(o, id);
    }
    return id ?? -1;
  }

  /** The view's lists become the match's. */
  private syncRoot(): void {
    const r = this.dec.root as Obj | null;
    if (!r) return;
    const m = this.match as unknown as Obj & Match;
    const seat = r.seat as Obj;
    const seatTrainer = seat.trainer as Trainer | null;
    // Watching: the followed trainer (a replay sees everyone and picks; a spectator's view is theirs).
    let me = seatTrainer;
    if (this.observe) {
      const all = [...(((r.trainers as Trainer[]) ?? []).filter(Boolean)), ...(seatTrainer ? [seatTrainer] : [])];
      me = all.find((t) => t.id === this.you) ?? seatTrainer;
    }
    const own = me === seatTrainer;
    if (me) {
      if (m.seat.trainer !== me) this.dressTrainer(me);
      m.seat.trainer = me;
    }
    m.seat.controlled = own ? ((seat.controlled as Mon | null) ?? null) : null;
    m.seat.lockTarget = own ? ((seat.lockTarget as Mon | null) ?? null) : null;
    m.seat.auto = !!seat.auto;
    m.seat.fishing = own ? ((seat.fishing as Match['fishing']) ?? null) : null;
    m.seat.pendingLearn = own && !this.observe ? ((seat.pendingLearn as Match['pendingLearn']) ?? []) : [];
    m.seat.snagOffer = own && !this.observe ? ((seat.snagOffer as Match['snagOffer']) ?? null) : null;
    if (this.observe) m.seat.outcome = null;
    else if (!this.ended) m.seat.outcome = (seat.outcome as Match['outcome']) ?? null;
    m.time = r.time as number;
    m.over = !!r.over;
    m.finalStarted = !!r.finalStarted;
    m.trainers = [...((r.trainers as Trainer[]) ?? []), ...(seatTrainer && seatTrainer !== me ? [seatTrainer] : [])].filter((t) => t && t !== me);
    m.npcs = ((r.npcs as Trainer[]) ?? []).filter(Boolean);
    m.wilds = ((r.wilds as Mon[]) ?? []).filter(Boolean);
    m.darkrai = (r.darkrai as Mon | null) ?? null;
    m.darkraiPortal = (r.darkraiPortal as Match['darkraiPortal']) ?? null;
    m.items = (r.items as Match['items']) ?? [];
    m.throws = (r.throws as Match['throws']) ?? [];
    m.duels = ((r.duels as Match['duels']) ?? []).filter(Boolean);
    Object.assign(m.darkness, r.darkness as object);
    m.lightZones = (r.lightZones as Match['lightZones']) ?? [];
    m.outposts = (r.outposts as Match['outposts']) ?? [];
    m.chests = (r.chests as Match['chests']) ?? [];
    const ch = (r.challenge as Match['challenge']) ?? null;
    m.challenge = ch && ch.npc ? ch : null;
    m.shops = ((r.shops as Match['shops']) ?? []).filter((s) => s && s.npc);
    const v = r.visitors as Obj;
    const vis = m.visitors as unknown as Obj;
    vis.portal = v.portal ?? null;
    vis.hoopa = v.hoopa ?? null;
    vis.hoopaUsed = !!v.hoopaUsed;
    vis.merchant = v.merchant ? { npc: v.merchant, goal: null, wait: 0 } : null;
    vis.ace = v.ace ? { npc: v.ace, goal: null, wait: 0 } : null;
    vis.aceState = v.aceState ?? 'idle';
    vis.aceFoe = v.aceFoe ?? null;
    vis.aceReadyAt = v.aceReadyAt ?? 0;
    m.radar = (r.radar as Match['radar']) ?? [];
  }

  /** The browser's step: send the keys and cursor, glide, animate, drift the storm's motes. */
  step(dt: number, input: Input): void {
    const m = this.match;
    const axis = input.moveAxis();
    const aim = m.aim ?? { x: 0, y: 0 };
    m.moveX = axis.x;
    m.moveY = axis.y;
    m.time += dt;
    m.ground.update(dt);
    for (const o of [...m.allTrainers, ...m.npcs, ...m.renderMons()] as unknown as Obj[]) {
      o.px = o.x;
      o.py = o.y;
    }
    // This step's keys: numbered, walked here at once (prediction), and sent three steps at a time.
    const f: [number, number, number] = [++this.seq, Math.round(axis.x * 1000) / 1000, Math.round(axis.y * 1000) / 1000];
    if (!this.observe) this.outbox.push(f);
    const av = this.observe ? null : this.pickAvatar();
    if (av !== this.avatar) {
      this.avatar = av;
      this.pending = [];
      if (av) {
        // It was gliding toward the server's spot: that spot is where the server has it.
        const g = this.glides.get(av);
        if (g) {
          for (const k of Object.keys(g.to)) av[k] = g.to[k];
          this.glides.delete(av);
        }
        this.auth = { o: av, x: av.x as number, y: av.y as number, dir: av.dir };
      } else this.auth = null;
    }
    if (av) {
      this.pending.push({ seq: f[0], mx: f[1], my: f[2] });
      if (this.pending.length > 120) this.pending.shift();
      this.walk(av, f[1], f[2], dt, true);
    }
    if (this.trace && av) {
      this.trace.push({ k: 'step', t: performance.now(), x: av.x as number, y: av.y as number, mx: f[1], seq: f[0] });
      this.hist.set(f[0], { x: av.x as number, y: av.y as number });
      if (this.hist.size > 400) this.hist.delete(this.hist.keys().next().value as number);
    }
    if (this.outbox.length >= 3) {
      this.net.send({ t: 'in', f: this.outbox, ax: Math.round(aim.x * 100) / 100, ay: Math.round(aim.y * 100) / 100 });
      this.outbox = [];
    }
    this.correction *= Math.exp(-dt * 2);
    for (const [o, g] of this.glides) {
      g.t += dt;
      const k = Math.min(1, g.t / g.d);
      for (const key of Object.keys(g.to)) o[key] = (g.from[key] ?? 0) + ((g.to[key] ?? 0) - (g.from[key] ?? 0)) * k;
      if (k >= 1) this.glides.delete(o);
    }
    const fainting = new Set(m.battle.fainting.map((f) => f.mon));
    for (const mon of m.renderMons()) {
      if (!mon.anim || fainting.has(mon)) continue;
      mon.anim.dir = mon.dir;
      if (mon.status !== 'freeze') mon.anim.update(dt);
    }
    m.battle.stepFainting(dt);
    // Ground items bob on their own (the server sends their timer once).
    for (const it of m.items) it.bob += dt;
    // Cooldowns run down between updates, so the move buttons count smoothly.
    for (const mon of m.player.party) for (let i = 0; i < mon.cooldowns.length; i++) mon.cooldowns[i] = Math.max(0, (mon.cooldowns[i] ?? 0) - dt);
    this.stepMotes(dt);
  }

  /**
   * What this player's movement keys move right now, when the browser can walk it the same way the
   * server will: their Pokémon in a battle or in Pokémon mode, else their trainer. Nothing while it
   * is busy (casting, dodging, asleep, knocked back): then it simply follows the server.
   */
  private pickAvatar(): Obj | null {
    const m = this.match;
    const p = m.player;
    if (!p.alive || p.downUntil !== undefined || m.seat.outcome) return null;
    let mon: Mon | null = null;
    const d = m.playerDuel;
    if (d && d.state !== 'over') mon = (d.a.trainer === p ? d.a : d.b).mon;
    else if (m.controlled) mon = m.controlled;
    if (mon) {
      if (mon.casting || mon.dodge || mon.leap || mon.lunge || mon.knock || mon.status === 'sleep' || mon.status === 'freeze' || mon.fainted || mon.visual.scale < 1) return null;
      return mon as unknown as Obj;
    }
    if (d || m.fishing) return null;
    return p as unknown as Obj;
  }

  /** The opponent closest to the reticle (within AIM_PICK tiles), as drawn here. */
  private aimedFoe(lead: Mon): Mon | null {
    const m = this.match;
    const a = m.aim;
    if (!a) return null;
    let best: Mon | null = null;
    let bd = AIM_PICK;
    for (const c of m.mons()) {
      if (c === lead || c.fainted || !m.battle.isEnemy(lead, c)) continue;
      const d = Math.hypot(c.x - a.x, c.y - a.y);
      if (d < bd) {
        bd = d;
        best = c;
      }
    }
    return best;
  }

  /** One step of the avatar under the keys, exactly as the server steps it. */
  private walk(o: Obj, mx: number, my: number, dt: number, animate: boolean): void {
    const m = this.match;
    if (isMon(o)) {
      const mon = o as unknown as Mon;
      const moved = mx || my ? m.walkSteered(mon, mx, my, dt) : 0;
      if (animate) {
        const walking = moved > 1e-4;
        if (walking !== mon.moving || (walking && mon.anim.action !== 'Walk')) {
          mon.moving = walking;
          mon.anim.play(walking ? 'Walk' : 'Idle');
        }
      }
      return;
    }
    const t = o as unknown as Trainer;
    const moved = mx || my ? m.walkTrainer(t, mx, my, dt) : 0;
    // The server pushes a trainer out of anyone they walk into; so does the prediction.
    m.separate(t);
    if (animate) m.afterTrainerMove(t, moved);
  }

  /**
   * An update came in: the avatar is where the server had it after frame `ack`. Replay the frames
   * sent since on top of that, and show the result; a small difference eases in, a big one snaps.
   */
  private reconcile(ack: number, shown: { x: number; y: number; moving: unknown; walkPhase: unknown } | null): void {
    const o = this.avatar;
    this.ack = Math.max(this.ack, ack);
    this.pending = this.pending.filter((f) => f.seq > this.ack);
    if (!o || !shown) return;
    const sx = o.x as number;
    const sy = o.y as number;
    for (const f of this.pending) this.walk(o, f.mx, f.my, 1 / 60, false);
    // The walk cycle runs here; the server's copy of it would make it stutter.
    o.moving = shown.moving;
    if (shown.walkPhase !== undefined) o.walkPhase = shown.walkPhase;
    const rx = o.x as number;
    const ry = o.y as number;
    if (this.trace) (this.trace as unknown as Array<Record<string, unknown>>).push({ k: 'replay', shownX: shown.x, shownY: shown.y, sx, sy, rx, ry, ack: this.ack, nz: this.pending.length });
    const ex = (o.x as number) - shown.x;
    const ey = (o.y as number) - shown.y;
    const err = Math.hypot(ex, ey);
    this.correction = Math.max(this.correction, err);
    const h = this.hist.get(this.ack);
    this.trace?.push({ k: 'fix', t: performance.now(), x: o.x as number, y: o.y as number, err, seq: this.ack, sx, sy, cx: h?.x, cy: h?.y, n: this.pending.length });
    if (err < 0.6) {
      // Most of the way to the corrected spot now, the rest as more updates come in.
      o.x = shown.x + ex * 0.35;
      o.y = shown.y + ey * 0.35;
    }
    o.px = o.x;
    o.py = o.y;
  }

  /** Dust drifting through the dark part of the screen (only drawn; the server has none). */
  private stepMotes(dt: number): void {
    const m = this.match;
    const p = m.player;
    for (let i = m.motes.length - 1; i >= 0; i--) {
      const mo = m.motes[i] as (typeof m.motes)[number];
      mo.x += mo.vx * dt;
      mo.y += mo.vy * dt;
      mo.life -= dt;
      if (mo.life <= 0 || !m.isDark(mo.x, mo.y)) m.motes.splice(i, 1);
    }
    if (!Number.isFinite(m.darkness.radius) || m.motes.length >= 90) return;
    for (let k = 0; k < 3; k++) {
      const x = p.x + (Math.random() - 0.5) * 14;
      const y = p.y + (Math.random() - 0.5) * 8;
      if (m.isDark(x, y)) m.motes.push({ x, y, vx: (Math.random() - 0.5) * 0.5, vy: -0.05 - Math.random() * 0.3, life: 2 + Math.random() * 3, size: 0.03 + Math.random() * 0.06 });
    }
  }

  /** Every way the screen changes the match goes to the server instead. */
  private installCommands(): void {
    const m = this.match as unknown as Record<string, unknown> & Match;
    const net = this.net;
    const proto = Match.prototype;
    const seat = () => this.match.seat;
    Object.defineProperty(m, 'auto', {
      get: () => seat().auto,
      set: (v: boolean) => {
        seat().auto = v;
        net.cmd('auto', v);
      },
    });
    m.step = (dt: number, input?: Input) => {
      if (input) this.step(dt, input);
    };
    m.playerCast = (slot: number) => {
      const lead = m.actingMon;
      if (!lead) return 'no-lead';
      if (lead.status === 'sleep' || lead.status === 'freeze') return 'asleep';
      if ((lead.cooldowns[slot] ?? 0) > 0) return 'cooldown';
      // Lag compensation: name the opponent under the reticle as this screen shows it (a little behind
      // the server); the server aims at where that opponent really is.
      const t = this.aimedFoe(lead);
      if (t) net.cmd('cast', slot, t.id);
      else net.cmd('cast', slot);
      return 'cast';
    };
    m.playerDodge = () => {
      net.cmd('dodge');
      return 'ok';
    };
    m.takeControl = (mon: Mon) => {
      if (mon.owner !== m.player || mon.fainted || mon.stowed) return false;
      net.cmd('take', mon.id);
      return true;
    };
    m.releaseControl = () => net.cmd('untake');
    m.pickLock = (mon: Mon) => {
      seat().lockTarget = mon;
      net.cmd('pickLock', mon.id);
    };
    m.cycleLock = () => {
      net.cmd('cycleLock');
      return seat().lockTarget;
    };
    const say = (c: Parameters<MirrorNet['cmd']>[0], ...a: Array<number | string | boolean | null>) => {
      net.cmd(c, ...a);
      return '';
    };
    m.swapLead = (i: number) => (net.cmd('swapLead', i), true);
    m.unequip = (_t: Trainer, i: number) => say('unequip', i);
    m.answerLearn = (i: number) => say('learn', i);
    m.release = (i: number) => say('release', i);
    m.megaEvolve = () => say('mega');
    m.toggleRide = () => say('ride');
    m.sell = (_t: Trainer, tab: 'items' | 'held', i: number) => say('sell', tab, i);
    m.buy = (_shop: unknown, i: number) => say('buy', i);
    m.deposit = (_t: Trainer, tab: 'items' | 'held', i: number) => say('deposit', tab, i);
    m.withdraw = (_t: Trainer, i: number) => say('withdraw', i);
    m.pickUp = () => (net.cmd('pickUp'), true);
    m.duelPick = (i: number) => say('duelPick', i);
    m.stylerLoop = (mon: Mon) => net.cmd('stylerLoop', mon.id);
    m.stylerBreak = (mon: Mon) => net.cmd('stylerBreak', mon.id);
    m.snag = (i: number) => say('snag', i);
    m.extractWithVoucher = (slot: number, i: number) => say('extract', slot, i);
    m.teach = (_t: Trainer, slot: number, replace: number) => say('teach', slot, replace);
    m.equip = (_t: Trainer, slot: number) => say('equip', slot);
    m.useItem = (_t: Trainer, slot: number) => say('useItem', slot);
    m.throwBall = (_t: Trainer, slot: number, to: { x: number; y: number }) => (net.cmd('throw', slot, Math.round(to.x * 100) / 100, Math.round(to.y * 100) / 100), true);
    m.startChallenge = () => say('interact');
    m.healAtHealer = () => say('interact');
    const vis = m.visitors as unknown as Record<string, unknown>;
    vis.challengeAce = () => say('interact');
    vis.askHoopa = () => say('interact');
    void proto;
    void CONFIG;
  }
}
