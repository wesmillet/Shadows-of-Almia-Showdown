/**
 * Townsfolk: a different handful of characters wanders the island each match, with something to
 * say to anyone who stops them (Space). Most are flavour, some give real advice, and a few know
 * more about this island's secrets than they let on. One of them, now and then, is a Breeder
 * with an Egg to trade.
 */
import type { Mon, Trainer } from './entities';
import type { Match } from './match';
import { SPECIES, species } from './data';
import { isDev } from '../dev';

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
      'Crystal shards push the darkness back for a moment. Cheap insurance, if you ask me.',
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
/** What her Eggs hold: the rare lines trainers dream of starting. */
const EGG_POOL = ['0147', '0246', '0371', '0374', '0443', '0633', '0704', '0610', '0885', '0636'];
/** Seconds from trade to hatching. */
const HATCH_SECONDS = 150;

interface Walker {
  npc: Trainer;
  folk: Folk;
  goal: { x: number; y: number } | null;
  wait: number;
  /** The next line each trainer hears (they cycle). */
  lineFor: Map<number, number>;
}

interface Egg {
  by: Trainer;
  at: number;
  dex: string;
}

export class TownsfolkCrew {
  readonly walkers: Walker[] = [];
  breeder: Walker | null = null;
  /** The species the Breeder wants this match. */
  want = '';
  private traded = new Set<number>();
  private eggs: Egg[] = [];

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
  }

  private spot(minFromPlayer: number): { x: number; y: number } | null {
    const m = this.m;
    for (let i = 0; i < 200; i++) {
      const x = m.rng.int(8, m.ground.cols - 8) + 0.5;
      const y = m.rng.int(8, m.ground.rows - 8) + 0.5;
      if (!m.ground.reachable(Math.floor(x), Math.floor(y))) continue;
      if (Math.hypot(x - m.player.x, y - m.player.y) < minFromPlayer) continue;
      return { x, y };
    }
    return null;
  }

  /** The townsperson (or the Breeder) within talking reach of the current player. */
  near(reach = 1.8): Walker | null {
    const p = this.m.player;
    let best: Walker | null = null;
    let bd = Infinity;
    for (const w of [...this.walkers, ...(this.breeder ? [this.breeder] : [])]) {
      const d = Math.hypot(w.npc.x - p.x, w.npc.y - p.y);
      if (d <= reach && d < bd) {
        bd = d;
        best = w;
      }
    }
    return best;
  }

  /** Space beside a townsperson: their next line (the Breeder trades instead). */
  talk(w: Walker): string {
    if (w === this.breeder) return this.talkBreeder();
    const p = this.m.player;
    const i = w.lineFor.get(p.id) ?? 0;
    const line = w.folk.lines[i % w.folk.lines.length] as string;
    w.lineFor.set(p.id, i + 1);
    return `${w.folk.name}: "${line}"`;
  }

  private talkBreeder(): string {
    const m = this.m;
    const p = m.player;
    const wantName = species(this.want).name;
    if (this.traded.has(p.id)) return `Breeder Maribel: "Take good care of that Egg now. They hatch when they're ready, not before."`;
    const idx = this.tradable(p);
    if (idx < 0) {
      return `Breeder Maribel: "If you bring me a ${wantName}, I'll trade you an Egg from my best stock. A real mystery, straight from the ranch!"`;
    }
    const given = p.party[idx] as Mon;
    if (p.duelId) return `Breeder Maribel: "Finish your battle first, dear."`;
    p.party.splice(idx, 1);
    if (m.controlled === given) m.releaseControl();
    if (m.lockTarget === given) m.lockTarget = null;
    m.battle.interrupt(given);
    given.target = null;
    given.captured = true;
    m.giveItem(p, 'mystery-egg', 1);
    this.traded.add(p.id);
    const rng = m.rng;
    const eggs = EGG_POOL.filter((d) => SPECIES.has(d));
    this.eggs.push({ by: p, at: m.time + HATCH_SECONDS, dex: eggs[rng.int(0, eggs.length - 1)] as string });
    return `Breeder Maribel: "A ${wantName}! Marvelous! Here, one Egg, keep it warm. It'll hatch when it's ready."`;
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

  /** The hatch countdowns; call every step. */
  step(dt: number): void {
    void dt;
    const m = this.m;
    for (let i = this.eggs.length - 1; i >= 0; i--) {
      const egg = this.eggs[i] as Egg;
      if (m.time < egg.at) continue;
      this.eggs.splice(i, 1);
      const t = egg.by;
      if (!t.alive) continue;
      // The Egg leaves the bag, whatever happens next.
      for (let s = 0; s < t.items.length; s++) {
        const e = t.items[s];
        if (e?.id === 'mystery-egg') {
          t.items[s] = e.count > 1 ? { ...e, count: e.count - 1 } : null;
          break;
        }
      }
      const lead = t.party.find((x) => !x.fainted && !x.captured);
      const level = Math.max(10, Math.round((lead?.level ?? 20) * 0.6));
      const baby = m.makeMon(egg.dex, level, t, t.x, t.y);
      if (t.party.length >= m.partyCap) {
        baby.captured = true;
        if (t.isPlayer) m.giveItem(t, 'extraction-voucher', 1);
        m.noticeFor(t, `The Egg hatched into ${baby.name}, but your party is full! It leaves you an Extraction Voucher`, 4);
        continue;
      }
      t.party.push(baby);
      if (t.duelId) baby.stowed = true;
      m.noticeFor(t, `Oh? The Egg is hatching... ${baby.name} hatched from the Egg!`, 4);
    }
  }
}
