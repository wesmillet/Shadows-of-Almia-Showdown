import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Accounts } from './accounts';
import { AdminApi } from './adminApi';
import type { Mail } from './mailer';

// The real HTTP routes, with a mailer that keeps the emails instead of sending them.
let acc: Accounts;
let server: Server;
let base = '';
const sent: Mail[] = [];

beforeAll(async () => {
  acc = new Accounts(mkdtempSync(join(tmpdir(), 'almia-reset-')), 'dev');
  acc.mailer = { send: async (m) => (sent.push(m), true) };
  const admin = new AdminApi(acc, { online: () => [], awaySeats: () => [], live: () => [] });
  server = createServer((req, res) => {
    const path = (req.url ?? '/').split('?')[0] as string;
    if (path === '/verify-email' || path === '/reset-password') return acc.handlePage(req, res);
    if (path.startsWith('/api/admin/')) return void admin.handle(req, res, path, new URL(req.url ?? '/', 'http://x'));
    void acc.handle(req, res);
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => server.close());

const post = async (path: string, body: unknown, cookie = '') => {
  const r = await fetch(`${base}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Almia': '1', cookie }, body: JSON.stringify(body) });
  return { status: r.status, json: (await r.json()) as Record<string, unknown>, cookie: (r.headers.get('set-cookie') ?? '').split(';')[0] as string };
};
const register = async (username: string) => (await post('/api/register', { username, password: "Sturdy-Mountain-Passphrase-42" })).cookie;
const login = async (username: string, password: string) => (await post('/api/login', { username, password })).status;
const linkIn = (m: Mail | undefined) => (m?.text.match(/https?:\/\/\S+\?t=([A-Za-z0-9_-]+)/) ?? [])[1] ?? '';

describe('password resets', () => {
  it('an administrator makes a one-time reset code; the player uses it in Forgot password', async () => {
    const player = await register('LockedOut1');
    expect(player).toMatch(/=/);
    const adminCookie = await register('BossAdmin1');
    acc.db.prepare("UPDATE users SET role = 'admin' WHERE username = 'BossAdmin1'").run();
    const id = (acc.db.prepare("SELECT id FROM users WHERE username = 'LockedOut1'").get() as { id: number }).id;
    // Only an administrator may.
    expect((await post('/api/admin/account/reset', { id }, player)).status).toBe(403);
    const made = await post('/api/admin/account/reset', { id }, adminCookie);
    expect(made.status).toBe(200);
    const code = String(made.json.code);
    expect(code).toMatch(/^[0-9A-F]{5}-[0-9A-F]{5}$/);
    // Only its hash is kept, and the action is logged.
    expect(JSON.stringify(acc.db.prepare('SELECT * FROM reset_tokens').all())).not.toContain(code);
    // A weak password gives the code back; then it works once.
    expect((await post('/api/recover', { username: 'LockedOut1', code, password: 'short' })).status).toBe(400);
    const ok = await post('/api/recover', { username: 'LockedOut1', code: code.toLowerCase(), password: 'Brand-New-Passphrase-77' });
    expect(ok.json.ok).toBe(true);
    expect(await login('LockedOut1', 'Brand-New-Passphrase-77')).toBe(200);
    expect((await post('/api/recover', { username: 'LockedOut1', code, password: 'Another-Passphrase-88' })).status).toBe(401);
    // It only works for its own account.
    const other = await post('/api/admin/account/reset', { id }, adminCookie);
    await register('SomeoneElse1');
    expect((await post('/api/recover', { username: 'SomeoneElse1', code: String(other.json.code), password: 'Brand-New-Passphrase-99' })).status).toBe(401);
  });

  it('an email is confirmed by its link, then a reset link sets a new password once', async () => {
    const me = await register('MailUser1');
    // Unconfirmed: no reset email goes out (and the reply never says whether one did).
    expect((await post('/api/email', { email: 'not-an-email' }, me)).status).toBe(400);
    expect((await post('/api/email', { email: 'Trainer@Example.com' }, me)).json.ok).toBe(true);
    const confirm = sent.at(-1);
    expect(confirm?.to).toBe('trainer@example.com');
    const before = sent.length;
    const f1 = await post('/api/forgot', { username: 'MailUser1' });
    expect(f1.json.ok).toBe(true);
    expect(sent.length).toBe(before);
    // Confirming.
    const page = await fetch(`${base}/verify-email?t=${linkIn(confirm)}`);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('Email confirmed');
    expect((await fetch(`${base}/verify-email?t=${linkIn(confirm)}`)).status).toBe(400);
    const meNow = (await (await fetch(`${base}/api/me`, { headers: { cookie: me } })).json()) as { email: { address: string; confirmed: boolean } };
    expect(meNow.email.confirmed).toBe(true);
    expect(meNow.email.address).not.toContain('trainer@');
    // Forgot: a link that works once.
    const f2 = await post('/api/forgot', { username: 'MailUser1' });
    expect(f2.json).toEqual(f1.json);
    const reset = sent.at(-1);
    expect(reset?.subject).toBe('Reset your password');
    const token = linkIn(reset);
    expect((await fetch(`${base}/reset-password?t=${token}`)).status).toBe(200);
    expect((await post('/api/reset', { token, password: 'short' })).status).toBe(400);
    expect((await post('/api/reset', { token, password: 'Reset-By-Email-Passphrase-55' })).json.ok).toBe(true);
    expect(await login('MailUser1', 'Reset-By-Email-Passphrase-55')).toBe(200);
    expect((await post('/api/reset', { token, password: 'Second-Try-Passphrase-66' })).status).toBe(400);
    // The old sign-in cookie was signed out.
    const old = (await (await fetch(`${base}/api/me`, { headers: { cookie: me } })).json()) as { signedIn: boolean };
    expect(old.signedIn).toBe(false);
  });

  it('with no email service, the email features say so and nothing breaks', async () => {
    const keep = acc.mailer;
    acc.mailer = null;
    const me = await register('NoMail1');
    expect((await post('/api/email', { email: 'a@b.co' }, me)).status).toBe(503);
    const meNow = (await (await fetch(`${base}/api/me`)).json()) as { email: { on: boolean } };
    expect(meNow.email.on).toBe(false);
    acc.mailer = keep;
  });
});
