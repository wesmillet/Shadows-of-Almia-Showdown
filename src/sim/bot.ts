/**
 * A computer trainer's hands: the things a player does with the mouse and keys, done by the rules
 * a player plays by.
 *
 *   - Its starter: three rolled from the new-player pool at the same odds a player rolls them
 *     (src/sim/starters.ts), and it keeps one of the three.
 *   - Its lead: fires the best ready move the moment it can, only when the move would reach (range,
 *     a clear line), and dashes out of a telegraph now and then, as a player at the keys would.
 *   - Catching: a wild worth having is worn down, its team holds back once it is weak (as Catch mode
 *     does for a player), and it throws its best ball for the job from within throwing range, one
 *     ball at a time, with no homing.
 *   - Its bag: potions and revives when they are needed, a status cured, X items in a trainer
 *     battle, Rare Candies, evolution stones, held items and TMs put to use, through the same calls
 *     a player's clicks make (Match.useItem, equip, teach).
 *   - Shops: out of balls (or with a Pokémon a stone would evolve) and the money, it goes to a stall
 *     and buys them, by Match.buy.
 */
import type { Rng } from '../core/rng';
import { dirFromVector } from '../core/math';
import { BattleSystem, expectedDamage, moveReach } from './battle';
import { ballModifier, catchChance } from './catching';
import { CONFIG, MOVE_SLOTS, SPECIES, canLearnTm, move, pickMoves } from './data';
import type { BotState, Mon, Trainer } from './entities';
import { incapable, lead } from './entities';
import { stoneEvolution } from './evolution';
import { ITEMS } from './items';
import { baseDex, megaFormOf } from './mega';
import { isRoaming } from './party';
import { starterChoices } from './starters';
import type { Shop } from './town';
import type { Match } from './match';

/** Base stats total (how a trainer ranks the starters it is offered). */
function bst(dex: string): number {
  const s = SPECIES.get(dex)?.stats;
  return s ? s.hp + s.atk + s.def + s.spa + s.spd + s.spe : 0;
}

/** A new trainer's starter: one of three rolled from the new-player pool. */
export function botStarter(rng: Rng): string {
  const offered = starterChoices(rng.int(1, 2 ** 30));
  // Half the time the strongest; otherwise whichever it fancies (players don't all pick by stats).
  return rng.chance(0.5) ? offered.reduce((a, b) => (bst(b) > bst(a) ? b : a)) : rng.pick(offered);
}

export function botState(t: Trainer): BotState {
  return (t.bot ??= { catchTarget: null, balls: 0, bagT: 0, boosted: new Set(), used: 0, thrown: 0 });
}

/** Balls in the bag, by slot. */
function ballSlots(t: Trainer): number[] {
  const out: number[] = [];
  t.items.forEach((s, i) => {
    if (s && ITEMS[s.id]?.kind === 'ball') out.push(i);
  });
  return out;
}

/** Balls a trainer carries in all. */
export function ballCount(t: Trainer): number {
  return t.items.reduce((n, s) => n + (s && ITEMS[s.id]?.kind === 'ball' ? s.count : 0), 0);
}

/** Whether a trainer would try to catch this wild Pokémon: room, a ball, and a Pokémon worth a slot. */
export function wantsCatch(match: Match, t: Trainer, w: Mon): boolean {
  if (!w.wild || w.fainted || w.captured || w.legend || w.npc || w.shadow || w.boss || w.aura) return false;
  if (t.party.length >= match.partyCap || ballCount(t) === 0) return false;
  const team = t.party.filter((m) => !m.captured);
  const top = team.reduce((a, m) => Math.max(a, m.level), 1);
  // A small team takes almost anything that will keep up; a fuller one only new lines that pull their weight.
  if (team.length < 3) return w.level >= top - 3;
  const line = baseDex(w.dex);
  if (team.some((m) => baseDex(m.megaFrom?.dex ?? m.dex) === line)) return false;
  return w.level >= top - 4 || !!w.alpha;
}

/** The ball to throw at `w` now: the one with the best odds, a Master Ball only for an Alpha. */
function bestBall(match: Match, t: Trainer, w: Mon): { slot: number; chance: number } | null {
  let best: { slot: number; chance: number } | null = null;
  for (const slot of ballSlots(t)) {
    const id = t.items[slot]?.id as string;
    if (ITEMS[id]?.special === 'master' && !w.alpha) continue;
    const mod = ballModifier(id, {
      target: w, thrower: t, matchTime: match.time,
      inWater: match.ground.inWater(Math.floor(w.x), Math.floor(w.y)), inDark: match.isDark(w.x, w.y),
    });
    const chance = catchChance(w, (w.calm ?? 0) > 0 ? mod * CONFIG.styler.catchMultiplier : mod);
    // The cheapest ball that does about as well: keep the good ones for hard catches.
    if (!best || chance > best.chance + 0.04) best = { slot, chance };
  }
  return best;
}

/** The trainer's catch target is still on: it exists, is wild and in reach of a hunt. */
function catchOn(st: BotState, t: Trainer): Mon | null {
  const w = st.catchTarget;
  if (!w || !w.wild || w.fainted || st.balls >= 6 || ballCount(t) === 0) return null;
  if (Math.hypot(w.x - t.x, w.y - t.y) > CONFIG.trainers.huntRange + 6) return null;
  return w;
}

/** Sets (or clears) the wild Pokémon a trainer is out to catch. */
export function setCatchTarget(t: Trainer, w: Mon | null): void {
  const st = botState(t);
  if (st.catchTarget !== w) {
    st.catchTarget = w;
    st.balls = 0;
  }
}

/**
 * The catch target, once weak: the team holds back from it (its hits would knock it out), like a
 * player's team in Catch mode.
 */
export function spares(attacker: Mon, target: Mon): boolean {
  const t = attacker.owner;
  if (!t || t.isPlayer || !target.wild) return false;
  return t.bot?.catchTarget === target && target.hp < target.maxHp * 0.25;
}

/** A ball, if the catch target is weak enough, in range, and no ball of this trainer's is in the air. */
function tryThrow(match: Match, t: Trainer): void {
  const st = botState(t);
  const w = catchOn(st, t);
  if (!w) {
    if (st.catchTarget && (st.catchTarget.fainted || !st.catchTarget.wild || st.balls >= 6 || ballCount(t) === 0)) setCatchTarget(t, null);
    return;
  }
  if (w.captured || match.throws.some((th) => th.thrower === t && th.phase !== 'done')) return;
  const d = Math.hypot(w.x - t.x, w.y - t.y);
  if (d > CONFIG.catch.throwRange - 0.5 || match.duelOf(t)) return;
  const pick = bestBall(match, t, w);
  if (!pick) return;
  // Weak (the team is holding back), or a ball good enough to try already (a Quick Ball at the start).
  const weak = w.hp < w.maxHp * 0.25;
  if (!weak && pick.chance < 0.5) return;
  // Thrown where it stands now: a ball lands where it was aimed (a moving target can be missed).
  if (match.throwBall(t, pick.slot, { x: w.x, y: w.y })) {
    st.balls++;
    st.thrown++;
  }
}

/** Bag slot of the first item matching. */
function slotOf(t: Trainer, pred: (id: string) => boolean): number {
  return t.items.findIndex((s) => !!s && pred(s.id));
}

/** Uses bag item `slot` on party member `target` the way a player's drag onto its card does. */
function use(match: Match, t: Trainer, slot: number, target: Mon): boolean {
  const i = t.party.indexOf(target);
  if (i < 0) return false;
  const before = t.items[slot]?.count ?? 0;
  const id = t.items[slot]?.id;
  match.useItem(t, slot, i);
  const used = (t.items[slot]?.count ?? 0) < before || t.items[slot]?.id !== id;
  if (used) botState(t).used++;
  return used;
}

/**
 * The bag, looked through every second or so: healing when it is needed (the Pokémon fighting first),
 * cures, revives, Rare Candies, stones, held items and TMs.
 */
function manageBag(match: Match, t: Trainer, fighting: Mon | null): void {
  const team = t.party.filter((m) => !m.captured);
  const def = (id: string) => ITEMS[id];
  // Healing: the fighting Pokémon under half HP, or anyone under a third out of a fight.
  const hurt = [fighting, ...team].find((m) => m && !m.fainted && m.hp < m.maxHp * (m === fighting ? 0.5 : 0.34));
  if (hurt) {
    const missing = hurt.maxHp - hurt.hp;
    // The smallest potion that covers most of it (no Hyper Potion on a scratch).
    const heals = t.items
      .map((s, i) => ({ s, i }))
      .filter((x) => x.s && def(x.s.id)?.kind === 'heal')
      .sort((a, b) => (def(a.s!.id)?.amount ?? 0) - (def(b.s!.id)?.amount ?? 0));
    const pick = heals.find((x) => (def(x.s!.id)?.amount ?? 0) >= missing * 0.7) ?? heals.at(-1);
    if (pick && use(match, t, pick.i, hurt)) return;
  }
  // Revive: one down and no healer about to put it right.
  const down = team.find((m) => m.fainted && !match.battle.fainting.some((f) => f.mon === m));
  if (down && (fighting || !match.outposts.some((o) => Math.hypot(o.x - t.x, o.y - t.y) < 15))) {
    const slot = slotOf(t, (id) => def(id)?.kind === 'revive');
    if (slot >= 0 && use(match, t, slot, down)) return;
  }
  // A status that hurts or stops it fighting.
  const sick = [fighting, ...team].find((m) => m && !m.fainted && m.status && (m === fighting || m.status === 'poison' || m.status === 'burn'));
  if (sick) {
    const slot = slotOf(t, (id) => def(id)?.kind === 'cure');
    if (slot >= 0 && use(match, t, slot, sick)) return;
  }
  // X items: once for each Pokémon sent out in a trainer battle, when it hits with that stat.
  const st = botState(t);
  if (fighting && match.duelOf(t) && !st.boosted.has(fighting.id) && fighting.hp > fighting.maxHp * 0.6) {
    const physical = fighting.moves.some((id) => move(id).category === 'physical' && move(id).power > 0);
    const slot = slotOf(t, (id) => def(id)?.kind === 'boost' && (def(id)?.stat !== 'atk' || physical));
    if (slot >= 0) {
      st.boosted.add(fighting.id);
      if (use(match, t, slot, fighting)) return;
    }
  }
  if (fighting) return;
  // Out of a fight: Rare Candies on the lowest level (it catches up), stones where they evolve something.
  const candy = slotOf(t, (id) => def(id)?.kind === 'candy');
  const low = team.filter((m) => !m.fainted && !m.evolving && m.level < 100).sort((a, b) => a.level - b.level)[0];
  if (candy >= 0 && low && use(match, t, candy, low)) return;
  for (let slot = 0; slot < t.items.length; slot++) {
    const s = t.items[slot];
    if (!s || def(s.id)?.kind !== 'stone') continue;
    const who = team.find((m) => !m.fainted && !m.evolving && !m.mega && stoneEvolution(m.species, s.id));
    if (who && use(match, t, slot, who)) return;
  }
  gear(match, t, team);
}

/** Which member suits a held item best (null: nobody, or it is worse than what they hold). */
function holder(team: Mon[], id: string): Mon | null {
  const def = ITEMS[id];
  if (!def) return null;
  const free = team.filter((m) => !m.heldItem && !m.fainted);
  const best = (xs: Mon[], key: (m: Mon) => number) => xs.slice().sort((a, b) => key(b) - key(a))[0] ?? null;
  switch (def.effect) {
    case 'mega': {
      const who = team.find((m) => megaFormOf(m.dex)?.stone === id && m.heldItem !== id);
      return who ?? null;
    }
    case 'type-boost':
      return best(free.filter((m) => m.moves.some((mv) => move(mv).type === def.boostType && move(mv).power > 0)), (m) => m.level);
    case 'choice-band':
      return best(free.filter((m) => m.stats.atk >= m.stats.spa), (m) => m.stats.atk);
    case 'exp-share':
    case 'lucky-egg':
      return best(free, (m) => -m.level);
    default:
      return best(free, (m) => m.level);
  }
}

/** Held items onto the members they suit; TMs taught where they beat a move it knows. */
function gear(match: Match, t: Trainer, team: Mon[]): void {
  for (let slot = 0; slot < t.held.length; slot++) {
    const s = t.held[slot];
    if (!s) continue;
    const def = ITEMS[s.id];
    if (def?.kind === 'hold') {
      const who = holder(team, s.id);
      if (who) {
        match.equip(t, slot, t.party.indexOf(who));
        return;
      }
    } else if (def?.kind === 'tm' && def.move) {
      const mv = def.move;
      for (const m of team) {
        if (m.moves.includes(mv) || !canLearnTm(m.species, mv)) continue;
        const keep = pickMoves(m.species, [...m.moves, mv]);
        if (!keep.includes(mv)) continue;
        const old = m.moves.find((id) => !keep.includes(id));
        const replace = m.moves.length < MOVE_SLOTS ? 0 : old ? m.moves.indexOf(old) : -1;
        if (replace < 0) continue;
        match.teach(t, slot, replace, t.party.indexOf(m));
        return;
      }
    }
  }
}

/** Evolution stones a trainer's team could use now (a member that evolves with it). */
function stonesWanted(t: Trainer): Set<string> {
  const out = new Set<string>();
  for (const m of t.party) {
    if (m.captured || m.mega) continue;
    for (const e of m.species.evolves ?? []) if (e.item && SPECIES.has(e.to) && !t.items.some((s) => s?.id === e.item)) out.add(e.item);
  }
  return out;
}

/** What a stall has that the trainer wants: balls when it has none, a stone that evolves one of its team. */
function wants(t: Trainer, shop: Shop, reserve: number, cap: number): boolean {
  const stones = stonesWanted(t);
  const needBalls = ballCount(t) === 0 && t.party.length < cap;
  return shop.stock.some((e) => t.money - e.price >= reserve && ((ITEMS[e.id]?.kind === 'ball' && needBalls) || stones.has(e.id)));
}

/** The stall a trainer wants to visit, if any is within reach: no balls left, or a stone for its team. */
export function shopFor(match: Match, t: Trainer): Shop | null {
  if (!match.shops.length) return null;
  let best: Shop | null = null;
  let bd = 70;
  for (const s of match.shops) {
    if (!wants(t, s, 200, match.partyCap)) continue;
    const d = Math.hypot(s.npc.x - t.x, s.npc.y - t.y);
    if (d < bd) {
      bd = d;
      best = s;
    }
  }
  return best;
}

/** At a stall: the stone its team needs, then a few of the cheapest balls, keeping money for a heal. */
export function shopAt(match: Match, t: Trainer, shop: Shop): void {
  const keep = 200;
  const stones = stonesWanted(t);
  shop.stock.forEach((e, i) => {
    if (stones.has(e.id) && t.money - e.price >= keep) match.buy(shop, i, t);
  });
  if (ballCount(t) > 0 || t.party.length >= match.partyCap) return;
  const balls = shop.stock.map((e, i) => ({ e, i })).filter((x) => ITEMS[x.e.id]?.kind === 'ball').sort((a, b) => a.e.price - b.e.price);
  const cheap = balls[0];
  if (!cheap) return;
  for (let n = 0; n < 6 && t.money - cheap.e.price >= keep; n++) match.buy(shop, cheap.i, t);
}

/** Bag, balls: every second or so (not in a trainer battle: duelHands does those). */
export function botTick(match: Match, t: Trainer, dt: number): void {
  const st = botState(t);
  // A player's Pokémon start on Attack; so do a bot's (Guard would leave its team out of its fights).
  for (const m of t.party) if (!m.captured && !isRoaming(m) && m.behavior !== 'aggressive' && !m.duelId) m.behavior = 'aggressive';
  tryThrow(match, t);
  st.bagT -= dt;
  if (st.bagT > 0) return;
  st.bagT = match.rng.range(0.7, 1.2);
  const l = lead(t);
  manageBag(match, t, l && l.target && BattleSystem.active(l.target) ? l : null);
}

/** In a trainer battle: the bag for the Pokémon out (potions, cures, X items). */
export function duelHands(match: Match, t: Trainer, out: Mon | null, dt: number): void {
  const st = botState(t);
  st.bagT -= dt;
  if (st.bagT > 0 || !out || out.fainted) return;
  st.bagT = match.rng.range(0.8, 1.4);
  manageBag(match, t, out);
}

/** Starts a fresh trainer battle's record (X items used). */
export function duelBegins(t: Trainer): void {
  if (t.bot) t.bot.boosted.clear();
}

/**
 * The lead, played like a player at the keys: it turns to what it is fighting and fires the best
 * move that is ready and would land, the moment it is ready (a short reaction, no long pause), and
 * dashes out of a telegraph now and then. Its teammates fight on their own like a player's.
 */
export function pilotLead(match: Match, t: Trainer): void {
  const m = lead(t);
  if (!m || m.casting || m.channel || incapable(m) || m.steered || m.visual.scale < 1 || m.evolving) return;
  const foe = m.target && BattleSystem.active(m.target) && match.battle.isEnemy(m, m.target) ? m.target : null;
  if (!foe || match.sparing(m, foe)) return;
  if (!m.dodge && (m.dodgeCd ?? 0) <= 0 && match.inHostileTelegraph(m)) {
    if (match.rng.chance(CONFIG.dodge.aiChance)) {
      const side = match.rng.chance(0.5) ? 1 : -1;
      match.startDodge(m, -(foe.y - m.y) * side, (foe.x - m.x) * side);
      return;
    }
    m.dodgeCd = 1;
  }
  if (m.busy > 0.3) m.busy = 0.3;
  if (m.busy > 0) return;
  const slot = match.battle.chooseMove(m, foe, true);
  if (slot < 0) return;
  m.dir = dirFromVector(foe.x - m.x, foe.y - m.y, m.dir);
  m.anim.dir = m.dir;
  if (match.battle.castToward(m, slot, foe.x, foe.y, moveReach(move(m.moves[slot] as string)) + 1, foe)) {
    m.busy = match.rng.range(0.15, 0.35);
  }
}

/** Expected damage of the best move a Pokémon has against another (for tests and the report). */
export function bestHit(a: Mon, b: Mon): number {
  return Math.max(0, ...a.moves.map((id) => expectedDamage(a, b, move(id))));
}
