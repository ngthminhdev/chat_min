import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadStore, settle, deferred } from './store-harness.mjs';

const F = 'tg-1|-100900', B = 'tg-1|42';
const topic = (id, lastTs) => ({ accountId: 'tg-1', chatId: '-100900', id, name: 'Topic ' + id, color: 0, unread: 0, mention: false, lastTs, preview: '', previewFrom: '', pinned: false, closed: false, general: false });
const msg = (id, threadId = '7') => ({ accountId: 'tg-1', chatId: '-100900', id: String(id), sort: id, ts: id, senderId: 'p', senderName: 'P', senderPhoto: '', outgoing: false, edited: false, deleted: false, kind: 'text', text: 'm' + id, media: null, link: null, replyTo: '', replyName: '', replyText: '', reactions: [], threadId, threadReply: false, status: 'sent', error: '', pinned: false, mentionsMe: false, rev: '1' });
const page = (from, n) => Array.from({ length: n }, (_, i) => msg(from + i));

function setup(api) {
  const s = loadStore({ api: { cachedMessages: async () => [[], []], ...api } });
  s.set({ accounts: [{ id: 'tg-1', platform: 'telegram', selfId: 'me' }], chats: {
    [F]: { accountId: 'tg-1', id: '-100900', kind: 'group', forum: true, title: 'Forum' },
    [B]: { accountId: 'tg-1', id: '42', kind: 'dm', title: 'Bob' },
  } });
  return s;
}

test('clicking an uncached forum answers at once, and a late topic list does not take the tab back', async () => {
  const topics = deferred();
  const s = setup({ topics: () => topics.promise, topicHistory: async () => page(100, 10), messages: async () => [] });
  void s.openChat(F);
  await settle(2);
  assert.equal(s.state().active, F, 'the forum is selected immediately');
  assert.equal(s.state().forumLanding[F], true, 'the view shows the opening state');
  void s.openChat(B);
  await settle();
  assert.equal(s.state().active, B);
  topics.resolve([topic('7', 5), topic('3', 1)]);
  await settle();
  assert.equal(s.state().active, B, 'the late forum response must not steal the newer choice');
  assert.equal(s.state().forumLanding[F], undefined, 'opening state cleared');
  assert.equal(s.callsOf('topicHistory').length, 0, 'no topic history read for an abandoned click');
});

test('when nothing else was chosen, the forum lands in its newest topic, replacing the stand-in tab', async () => {
  const topics = deferred();
  const s = setup({ topics: () => topics.promise, topicHistory: async () => page(100, 10), messages: async () => [] });
  void s.openChat(F);
  await settle(2);
  topics.resolve([topic('3', 1), topic('7', 5)]);
  await settle();
  assert.equal(s.state().active, 'thread:' + F + ':7');
  assert.deepEqual([...s.state().tabs], ['thread:' + F + ':7']);
  assert.equal(s.callsOf('topics').length, 1);
});

test('double click on an uncached forum asks for topics once', async () => {
  const topics = deferred();
  const s = setup({ topics: () => topics.promise, topicHistory: async () => page(100, 10) });
  void s.openChat(F); void s.openChat(F);
  await settle(2);
  topics.resolve([topic('7', 5)]);
  await settle();
  assert.equal(s.callsOf('topics').length, 1);
  assert.equal(s.state().active, 'thread:' + F + ':7');
});

test('opening a topic reads its history at once, not the forum newest page first', async () => {
  const s = setup({ topics: async () => [topic('7', 5)], topicHistory: async () => page(100, 10), messages: () => new Promise(() => {}) });
  s.openTopicTab(F, topic('7', 5));
  await settle();
  assert.equal(s.callsOf('topicHistory').length, 1, 'topic history requested immediately');
  assert.equal(s.callsOf('messages').length, 0, 'the forum timeline (network) is not a prerequisite');
  assert.equal(s.state().msgs[F].length, 10);
});

test('topic history pages past 50 messages with loading, retry and end-of-history states', async () => {
  let fail = false;
  const s = setup({
    topicHistory: async (_a, _c, _t, before, limit) => {
      if (fail) throw 'network down (fake)';
      if (before === 0) return page(1000, limit);        // newest 50: 1000..1049
      if (before === 1000) return page(950, limit);      // 950..999
      if (before === 950) return page(930, 20);          // short page: start of topic
      return [];
    },
  });
  const T = 'thread:' + F + ':7';
  s.openTopicTab(F, topic('7', 5));
  await settle();
  assert.equal(s.state().older[T], 'idle', 'a full page leaves more to load');
  assert.equal(s.state().threadPages[T].token, '1000');
  const loading = s.loadOlderThread(T);
  assert.equal(s.state().older[T], 'loading', 'loading state while the older page is requested');
  await loading; await settle();
  assert.equal(s.callsOf('topicHistory')[1][3], 1000, 'older page starts from the oldest loaded id');
  assert.equal(s.state().msgs[F].filter((m) => m.threadId === '7').length, 100);
  fail = true;
  await s.loadOlderThread(T); await settle();
  assert.equal(s.state().older[T], 'idle');
  assert.match(s.state().threadTabs[T].error, /network down/);
  assert.equal(s.state().threadTabs[T].errorOlder, true, 'the error offers retrying the older page');
  fail = false;
  await s.loadOlderThread(T); await settle();
  assert.equal(s.state().older[T], 'done', 'a short page is the start of the topic');
  assert.equal(s.state().threadTabs[T].error, '');
  assert.equal(s.state().msgs[F].filter((m) => m.threadId === '7').length, 120);
  await s.loadOlderThread(T); await settle();
  assert.equal(s.callsOf('topicHistory').length, 4, 'no request after the end of history');
});
