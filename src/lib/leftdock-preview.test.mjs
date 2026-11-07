import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadStore, settle } from './store-harness.mjs';

const plain = (x) => JSON.parse(JSON.stringify(x));
const s0 = () => loadStore({ api: { cachedMessages: async () => [[], []] } });

test('preview target: Google Chat reply opens its thread, threaded timeline message its space', () => {
  const s = s0();
  const reply = { accountId: 'gc-1', id: 'spaces/S', kind: 'space', threaded: true, previewMsg: 'm9', previewThread: 'spaces/S/threads/t', previewKind: 'reply', previewContext: 'Release plan' };
  assert.deepEqual(plain(s.previewTarget(reply)), { accountId: 'gc-1', chatId: 'spaces/S', id: 'm9', threadId: 'spaces/S/threads/t', threadReply: true });
  assert.deepEqual(plain(s.previewTarget({ ...reply, previewKind: 'main', previewThread: '' })), { accountId: 'gc-1', chatId: 'spaces/S', id: 'm9', threadId: '', threadReply: false });
});

test('preview target: Telegram forum topic message opens that topic; plain chats and unknown previews open normally', () => {
  const s = s0();
  const forum = { accountId: 'tg-1', id: '-100', kind: 'group', forum: true, previewMsg: '501', previewThread: '7', previewKind: 'topic', previewContext: 'Dev' };
  assert.deepEqual(plain(s.previewTarget(forum)), { accountId: 'tg-1', chatId: '-100', id: '501', threadId: '7', threadReply: false });
  assert.equal(s.previewTarget({ accountId: 'tg-1', id: '42', kind: 'dm', previewMsg: '9', previewKind: 'main' }), null, 'a plain chat keeps its normal open (reading position, newest)');
  assert.equal(s.previewTarget({ accountId: 'tg-1', id: '42', kind: 'group', previewMsg: '', previewKind: '' }), null);
  assert.equal(s.previewTarget({ accountId: 'wa-1', id: 'web', kind: 'web', previewMsg: 'x', previewKind: 'main' }), null);
});

test('a topic preview opens its topic even when another topic was opened last, and becomes the last topic', async () => {
  const F = 'tg-1|-100';
  const s = loadStore({ api: { cachedMessages: async () => [[], []], topicHistory: async () => [{ accountId: 'tg-1', chatId: '-100', id: '501', sort: 501, threadId: '7', threadReply: false, text: 'hi' }] } });
  s.set({ accounts: [{ id: 'tg-1', platform: 'telegram' }], chats: { [F]: { accountId: 'tg-1', id: '-100', kind: 'group', forum: true, title: 'Forum', previewMsg: '501', previewThread: '7', previewKind: 'topic', previewContext: 'Dev' } },
    lastTopic: { [F]: '3' }, threadTabs: { ['thread:' + F + ':3']: { chatKey: F, threadId: '3', rootId: '', title: 'Ops', topic: true } } });
  await s.openMessage(s.previewTarget(s.state().chats[F]));
  assert.equal(s.state().active, 'thread:' + F + ':7');
  assert.equal(s.state().jumpTo, '501');
  assert.equal(s.state().lastTopic[F], '7');
});

test('"Mở hội thoại chính" opens the forum timeline itself, not its last topic', async () => {
  const F = 'tg-1|-100';
  const s = loadStore({ api: { cachedMessages: async () => [[], []], messages: async () => [] } });
  s.set({ accounts: [{ id: 'tg-1', platform: 'telegram' }], chats: { [F]: { accountId: 'tg-1', id: '-100', kind: 'group', forum: true, title: 'Forum' } },
    lastTopic: { [F]: '3' }, threadTabs: { ['thread:' + F + ':3']: { chatKey: F, threadId: '3', rootId: '', title: 'Ops', topic: true } }, active: 'thread:' + F + ':3', tabs: ['thread:' + F + ':3'] });
  await s.openMainTimeline(F); await settle();
  assert.equal(s.state().active, F);
});

test('Google Chat: "Mở hội thoại chính" from a thread tab returns to the space timeline', async () => {
  const G = 'gc-1|spaces/S', T = 'thread:' + G + ':spaces/S/threads/t';
  const s = loadStore({ api: { cachedMessages: async () => [[], []], messages: async () => [], primaryMessages: async () => ({ messages: [], before: 0, hasMore: false }), threadList: async () => ({ threads: [], hasMore: false }) } });
  s.set({ accounts: [{ id: 'gc-1', platform: 'gchat' }], chats: { [G]: { accountId: 'gc-1', id: 'spaces/S', kind: 'space', threaded: true, title: 'S' } },
    threadTabs: { [T]: { chatKey: G, threadId: 'spaces/S/threads/t', rootId: '', title: 'x' } }, active: T, tabs: [T] });
  await s.openMainTimeline(G); await settle();
  assert.equal(s.state().active, G);
});
