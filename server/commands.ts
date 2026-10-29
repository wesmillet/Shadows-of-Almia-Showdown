/**
 * A player's commands, run on the real match as that player's seat. Each one calls the same Match
 * method the offline game calls, so cooldowns, money, bag contents and party rules are enforced
 * there; this file adds the checks the offline screen used to make before calling (standing at the
 * shop, the ball within throwing range, the styler loop within reach) and rejects bad arguments.
 */
import { CONFIG } from '../src/sim/data';
import type { Mon } from '../src/sim/entities';
import { hookOrReel, startFishing, canFish } from '../src/sim/fishing';
import type { Match } from '../src/sim/match';
import type { CommandName } from '../src/net/protocol';
import type { Seat } from '../src/sim/seat';

type Arg = number | string | boolean | null;

/** Whole number in [lo, hi], or null. */
function int(v: Arg | undefined, lo: number, hi: number): number | null {
  return typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi ? v : null;
}

function num(v: Arg | undefined): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** A Pokémon by id among those the match has (wilds, parties, Darkrai). */
function monById(m: Match, id: Arg | undefined): Mon | null {
  if (typeof id !== 'number') return null;
  for (const x of m.mons()) if (x.id === id) return x;
  return null;
}

/**
 * How far an aimed-at opponent may be from the aim and still count: the aim pick (1.6 tiles) plus
 * how far a fast Pokémon runs in a quarter second of lag.
 */
const AIM_SLACK = 1.6 + 6 * 0.25;

const STYLER_COOLDOWN = 0.2;
const lastStyler = new WeakMap<Seat, number>();

/**
 * Something an honest browser never sends (it checks the same things before sending): a ball thrown
 * past its range, someone else's Pokémon, a made-up target. Each is refused anyway; flags are how
 * the moderators hear about who keeps trying (server/room.ts adds them up).
 */
export type Flag = (kind: string, detail: string) => void;

/** Runs one command; returns the message to show the player ('' for none). */
export function runCommand(m: Match, seat: Seat, c: CommandName, a: Arg[], flag: Flag = () => {}): string {
  if (m.over || seat.outcome || !seat.trainer.alive) return '';
  return m.withSeat(seat, () => command(m, seat, c, a, flag));
}

function command(m: Match, seat: Seat, c: CommandName, a: Arg[], flag: Flag): string {
  const p = seat.trainer;
  const tab = (v: Arg | undefined): 'items' | 'held' | null => (v === 'items' || v === 'held' ? v : null);
  const bag = CONFIG.items.inventorySize;
  switch (c) {
    case 'cast': {
      const slot = int(a[0], 0, 3);
      if (slot === null) return '';
      // Lag compensation: the browser names the opponent it aimed at, drawn where it was a moment
      // ago. If it is near the aim (as far as it could have moved since), aim at where it is now.
      const foe = monById(m, a[1]);
      const lead = m.actingMon;
      const aim = seat.aim;
      // Naming a foe far from where you aimed: an aimbot's tell (an honest browser names the one under the reticle).
      if (foe && aim && Math.hypot(foe.x - aim.x, foe.y - aim.y) > AIM_SLACK * 2.5) flag('aim-claim', `${foe.name} ${Math.hypot(foe.x - aim.x, foe.y - aim.y).toFixed(1)} tiles from the aim`);
      let r: ReturnType<Match['playerCast']>;
      if (foe && lead && aim && foe !== lead && !foe.fainted && m.battle.isEnemy(lead, foe) && Math.hypot(foe.x - aim.x, foe.y - aim.y) <= AIM_SLACK) {
        seat.aim = { x: foe.x, y: foe.y };
        r = m.playerCast(slot);
        seat.aim = aim;
      } else r = m.playerCast(slot);
      return r === 'asleep' ? 'Your Pokémon is asleep' : '';
    }
    case 'dodge': {
      const r = m.playerDodge();
      return r === 'cooldown' ? 'Dodge not ready' : '';
    }
    case 'auto':
      if (typeof a[0] === 'boolean') m.auto = a[0];
      return '';
    case 'take': {
      const mon = monById(m, a[0]);
      if (mon && mon.owner !== p) flag('not-yours', `tried to steer ${mon.name}`);
      return mon && mon.owner === p && m.takeControl(mon) ? `Pokémon mode: you steer ${mon.name}. Esc or click your trainer to go back` : '';
    }
    case 'untake':
      if (m.controlled) m.releaseControl();
      return '';
    case 'pickLock': {
      const mon = monById(m, a[0]);
      if (mon) m.pickLock(mon);
      return '';
    }
    case 'cycleLock': {
      const t = m.cycleLock();
      return t ? `Ball target: ${t.name}` : 'No wild Pokémon in range';
    }
    case 'swapLead': {
      const i = int(a[0], 0, 11);
      return i !== null && m.swapLead(i) ? '' : '';
    }
    case 'behavior': {
      const i = int(a[0], 0, 11);
      if (i !== null) m.cycleBehavior(i);
      return '';
    }
    case 'unequip': {
      const i = int(a[0], 0, 11);
      return i === null ? '' : m.unequip(p, i);
    }
    case 'learn': {
      const i = int(a[0], -1, 3);
      return i === null ? '' : m.answerLearn(i);
    }
    case 'release': {
      const i = int(a[0], 0, 11);
      return i === null ? '' : m.release(i);
    }
    case 'mega':
      return m.megaEvolve(p);
    case 'ride':
      return m.toggleRide();
    case 'sell': {
      const t = tab(a[0]);
      const i = int(a[1], 0, bag - 1);
      if (!t || i === null) return '';
      if (m.nearService()?.kind !== 'shop') {
        flag('shop-range', 'sold away from a shop');
        return 'Walk up to a shop first';
      }
      return m.sell(p, t, i);
    }
    case 'buy': {
      const s = m.nearService();
      const i = int(a[0], 0, 40);
      if (s?.kind !== 'shop') flag('shop-range', 'bought away from a shop');
      if (s?.kind !== 'shop' || i === null) return s?.kind === 'shop' ? '' : 'Walk up to a shop first';
      return m.buy(s.shop, i);
    }
    case 'deposit': {
      const t = tab(a[0]);
      const i = int(a[1], 0, bag - 1);
      if (!t || i === null) return '';
      if (m.nearService()?.kind !== 'chest') return 'Walk up to a storage chest first';
      return m.deposit(p, t, i);
    }
    case 'withdraw': {
      const i = int(a[0], 0, 200);
      if (i === null) return '';
      if (m.nearService()?.kind !== 'chest') return 'Walk up to a storage chest first';
      return m.withdraw(p, i);
    }
    case 'interact':
      return interact(m);
    case 'pickUp':
      m.pickUp();
      return '';
    case 'duelPick': {
      const i = int(a[0], 0, 11);
      return i === null ? '' : m.duelPick(i);
    }
    case 'stylerLoop':
    case 'stylerBreak': {
      const mon = monById(m, a[0]);
      if (!mon || !mon.wild) return '';
      if (!m.hasStyler(p)) {
        flag('styler-none', 'styler loop without a Capture Styler');
        return '';
      }
      const d = Math.hypot(mon.x - p.x, mon.y - p.y);
      if (d > CONFIG.styler.maxRange + 2) {
        flag('styler-range', `${d.toFixed(1)} tiles`);
        return '';
      }
      // The loop is drawn in the browser; a believable pace is all it may claim.
      const last = lastStyler.get(seat) ?? -Infinity;
      if (c === 'stylerLoop' && m.time - last < STYLER_COOLDOWN) {
        flag('styler-pace', `${((m.time - last) * 1000).toFixed(0)} ms between loops`);
        return '';
      }
      lastStyler.set(seat, m.time);
      if (c === 'stylerLoop') m.stylerLoop(mon);
      else m.stylerBreak(mon);
      return '';
    }
    case 'snag': {
      const i = int(a[0], 0, 11);
      return i === null ? '' : m.snag(i);
    }
    case 'extract': {
      const slot = int(a[0], 0, bag - 1);
      const i = int(a[1], 0, 11);
      return slot === null || i === null ? '' : m.extractWithVoucher(slot, i);
    }
    case 'teach': {
      const slot = int(a[0], 0, bag - 1);
      const r = int(a[1], -1, 3);
      // the Pokémon it was dragged onto (-1 or absent: the lead)
      const target = a[2] === undefined ? -1 : int(a[2], -1, 11);
      return slot === null || r === null || target === null ? '' : m.teach(p, slot, r, target);
    }
    case 'equip': {
      const slot = int(a[0], 0, bag - 1);
      const target = a[1] === undefined ? -1 : int(a[1], -1, 11);
      return slot === null || target === null ? '' : m.equip(p, slot, target);
    }
    case 'useItem': {
      const slot = int(a[0], 0, bag - 1);
      const target = a[1] === undefined ? -1 : int(a[1], -1, 11);
      return slot === null || target === null ? '' : m.useItem(p, slot, target);
    }
    case 'discard': {
      const t = tab(a[0]);
      const i = int(a[1], 0, bag - 1);
      if (!t || i === null) return '';
      const list = t === 'held' ? p.held : p.items;
      list[i] = null;
      return '';
    }
    case 'throw':
      return throwBall(m, seat, a, flag);
    default:
      return '';
  }
}

/** Space: fishing first, then whoever is in reach (Celeste, Hoopa, the challenger, a healer), else pick up or cast a line. */
function interact(m: Match): string {
  if (m.fishing) return hookOrReel(m);
  const who = m.visitors.near();
  if (who === 'ace') return m.visitors.challengeAce();
  if (who === 'hoopa') return m.visitors.askHoopa();
  const folkCrew = m.visitors.folk;
  const folk = folkCrew?.near();
  if (folkCrew && folk) return folkCrew.talk(folk);
  const s = m.nearService();
  if (s?.kind === 'challenge') return m.startChallenge();
  if (s?.kind === 'healer') return m.healAtHealer();
  // Shops and chests open on the player's own screen; nothing to do here.
  if (s?.kind === 'shop' || s?.kind === 'chest') return '';
  if (m.nearestItem()) {
    m.pickUp();
    return '';
  }
  if (canFish(m)) return startFishing(m);
  m.pickUp();
  return '';
}

/** A ball: at the legendary in your bout (any distance), else at a spot within throwing range. */
function throwBall(m: Match, seat: Seat, a: Arg[], flag: Flag): string {
  const p = seat.trainer;
  const slot = int(a[0], 0, CONFIG.items.inventorySize - 1);
  const x = num(a[1]);
  const y = num(a[2]);
  if (slot === null || x === null || y === null) return '';
  const legend = m.legendBoutFoe() ?? m.shadowBoutFoe();
  if (legend) {
    if (m.throws.some((th) => th.thrower === p && th.phase !== 'done')) return 'Wait for the ball to settle';
    m.throwBall(p, slot, { x: legend.x, y: legend.y }, legend);
    return '';
  }
  if (p.duelId) return "You can't catch another trainer's Pokémon";
  if (Math.hypot(x - p.x, y - p.y) > CONFIG.catch.throwRange + 0.5) {
    if (Math.hypot(x - p.x, y - p.y) > CONFIG.catch.throwRange + 3) flag('throw-range', `${Math.hypot(x - p.x, y - p.y).toFixed(1)} tiles`);
    return 'Out of range';
  }
  m.throwBall(p, slot, { x, y });
  return '';
}
