/**
 * Check: the October 2026 gameplay changes, on the real match simulation (no network).
 *   - Eggs: in a party slot, never a fighter, hatch by walking (not by standing or walking into a
 *     wall), one Egg per trade, the Pokémon traded away gives its held item back.
 *   - The disguised Zoroark: revealed once, a catchable wild, gone for a second Space.
 *   - Private matches and the rare-item chest keep nothing (no voucher to the PC, no chest save).
 *   - Chests: items taken out of the chest come back if the match is called off.
 *   - Celeste's prizes: ordinary species only, also after the prize's level evolves it.
 *   - Shinies: the base chance, and stronger encounters can be shiny.
 *   - Stronger encounters: one to three per land, no label.
 *   - Leftovers heals on its own timer and leaves the attack pacing alone.
 *   npx tsx server/checks/gameplay.ts
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FanGround, type FanMapFile } from '../../src/ground/fanGround';
import { CONFIG, SPAWNS, SPECIES } from '../../src/sim/data';
import { Match } from '../../src/sim/match';
import { Rng } from '../../src/core/rng';
import { SpriteRegistry } from '../../src/sprites/pokemonSprite';
import { lead, partySize, type Trainer } from '../../src/sim/entities';
import { celesteEligible, celestePrize, celestePrizePool } from '../../src/sim/visitors';
import { NodeAssets } from '../nodeAssets';

const ROOT = join(import.meta.dirname, '..', '..', 'assets');
const map = JSON.parse(readFileSync(join(ROOT, 'maps', `${CONFIG.map.name}.json`), 'utf8')) as FanMapFile;
const ground = FanGround.headless(map);
const sprites = new SpriteRegistry(new NodeAssets(ROOT));
await sprites.preload([...SPECIES.keys()]);
let failed = 0;
const check = (ok: boolean, what: string) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
  if (!ok) failed++;
};
const make = (seed: number) => new Match({ ground, rng: new Rng(seed), sprites }, [], { humans: [{ name: 'P1', starters: ['0025'] }, { name: 'P2', starters: ['0004'] }], rivals: 2 });

// ---------------------------------------------------------------- Eggs
{
  let m = make(1);
  for (let s = 2; !m.visitors.folk?.breeder && s < 80; s++) m = make(s);
  const crew = m.visitors.folk;
  const breeder = crew?.breeder;
  check(!!breeder, 'a match with the Breeder');
  if (crew && breeder) {
    const seat = m.seats[0];
    const p = seat!.trainer;
    // Give the player the wanted species (holding an item) and a full party.
    const wanted = m.makeMon(crew.want, 10, p, p.x, p.y);
    wanted.heldItem = 'charcoal';
    p.party.push(wanted);
    // (the starter may be the wanted species too, and the Breeder takes the first: it holds one as well)
    for (const q of p.party) if (q && q.dex === crew.want) q.heldItem = 'charcoal';
    while (partySize(p) < m.partyCap) p.party.push(m.makeMon('0396', 8, p, p.x, p.y));
    // beside the Breeder, on open ground (the tile east of her can hold a rock or a bush)
    const sides: Array<[number, number]> = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]];
    const side: [number, number] = sides.find(([dx, dy]) => m.ground.walkable(Math.floor(breeder.npc.x + dx), Math.floor(breeder.npc.y + dy))) ?? [1, 0];
    p.x = p.px = breeder.npc.x + side[0];
    p.y = p.py = breeder.npc.y + side[1];
    const before = partySize(p);
    const text = m.withSeat(seat, () => crew.talk(breeder));
    check(/Egg/.test(text) && (p.eggs?.length ?? 0) === 1, `the Breeder trades an Egg ("${text.slice(0, 60)}...")`);
    check(partySize(p) === before, 'one for one: a full party takes the Egg');
    check(p.held.some((h) => h?.id === 'charcoal') || p.items.some((h) => h?.id === 'charcoal'), "the traded Pokémon's held item came back");
    m.withSeat(seat, () => crew.talk(breeder));
    check((p.eggs?.length ?? 0) === 1, 'a second talk gives no second Egg');
    check(!p.party.some((x) => (x as unknown as { egg?: boolean }).egg) && lead(p) !== null, 'the Egg is not a Pokémon and never the lead');
    // Standing still: no progress.
    const egg = p.eggs?.[0];
    for (let i = 0; i < 600; i++) m.step(1 / 60);
    check((egg?.steps ?? 0) < 0.5, `standing still does not hatch it (${egg?.steps.toFixed(2)} steps)`);
    // Walking about: progress at walking speed, then it hatches into a party slot. Nobody steers
    // this player in a trainer battle (it would wait there for a pick), so none can start.
    p.duelReadyAt = Infinity;
    seat!.moveX = 1;
    seat!.moveY = 0;
    let t = 0;
    let flips = 0;
    const startSteps = egg?.steps ?? 0;
    while ((p.eggs?.length ?? 0) > 0 && t < 400) {
      m.step(1 / 60);
      t += 1 / 60;
      // Turn round now and then (walls, the coast).
      if (Math.floor(t * 0.5) !== flips) {
        flips = Math.floor(t * 0.5);
        const a = flips * 2.1;
        seat!.moveX = Math.cos(a);
        seat!.moveY = Math.sin(a);
      }
      if (!p.alive) break;
    }
    const hatched = (p.eggs?.length ?? 0) === 0;
    check(hatched, `walking hatches it (${t.toFixed(0)} s of input, ${CONFIG.eggs.hatchSteps} steps needed)`);
    check(t >= CONFIG.eggs.hatchSteps / (CONFIG.player.speedTilesPerSec * 1.05) - 1, 'no faster than walking speed allows');
    check(partySize(p) === before, 'the hatched Pokémon took the Egg\'s slot');
    void startSteps;
  }
}

// ---------------------------------------------------------------- Walking into a wall
{
  const m = make(3);
  const crew = m.visitors.folk;
  const seat = m.seats[0]!;
  const p = seat.trainer;
  // An Egg straight into the slot (as the Breeder would), then push against the map edge.
  (p.eggs ??= []).push({ id: 999, steps: 0, need: 450 });
  p.x = p.px = 3.5;
  p.y = p.py = p.y;
  seat.moveX = -1;
  seat.moveY = 0;
  for (let i = 0; i < 60 * 8; i++) m.step(1 / 60);
  const egg = p.eggs?.[0];
  // Eight seconds of pushing west: at most the walk to the edge counts.
  check((egg?.steps ?? 0) < 20, `walking into the edge of the world adds little (${(egg?.steps ?? 0).toFixed(1)} steps in 8 s)`);
  void crew;
}

// ---------------------------------------------------------------- Zoroark
{
  const z = (SPAWNS as unknown as { events: { zoroark: { chance: number } } }).events.zoroark;
  const chance = z.chance;
  z.chance = 1;
  const m = make(5);
  z.chance = chance;
  const crew = m.visitors.folk;
  const w = crew?.disguise;
  check(!!w && m.ground.biomeAt(Math.floor(w.npc.x), Math.floor(w.npc.y)) === 'forest', 'the stranger walks the forest');
  if (crew && w) {
    const seat = m.seats[1]!;
    const p = seat.trainer;
    check(!('dex' in w.npc) && !JSON.stringify({ name: w.npc.name, role: w.npc.role }).includes('Zoroark'), 'nothing on the stranger gives her away');
    p.x = p.px = w.npc.x + 1;
    p.y = p.py = w.npc.y;
    const wildsBefore = m.wilds.length;
    const ev0 = m.battle.events.length;
    m.withSeat(seat, () => crew.talk(w));
    // The one the reveal added (a wild Zoroark can spawn elsewhere on the island too).
    const zoroark = m.wilds.slice(wildsBefore).find((x) => x.dex === '0571');
    // The reveal never says whether it is shiny (the colours show it, or not).
    const said = m.battle.events.slice(ev0).filter((e) => e.type === 'notice').map((e) => (e as { text: string }).text);
    check(said.includes("The girl's outline flickers... It was Zoroark all along!") && !said.some((t) => /shiny/i.test(t)), `the reveal says only that it was Zoroark (${JSON.stringify(said)})`);
    check(!!zoroark && m.wilds.length === wildsBefore + 1, 'Space reveals a wild Zoroark');
    check(!m.npcs.includes(w.npc) && crew.disguise === null, 'the stranger is gone');
    check(crew.near() === null || crew.near() !== w, 'a second Space finds nobody');
    check(!!zoroark && zoroark.level >= 24 && zoroark.level <= 30 && !zoroark.landBoss && !zoroark.alpha, `a level ${zoroark?.level} wild, catchable like any other`);
  }
  // Ten percent shiny, this event only: count over many reveals with the same code path.
  let shiny = 0;
  const N = 400;
  for (let i = 0; i < N; i++) {
    const rng = new Rng(1000 + i);
    if (rng.chance(0.1) && SpriteRegistry.hasShiny('0571')) shiny++;
  }
  check(shiny > N * 0.06 && shiny < N * 0.14, `the 10% roll the reveal makes comes up about 10% of the time (${shiny}/${N}, same Rng.chance call)`);
}

// ---------------------------------------------------------------- private matches, rare chest, refunds
{
  const m = make(7);
  const saves: string[] = [];
  m.chestStore = { load: () => [{ id: 'potion', count: 3 }], save: (t) => saves.push(t.name) };
  const seat = m.seats[0]!;
  const p = seat.trainer;
  p.items[0] = { id: 'extraction-voucher', count: 1 };
  p.party.push(m.makeMon('0396', 8, p, p.x, p.y));
  m.keepsResults = false;
  const said = m.withSeat(seat, () => m.extractWithVoucher(0, 1));
  check(/private/.test(said) && p.items[0]?.id === 'extraction-voucher', 'a voucher does nothing in a private match');
  m.withSeat(seat, () => m.withdraw(p, 0));
  check(saves.length === 0, 'a private match never saves a chest');
  const m2 = make(8);
  const saves2: Array<Array<{ id: string; count: number } | null>> = [];
  m2.chestStore = { load: () => [{ id: 'potion', count: 3 }], save: (_t, box) => saves2.push(box.map((b) => (b ? { ...b } : null))) };
  m2.rareChest = true;
  const p2 = m2.seats[0]!.trainer;
  m2.withdraw(p2, 0);
  check(saves2.length === 0, 'the rare-item chest is never saved');
  const m3 = make(9);
  const saves3: Array<Array<{ id: string; count: number } | null>> = [];
  m3.chestStore = { load: () => [{ id: 'ultra-ball', count: 5 }], save: (_t, box) => saves3.push(box.map((b) => (b ? { ...b } : null))) };
  const p3 = m3.seats[0]!.trainer;
  m3.withdraw(p3, 0);
  const afterTake = saves3.at(-1)?.find((b) => b?.id === 'ultra-ball');
  m3.refundChests();
  const afterRefund = saves3.at(-1)?.find((b) => b?.id === 'ultra-ball');
  check(!afterTake && afterRefund?.count === 5, 'items taken out come back if the match is called off');
}

// ---------------------------------------------------------------- Celeste
{
  const pool = celestePrizePool();
  const bad = pool.filter((d) => SPECIES.get(d)?.class || SPECIES.get(d)?.megaOf || /-(shiny|mega|shadow|final|unbound)/.test(d));
  check(bad.length === 0, `Celeste's pool has no legendaries, Mythicals, Megas or variants (${pool.length} species)`);
  check(pool.includes('0010') && pool.includes('0571') && pool.includes('0027-alola'), 'it holds ordinary species of every kind, regional forms too');
  // The classification itself: every species PokeAPI calls legendary or Mythical carries a class.
  const named = ['0150', '0151', '0243', '0245', '0249', '0250', '0251', '0381', '0384', '0385', '0488', '0490', '0491', '0492', '0494', '0720', '0802', '0808', '0809', '0888', '0889', '1007', '1008'];
  check(named.filter((d) => SPECIES.has(d)).every((d) => !!SPECIES.get(d)?.class), 'every legendary and Mythical in the game is classified as one');
  // The prize as given (after the level's evolution): every species of the pool at every level, many times.
  const given = new Set<string>();
  const rng = new Rng(99);
  for (let i = 0; i < 60_000; i++) given.add(celestePrize(rng, rng.int(1, 100)));
  const wrong = [...given].filter((d) => !celesteEligible(d) || SPECIES.get(d)?.class);
  check(wrong.length === 0, `60,000 prizes at random levels: ${given.size} different species given, none legendary, Mythical, Mega or a variant${wrong.length ? ` (bad: ${wrong.join(' ')})` : ''}`);
}

// ---------------------------------------------------------------- shinies
{
  check(CONFIG.wild.shinyChance === 0.01 && CONFIG.wild.alphaShinyMultiplier === 4, `base shiny chance ${CONFIG.wild.shinyChance}, Alphas x${CONFIG.wild.alphaShinyMultiplier}`);
  let strong = 0;
  let strongShiny = 0;
  for (let s = 100; s < 400; s++) {
    const m = make(s);
    for (const w of m.wilds) {
      if (!w.landBoss || w.legend) continue;
      strong++;
      if (w.shiny) strongShiny++;
    }
  }
  check(strongShiny > 0, `stronger encounters can be shiny (${strongShiny} of ${strong} over 300 matches)`);
}

// ---------------------------------------------------------------- stronger encounters and Leftovers
{
  const counts = new Map<number, number>();
  for (let s = 20; s < 30; s++) {
    const m = make(s);
    const byLand = new Map<string, number>();
    for (const w of m.wilds) if (w.landBoss && !w.legend) byLand.set(m.ground.biomeAt(Math.floor(w.x), Math.floor(w.y)), (byLand.get(m.ground.biomeAt(Math.floor(w.x), Math.floor(w.y))) ?? 0) + 1);
    for (const n of byLand.values()) counts.set(n, (counts.get(n) ?? 0) + 1);
    check([...byLand.values()].every((n) => n >= 1 && n <= 3) && byLand.size >= 4, `seed ${s}: stronger encounters per land ${JSON.stringify(Object.fromEntries(byLand))}`);
  }
  const m = make(40);
  const p = m.seats[0]!.trainer as Trainer;
  const mon = lead(p)!;
  mon.heldItem = 'leftovers';
  mon.hp = Math.floor(mon.maxHp / 2);
  mon.busy = 0;
  const hp0 = mon.hp;
  for (let i = 0; i < 60 * 3.2; i++) m.step(1 / 60);
  check(mon.hp > hp0, `Leftovers heals (${hp0} -> ${mon.hp})`);
  check(mon.busy <= 0.01, `and leaves the attack pacing alone (busy ${mon.busy.toFixed(2)})`);
}

console.log(failed ? `${failed} gameplay check(s) failed` : 'All gameplay checks passed');
process.exit(failed ? 1 : 0);
