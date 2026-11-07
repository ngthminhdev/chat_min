import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadStore, settle } from './store-harness.mjs';

// Fake upload API: the first attempt of every send fails like a dropped upload, later ones succeed.
function flakyUpload() {
  let attempt = 0;
  return async (a) => {
    attempt++;
    if (attempt === 1) throw 'upload failed: connection reset (fake)';
    return { accountId: a.accountId, chatId: a.chatId, id: 'server-' + attempt, sort: 1000 + attempt, ts: 1, senderId: 'me', senderName: '', senderPhoto: '', outgoing: true, edited: false, deleted: false, kind: a.file ? 'media' : 'text', text: a.text, media: null, link: null, replyTo: a.replyTo ?? '', replyName: '', replyText: '', reactions: [], threadId: a.threadId ?? '', threadReply: !!a.threadId, status: 'sent', error: '', pinned: false, mentionsMe: false, rev: '1' };
  };
}

function setup(platform, k) {
  const [accountId, chatId] = k.split('|');
  const store = loadStore({ api: { send: flakyUpload() } });
  store.set({ accounts: [{ id: accountId, platform, selfId: 'me' }], chats: { [k]: { accountId, id: chatId, kind: 'group' } }, msgs: { [k]: [] } });
  return store;
}

const plainObj = (x) => JSON.parse(JSON.stringify(x));
const failed = (s, k) => s.state().msgs[k].filter((m) => m.status === 'failed');

test('Telegram: retry re-sends the same file, caption wire text, plain/asFile mode, reply and topic', async () => {
  const K = 'tg-1|-100200';
  const s = setup('telegram', K);
  await s.send(K, 'Báo cáo @An', { file: '/tmp/fake/report.png', replyTo: '77', threadId: '12', wire: 'Báo cáo @{An}', plain: true, asFile: true });
  await settle();
  const [bubble] = failed(s, K);
  assert.ok(bubble, 'the failed upload stays as a failed bubble');
  assert.equal(bubble.media.localPath, '/tmp/fake/report.png');
  await s.retry(K, bubble);
  await settle();
  const sends = s.callsOf('send').map(([a]) => plainObj(a));
  assert.equal(sends.length, 2);
  assert.deepEqual(sends[1], sends[0], 'the retry asks for exactly what the first attempt asked');
  assert.deepEqual(sends[1], { accountId: 'tg-1', chatId: '-100200', text: 'Báo cáo @{An}', file: '/tmp/fake/report.png', replyTo: '77', threadId: '12', plain: true, asFile: true });
  assert.equal(failed(s, K).length, 0);
  assert.equal(s.state().msgs[K].filter((m) => m.outgoing).length, 1, 'one bubble after a successful retry');
});

test('Google Chat: retry of a file without caption keeps the thread', async () => {
  const K = 'gc-1|spaces/AAA';
  const s = setup('gchat', K);
  await s.send(K, '', { file: '/tmp/fake/log.txt', threadId: 'spaces/AAA/threads/t1' });
  await settle();
  const [bubble] = failed(s, K);
  assert.equal(bubble.text, '');
  await s.retry(K, bubble);
  await settle();
  const sends = s.callsOf('send').map(([a]) => plainObj(a));
  assert.deepEqual(sends[1], { accountId: 'gc-1', chatId: 'spaces/AAA', text: '', file: '/tmp/fake/log.txt', threadId: 'spaces/AAA/threads/t1' });
});

test('Google Chat: retry of a file with caption in a thread keeps the caption', async () => {
  const K = 'gc-1|spaces/AAA';
  const s = setup('gchat', K);
  await s.send(K, 'xem file này', { file: '/tmp/fake/a.pdf', threadId: 'spaces/AAA/threads/t2', replyTo: '' });
  await settle();
  await s.retry(K, failed(s, K)[0]);
  await settle();
  const sends = s.callsOf('send').map(([a]) => plainObj(a));
  assert.deepEqual(sends[1], sends[0]);
  assert.equal(sends[1].text, 'xem file này');
});

test('Telegram: retry of a file without caption, no topic', async () => {
  const K = 'tg-1|555';
  const s = setup('telegram', K);
  await s.send(K, '', { file: '/tmp/fake/v.mp4', asFile: false });
  await settle();
  await s.retry(K, failed(s, K)[0]);
  await settle();
  const sends = s.callsOf('send').map(([a]) => plainObj(a));
  assert.deepEqual(sends[1], { accountId: 'tg-1', chatId: '555', text: '', file: '/tmp/fake/v.mp4', asFile: false });
});

test('double-clicking retry starts one attempt only', async () => {
  const K = 'tg-1|555';
  const s = setup('telegram', K);
  await s.send(K, 'hello', {});
  await settle();
  const bubble = failed(s, K)[0];
  s.retry(K, bubble); s.retry(K, bubble);
  await settle();
  assert.equal(s.callsOf('send').length, 2, 'first attempt + exactly one retry');
});

test('a failed bubble without a recorded request still retries its local file and context', () => {
  const s = setup('telegram', 'tg-1|1');
  const req = plainObj(s.retryRequest({ text: 'cap', replyTo: '5', threadId: '9', media: { kind: 'file', localPath: '/tmp/fake/x.zip' } }));
  assert.deepEqual(req, { text: 'cap', replyTo: '5', threadId: '9', file: '/tmp/fake/x.zip' });
});
