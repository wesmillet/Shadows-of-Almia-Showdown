/**
 * Townsfolk: a different handful of characters wanders the island each match, with something to
 * say to anyone who stops them (Space). Most are flavour, some give real advice, and a few know
 * more about this island's secrets than they let on. One of them, now and then, is a Breeder
 * with an Egg to trade.
 */
import type { EggSlot, Mon, Trainer } from './entities';
import { partySize } from './entities';
import type { Match } from './match';
import { CONFIG, SPAWNS, SPECIES, species } from './data';
import { isDev } from '../dev';
import { SpriteRegistry } from '../sprites/pokemonSprite';

export interface Folk {
  name: string;
  role: string;
  lines: string[];
}

/** The pool a match draws its townsfolk from (names stay out of the rivals' name pool). */
export const FOLK_POOL: Folk[] = [
  {
    name: 'Youngster Cole', role: 'villager_a', lines: [
      'My Bidoof could beat your whole team! ...Okay, maybe not. But he tries really hard!',
      'Keep two Pokémon out and the second one watches your back. I learned that the hard way.',
      'Shorts are comfy and all, but nobody warns you about running from an Alpha in them.',
    ],
  },
  {
    name: 'Old Fisherman Walt', role: 'villager_b', lines: [
      'Sixty years I fished these waters. The lake out east still gives me the shivers.',
      "Some nights the black water goes still, like it's holding its breath. Don't ask me what for.",
      "A Super Rod isn't about the fish you can catch. It's about the fish you shouldn't.",
    ],
  },
  {
    name: 'Hiker Bruno', role: 'villager_c', lines: [
      'I hiked all five lands in one day! My knees would like a word with whoever built those stairs.',
      'Snow, sand, leaves, grass: every Pokémon has its ground. Hunt where your target lives.',
    ],
  },
  {
    name: 'Lass Marina', role: 'villager_d', lines: [
      'I counted the ducks on the summit lake. It is never the same number twice. NEVER.',
      'A boy told me golden rings open in the sky when nobody looks. He also eats sand, so who knows.',
    ],
  },
  {
    name: 'Instructor Hale', role: 'villager_h', lines: [
      'A worn-down Pokémon goes calm sooner or later. That calm moment is when a ball truly counts.',
      'Auto-battle is fine for walking. For a real fight, take the controls yourself. R, trainer. R.',
      'Your party heals free at any outpost. Dying because you were too proud to walk there is a choice.',
    ],
  },
  {
    name: 'Gravekeeper Morrow', role: 'villager_e', lines: [
      'These graves are older than the Union. Older than the castle. Mind your step after dark.',
      'When the storm swallows the island, I see shapes walking in it that have no owner.',
    ],
  },
  {
    name: 'Scholar Imani', role: 'villager_f', lines: [
      "The Shadow Crystal holds the night at bay. One old text calls it 'the lid on a bad dream'.",
      'The crystal pulses and the dark creeps closer each time. Watch the ring on your map, not the sky.',
    ],
  },
  {
    name: 'Chef Porcini', role: 'villager_g', lines: [
      'I came here to open a restaurant. My only customers are Pidgey. They do not tip.',
      "You'd think a battle royale would be good for business. Everyone is too busy to eat!",
    ],
  },
  {
    name: 'Gambler Dice', role: 'villager_a', lines: [
      'Every storage chest on this island remembers you between matches. I keep my winnings in one. And my losses.',
      "One in five hundred. Those are shiny odds. I've beaten worse, friend. I've also lost to better.",
    ],
  },
  {
    name: 'Veteran Sarge', role: 'villager_h', lines: [
      'Snag Machine rule one: wear the dark ones down under ten percent, THEN fire. Rule two: see rule one.',
      'I was at the first showdown. Back then the storm was just weather. Now it hunts.',
    ],
  },
  {
    name: 'Poké Maniac Gus', role: 'villager_c', lines: [
      'I collect Pokémon shaped like balls. Voltorb, Jigglypuff, Marill... my collection ROLLS.',
      'An Electrode beat me at hide and seek once. Round object. Flat field. Explain THAT.',
    ],
  },
  {
    name: 'Swimmer Lena', role: 'villager_d', lines: [
      'They say Latios will carry a trainer he trusts. The sky, the spray, the speed... imagine it.',
      'I swim everywhere. Piers are for people who fear fun.',
    ],
  },
  {
    name: 'Blacksmith Orin', role: 'villager_e', lines: [
      'I shape quarry ore into charms. The crystal ones hum at night. I stopped asking why.',
      'Evolution stones turn up in the town stalls. Each town stocks its own, so check them all.',
    ],
  },
  {
    name: 'Mystic Vela', role: 'villager_f', lines: [
      "I read fortunes. Yours says 'beware the final two'. That will be 200 Poké Dollars.",
      'The darkness does not close in to kill you, dear. It closes in to WAKE something.',
    ],
  },
  {
    name: 'Tourist Chad', role: 'villager_g', lines: [
      "Back home we don't have giant storms or ghost whales. We have a mall. This is better.",
      'I asked a Ranger where the gift shop is. Still waiting on that answer.',
    ],
  },
  {
    name: 'Picnicker June', role: 'villager_b', lines: [
      'I set out six sandwiches and turned my back for ONE second. Six Pidgey. Zero sandwiches.',
      'Stock potions before you pick fights. The healer cannot reach you mid-battle, friend.',
    ],
  },
];

/** What the Breeder might ask for: common catches on these grounds. */
const WANTS = ['0025', '0133', '0129', '0092', '0387', '0390', '0393', '0447'];
/** What her Eggs hold: the rare lines trainers dream of starting (equally likely; ones not in species.json are skipped). */
const EGG_POOL = ['0147', '0246', '0371', '0374', '0443', '0633', '0704', '0610', '0885', '0636'];
/**
 * Now and then (CONFIG.eggs.mythicalChance in all) an Egg holds a small Mythical Pokémon instead,
 * each of these equally likely. Mythical, not legendary (species.json class), and all small. Darkrai
 * (the finale) and Hoopa (the portal event) are left out: they have their own parts to play.
 */
export const MYTHICAL_EGGS = ['0151', '0251', '0385', '0490', '0492', '0494', '0802', '0808'];

/** The species an Egg holds: a Mythical with `mythicalChance`, else one of the Breeder's lines. */
export function eggSpecies(rng: Match['rng'], mythicalChance: number): { dex: string; mythical: boolean } {
  const myth = MYTHICAL_EGGS.filter((d) => SPECIES.has(d));
  if (myth.length && rng.chance(mythicalChance)) return { dex: myth[rng.int(0, myth.length - 1)] as string, mythical: true };
  const eggs = EGG_POOL.filter((d) => SPECIES.has(d));
  return { dex: eggs[rng.int(0, eggs.length - 1)] as string, mythical: false };
}

interface Walker {
  npc: Trainer;
  folk: Folk;
  goal: { x: number; y: number } | null;
  wait: number;
  /** The next line each trainer hears (they cycle). */
  lineFor: Map<number, number>;
}

/** The disguised Zoroark event (spawns.json events.zoroark). */
interface ZoroarkEvent {
  chance: number;
  levels: [number, number];
  shinyChance: number;
  dex: string;
  role: string;
  name: string;
}

let nextEggId = 1;

export class TownsfolkCrew {
  readonly walkers: Walker[] = [];
  breeder: Walker | null = null;
  /** The stranger in the forest who is really Zoroark (some matches), until she is found out. */
  disguise: Walker | null = null;
  /** Zoroark has dropped her disguise this match (once a match, whoever finds her). */
  zoroarkRevealed = false;
  /** The species the Breeder wants this match. */
  want = '';
  private traded = new Set<number>();
  /** What each Egg holds, by Egg id. Kept here, never on the trainer, so it is not sent to the browser. */
  private eggContents = new Map<number, { dex: string; mythical: boolean }>();

  constructor(private readonly m: Match) {
    const rng = m.rng;
    const pool = rng.shuffle([...FOLK_POOL]);
    const n = rng.int(7, 10);
    for (const folk of pool.slice(0, n)) {
      const s = this.spot(18);
      if (!s) continue;
      const npc = m.makeTrainer(folk.name, folk.role, false, s.x, s.y);
      m.npcs.push(npc);
      this.walkers.push({ npc, folk, goal: null, wait: rng.range(0, 3), lineFor: new Map() });
    }
    const wants = WANTS.filter((d) => SPECIES.has(d));
    const eggs = EGG_POOL.filter((d) => SPECIES.has(d));
    if (wants.length && eggs.length && (isDev() || rng.chance(0.35))) {
      const s = this.spot(25);
      if (s) {
        this.want = wants[rng.int(0, wants.length - 1)] as string;
        const npc = m.makeTrainer('Breeder Maribel', 'breeder', false, s.x, s.y);
        m.npcs.push(npc);
        this.breeder = { npc, folk: { name: 'Breeder Maribel', role: 'breeder', lines: [] }, goal: null, wait: 0, lineFor: new Map() };
      }
    }
    // The disguised Zoroark: a stranger wandering the forest, in a few matches.
    const z = this.zoroark;
    if (z && SPECIES.has(z.dex) && rng.chance(z.chance)) {
      const s = this.spot(30, (x, y) => m.ground.biomeAt(Math.floor(x), Math.floor(y)) === 'forest');
      if (s) {
        const npc = m.makeTrainer(z.name, z.role, false, s.x, s.y);
        m.npcs.push(npc);
        this.disguise = { npc, folk: { name: z.name, role: z.role, lines: [] }, goal: null, wait: rng.range(0, 3), lineFor: new Map() };
      }
    }
  }

  private get zoroark(): ZoroarkEvent | null {
    return (SPAWNS as unknown as { events?: { zoroark?: ZoroarkEvent } }).events?.zoroark ?? null;
  }

  private spot(minFromPlayer: number, ok: (x: number, y: number) => boolean = () => true): { x: number; y: number } | null {
    const m = this.m;
    for (let i = 0; i < 400; i++) {
      const x = m.rng.int(8, m.ground.cols - 8) + 0.5;
      const y = m.rng.int(8, m.ground.rows - 8) + 0.5;
      if (!m.ground.reachable(Math.floor(x), Math.floor(y))) continue;
      if (Math.hypot(x - m.player.x, y - m.player.y) < minFromPlayer) continue;
      if (!ok(x, y)) continue;
      return { x, y };
    }
    return null;
  }

  /** The townsperson, the Breeder or the stranger within talking reach of the current player. */
  near(reach = 1.8): Walker | null {
    const p = this.m.player;
    let best: Walker | null = null;
    let bd = Infinity;
    for (const w of [...this.walkers, ...(this.breeder ? [this.breeder] : []), ...(this.disguise ? [this.disguise] : [])]) {
      const d = Math.hypot(w.npc.x - p.x, w.npc.y - p.y);
      if (d <= reach && d < bd) {
        bd = d;
        best = w;
      }
    }
    return best;
  }

  /** Space beside a townsperson: their next line (the Breeder trades instead; the stranger is found out). */
  talk(w: Walker): string {
    if (w === this.breeder) return this.talkBreeder();
    if (w === this.disguise) return this.revealZoroark();
    const p = this.m.player;
    const i = w.lineFor.get(p.id) ?? 0;
    const line = w.folk.lines[i % w.folk.lines.length] as string;
    w.lineFor.set(p.id, i + 1);
    return `${w.folk.name}: "${line}"`;
  }

  /**
   * The stranger was Zoroark all along: she vanishes in a swirl of shadow and Zoroark stands there,
   * a wild Pokémon to battle and catch. Happens once: the stranger is gone from that moment, so a
   * second Space (from anyone, or after a reconnect) finds nobody to talk to.
   */
  private revealZoroark(): string {
    const m = this.m;
    const w = this.disguise;
    const z = this.zoroark;
    if (!w || !z || this.zoroarkRevealed) return '';
    this.zoroarkRevealed = true;
    this.disguise = null;
    m.npcs = m.npcs.filter((n) => n !== w.npc);
    const { x, y } = w.npc;
    const level = m.rng.int(z.levels[0], z.levels[1]);
    // This event's own shiny odds (the global odds are untouched).
    const shiny = m.rng.chance(z.shinyChance) && SpriteRegistry.hasShiny(z.dex);
    const mon = m.makeMon(z.dex, level, null, x, y, shiny);
    mon.dir = w.npc.dir;
    mon.homeX = x;
    mon.homeY = y;
    m.wilds.push(mon);
    m.battle.events.push({ type: 'scene-fx', id: 'fx_114', x, y, scale: 2, ground: true, fps: 14, tint: '#3a1458' });
    m.battle.events.push({ type: 'notice', seconds: 4, text: `The girl's outline flickers... It was ${shiny ? 'a shiny ' : ''}Zoroark all along!` });
    return `${z.name}: "Hee hee... you saw through me!"`;
  }

  private talkBreeder(): string {
    const m = this.m;
    const p = m.player;
    const wantName = species(this.want).name;
    if (this.traded.has(p.id)) return `Breeder Maribel: "Take good care of that Egg now. Keep walking with it and it'll hatch."`;
    const idx = this.tradable(p);
    if (idx < 0) {
      return `Breeder Maribel: "If you bring me a ${wantName}, I'll trade you an Egg from my best stock. A real mystery, straight from the ranch!"`;
    }
    const given = p.party[idx] as Mon;
    if (p.duelId) return `Breeder Maribel: "Finish your battle first, dear."`;
    // One for one: the Pokémon leaves the party and the Egg takes its place, so a full party is fine.
    p.party.splice(idx, 1);
    // Its held item stays with the trainer (when there is room for it).
    if (given.heldItem && m.giveItem(p, given.heldItem)) given.heldItem = null;
    if (m.controlled === given) m.releaseControl();
    if (m.lockTarget === given) m.lockTarget = null;
    m.battle.interrupt(given);
    given.target = null;
    given.captured = true;
    this.traded.add(p.id);
    const egg: EggSlot = { id: nextEggId++, steps: 0, need: CONFIG.eggs.hatchSteps };
    this.eggContents.set(egg.id, eggSpecies(m.rng, CONFIG.eggs.mythicalChance));
    (p.eggs ??= []).push(egg);
    return `Breeder Maribel: "A ${wantName}! Marvelous! Here, one Egg. Keep walking with it and it'll hatch."`;
  }

  /** The index of a party member the Breeder would take: her wanted species, never the last able one. */
  private tradable(p: Trainer): number {
    for (let i = 0; i < p.party.length; i++) {
      const mon = p.party[i] as Mon;
      if (mon.dex !== this.want || mon.captured) continue;
      if (p.party.some((o) => o !== mon && !o.fainted && !o.captured)) return i;
    }
    return -1;
  }

  /** Hatching; call every step. An Egg counts the tiles its trainer walks (Match.afterTrainerMove). */
  step(dt: number): void {
    void dt;
    const m = this.m;
    for (const t of m.allTrainers) {
      if (!t.eggs?.length || !t.alive) continue;
      for (const egg of [...t.eggs]) {
        if (egg.steps < egg.need) continue;
        this.hatch(t, egg);
      }
    }
  }

  private hatch(t: Trainer, egg: EggSlot): void {
    const m = this.m;
    const at = t.eggs?.indexOf(egg) ?? -1;
    if (at < 0) return;
    t.eggs?.splice(at, 1);
    const inside = this.eggContents.get(egg.id);
    this.eggContents.delete(egg.id);
    if (!inside) return;
    const lead = t.party.find((x) => !x.fainted && !x.captured);
    const level = Math.max(10, Math.round((lead?.level ?? 20) * 0.6));
    const baby = m.makeMon(inside.dex, level, t, t.x, t.y);
    // The Egg held its party slot, so there is room (unless something else filled it meanwhile).
    if (partySize(t) >= m.partyCap) {
      baby.captured = true;
      if (t.isPlayer) m.giveItem(t, 'extraction-voucher', 1);
      m.battle.events.push({ type: 'notice', seconds: 4, text: `The Egg hatched into ${baby.name}, but your party is full! It leaves you an Extraction Voucher` });
      return;
    }
    t.party.push(baby);
    if (t.duelId) baby.stowed = true;
    m.battle.events.push({ type: 'scene-fx', id: 'fx_239', x: t.x, y: t.y, scale: 1.6, lift: 1, fps: 10 });
    m.battle.events.push({ type: 'notice', seconds: 4, text: inside.mythical ? `Oh? The Egg is glowing... the Mythical ${baby.name} hatched from it!` : `Oh? The Egg is hatching... ${baby.name} hatched from the Egg!` });
  }
}
