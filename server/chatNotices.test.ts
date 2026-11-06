/** Update and restart notices are not kept in the chat history; old ones are cleared on start. */
import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Accounts } from './accounts';
import { Chat } from './chat';

describe('update notices in chat', () => {
  it('are shown live, never saved, and old saved ones are removed', () => {
    const acc = new Accounts(mkdtempSync(join(tmpdir(), 'almia-chat-')), 'dev');
    const sent: Array<{ text?: string }> = [];
    const chat = new Chat((m) => sent.push(m as { text?: string }), acc);
    // An old notice saved by an earlier build, and an ordinary announcement.
    acc.db.prepare("INSERT INTO chat (user_id, name, text, at) VALUES (NULL, 'Announcement', 'The server is updating in a few minutes. Old.', 1)").run();
    acc.db.prepare("INSERT INTO chat (user_id, name, text, at) VALUES (NULL, 'Announcement', 'Server is going down for maintenance soon!', 2)").run();
    chat.announce('Double XP this weekend');
    chat.announce('The server is restarting soon. Matches running now have a few minutes to finish.', { keep: false });
    expect(sent.map((m) => m.text)).toContain('The server is restarting soon. Matches running now have a few minutes to finish.');
    const fresh = new Chat(() => {}, acc);
    const seen: Array<{ text?: string }> = [];
    fresh.history({ key: 'k', name: 'n', accountId: null, send: (m) => seen.push(m as { text?: string }) });
    expect(seen.map((m) => m.text)).toEqual(['Double XP this weekend']);
  });
});
