# Guardian Signs attack effects

256 attack and status effect animations ripped from Pokémon Ranger 3: Guardian Signs
(The Spriters Resource, "Miscellaneous - Attack Effects"). Each effect is one PNG,
frames packed left to right at a uniform cell size, transparent background, magenta
guide marks removed. `manifest.json` lists frame width, height and count per effect.
Single-frame entries are projectiles or static sprites meant to be moved, rotated or
tinted in code.

`contact_sheet.png` shows the peak frame of every effect with its ID and frame count,
8 per row, IDs ascending. Use it to assign effects to moves in data/moves.

Rough families by ID (see the contact sheet for exact picks):
- impacts and bursts: 001-005, 017, 021-022, 036, 147-148, 172-176
- rings and auras: 006-007, 012, 014, 024, 026, 028, 041-042, 061, 142, 190
- fire: 035, 040, 055, 057, 134, 140, 145, 174-175, 191
- water, ice, bubbles: 025, 045-047, 136-137, 144, 146, 155, 161-163
- electric: 027, 044, 052, 054, 157
- dark, ghost, poison clouds: 033-034, 037-038, 056, 158-159, 177, 186-188
- beams and lines: 039, 050, 060, 129-131, 138
- rocks and ground: 023, 149-150, 156, 183-184
- status: hearts, notes, sparkles, sleep: 013, 015-016, 152, 167-168
