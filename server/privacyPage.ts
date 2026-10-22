/**
 * The privacy page (/privacy): what the game server keeps, why, and how to have it deleted. Plain
 * words, as many players are young. PRIVACY_CONTACT sets where deletion requests go.
 */
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);

export function privacyPage(contact: string | null): string {
  const reach = contact ? `write to <a href="${esc(contact.includes('@') ? `mailto:${contact}` : contact)}">${esc(contact)}</a>` : 'report yourself in the game chat with the word "delete" (a moderator will see it)';
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Privacy · Shadows of Almia Showdown</title>
<style>
@font-face { font-family: BoldPixels; src: url('/assets/fonts/BoldPixels.ttf'); }
body { margin: 0; background: #17112a; color: #4a3424; font-family: system-ui, sans-serif; padding: 24px 16px; line-height: 1.5; }
main { max-width: 760px; margin: 0 auto; background: #f4ecdc; border: 3px solid #4a3424; box-shadow: 0 4px 0 #2a1d14; padding: 20px 24px; }
h1, h2 { font-family: BoldPixels, system-ui; font-weight: normal; }
h1 { margin-top: 0; }
h2 { font-size: 19px; margin: 22px 0 6px; color: #c2611a; }
li { margin: 4px 0; }
a { color: #c2611a; }
.dim { color: #8a6a4a; font-size: 14px; }
</style></head><body><main>
<h1>Privacy</h1>
<p>Shadows of Almia Showdown is a free fan game. It has no ads, no trackers, and sells nothing, including your information. This page says what the game's server keeps and why.</p>
<h2>If you play as a guest</h2>
<ul>
<li>Your browser keeps a random key so you can rejoin a match if your connection drops. Nothing you win is kept.</li>
<li>Like every account, a guest's connection is seen with an internet address and a random device id (see "Keeping the game safe").</li>
</ul>
<h2>If you make an account</h2>
<ul>
<li><b>Your trainer name</b> (please not your real name) and your password, stored only in a scrambled form we can not read back.</li>
<li>If you sign in with Google: Google's number for your account and your first name (to suggest a trainer name). Not your email.</li>
<li><b>Your game</b>: Pokémon in your PC, your storage chest, your look and title, levels, achievements, ranked rating, stats and match history.</li>
<li><b>Recovery codes</b>, scrambled like the password, so you can get back in without an email.</li>
<li>A sign-in cookie, so you stay signed in (for 30 days, or until you sign out).</li>
</ul>
<h2>What other players can see</h2>
<ul>
<li>Your trainer name, look, title, level, rank, stats, achievements and recent matches (your profile page).</li>
<li>Whether you are online and what you are doing, to your friends only.</li>
<li>What you say in the global chat. Chat is kept so moderators can look into reports.</li>
<li><b>Replays</b> of matches you play in (except private matches, which only their players see), showing your trainer name. Replays are deleted after a while to make room.</li>
</ul>
<h2>Keeping the game safe</h2>
<ul>
<li>The server notes the internet address and a random device id each player connects from, and actions in matches that a normal game can not do. Moderators use these against cheating and abuse, and a ban can apply to a device, or to an address for a week.</li>
<li>If the game breaks on your screen, it may send the error (what went wrong in the game's code, and your browser's name) so it can be fixed.</li>
</ul>
<h2>Deleting your account</h2>
<p>To have your account and everything kept for it deleted, ${reach}. Your chat messages are blanked out too. Backups that still contain it are replaced within a few weeks.</p>
<p class="dim">Pokémon is © Nintendo, Creatures and GAME FREAK. This fan game is not affiliated with them.</p>
<p><a href="/">Back to the game</a></p>
</main></body></html>`;
}
