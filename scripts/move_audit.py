#!/usr/bin/env python3
"""The 28 October move audit's data changes, applied to data/moves.json in place (rerunnable).

  python3 scripts/move_audit.py

data/moves.json is the move library's source of truth: moves.py and move_balance.py built it but
it has been tuned since (66 cooldowns and many effects differ from what those scripts would
write), so this applies only the audit's own changes, by move id, and leaves the rest alone.
docs/move-audit-2026-10-28.md has the reasons, move by move.
"""
import json, os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PATH = os.path.join(ROOT, 'data', 'moves.json')


def T(id, **k): return dict(id=id, anchor='target', **k)


# Priority dashes: they lunge faster and further (battle.ts startLunge: lunge.maxTiles x dash).
DASH = {'quick-attack': 1.35, 'aqua-jet': 1.35, 'mach-punch': 1.3, 'bullet-punch': 1.3, 'shadow-sneak': 1.3, 'sucker-punch': 1.25}
DRAIN = {'absorb': 0.5, 'mega-drain': 0.5, 'giga-drain': 0.5, 'draining-kiss': 0.75}
REACH = {'vine-whip': 2.0}
# Shove strength on a contact hit or a slam's landing, times the usual power-scaled shove.
KNOCK = {'dragon-tail': 2.4, 'body-slam': 1.3, 'heavy-slam': 1.6, 'iron-tail': 1.2, 'wave-crash': 1.2,
         'lick': 0.5, 'nuzzle': 0.5, 'bug-bite': 0.7, 'double-kick': 0.6, 'fury-cutter': 0.6}


def swap(m, old, new):
    """Replaces the part using effect `old` by `new` (a dict of fields to set, id included)."""
    for p in m['fx']:
        if p['id'] == old:
            if new.get('_replace'): p.clear()
            p.update({k: v for k, v in new.items() if k != '_replace'})
            return
    if any(p['id'] == new['id'] for p in m['fx']): return      # already applied
    raise SystemExit(f"{m['id']}: no {old}")


def main():
    raw = open(PATH, encoding='utf-8').read()
    data = json.loads(raw)
    by = {m['id']: m for m in data['moves']}
    for mid, m in by.items():
        if mid in DASH: m['dash'] = DASH[mid]
        else: m.pop('dash', None)
        if mid in KNOCK: m['knock'] = KNOCK[mid]
        else: m.pop('knock', None)
    note = (" dash (optional): a priority dash lunges that much faster and further. knock (optional): how hard a contact hit or a slam's"
            " landing shoves, times the usual. A contact move or slam lands only on a body its user is touching when it strikes"
            " (data.ts contactReach); shots and blasts stop at walls (match.ts shotClear). Effect and dash/knock changes since 28"
            " October: scripts/move_audit.py. drain (optional): the user gets back that share of the HP the hit took. reach (optional):"
            " a contact move that strikes from that many tiles past its user's body (Vine Whip).")
    if 'dash (optional)' not in data['_comment']: data['_comment'] += note
    elif 'drain (optional)' not in data['_comment']: data['_comment'] = data['_comment'][:data['_comment'].index(' dash (optional)')] + note
    # Quick Attack looked exactly like Tackle: a sharp star for the quick strike, a lighter puff.
    by['quick-attack']['fx'] = [T('fx_005', scale=2.2, fps=20), T('fx_067', scale=0.6, ground=True, fps=18)]
    # Brick Break's second part was the big white disc (fx_004), a white-out over the target.
    swap(by['brick-break'], 'fx_004', dict(id='fx_017', anchor='target', scale=1.4, fps=14, delay=0.06))
    # Powders landed as icy puffs (fx_046, Powder Snow's): they land as powder sparkles.
    swap(by['sleep-powder'], 'fx_046', dict(_replace=True, id='fx_021', anchor='target', scale=1.6, fps=12, tint='#c9b8ff'))
    swap(by['stun-spore'], 'fx_046', dict(_replace=True, id='fx_021', anchor='target', scale=1.6, fps=12, tint='#ffe27a'))
    # Energy Ball burst into the drain moves' sparkle ring: a green energy burst instead.
    swap(by['energy-ball'], 'fx_014', dict(_replace=True, id='fx_202', anchor='target', scale=1.3, fps=14))
    # Poison Jab played Psychic's eye ring (fx_041): a jab, purple.
    swap(by['poison-jab'], 'fx_041', dict(_replace=True, id='fx_148', anchor='target', scale=1.6, fps=14, tint='#c070ff'))
    # Fairy Wind threw a big white disc: a pink gust.
    swap(by['fairy-wind'], 'fx_203', dict(id='fx_160', scale=1.4, fps=12))
    # Iron Head struck with an electric burst (fx_073): a metal starburst.
    swap(by['iron-head'], 'fx_073', dict(_replace=True, id='fx_017', anchor='target', scale=1.6, fps=14, tint='#d0d8e8'))
    # Ice Punch and Ice Beam encased every target in the freeze block (fx_076) though they freeze
    # only 10-12% of the time (the freeze status shows its own effect): an ice shatter instead.
    swap(by['ice-punch'], 'fx_076', dict(_replace=True, id='fx_204', anchor='target', scale=1.6, fps=16, delay=0.08))
    swap(by['ice-beam'], 'fx_076', dict(_replace=True, id='fx_204', anchor='target', scale=1.6, fps=16, delay=0.2))
    # Icy Wind's gust raised an ice pillar on each target: frost puffs.
    swap(by['icy-wind'], 'fx_047', dict(_replace=True, id='fx_046', anchor='target', scale=1.4, fps=14))
    # Lick showed claw marks; Astonish had the splat that suits a lick. Swapped: a lick, a start.
    by['lick']['fx'] = [T('fx_049', scale=1.0, fps=20, tint='#ff9ad5')]
    by['astonish']['fx'] = [T('fx_196', scale=1.4, fps=16, tint='#c9a6ff')]
    # Draining moves had no healing at all: the user now gets back a share of the HP it took
    # (battle.ts landHit; the canon shares). The sparkles that played on the user at every cast, hit
    # or miss, now play only when HP actually comes back (the 'heal' event).
    for mid, share in DRAIN.items():
        by[mid]['drain'] = share
        by[mid]['fx'] = [p for p in by[mid]['fx'] if p['anchor'] != 'attacker']
    for mid, m in by.items():
        if mid not in DRAIN: m.pop('drain', None)
    # Vine Whip's vine: a thin green lash from its user to the target (fx_108, the slim beam strip,
    # tinted) and a quick cut where it lands. Its old effect (fx_064, vines sprouting round the target)
    # took a third of a second to grow, so the hit came long before anything showed.
    by['vine-whip']['fx'] = [dict(id='fx_108', anchor='attacker', mode='stream', scale=0.9, seconds=0.3, fps=16, tint='#6cc24a', origin='body'),
                            T('fx_116', scale=1.3, fps=30, tint='#7ad04a')]
    # Fairy Wind landed as a flat pink disc over the target (fx_205): a pink sparkle burst instead.
    by['fairy-wind']['fx'] = [p for p in by['fairy-wind']['fx'] if p['anchor'] != 'target'] + [T('fx_031', scale=1.6, fps=16, tint='#ffb3e6')]
    # Vine Whip lashes from a distance with its vine instead of charging in like Tackle.
    for mid, m in by.items():
        if mid in REACH: m['reach'] = REACH[mid]
        else: m.pop('reach', None)
    out = json.dumps(data, ensure_ascii=True)
    if out != raw:
        open(PATH, 'w', encoding='utf-8').write(out)
    print('moves.json', 'updated' if out != raw else 'unchanged')


if __name__ == '__main__':
    main()
