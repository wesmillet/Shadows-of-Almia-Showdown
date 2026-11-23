/**
 * Steven: the Hoenn Champion, battled in the stadium (src/sim/stadium.ts) after a match is won.
 *
 * When the match comes down to one human playing alone, Steven may invite them (CONFIG.steven.chance,
 * only where the server allows it: Match.stevenEnabled). The winner's result waits while they answer:
 * accepting brings them to the stadium's south tunnel, their team restored; Steven waits at the north
 * end. He sends out six Hoenn Pokémon at a fixed level (CONFIG.steven.level), his ace last and higher
 * (aceLevel). Worn down to
 * half its HP the ace heals to full and changes into its limited form: new types, stronger, bigger
 * (Match.stepChampionMon, Match.stepEvolutions). Now and then (allFormsChance) all six start in their
 * limited forms. Beating him sends the ace's limited form to the winner's PC. Losing is friendly: the
 * team is patched up and the win stands. Either way the match then ends with the win.
 *
 * On every server unless switched off (STEVEN=0); offline, in tester mode or with ?steven=1.
 */
import { CONFIG, SPECIES } from './data';
import type { Mon, Trainer } from './entities';
import type { Duel, Match } from './match';
import type { Seat } from './seat';

/** His team, as in Pokémon Omega Ruby and Alpha Sapphire. */
export const STEVEN_TEAM = ['0227', '0344', '0306', '0346', '0348', '0376'] as const;

/** Each one's limited form (assets/pokemon/<dex>, made for this game). */
export const LIMITED_FORM: Record<string, string> = {
  '0227': '0227-glacier', // Glacier Skarmory, Ice/Flying
  '0344': '0344-moon', // Moonstone Claydol, Dark/Psychic
  '0306': '0306-moss', // Mossback Aggron, Steel/Grass
  '0346': '0346-abyss', // Abyssal Cradily, Water/Rock
  '0348': '0348-amber', // Amber Armaldo, Ground/Rock
  '0376': '0376-molten', // Molten Metagross, Steel/Fire
};

export type StevenState = 'none' | 'invite' | 'intro' | 'battle' | 'outro' | 'done';

export interface StevenConfig {
  chance: number;
  /** His team's level, the same for every challenger. */
  level: number;
  /** His ace's level. */
  aceLevel: number;
  maxLevel: number;
  allFormsChance: number;
  transformAt: number;
  transformStats: number;
  transformScale: number;
  prizeLevel: number;
  healBefore: boolean;
  inviteSeconds: number;
  introSeconds: number;
  outroSeconds: number;
  look: string;
  aceItem: string;
  /** How often his Pokémon dash out of a telegraph, by phase (a legendary's are 0.55, 0.7, 0.85). */
  dodge?: number[];
}

export function stevenConfig(): StevenConfig {
  return (CONFIG as typeof CONFIG & { steven: StevenConfig }).steven;
}

export class StevenChallenge {
  state: StevenState = 'none';
  /** Seconds in the current state. */
  t = 0;
  /** The winner he challenged. */
  who: Trainer | null = null;
  /** Steven himself (a trainer standing at the stadium's north end). */
  host: Trainer | null = null;
  /** The Pokémon he sends out last, and what it becomes. */
  ace: Mon | null = null;
  aceBase = '';
  /** All six in their limited forms from the start (the rare version). */
  allForms = false;
  result: 'won' | 'lost' | 'declined' | null = null;
  /** What the winner takes home (beating him). */
  prize: { dex: string; name: string; level: number } | null = null;
  private duel: Duel | null = null;

  constructor(private readonly m: Match) {}

  /** Seconds left to answer the invitation (for the screen). */
  get inviteLeft(): number {
    return this.state === 'invite' ? Math.max(0, stevenConfig().inviteSeconds - this.t) : 0;
  }

  /**
   * The match is won by `seat` (Match.settleOutcome asks before giving them the win). True while the
   * win has to wait for Steven: an invitation is open, or the battle and its outro are under way.
   */
  holds(seat: Seat): boolean {
    if (this.state === 'done') return false;
    if (this.state !== 'none') return seat.trainer === this.who;
    const m = this.m;
    const t = seat.trainer;
    if (!m.stevenEnabled || !t.alive || t.team !== undefined || !t.party.some((x) => !x.captured)) {
      this.state = 'done';
      return false;
    }
    if (!m.rng.chance(stevenConfig().chance)) {
      this.state = 'done';
      return false;
    }
    this.who = t;
    this.setState('invite');
    m.withSeat(t, () => m.battle.events.push({ type: 'steven', stage: 'invite' }));
    return true;
  }

  /** The winner's answer (Space or the button: yes; Esc: no). Unanswered, the invitation is accepted. */
  answer(accept: boolean): string {
    if (this.state !== 'invite') return '';
    if (!accept) {
      this.result = 'declined';
      this.setState('done');
      return 'Steven: "Another time, then. Congratulations on your win."';
    }
    this.begin();
    return '';
  }

  private setState(s: StevenState): void {
    this.state = s;
    this.t = 0;
  }

  step(dt: number): void {
    if (this.state === 'none' || this.state === 'done') return;
    const c = stevenConfig();
    this.t += dt;
    const m = this.m;
    const p = this.who;
    if (!p) return;
    if (this.state === 'invite' && this.t >= c.inviteSeconds) this.begin();
    else if (this.state === 'intro') {
      // Both walk to their ends of the field while the screen introduces him.
      this.holdSpots();
      if (this.t >= c.introSeconds) this.startBattle();
    } else if (this.state === 'battle') {
      const d = this.duel;
      if (!d || d.state === 'over') this.onDuelEnd(d?.winner ?? null);
    } else if (this.state === 'outro' && this.t >= c.outroSeconds) {
      if (this.host) {
        this.host.alive = false;
        m.trainers = m.trainers.filter((x) => x !== this.host);
      }
      this.setState('done');
    }
  }

  /** In the stadium: Steven and the challenger keep to their spots until the battle starts. */
  private holdSpots(): void {
    const st = this.m.stadium;
    const p = this.who;
    if (!st || !p) return;
    p.x = p.px = st.playerSpot.x;
    p.y = p.py = st.playerSpot.y;
    p.dir = 4;
    p.moving = false;
    // The team waits in its balls for the battle.
    for (const mon of p.party) {
      if (mon.captured || mon.stowed) continue;
      mon.stowed = true;
      mon.target = null;
      mon.moving = false;
    }
    if (this.host) {
      this.host.x = this.host.px = st.stevenSpot.x;
      this.host.y = this.host.py = st.stevenSpot.y;
      this.host.dir = 0;
      this.host.moving = false;
    }
  }

  /** Accepted: off to the stadium. */
  private begin(): void {
    const m = this.m;
    const p = this.who as Trainer;
    const st = m.stadium;
    const c = stevenConfig();
    if (!st) {
      this.setState('done');
      return;
    }
    st.look = (['colosseum', 'cavern', 'league'].includes(c.look) ? c.look : 'colosseum') as typeof st.look;
    if (m.controlled) m.releaseControl();
    if (p.mount) m.dismount(p, true);
    p.x = p.px = st.playerSpot.x;
    p.y = p.py = st.playerSpot.y;
    p.aiTarget = null;
    for (const mon of p.party) {
      if (mon.captured) continue;
      m.battle.interrupt(mon);
      mon.target = null;
      mon.recall = false;
      if (c.healBefore) {
        mon.fainted = false;
        mon.hp = mon.maxHp;
        m.battle.cureStatus(mon);
        mon.drowsy = 0;
        mon.anim.play('Idle', { restart: true });
      }
      mon.stowed = true;
      mon.x = mon.px = p.x;
      mon.y = mon.py = p.y;
    }
    const host = m.makeTrainer('Steven', 'steven', false, st.stevenSpot.x, st.stevenSpot.y);
    host.visitor = true;
    host.champion = true;
    host.dir = 0;
    this.host = host;
    this.buildTeam(host, p);
    for (const mon of host.party) mon.stowed = true;
    m.trainers.push(host);
    this.setState('intro');
    m.withSeat(p, () => m.battle.events.push({ type: 'steven', stage: 'intro' }));
  }

  /** Six Hoenn Pokémon at a fixed level; the ace last and higher (src/sim/steven.ts file comment). */
  private buildTeam(host: Trainer, _p: Trainer): void {
    const m = this.m;
    const c = stevenConfig();
    const team: string[] = STEVEN_TEAM.filter((d) => SPECIES.has(d));
    const aceBase = team[m.rng.int(0, team.length - 1)] as string;
    this.aceBase = aceBase;
    this.allForms = m.rng.chance(c.allFormsChance) && team.every((d) => SPECIES.has(LIMITED_FORM[d] ?? ''));
    const order = m.rng.shuffle(team.filter((d) => d !== aceBase));
    order.push(aceBase);
    host.party = [];
    for (const base of order) {
      const isAce = base === aceBase;
      const form = LIMITED_FORM[base] as string;
      const dex = this.allForms && SPECIES.has(form) ? form : base;
      const level = Math.min(c.maxLevel, isAce ? c.aceLevel : c.level);
      const mon = m.makeMon(dex, level, host, host.x, host.y + 1);
      mon.behavior = 'aggressive';
      if (isAce) {
        this.ace = mon;
        mon.heldItem = c.aceItem || null;
        // Its true form when worn down (in the rare version it is already in it: it heals and grows).
        if (SPECIES.has(form)) mon.aceForm = { to: form, done: false };
      }
      host.party.push(mon);
    }
    // The prize: the ace's limited form.
    const prizeDex = SPECIES.has(LIMITED_FORM[aceBase] ?? '') ? (LIMITED_FORM[aceBase] as string) : aceBase;
    this.prize = { dex: prizeDex, name: SPECIES.get(prizeDex)?.name ?? prizeDex, level: c.prizeLevel };
  }

  private startBattle(): void {
    const m = this.m;
    const st = m.stadium;
    const p = this.who as Trainer;
    const host = this.host as Trainer;
    if (!st) return;
    const d = m.startDuel(p, host, st.playerSpot, st.stevenSpot);
    d.bounds = { ...st.field };
    d.stadium = true;
    this.duel = d;
    this.setState('battle');
  }

  /** The battle is over: `winner` is the challenger (they beat him) or Steven or nobody. */
  onDuelEnd(winner: Trainer | null): void {
    if (this.state !== 'battle') return;
    const m = this.m;
    const p = this.who as Trainer;
    if (winner === p) {
      this.result = 'won';
      const pr = this.prize;
      if (pr) {
        const mon = m.makeMon(pr.dex, pr.level, p, p.x, p.y - 1);
        // Straight to the PC (the browser's own offline, the account's online: src/ui/matchScreen.ts, server/room.ts).
        m.withSeat(p, () => m.battle.events.push({ type: 'extracted', mon, via: 'steven' }));
      }
    } else {
      this.result = 'lost';
      // Friendly: the team is patched up.
      for (const mon of p.party) {
        if (mon.captured) continue;
        mon.fainted = false;
        mon.hp = Math.max(mon.hp, Math.round(mon.maxHp * 0.25));
        mon.status = null;
        mon.anim.play('Idle', { restart: true });
      }
      m.placeParty(p);
    }
    m.withSeat(p, () => m.battle.events.push({ type: 'steven', stage: this.result === 'won' ? 'won' : 'lost' }));
    this.setState('outro');
  }

  /**
   * The challenger left the match (or lost their connection) while he waited: the invitation or the
   * battle is off and their win stands. True when that trainer was his challenger.
   */
  abandon(t: Trainer): boolean {
    if (t !== this.who || this.state === 'none' || this.state === 'done') return false;
    const m = this.m;
    const d = this.duel;
    if (d && d.state !== 'over') {
      d.state = 'over';
      d.winner = null;
      for (const side of [d.a, d.b]) side.trainer.duelId = undefined;
    }
    if (this.host) {
      this.host.alive = false;
      m.trainers = m.trainers.filter((x) => x !== this.host);
    }
    if (!this.result) this.result = 'declined';
    this.setState('done');
    return true;
  }

  /** The challenger is in the stadium (the screen keeps the camera there, and nothing there is dark). */
  inStadium(t: Trainer | null | undefined): boolean {
    return !!t && t === this.who && (this.state === 'intro' || this.state === 'battle' || this.state === 'outro');
  }

  /** A browser's copy (src/net/mirror.ts): the server's view of the challenge. */
  mirror(v: ReturnType<StevenChallenge['view']>, m: Match): void {
    this.state = v.state;
    this.t = v.t;
    this.aceBase = v.ace;
    this.allForms = v.allForms;
    this.result = v.result as StevenChallenge['result'];
    this.prize = v.prize;
    this.who = v.who === null ? null : m.player.id === v.who ? m.player : (m.allTrainers.find((x) => x.id === v.who) ?? null);
    const st = m.stadium;
    if (st && ['colosseum', 'cavern', 'league'].includes(v.look)) st.look = v.look as typeof st.look;
  }

  /** What every browser needs to draw it (sent with each update: server/view.ts). */
  view(): { state: StevenState; t: number; who: number | null; ace: string; aceForm: string; allForms: boolean; result: string | null; prize: { dex: string; name: string; level: number } | null; look: string } {
    return {
      state: this.state, t: Math.round(this.t * 10) / 10, who: this.who?.id ?? null, ace: this.aceBase,
      aceForm: LIMITED_FORM[this.aceBase] ?? '', allForms: this.allForms, result: this.result, prize: this.prize, look: this.m.stadium?.look ?? 'colosseum',
    };
  }
}
