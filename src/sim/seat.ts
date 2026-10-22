/**
 * A seat: one human player in a match, with everything that is theirs alone (what they steer,
 * where they aim, their ball target, fishing line, move-learn prompts, Snag offer, result).
 *
 * A match has one seat offline (you) and up to eight on the game server. Match keeps a current
 * seat and its per-player fields (match.player, match.controlled, match.aim, ...) read and write
 * the current seat, so the single-player code runs unchanged for whichever seat is being stepped
 * or is acting (Match.withSeat).
 */
import type { Mon, Trainer } from './entities';
import type { FishingState } from './fishing';

export type MatchOutcome = null | 'win' | 'loss';

export interface Seat {
  trainer: Trainer;
  /** Movement keys this step (-1..1 each). */
  moveX: number;
  moveY: number;
  /**
   * Online: movement keys the browser sent, one per simulation step, numbered. The server applies
   * one each step and tells the browser the number of the last it used (`ack`), so the browser can
   * walk its own trainer ahead and only correct the difference (src/net/mirror.ts).
   */
  inputs: Array<[number, number, number]>;
  ack: number;
  /** Steps the server ran on the last keys while no new ones had arrived (skipped when they come). */
  ahead: number;
  /** The last keys received (held for a few steps when the next are late). */
  held: [number, number];
  aim: { x: number; y: number } | null;
  auto: boolean;
  autoTimer: number;
  lockTarget: Mon | null;
  lockPicked: boolean;
  controlled: Mon | null;
  fishing: FishingState | null;
  handoffUntil: number;
  sparedNotice: Mon | null;
  pendingLearn: Array<{ mon: Mon; moveId: string }>;
  snagOffer: { from: Trainer } | null;
  outcome: MatchOutcome;
}

export function newSeat(trainer: Trainer): Seat {
  return {
    trainer, moveX: 0, moveY: 0, inputs: [], ack: 0, ahead: 0, held: [0, 0], aim: null, auto: true, autoTimer: 0, lockTarget: null, lockPicked: false,
    controlled: null, fishing: null, handoffUntil: 0, sparedNotice: null, pendingLearn: [], snagOffer: null, outcome: null,
  };
}
