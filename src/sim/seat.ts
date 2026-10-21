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
    trainer, moveX: 0, moveY: 0, aim: null, auto: true, autoTimer: 0, lockTarget: null, lockPicked: false,
    controlled: null, fishing: null, handoffUntil: 0, sparedNotice: null, pendingLearn: [], snagOffer: null, outcome: null,
  };
}
