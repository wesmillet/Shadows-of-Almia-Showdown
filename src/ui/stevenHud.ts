/**
 * Steven's screens over the match (src/sim/steven.ts): his invitation to the winner, the stadium's
 * intro, and how the battle ended. Drawn on the HUD canvas by MatchScreen.drawSteven.
 */
import type { View } from '../render/view';
import type { RangerSprites } from '../sprites/rangerSprite';
import type { StevenChallenge } from '../sim/steven';
import { SPECIES } from '../sim/data';
import { uiFont } from './screens';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Steven's colours: Devon steel, with the Hoenn League's teal. */
const STEEL_DARK = '#16202e';
const STEEL = '#2b3a50';
const STEEL_LIGHT = '#8fa6c4';
const TEAL = '#5fd3c8';
const GOLD = '#ffd34a';

function label(h: CanvasRenderingContext2D, s: string, x: number, y: number, px: number, color: string, align: CanvasTextAlign = 'left'): void {
  h.font = uiFont(px);
  h.textAlign = align;
  h.textBaseline = 'alphabetic';
  h.fillStyle = 'rgba(0,0,0,0.55)';
  h.fillText(s, x + Math.max(1, px / 12), y + Math.max(1, px / 12));
  h.fillStyle = color;
  h.fillText(s, x, y);
}

/** Steven himself, big, from his overworld sheet (facing down). */
function portrait(h: CanvasRenderingContext2D, rangers: RangerSprites | null, cx: number, foot: number, scale: number): void {
  if (!rangers) return;
  const f = rangers.get('steven').frame('down', 0, false);
  h.save();
  h.imageSmoothingEnabled = false;
  const w = f.w * scale;
  const ht = f.h * scale;
  if (f.flip) {
    h.translate(cx, 0);
    h.scale(-1, 1);
    h.drawImage(f.image, f.sx, f.sy, f.w, f.h, -w / 2, foot - ht, w, ht);
  } else h.drawImage(f.image, f.sx, f.sy, f.w, f.h, cx - w / 2, foot - ht, w, ht);
  h.restore();
}

/**
 * The invitation: a card in the middle of the screen with Steven, his words, and two buttons.
 * Returns the buttons' rectangles (for clicks and taps).
 */
export function drawInvite(v: View, st: StevenChallenge, rangers: RangerSprites | null, time: number): { yes: Rect; no: Rect } {
  const h = v.hud;
  const s = v.baseScale;
  const W = Math.min(v.width - 32 * s, 560 * s);
  const H = 250 * s;
  const x = (v.width - W) / 2;
  const y = (v.height - H) / 2 - 20 * s;
  h.save();
  // The world dims behind it.
  h.fillStyle = 'rgba(5,6,14,0.55)';
  h.fillRect(0, 0, v.width, v.height);
  // The card: steel with a teal edge that shimmers.
  const g = h.createLinearGradient(x, y, x, y + H);
  g.addColorStop(0, STEEL);
  g.addColorStop(1, STEEL_DARK);
  h.fillStyle = g;
  h.beginPath();
  h.roundRect(x, y, W, H, 10 * s);
  h.fill();
  h.lineWidth = 3 * s;
  const shimmer = 0.6 + 0.4 * Math.sin(time * 3);
  h.strokeStyle = `rgba(95,211,200,${shimmer})`;
  h.stroke();
  // Steven on the left, on a little stone plinth.
  const px = x + 78 * s;
  const foot = y + H - 40 * s;
  h.fillStyle = 'rgba(143,166,196,0.25)';
  h.beginPath();
  h.ellipse(px, foot, 46 * s, 10 * s, 0, 0, Math.PI * 2);
  h.fill();
  portrait(h, rangers, px, foot, 4 * s);
  // His words.
  const tx = x + 150 * s;
  label(h, 'CHAMPION STEVEN', tx, y + 40 * s, 13 * s, TEAL);
  label(h, 'wants to battle you!', tx, y + 66 * s, 20 * s, '#ffffff');
  const lines = ['"That was a remarkable win. I have', 'been watching. Will you face me', 'and my team in the stadium?"'];
  lines.forEach((ln, i) => label(h, ln, tx, y + 98 * s + i * 20 * s, 13 * s, STEEL_LIGHT));
  // Buttons.
  const bw = (W - 150 * s - 34 * s) / 2;
  const bh = 40 * s;
  const by = y + H - bh - 20 * s;
  const yes: Rect = { x: tx, y: by, w: bw, h: bh };
  const no: Rect = { x: tx + bw + 14 * s, y: by, w: bw, h: bh };
  for (const [r, text, fill] of [[yes, 'Battle!  Space', TEAL], [no, 'Not now  Esc', '#495a72']] as const) {
    h.fillStyle = fill;
    h.beginPath();
    h.roundRect(r.x, r.y, r.w, r.h, 6 * s);
    h.fill();
    label(h, text, r.x + r.w / 2, r.y + r.h / 2 + 6 * s, 14 * s, fill === TEAL ? STEEL_DARK : '#ffffff', 'center');
  }
  // How long until it is taken as a yes.
  const left = Math.ceil(st.inviteLeft);
  label(h, `Accepted in ${left} s`, x + W - 14 * s, y + 24 * s, 11 * s, STEEL_LIGHT, 'right');
  h.restore();
  return { yes, no };
}

/**
 * The stadium's intro: dark bands, a steel banner "CHAMPION BATTLE", the two names, and a hint about
 * his ace. `t` seconds in, `T` long.
 */
export function drawIntro(v: View, st: StevenChallenge, playerName: string, t: number, T: number): void {
  const h = v.hud;
  const s = v.baseScale;
  const W = v.width;
  const H = v.height;
  const ease = (x: number) => 1 - (1 - Math.min(1, Math.max(0, x))) ** 3;
  const out = t > T - 0.5 ? Math.max(0, 1 - (t - (T - 0.5)) / 0.5) : 1;
  h.save();
  const band = H * 0.13 * ease(t / 0.4);
  h.globalAlpha = 0.92 * out;
  h.fillStyle = '#06080f';
  h.fillRect(0, 0, W, band);
  h.fillRect(0, H - band, W, band);
  // The banner sweeps in from both sides.
  const sw = ease((t - 0.15) / 0.35);
  const by = H * 0.3;
  const bh = 70 * s;
  const reach = (W / 2 + 40 * s) * sw;
  const g = h.createLinearGradient(0, by - bh / 2, 0, by + bh / 2);
  g.addColorStop(0, STEEL_DARK);
  g.addColorStop(0.5, '#3d5574');
  g.addColorStop(1, STEEL_DARK);
  h.fillStyle = g;
  h.beginPath();
  h.moveTo(W / 2 - reach, by - bh / 2 + 8 * s);
  h.lineTo(W / 2 + reach, by - bh / 2 - 8 * s);
  h.lineTo(W / 2 + reach, by + bh / 2 - 8 * s);
  h.lineTo(W / 2 - reach, by + bh / 2 + 8 * s);
  h.closePath();
  h.fill();
  h.strokeStyle = TEAL;
  h.lineWidth = 2 * s;
  h.stroke();
  const tIn = ease((t - 0.45) / 0.3);
  h.globalAlpha = out * tIn;
  label(h, 'CHAMPION BATTLE', W / 2, by + 12 * s, 34 * s, '#ffffff', 'center');
  // The names below: Steven's in steel, the challenger's in gold.
  const nIn = ease((t - 0.8) / 0.4);
  h.globalAlpha = out * nIn;
  label(h, 'Steven', W / 2 - 30 * s - (1 - nIn) * 120 * s, by + bh / 2 + 44 * s, 26 * s, STEEL_LIGHT, 'right');
  label(h, 'VS', W / 2, by + bh / 2 + 44 * s, 22 * s, GOLD, 'center');
  label(h, playerName, W / 2 + 30 * s + (1 - nIn) * 120 * s, by + bh / 2 + 44 * s, 26 * s, GOLD, 'left');
  const hint = st.allForms ? 'His whole team has awakened. Every one is in its limited form!' : 'Hoenn Champion · six Pokémon · his ace is sent out last';
  const hIn = ease((t - 1.4) / 0.4);
  h.globalAlpha = out * hIn;
  label(h, hint, W / 2, by + bh / 2 + 74 * s, 13 * s, st.allForms ? '#ff9a6b' : '#c9d6e8', 'center');
  h.restore();
}

/** How it ended: a banner, and the prize (beat him) or his parting words (lost to him). */
export function drawResult(v: View, st: StevenChallenge, won: boolean, t: number, T: number): void {
  const h = v.hud;
  const s = v.baseScale;
  const W = v.width;
  const H = v.height;
  const ease = (x: number) => 1 - (1 - Math.min(1, Math.max(0, x))) ** 3;
  const a = Math.min(1, t / 0.4) * (t > T - 0.6 ? Math.max(0, (T - t) / 0.6) : 1);
  h.save();
  h.globalAlpha = a;
  const y = H * 0.32;
  const bh = 64 * s;
  const g = h.createLinearGradient(0, y - bh / 2, 0, y + bh / 2);
  g.addColorStop(0, won ? '#5a4310' : STEEL_DARK);
  g.addColorStop(0.5, won ? '#b88a1c' : '#3d5574');
  g.addColorStop(1, won ? '#5a4310' : STEEL_DARK);
  h.fillStyle = g;
  h.fillRect(0, y - bh / 2, W, bh);
  label(h, won ? 'YOU DEFEATED CHAMPION STEVEN!' : 'STEVEN WINS', W / 2, y + 11 * s, 30 * s, '#ffffff', 'center');
  const k = ease((t - 0.5) / 0.5);
  h.globalAlpha = a * k;
  if (won && st.prize) {
    const name = SPECIES.get(st.prize.dex)?.name ?? st.prize.name;
    label(h, `${name} was sent to your PC!`, W / 2, y + bh / 2 + 36 * s, 20 * s, GOLD, 'center');
    label(h, 'Steven: "You and your Pokémon are something special."', W / 2, y + bh / 2 + 62 * s, 13 * s, '#e6ecf5', 'center');
  } else {
    label(h, 'Steven: "A fine battle. Come back stronger, and we will go again."', W / 2, y + bh / 2 + 36 * s, 14 * s, '#e6ecf5', 'center');
    label(h, 'Your team was patched up. Your win still counts.', W / 2, y + bh / 2 + 60 * s, 12 * s, STEEL_LIGHT, 'center');
  }
  h.restore();
}
