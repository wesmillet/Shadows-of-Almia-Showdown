/**
 * PROTOTYPE (scaling-lab branch): repeatable playtest scenarios for comparing level scaling.
 *
 * Open /scenarios.html, or /?scenario=<id>&scaling=current|p&seed=<n>. The player's team and the
 * opponents are set exactly (species, levels; moves are the ones each species knows at that level,
 * the same under both scalings), the storm is held off, no other wild Pokémon, trainers or items
 * come near, and the same seed gives the opponents the same dice. A trainer battle starts by
 * itself a second in; in an open-world fight the wild Pokémon come at you.
 */
import type { Match } from './match';
import { move } from './data';
import type { Mon, Trainer } from './entities';

/** [dex, level, moves?] */
export type Entry = [string, number, string[]?];

export interface Scenario {
  id: string;
  title: string;
  kind: 'trainer' | 'wild';
  stage: 'early' | 'middle' | 'late';
  /** One line on what it shows. */
  about: string;
  you: Entry[];
  foe: Entry[];
}

export const SCENARIOS: Scenario[] = [
  { id: 'even-early', title: 'Even, early: Pikachu 10 vs Shinx 10', kind: 'trainer', stage: 'early', about: 'Two level-10 starters; Shinx is a little stronger. How much does play decide?', you: [['0025', 10]], foe: [['0403', 10]] },
  { id: 'type-even', title: 'Type disadvantage, even: Charmeleon 20 vs Wartortle 20', kind: 'trainer', stage: 'middle', about: 'You are weak to its Water moves at equal level.', you: [['0005', 20]], foe: [['0008', 20]] },
  { id: 'small-gap', title: 'Small gap: your Luxio 22 vs Luxio 25', kind: 'trainer', stage: 'middle', about: 'Same species, 3 levels down.', you: [['0404', 22]], foe: [['0404', 25]] },
  { id: 'level-vs-type', title: 'Level vs type: your Charmeleon 30 vs Wartortle 20', kind: 'trainer', stage: 'middle', about: '10 levels up, but weak to its moves. Today the levels win; under P it is closer.', you: [['0005', 30]], foe: [['0008', 20]] },
  { id: 'type-vs-level', title: 'Type vs level: your Wartortle 20 vs Charmeleon 30', kind: 'trainer', stage: 'middle', about: 'The same battle from the other side: 10 levels down, with the type edge.', you: [['0008', 20]], foe: [['0005', 30]] },
  { id: 'big-gap', title: 'Big gap: your Staraptor 30 vs Luxray 40', kind: 'trainer', stage: 'middle', about: '10 levels down and the matchup against you. Expected to lose; how long do you last, and how much can you do?', you: [['0398', 30]], foe: [['0405', 40]] },
  { id: 'late-even', title: 'Late, even: Garchomp 55 vs Charizard 55', kind: 'trainer', stage: 'late', about: 'Two strong Pokémon at equal level.', you: [['0445', 55]], foe: [['0006', 55]] },
  { id: 'late-gap', title: 'Late gap: your Charizard 50 vs Garchomp 60', kind: 'trainer', stage: 'late', about: '10 levels down late in a match.', you: [['0006', 50]], foe: [['0445', 60]] },
  { id: 'reserves', title: 'Reserves: your three level 25 vs one Luxray 35', kind: 'trainer', stage: 'middle', about: 'In a trainer battle they come out one at a time.', you: [['0404', 25], ['0397', 25], ['0008', 25]], foe: [['0405', 35]] },
  { id: 'gang-up', title: 'Outnumbering: your three level 25 vs a wild Luxray 35', kind: 'wild', stage: 'middle', about: 'In the open two of yours fight at once, the third waits in reserve.', you: [['0404', 25], ['0397', 25], ['0008', 25]], foe: [['0405', 35]] },
  { id: 'outnumbered', title: 'Outnumbered: your Luxray 30 vs three wild level 25', kind: 'wild', stage: 'middle', about: 'One strong Pokémon against a pack.', you: [['0405', 30]], foe: [['0404', 25], ['0397', 25], ['0008', 25]] },
  { id: 'early-wild', title: 'Early wild above you: Pikachu 10 + Starly 10 vs wild Shinx 16', kind: 'wild', stage: 'early', about: 'A starter team meets a wild six levels up.', you: [['0025', 10], ['0396', 10]], foe: [['0403', 16]] },
  { id: 'sleep', title: 'Sleep: two Gengar 30 (Hypnosis) vs wild Luxray 38', kind: 'wild', stage: 'middle', about: 'Sleep now ends on the first damaging hit. Add &sleep=old to the address to compare with the old sleep.', you: [['0094', 30, ['hypnosis', 'shadow-ball']], ['0094', 30, ['hypnosis', 'shadow-ball']]], foe: [['0405', 38]] },
];

export function scenarioById(id: string | null): Scenario | null {
  return SCENARIOS.find((s) => s.id === id) ?? null;
}

/** What the playtest overlay shows. */
export interface ScenarioRun {
  scenario: Scenario;
  you: Mon[];
  foe: Mon[];
  /** Match time the fighting started (first hit either way), and when one side was all down. */
  startedAt: number | null;
  endedAt: number | null;
  result: 'won' | 'lost' | null;
  /** Moves each side got off (casts), for "how much could the weaker side do". */
  casts: { you: number; foe: number };
}

function openSpot(m: Match): { x: number; y: number } {
  const g = m.ground;
  for (let r = 0; r < 160; r += 2) for (let a = 0; a < 6.28; a += 0.2) {
    const x = Math.floor(m.centerX + Math.cos(a) * (40 + r));
    const y = Math.floor(m.centerY + Math.sin(a) * (40 + r));
    let ok = true;
    for (let dy = -8; dy <= 8 && ok; dy++) for (let dx = -8; dx <= 8 && ok; dx++) if (dx * dx + dy * dy <= 64 && !(g.walkable(x + dx, y + dy) && g.reachable(x + dx, y + dy))) ok = false;
    if (ok) return { x: x + 0.5, y: y + 0.5 };
  }
  return { x: m.centerX + 40, y: m.centerY };
}

/** Sets up `sc` in a freshly made match (the player's seat is the player). */
export function applyScenario(m: Match, sc: Scenario): ScenarioRun {
  const spot = openSpot(m);
  const p = m.player;
  const make = (owner: Trainer | null, [dex, level, moves]: Entry, x: number, y: number): Mon => {
    const mon = m.makeMon(dex, level, owner, x, y);
    if (moves) {
      mon.moves = moves;
      mon.cooldowns = moves.map(() => 0);
    }
    return mon;
  };
  p.x = p.px = spot.x - 2.5;
  p.y = p.py = spot.y;
  p.items = p.items.map(() => null);
  p.party = sc.you.map((e) => make(p, e, p.x, p.y));
  m.placeParty(p);
  p.duelReadyAt = Infinity;
  const rivals = m.trainers.filter((t) => t !== p);
  const foeTrainer = sc.kind === 'trainer' ? rivals[0] ?? null : null;
  // Everyone else is set aside: no team, far off, never acting (as if knocked down for good).
  for (const t of rivals) {
    if (t === foeTrainer) continue;
    t.party = [];
    t.downUntil = Infinity;
    t.x = t.px = 2;
    t.y = t.py = 2;
  }
  let foe: Mon[] = [];
  if (foeTrainer) {
    foeTrainer.x = foeTrainer.px = spot.x + 2.5;
    foeTrainer.y = foeTrainer.py = spot.y;
    foeTrainer.items = foeTrainer.items.map(() => null);
    foeTrainer.party = sc.foe.map((e) => make(foeTrainer, e, foeTrainer.x, foeTrainer.y));
    m.placeParty(foeTrainer);
    foeTrainer.duelReadyAt = Infinity;
    foe = foeTrainer.party;
    m.wilds = [];
  } else {
    foe = sc.foe.map((e, i) => {
      const w = make(null, e, spot.x + 2 + (i % 2), spot.y - 1 + i);
      w.homeX = w.x;
      w.homeY = w.y;
      return w;
    });
    m.wilds = [...foe];
  }
  m.items = [];
  const run: ScenarioRun = { scenario: sc, you: p.party, foe, startedAt: null, endedAt: null, result: null, casts: { you: 0, foe: 0 } };
  const t0 = m.time;
  let duelStarted = false;
  const hold = (): void => {
    m.darkness.radius = m.darkness.targetRadius = 999;
    m.darkness.nextPulseIn = 1e9;
  };
  hold();
  // Wraps this match's step: the storm held off before it, the tally after it (the screen empties
  // the event list once the step is drawn).
  const step = m.step.bind(m);
  m.step = (dt, input) => {
    hold();
    step(dt, input);
    after();
  };
  const after = (): void => {
    // Nothing else wanders in.
    m.wilds = m.wilds.filter((w) => foe.includes(w) || Math.hypot(w.x - spot.x, w.y - spot.y) > 40);
    if (foeTrainer && !duelStarted && m.time - t0 > 1) {
      duelStarted = true;
      m.startDuel(p, foeTrainer);
    }
    for (const e of m.battle.events) {
      if (e.type === 'cast' && e.attacker.owner === p) run.casts.you++;
      else if (e.type === 'cast' && foe.includes(e.attacker)) run.casts.foe++;
      if (e.type === 'hit' && run.startedAt === null && (foe.includes(e.target) || foe.includes(e.attacker))) run.startedAt = m.time;
    }
    if (run.result) return;
    const down = (list: Mon[]) => list.length > 0 && list.every((x) => x.fainted || x.captured);
    if (down(foe)) run.result = 'won';
    else if (down(run.you)) run.result = 'lost';
    if (run.result) run.endedAt = m.time;
  };
  return run;
}

/** PROTOTYPE: Thunder and Stone Edge back to their timing on the fixes branch (?nowarn=1), to compare. */
export function unwarnMoves(): void {
  for (const id of ['thunder', 'stone-edge']) {
    const d = move(id) as { warn?: number; fx?: Array<{ anchor: string; delay?: number }> };
    const w = d.warn ?? 0;
    if (!w) continue;
    d.warn = undefined;
    for (const part of d.fx ?? []) if (part.anchor === 'target' && part.delay !== undefined) {
      const back = +(part.delay - w).toFixed(3);
      if (back > 0) part.delay = back;
      else delete part.delay;
    }
  }
}
