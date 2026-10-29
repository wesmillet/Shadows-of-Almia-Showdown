/**
 * The browser's copy of a match (MirrorMatch) against a real server match and its encoder: a
 * Pokémon's spot on screen ends where the server has it, however updates arrive.
 *
 * Found by the online combat checks (tools/online-combat) under jitter: a Pokémon could stay drawn
 * several tiles from where the server had it, for as long as it stood still, because
 *  - a jump (snap) left an older glide running, which carried it back toward its old spot, and
 *  - an update that arrived mid-glide and changed only x kept y at the glide's halfway point (the
 *    server sends only what changed, so y never came again).
 */
import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { loadWorld } from './world';
import { PlayerView } from './view';
import { Match } from '../src/sim/match';
import { Rng } from '../src/core/rng';
import { IdTable, SyncEncoder } from '../src/net/sync';
import { MirrorMatch } from '../src/net/mirror';
import type { ServerMsg } from '../src/net/protocol';
import type { MirrorNet } from '../src/net/connection';
import type { RangerSprites } from '../src/sprites/rangerSprite';
import type { Input } from '../src/core/input';

describe('mirror glides', () => {
  it('a Pokémon ends where the server has it after a jump and a partial update mid-glide', async () => {
    const world = await loadWorld(join(import.meta.dirname, '..', 'assets'));
    const deps = () => ({ ground: world.ground(), rng: new Rng(5), sprites: world.sprites });
    const server = new Match(deps(), [], { humans: [{ name: 'A', starters: ['0448'] }, { name: 'B', starters: ['0006'] }], rivals: 0 });
    const seat = server.seats[1]!;
    const view = new PlayerView(server, seat);
    const enc = new SyncEncoder(new IdTable(), seat.trainer);
    let listener: ((msg: ServerMsg) => void) | null = null;
    const net: MirrorNet = { on: (l) => ((listener = l), () => {}), send: () => {}, cmd: () => {} };
    const rangers = { characters: () => [], setRole: async () => {} } as unknown as RangerSprites;
    const mirror = new MirrorMatch(deps(), net, seat.trainer.id, [], rangers);
    const still = { moveAxis: () => ({ x: 0, y: 0 }) } as unknown as Input;
    const send = () => listener?.({ t: 's', p: enc.encode(view.build(), view.visible), e: [], time: server.time, ack: seat.ack } as ServerMsg);
    const mon = seat.trainer.party[0]!;
    mon.steered = true; // the party AI leaves it where it is put
    const shown = () => mirror.match.allTrainers.find((t) => t.id === seat.trainer.id)!.party[0]!;
    send();
    mirror.step(1 / 60, still);
    const x0 = mon.x;
    const y0 = mon.y;
    // It walks north in small steps (each one glides on screen)...
    for (let i = 0; i < 6; i++) {
      mon.y -= 0.8;
      send();
      mirror.step(1 / 60, still);
    }
    // ...then jumps back to where it started (over 4 tiles: a snap), before the last glide has finished,
    mon.x = x0;
    mon.y = y0;
    send();
    for (let i = 0; i < 30; i++) mirror.step(1 / 60, still);
    expect(shown().x).toBeCloseTo(mon.x, 3);
    expect(shown().y).toBeCloseTo(mon.y, 3);
    // An update mid-glide that moves only x: y must stay the server's.
    mon.y += 0.3;
    send();
    mirror.step(1 / 60, still);
    mon.x += 0.3;
    send();
    for (let i = 0; i < 30; i++) mirror.step(1 / 60, still);
    expect(shown().x).toBeCloseTo(mon.x, 3);
    expect(shown().y).toBeCloseTo(mon.y, 3);
  }, 60_000);
});
