import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadStore, settle, deferred } from './store-harness.mjs';

const G = 'gc-1|spaces/S';
const m = (id, sort, reply = false, thread = 't' + sort) => ({ accountId: 'gc-1', chatId: 'spaces/S', id, sort, ts: sort, kind: 'text', text: id, threadId: thread, threadReply: reply, outgoing: false, media: null, reactions: [] });

test('Google Chat: the cached history paints before the live page, which refreshes in the background', async () => {
  const live = deferred();
  const cached = [m('c1', 1), m('c2', 2), m('r1', 3, true, 't1')];
  const s = loadStore({ api: {
    cachedMessages: async () => [cached, [m('c1', 1)]],
    messages: () => live.promise,
    primaryMessages: async () => ({ messages: [], before: 0, hasMore: false }),
    threadList: async () => ({ threads: [], hasMore: false }),
  } });
  s.set({ accounts: [{ id: 'gc-1', platform: 'gchat' }], chats: { [G]: { accountId: 'gc-1', id: 'spaces/S', kind: 'space', threaded: true, title: 'S' } } });
  const opened = s.openChat(G);
  await settle();
  assert.equal(s.state().msgs[G].length, 3, 'cached rows on screen while the network is still pending');
  assert.equal(s.state().refreshing[G], true, 'background refresh is visible as a state');
  await opened;
  assert.equal(s.state().msgs[G].length, 3, 'openChat resolves without waiting for the live page');
  const lists = s.callsOf('threadList');
  assert.ok(lists.length >= 1);
  assert.ok(lists.every((args) => args[4] === false), 'with the Inspector closed the thread list stays local (remote=false)');
  live.resolve([m('c2', 2), m('c3', 4)]);
  await settle();
  assert.equal(s.state().refreshing[G], undefined, 'refresh state cleared');
  assert.ok(s.state().msgs[G].some((x) => x.id === 'c3'), 'the live page merged in');
});

test('a failed background refresh keeps the cached copy and records the error for inline retry', async () => {
  const s = loadStore({ api: {
    cachedMessages: async () => [[m('c1', 1)], []],
    messages: async () => { throw 'offline (fake)'; },
  } });
  s.set({ accounts: [{ id: 'gc-1', platform: 'gchat' }], chats: { [G]: { accountId: 'gc-1', id: 'spaces/S', kind: 'space', title: 'S' } } });
  await s.openChat(G); await settle();
  assert.equal(s.state().msgs[G].length, 1);
  assert.match(s.state().loadErr[G], /offline/);
  assert.equal(s.state().refreshing[G], undefined);
});
