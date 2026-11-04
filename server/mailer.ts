/**
 * Sending email (only for password resets and confirming an address): Resend's HTTP API
 * (https://resend.com, free for up to 3,000 emails a month). Off unless the server has
 * RESEND_API_KEY; EMAIL_FROM sets the sender (a verified domain on Resend). Without it, the game
 * offers no email features and everything else works the same.
 */
export interface Mail {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface Mailer {
  send(mail: Mail): Promise<boolean>;
}

export function resendMailer(env: NodeJS.ProcessEnv = process.env): Mailer | null {
  const key = env.RESEND_API_KEY;
  if (!key) return null;
  const from = env.EMAIL_FROM || 'Shadows of Almia Showdown <noreply@soashowdown.com>';
  return {
    async send(mail: Mail): Promise<boolean> {
      try {
        const r = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ from, to: [mail.to], subject: mail.subject, text: mail.text, html: mail.html }),
          signal: AbortSignal.timeout(10_000),
        });
        if (!r.ok) console.error(`Email not sent: ${r.status}`);
        return r.ok;
      } catch (e) {
        console.error(`Email not sent: ${(e as Error).name}`);
        return false;
      }
    },
  };
}

/** A@b.co style addresses only (kept short; the confirmation link proves it works). */
export function emailProblem(email: string): string | null {
  if (email.length > 120) return 'That email is too long';
  if (!/^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[a-z]{2,}$/i.test(email)) return 'That does not look like an email address';
  return null;
}

/** w****@gmail.com: enough to recognise it, not enough to read it off a screen. */
export function maskEmail(email: string): string {
  const [user = '', domain = ''] = email.split('@');
  return `${user.slice(0, 1)}${'*'.repeat(Math.max(2, Math.min(6, user.length - 1)))}@${domain}`;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);

/** One email: a line or two and a button-like link. */
export function mailBody(title: string, lines: string[], link: { href: string; label: string } | null): { text: string; html: string } {
  const text = [title, '', ...lines, ...(link ? ['', `${link.label}: ${link.href}`] : []), '', 'Shadows of Almia Showdown'].join('\n');
  const html = `<div style="font-family:system-ui,sans-serif;background:#17112a;padding:24px">
<div style="max-width:520px;margin:0 auto;background:#f4ecdc;color:#4a3424;border:3px solid #4a3424;padding:20px 24px">
<h2 style="margin:0 0 12px;color:#c2611a">${esc(title)}</h2>
${lines.map((l) => `<p style="margin:0 0 10px;line-height:1.5">${esc(l)}</p>`).join('')}
${link ? `<p style="margin:18px 0"><a href="${esc(link.href)}" style="background:#c2611a;color:#fff;padding:10px 18px;text-decoration:none;display:inline-block">${esc(link.label)}</a></p>` : ''}
<p style="margin:16px 0 0;font-size:13px;color:#8a6a4a">Shadows of Almia Showdown</p>
</div></div>`;
  return { text, html };
}

const PAGE_STYLE = `@font-face { font-family: BoldPixels; src: url('/assets/fonts/BoldPixels.ttf'); }
body { margin: 0; background: #17112a; color: #4a3424; font-family: system-ui, sans-serif; padding: 24px 16px; line-height: 1.5; }
main { max-width: 460px; margin: 40px auto; background: #f4ecdc; border: 3px solid #4a3424; box-shadow: 0 4px 0 #2a1d14; padding: 20px 24px; }
h1 { font-family: BoldPixels, system-ui; font-weight: normal; color: #c2611a; margin-top: 0; }
label { display: block; margin: 12px 0 4px; }
input { width: 100%; box-sizing: border-box; padding: 10px; border: 2px solid #4a3424; font: inherit; background: #fffaf0; }
button, .btn { margin-top: 16px; background: #c2611a; color: #fff; border: 0; padding: 11px 20px; font: inherit; cursor: pointer; text-decoration: none; display: inline-block; box-shadow: 0 3px 0 #8a3a0a; }
.err { color: #b0302a; min-height: 20px; margin-top: 10px; }
.ok { color: #2e7d32; }`;

/** A page with a title, a message and a way back to the game. */
export function messagePage(title: string, message: string, ok: boolean): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · Shadows of Almia Showdown</title><style>${PAGE_STYLE}</style></head><body><main>
<h1>${esc(title)}</h1><p class="${ok ? 'ok' : 'err'}">${esc(message)}</p><a class="btn" href="/">Back to the game</a></main></body></html>`;
}

/** The new-password form a reset link opens (the token goes back with the form, never in a log). */
export function resetPage(token: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer"><title>New password · Shadows of Almia Showdown</title><style>${PAGE_STYLE}</style></head><body><main>
<h1>Choose a new password</h1>
<form id="f"><label for="p1">New password (8+ characters)</label><input id="p1" type="password" autocomplete="new-password" required>
<label for="p2">Again</label><input id="p2" type="password" autocomplete="new-password" required>
<div class="err" id="e"></div><button type="submit">Set new password</button></form>
<script>
const t = ${JSON.stringify(token)};
history.replaceState(null, '', '/reset-password');
document.getElementById('f').onsubmit = async (ev) => {
  ev.preventDefault();
  const e = document.getElementById('e');
  const p1 = document.getElementById('p1').value, p2 = document.getElementById('p2').value;
  if (p1 !== p2) { e.textContent = 'The two passwords are different'; return; }
  e.textContent = '';
  try {
    const r = await fetch('/api/reset', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Almia': '1' }, body: JSON.stringify({ token: t, password: p1 }) });
    const j = await r.json();
    if (!j.ok) { e.textContent = j.error || 'That did not work'; return; }
    document.querySelector('main').innerHTML = '<h1>Password changed</h1><p class="ok">You can sign in with your new password now' + (j.username ? ' as ' + j.username.replace(/[<>&]/g, '') : '') + '.</p><a class="btn" href="/">Back to the game</a>';
  } catch { e.textContent = "Can't reach the game server"; }
};
</script></main></body></html>`;
}
