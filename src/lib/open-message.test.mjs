import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadStore, settle, deferred } from './store-harness.mjs';

const base = { senderId: 'p', senderName: 'P', senderPhoto: '', outgoing: false, edited: false, deleted: false, kind: 'text', media: null, link: null, replyTo: '', replyName: '', replyText: '', reactions: [], status: 'sent', error: '', pinned: false, mentionsMe: false, rev: '1' };
const G = 'gc-1|spaces/S', T = 'spaces/S/threads/t';
const greply = (i) => ({ ...base, accountId: 'gc-1', chatId: 'spaces/S', id: 'r-' + i, sort: i, ts: i, text: 'reply ' + i, threadId: T, threadReply: true });
const groot = { ...base, accountId: 'gc-1', chatId: 'spaces/S', id: 'root', sort: 1, ts: 1, text: 'root', threadId: T, threadReply: false };
// fake SQLite: 300 cached replies of one thread
const cachedThread = Array.from({ length: 300 }, (_, i) => greply(i + 2));
const sqliteContext = (id, connectTo) => {
  const i = cachedThread.findIndex((m) => m.id === id);
  if (i < 0) return [];
  return cachedThread.filter((m, j) => j >= i - 20 && (connectTo > m.sort || connectTo <= 0 && j <= i + 40));
};

function gchat(extra = {}) {
  const s = loadStore({ api: {
    cachedMessages: async () => [[], []],
    thread: async () => ({ messages: cachedThread.slice(-20), nextPageToken: 'older-token' }),
    threadRoot: async () => [groot],
    messageContext: async (_a, _c, id, _t, connectTo) => sqliteContext(id, connectTo),
    ...extra,
  } });
  s.set({ accounts: [{ id: 'gc-1', platform: 'gchat', selfId: 'me' }], chats: { [G]: { accountId: 'gc-1', id: 'spaces/S', kind: 'space', threaded: true, title: 'Space' } } });
  return s;
}

test('Google Chat: a cached reply outside the newest page opens its thread, is loaded and becomes the jump target', async () => {
  const s = gchat();
  await s.openMessage(greply(40));
  await settle();
  const tab = 'thread:' + G + ':' + T;
  assert.equal(s.state().active, tab, 'the thread tab, not the space');
  assert.equal(s.state().jumpTo, 'r-40');
  const [, , id, thread, connectTo] = s.callsOf('messageContext')[0];
  assert.equal(id, 'r-40'); assert.equal(thread, T);
  assert.equal(connectTo, 282, 'joined to the oldest reply the thread page loaded');
  const replies = s.state().msgs[G].filter((m) => m.threadReply);
  const limit = s.state().threadPages[tab].limit;
  assert.ok(replies.slice(-limit).some((m) => m.id === 'r-40'), 'the thread window includes the target');
  assert.ok(replies.slice(-limit).every((m, i, a) => i === 0 || m.sort === a[i - 1].sort + 1), 'no hidden gap in the revealed replies');
  assert.equal(s.state().threadPages[tab].token, 'older-token', 'older paging keeps its live cursor');
});

test('Google Chat: a reply already in the newest page needs no extra read', async () => {
  const s = gchat();
  await s.openMessage(greply(295));
  assert.equal(s.callsOf('messageContext').length, 0);
  assert.equal(s.state().jumpTo, 'r-295');
});

test('a message that is nowhere in history lands on the newest message with an explanation', async () => {
  const s = gchat();
  const before = s.state().toLatest;
  await s.openMessage({ accountId: 'gc-1', chatId: 'spaces/S', id: 'gone', threadId: T, threadReply: true });
  assert.equal(s.state().jumpTo, null);
  assert.equal(s.state().toLatest, before + 1);
  assert.match(s.state().toasts.at(-1).text, /bị xoá hoặc chưa tải được — đang hiện luồng/);
  assert.equal(s.state().active, 'thread:' + G + ':' + T, 'the known thread stays open: context kept');
});

const F = 'tg-1|-100900';
const tmsg = (id, topic = '7') => ({ ...base, accountId: 'tg-1', chatId: '-100900', id: String(id), sort: id, ts: id, text: 'm' + id, threadId: topic, threadReply: false });

test('Telegram forum: an old message opens its topic, loads the history around it and keeps older paging', async () => {
  const s = loadStore({ api: {
    cachedMessages: async () => [[], []],
    topicHistory: async (_a, _c, _t, before) => before === 0 ? Array.from({ length: 50 }, (_, i) => tmsg(5000 + i)) : [],
    messageContext: async (_a, _c, id, topic, connectTo) => { assert.equal(topic, '7'); return Array.from({ length: connectTo - 1180 }, (_, i) => tmsg(1180 + i)); },
  } });
  s.set({ accounts: [{ id: 'tg-1', platform: 'telegram' }], chats: { [F]: { accountId: 'tg-1', id: '-100900', kind: 'group', forum: true, title: 'Forum' } }, topics: { [F]: [{ id: '7', name: 'Dev', lastTs: 1 }] } });
  await s.openMessage(tmsg(1200));
  const tab = 'thread:' + F + ':7';
  assert.equal(s.state().active, tab);
  assert.equal(s.state().threadTabs[tab].title, 'Dev');
  assert.equal(s.state().jumpTo, '1200');
  assert.equal(s.callsOf('messageContext')[0][4], 5000, 'joined to the newest topic page');
  assert.equal(s.state().threadPages[tab].token, '1180', 'older pages continue below the loaded context');
  assert.equal(s.callsOf('messages').length, 0, 'never the forum-wide page');
});

test('a newer click cancels a pending jump: the old response neither switches tab nor scrolls', async () => {
  const ctx = deferred();
  const s = gchat({ messageContext: () => ctx.promise });
  s.set({ chats: { ...s.state().chats, 'gc-1|other': { accountId: 'gc-1', id: 'other', kind: 'dm', title: 'Other' } } });
  const pending = s.openMessage(greply(40));
  await settle();
  void s.openChat('gc-1|other');
  ctx.resolve(sqliteContext('r-40', 282));
  await pending; await settle();
  assert.equal(s.state().active, 'gc-1|other');
  assert.equal(s.state().jumpTo, null);
});

test('jumping to an old message does not mark the chat read until the reader reaches the bottom', async () => {
  const K = 'tg-1|42';
  const old = { ...base, accountId: 'tg-1', chatId: '42', id: '10', sort: 10, ts: 10, text: 'old', threadId: '', threadReply: false };
  const s = loadStore({ timers: true, focused: true, api: {
    cachedMessages: async () => [[], []],
    messages: async () => Array.from({ length: 50 }, (_, i) => ({ ...old, id: String(900 + i), sort: 900 + i })),
    messageContext: async () => [old],
    markRead: async () => true,
  } });
  s.set({ accounts: [{ id: 'tg-1', platform: 'telegram' }], chats: { [K]: { accountId: 'tg-1', id: '42', kind: 'dm', unread: 3, title: 'Bob' } } });
  await s.openMessage(old);
  await s.flushTimers();
  assert.equal(s.callsOf('markRead').length, 0, 'not read while jumping to an older message');
  s.jumpDone();
  s.set({ atBottom: true });
  s.markRead(K, true);
  await s.flushTimers();
  assert.equal(s.callsOf('markRead').length, 1, 'read once the newest messages are on screen');
});

test('bell, todo source and notification share the landing: a forum message opens its topic', async () => {
  const s = loadStore({ api: { cachedMessages: async () => [[], []], topicHistory: async () => [tmsg(1200)] } });
  s.set({ accounts: [{ id: 'tg-1', platform: 'telegram' }], chats: { [F]: { accountId: 'tg-1', id: '-100900', kind: 'group', forum: true, title: 'Forum' } }, inbox: [tmsg(1200)] });
  await s.openAt(F, '1200', '');
  assert.equal(s.state().active, 'thread:' + F + ':7', 'thread id recovered from the bell item');
  assert.equal(s.state().jumpTo, '1200');
});

test('an abandoned jump does not keep blocking read receipts for that chat', async () => {
  const K = 'tg-1|42', O = 'tg-1|43';
  const ctx = deferred();
  const old = { ...base, accountId: 'tg-1', chatId: '42', id: '10', sort: 10, ts: 10, text: 'old', threadId: '', threadReply: false };
  const s = loadStore({ timers: true, focused: true, api: {
    cachedMessages: async () => [[], []], messages: async () => [{ ...old, id: '99', sort: 99 }],
    messageContext: () => ctx.promise, markRead: async () => true,
  } });
  s.set({ accounts: [{ id: 'tg-1', platform: 'telegram' }], chats: { [K]: { accountId: 'tg-1', id: '42', kind: 'dm', unread: 2, title: 'Bob' }, [O]: { accountId: 'tg-1', id: '43', kind: 'dm', title: 'Other' } } });
  const pending = s.openMessage(old);
  await settle();
  await s.openChat(O);          // the user moves on before the context arrives
  ctx.resolve([old]); await pending;
  await s.openChat(K);          // and comes back normally, at the bottom
  s.set({ atBottom: true });
  s.markRead(K, true);
  await s.flushTimers();
  assert.ok(s.callsOf('markRead').some((c) => c[1] === '42'), 'the chat is read again once watched');
});
