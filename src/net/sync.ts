/**
 * State sync for online matches: the server keeps the real match; each browser keeps a mirror of
 * the part it can see and draws it with the ordinary match screen.
 *
 * The encoder walks a per-player "view" object graph (built by server/view.ts) and sends, per
 * object, only the fields that changed since that player last heard about it. Objects are
 * identified by a stable number; a field that points at another object is sent as { '#': id }.
 * Objects that leave the view are listed in `drop`. Anything new the simulation grows (a new field
 * on a Pokémon, a new kind of effect) syncs without touching this file.
 *
 * Pokémon get two special cases: their sprite set and animation player never travel (the mirror
 * rebuilds them from `dex`/`shiny`), and the animation is sent as [action, loop, play counter] so
 * the mirror restarts an action exactly when the server did. AI bookkeeping is not sent.
 */

/** A patch: object id -> changed fields (`$k` marks an array: then fields are indices plus length). */
export interface SyncPatch {
  /** Root object id. */
  root: number;
  set: Record<number, Record<string, unknown>>;
  /** Ids that are no longer in this player's view. */
  drop: number[];
}

/** Fields of a Pokémon the browser never needs (AI internals, timers it does not draw). */
const MON_SKIP = new Set([
  'species', 'sprites', 'anim', 'homeX', 'homeY', 'targetX', 'targetY', 'idleTimer', 'wander', 'wanderPause', 'roamTarget',
  'stuckT', 'chaseBlockId', 'chaseBlockT', 'detourSide', 'detourT', 'sinceHit', 'everHit', 'castSeq', 'orbPaid', 'busy',
  'statusTimer', 'outsideDark', 'shadowStormT', 'leftoversT', 'snagHinted', 'px', 'py',
]);
/** Fields of a trainer the browser never needs. */
const TRAINER_SKIP = new Set(['ai', 'aiTimer', 'aiTarget', 'aiKey', 'aiProgress', 'aiBans', 'attackTimer', 'roamTimer', 'counter', 'px', 'py']);
/** Fields only the trainer's own player may see. */
const TRAINER_PRIVATE = new Set(['items', 'held', 'storage', 'money', 'stats']);

export function isMon(o: object): boolean {
  return 'dex' in o && 'cooldowns' in o && 'stats' in o;
}

/** A trainer (not by its bag: other players' bags are never sent, so their mirrors have none). */
export function isTrainer(o: object): boolean {
  return 'party' in o && 'isPlayer' in o && 'role' in o;
}

/** Numbers travel at 1/1000 (positions in tiles: plenty for drawing, and fewer digits on the wire). */
const PRECISION = 1000;

/**
 * Fields sent only when an object first appears: they change every step in a way the mirror can
 * follow by itself (a ground item's bob timer: the mirror advances it).
 */
const ONCE = new Set(['bob']);

interface AnimLike {
  action: string;
  loop: boolean;
  time: number;
}

/**
 * Server side: one encoder per connected player. `encode(view)` returns the patch that brings that
 * player's mirror up to date.
 */
export class SyncEncoder {
  /** Ids for objects (shared by every encoder on the server, so ids mean the same thing for all). */
  private readonly precision: number;

  /** `precision`: numbers are rounded to 1/precision (replays use 100: they are watched, not played). */
  constructor(private readonly ids: IdTable, private owner: object | null = null, opts: { precision?: number } = {}) {
    this.precision = opts.precision ?? PRECISION;
  }

  private round(v: number): number {
    return Math.round(v * this.precision) / this.precision;
  }

  /** What this player was last sent: id -> encoded fields. */
  private sent = new Map<number, Record<string, unknown>>();
  /** Animation play counters per Pokémon (bumped when the server restarts an action). */
  private static plays = new WeakMap<object, { action: string; time: number; n: number }>();

  /** Sets `owner` (this player's trainer) after the match starts. */
  setOwner(t: object): void {
    this.owner = t;
  }

  /**
   * `visible`: the Pokémon and trainers this player may know about; a reference to any other
   * travels as null (so one far-off target does not pull half the map along).
   */
  encode(view: object, visible?: Set<object>): SyncPatch {
    this.visible = visible ?? null;
    const seen = new Set<number>();
    const set: SyncPatch['set'] = {};
    const stack: object[] = [view];
    const rootId = this.ids.id(view);
    while (stack.length) {
      const o = stack.pop() as object;
      const id = this.ids.id(o);
      if (seen.has(id)) continue;
      seen.add(id);
      const enc = this.encodeObject(o, stack);
      const prev = this.sent.get(id);
      if (prev) for (const k of ONCE) if (k in prev && k in enc) enc[k] = prev[k];
      const diff: Record<string, unknown> = {};
      let changed = false;
      for (const k in enc) {
        const v = enc[k];
        if (!prev || !same(prev[k], v)) {
          diff[k] = v;
          changed = true;
        }
      }
      if (prev) {
        for (const k in prev) {
          if (!(k in enc)) {
            diff[k] = null;
            diff[`~${k}`] = 1;
            changed = true;
          }
        }
      }
      if (changed || !prev) set[id] = diff;
      this.sent.set(id, enc);
    }
    const drop: number[] = [];
    for (const id of this.sent.keys()) {
      if (!seen.has(id)) {
        drop.push(id);
        this.sent.delete(id);
      }
    }
    return { root: rootId, set, drop };
  }

  private visible: Set<object> | null = null;

  /**
   * An event for this player, or null when it names a Pokémon, trainer or battle they cannot see
   * (call after encode, so this tick's new objects already count as known). Static data (moves)
   * travels by id; everything else by value.
   */
  encodeEvent(ev: object): Record<string, unknown> | null {
    let ok = true;
    const enc = (v: unknown, depth: number): unknown => {
      if (v === null || v === undefined || typeof v !== 'object') return typeof v === 'number' ? this.round(v) : v;
      const o = v as Record<string, unknown>;
      if (isMon(o) || isTrainer(o) || ('a' in o && 'b' in o && 'cx' in o)) {
        const id = this.ids.id(o);
        if (!this.sent.has(id)) ok = false;
        return { '#': id };
      }
      if (typeof o.id === 'string' && 'power' in o && 'cooldown' in o) return { $move: o.id };
      if (depth > 4) return null;
      if (Array.isArray(o)) return o.map((x) => enc(x, depth + 1));
      const out: Record<string, unknown> = {};
      for (const k of Object.keys(o)) out[k] = enc(o[k], depth + 1);
      return out;
    };
    const out = enc(ev, 0) as Record<string, unknown>;
    return ok ? out : null;
  }

  private encodeObject(o: object, stack: object[]): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    const ref = (v: unknown): unknown => {
      if (v === null || v === undefined) return v ?? null;
      if (typeof v === 'number') return Number.isFinite(v) ? this.round(v) : v > 0 ? 'Inf' : v < 0 ? '-Inf' : 'NaN';
      if (typeof v === 'string' || typeof v === 'boolean') return v;
      if (typeof v === 'function') return undefined;
      if (typeof v === 'object') {
        const proto = Object.getPrototypeOf(v);
        // Plain objects and arrays travel; class instances (sprites, maps of the ground...) do not.
        if (proto !== Object.prototype && proto !== Array.prototype && proto !== null) return undefined;
        if (this.visible && !this.visible.has(v as object) && (isMon(v as object) || isTrainer(v as object))) return null;
        stack.push(v as object);
        return { '#': this.ids.id(v as object) };
      }
      return undefined;
    };
    if (Array.isArray(o)) {
      out.$k = 1;
      out.length = o.length;
      for (let i = 0; i < o.length; i++) {
        const v = ref(o[i]);
        if (v !== undefined) out[i] = v;
      }
      return out;
    }
    const mon = isMon(o);
    const trainer = !mon && isTrainer(o);
    const mine = trainer && o === this.owner;
    for (const k of Object.keys(o)) {
      if (mon && MON_SKIP.has(k)) continue;
      if (trainer && (TRAINER_SKIP.has(k) || (!mine && TRAINER_PRIVATE.has(k)))) continue;
      // A field set to undefined is a field that is not there (t.downUntil = undefined after a
      // respawn): it travels as a deletion, never as null (null would read as still set).
      if ((o as Record<string, unknown>)[k] === undefined) continue;
      const v = ref((o as Record<string, unknown>)[k]);
      if (v !== undefined) out[k] = v;
    }
    if (mon) {
      const a = (o as { anim?: AnimLike }).anim;
      if (a) {
        let p = SyncEncoder.plays.get(o);
        if (!p) SyncEncoder.plays.set(o, (p = { action: a.action, time: a.time, n: 0 }));
        if (p.action !== a.action || a.time < p.time) p.n++;
        p.action = a.action;
        p.time = a.time;
        out.$anim = `${a.action}|${a.loop ? 1 : 0}|${p.n}`;
      }
    }
    if (trainer) {
      const c = (o as { counter?: { x: number; y: number } | null }).counter;
      if (c) out.$counter = `${this.round(c.x)},${this.round(c.y)}`;
    }
    return out;
  }
}

function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a && b && typeof a === 'object' && typeof b === 'object') return (a as { '#'?: number })['#'] === (b as { '#'?: number })['#'] && (a as { '#'?: number })['#'] !== undefined;
  return false;
}

/** Stable ids for objects, shared by everything on one server. */
export class IdTable {
  private map = new WeakMap<object, number>();
  private next = 1;
  id(o: object): number {
    let n = this.map.get(o);
    if (n === undefined) {
      n = this.next++;
      this.map.set(o, n);
    }
    return n;
  }
}

/**
 * Browser side: applies patches to a table of mirror objects. `hydrate` is called for each new
 * object once its first fields are in (the match mirror turns Pokémon into drawable ones there),
 * and `animate` when a Pokémon's animation changes.
 */
export class SyncDecoder {
  readonly objects = new Map<number, Record<string, unknown>>();
  root: Record<string, unknown> | null = null;

  constructor(
    private readonly hooks: {
      hydrate?: (o: Record<string, unknown>) => void;
      animate?: (o: Record<string, unknown>, action: string, loop: boolean, restart: boolean) => void;
      counter?: (o: Record<string, unknown>, x: number, y: number) => void;
    } = {},
  ) {}

  apply(p: SyncPatch): void {
    const fresh: Array<Record<string, unknown>> = [];
    // First make sure every object exists, so references between new objects resolve.
    for (const key of Object.keys(p.set)) {
      const id = Number(key);
      if (!this.objects.has(id)) {
        const f = p.set[id] as Record<string, unknown>;
        const o = (f.$k ? [] : {}) as Record<string, unknown>;
        this.objects.set(id, o);
        fresh.push(o);
      }
    }
    for (const key of Object.keys(p.set)) {
      const id = Number(key);
      const o = this.objects.get(id) as Record<string, unknown>;
      const f = p.set[id] as Record<string, unknown>;
      for (const k of Object.keys(f)) {
        if (k === '$k' || k.startsWith('~')) continue;
        if (f[`~${k}`]) {
          delete o[k];
          continue;
        }
        if (k === '$anim') {
          const [action, loop, n] = String(f[k]).split('|');
          const prevN = o.$animN as string | undefined;
          o.$animN = n;
          this.hooks.animate?.(o, action as string, loop === '1', prevN !== undefined && prevN !== n);
          continue;
        }
        if (k === '$counter') {
          const [x, y] = String(f[k]).split(',').map(Number);
          this.hooks.counter?.(o, x as number, y as number);
          continue;
        }
        if (k === 'length' && Array.isArray(o)) {
          (o as unknown as unknown[]).length = f[k] as number;
          continue;
        }
        o[k] = this.value(f[k]);
      }
    }
    for (const o of fresh) this.hooks.hydrate?.(o);
    for (const id of p.drop) this.objects.delete(id);
    this.root = this.objects.get(p.root) ?? this.root;
  }

  /** An event as sent by SyncEncoder.encodeEvent, with references resolved (null if one is gone). */
  decodeEvent(e: Record<string, unknown>, moveById: (id: string) => unknown): Record<string, unknown> | null {
    let ok = true;
    const dec = (v: unknown): unknown => {
      if (v === null || typeof v !== 'object') return v;
      const o = v as Record<string, unknown>;
      if ('#' in o) {
        const got = this.objects.get(o['#'] as number);
        if (!got) ok = false;
        return got ?? null;
      }
      if ('$move' in o) return moveById(o.$move as string);
      if (Array.isArray(o)) return o.map(dec);
      const out: Record<string, unknown> = {};
      for (const k of Object.keys(o)) out[k] = dec(o[k]);
      return out;
    };
    const out = dec(e) as Record<string, unknown>;
    return ok ? out : null;
  }

  private value(v: unknown): unknown {
    if (v === 'Inf') return Infinity;
    if (v === '-Inf') return -Infinity;
    if (v === 'NaN') return NaN;
    if (v && typeof v === 'object' && '#' in (v as object)) return this.objects.get((v as { '#': number })['#']) ?? null;
    return v;
  }
}
