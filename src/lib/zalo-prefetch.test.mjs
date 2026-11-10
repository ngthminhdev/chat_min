import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deferred, loadStore, settle } from './store-harness.mjs';

test('Zalo warms unread chats from SQLite and refreshes only the chat opened by the user', async () => {
  const accountId = 'zalo-1';
  const group = { accountId, id: 'g:1', kind: 'group', unread: 1, order: 2 };
  const dm = { accountId, id: 'u:2', kind: 'dm', unread: 1, order: 1 };
  const groupKey = `${accountId}|${group.id}`, dmKey = `${accountId}|${dm.id}`;
  const cached = { accountId, chatId: group.id, id: '1', sort: 1, kind: 'text', outgoing: false };
  const live = deferred();
  const s = loadStore({ timers: true, api: {
    cachedMessages: async (_accountId, chatId) => [chatId === group.id ? [cached] : [], []],
    messages: () => live.promise,
  } });
  s.set({ accounts: [{ id: accountId, platform: 'zalo' }], chats: { [groupKey]: group, [dmKey]: dm } });
  s.applyEvent({ type: 'health', accountId, health: 'ok' });
  await s.flushTimers();
  assert.equal(s.callsOf('messages').length, 0, 'warmup makes no provider history requests');
  assert.equal(s.callsOf('cachedMessages').length, 2);
  assert.equal(s.state().msgs[groupKey]?.[0].id, cached.id);
  assert.equal(s.state().msgs[dmKey], undefined, 'a cache miss can still load live on first open');

  await s.openChat(groupKey);
  assert.deepEqual(s.callsOf('messages').map(args => args[1]), [group.id]);
  assert.equal(s.state().refreshing[groupKey], true);
  live.resolve([{ ...cached, id: '2', sort: 2 }]);
  await settle();
  assert.equal(s.state().msgs[groupKey].at(-1).id, '2');
});

test('duplicate or older read receipts leave the rendered message list untouched', () => {
  const k = 'zalo-1|g:1';
  const sent = { id: '1', sort: 1, outgoing: true, status: 'sent' };
  const incoming = { id: '2', sort: 2, outgoing: false, status: 'sent' };
  const later = { id: '3', sort: 3, outgoing: true, status: 'sent' };
  const s = loadStore();
  s.set({ msgs: { [k]: [sent, incoming, later] } });
  const seen = { type: 'readOutbox', accountId: 'zalo-1', chatId: 'g:1', upTo: 2 };
  s.applyEvent(seen);
  const updated = s.state();
  assert.equal(updated.msgs[k][0].status, 'seen');
  assert.equal(updated.msgs[k][1], incoming);
  assert.equal(updated.msgs[k][2], later);
  s.applyEvent(seen);
  s.applyEvent({ ...seen, upTo: 1 });
  assert.equal(s.state(), updated);
});
