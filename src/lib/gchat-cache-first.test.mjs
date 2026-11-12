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

test('coming back to a chat within 30 s does not fetch its newest page again; unread or time does', async () => {
  const realNow = Date.now;
  let now = 1_000_000;
  Date.now = () => now;
  try {
    const A = 'gc-1|spaces/A';
    const s = loadStore({ api: { cachedMessages: async () => [[m('c1', 1)], []], messages: async () => [m('c1', 1)] } });
    const chat = (id, extra = {}) => ({ accountId: 'gc-1', id, kind: 'space', title: id, ...extra });
    s.set({ accounts: [{ id: 'gc-1', platform: 'gchat' }], chats: { [G]: chat('spaces/S'), [A]: chat('spaces/A') } });
    const fetches = () => s.callsOf('messages').filter((a) => a[1] === 'spaces/S').length;
    await s.openChat(G); await settle();
    assert.equal(fetches(), 1);
    await s.openChat(A); await settle();
    now += 10_000;
    await s.openChat(G); await settle();
    assert.equal(fetches(), 1, 'back after 10 s: live events kept it current, no second fetch');
    assert.equal(s.state().refreshing[G], undefined);
    // something arrived while away: refresh at once, whatever the clock says
    await s.openChat(A); await settle();
    s.set((st) => ({ chats: { ...st.chats, [G]: chat('spaces/S', { unread: 1 }) } }));
    await s.openChat(G); await settle();
    assert.equal(fetches(), 2, 'unread chat refreshes');
    s.set((st) => ({ chats: { ...st.chats, [G]: chat('spaces/S') } }));
    await s.openChat(A); await settle();
    now += 31_000;
    await s.openChat(G); await settle();
    assert.equal(fetches(), 3, 'older than 30 s: refreshed');
  } finally { Date.now = realNow; }
});

test('closing a chat tab drops its loaded messages; the next open reads the cache again', async () => {
  const s = loadStore({ api: { cachedMessages: async () => [[m('c1', 1), m('c2', 2)], []], messages: async () => [m('c1', 1), m('c2', 2)] } });
  s.set({ accounts: [{ id: 'gc-1', platform: 'gchat' }], chats: { [G]: { accountId: 'gc-1', id: 'spaces/S', kind: 'space', title: 'S' } } });
  await s.openChat(G); await settle();
  s.set((st) => ({ fresh: { ...st.fresh, c2: true } }));
  s.closeTab(G); await settle();
  assert.equal(s.state().tabs.length, 0);
  assert.equal(s.state().msgs[G], undefined, 'no tab, no loaded messages');
  assert.equal(s.state().fresh.c2, undefined, 'their "just arrived" marks go with them');
  // a message for the closed chat is not collected in memory
  s.applyEvent?.({ type: 'message', msg: m('c3', 3), isNew: true, inbox: false });
  assert.equal(s.state().msgs[G], undefined);
  await s.openChat(G); await settle();
  assert.equal(s.callsOf('cachedMessages').length, 2, 'reopened from the local cache');
  assert.equal(s.state().msgs[G].length, 2);
});
