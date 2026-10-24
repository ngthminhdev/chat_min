import test from 'node:test';
import assert from 'node:assert/strict';
import { layoutMessages } from './message-layout.ts';

const at = (day, hour, minute) => new Date(2026, 9, day, hour, minute).getTime();
const msg = (id, ts, patch = {}) => ({ id, ts, sort: Number(id), senderId: 'a', outgoing: false, kind: 'text', text: '', ...patch });

test('continuous messages share one group, gaps and midnight start a new group', () => {
  const rows = layoutMessages([msg('1', at(23, 23, 58)), msg('2', at(23, 23, 59)), msg('3', at(24, 0, 1)), msg('4', at(24, 0, 20))]);
  assert.deepEqual(rows.map(r => [r.first, r.last, r.newDay]), [[true, false, true], [false, true, false], [true, true, true], [true, true, false]]);
});

test('service, deleted, direction and unread boundaries break message groups', () => {
  for (const patch of [{ kind: 'service' }, { deleted: true }, { outgoing: true }, { senderId: 'b' }]) {
    const rows = layoutMessages([msg('1', at(24, 10, 0)), msg('2', at(24, 10, 1), patch), msg('3', at(24, 10, 2))]);
    assert.ok(rows.every(r => r.first && r.last));
  }
  const rows = layoutMessages([msg('1', at(24, 10, 0)), msg('2', at(24, 10, 1))], 2);
  assert.ok(rows[0].last && rows[1].first);
});

test('albums preserve captioned messages and unread boundaries', () => {
  const photo = (id, patch = {}) => msg(id, at(24, 10, 0), { kind: 'media', albumId: 'album', media: { kind: 'image', name: 'Photo' }, ...patch });
  assert.equal(layoutMessages([photo('1'), photo('2')])[0].album.length, 2);
  assert.equal(layoutMessages([photo('1', { text: 'first caption' }), photo('2', { text: 'second caption' })]).length, 2);
  assert.equal(layoutMessages([photo('1'), photo('2', { text: 'second caption' })]).length, 2);
  assert.equal(layoutMessages([photo('1'), photo('2')], 2).length, 2);
  assert.equal(layoutMessages([photo('1'), photo('2', { deleted: true })]).length, 2);
});

test('album folding never hides a tile failure, progress, reaction, quote or thread', () => {
  const photo = (id, patch = {}) => msg(id, at(24, 10, 0), { kind: 'media', outgoing: true, status: 'sent', threadId: '', reactions: [], media: { kind: 'image', name: 'Photo' }, ...patch });
  for (const patch of [{ status: 'failed' }, { status: 'sending' }, { edited: true }, { reactions: [{ emoji: '👍', count: 1 }] }, { replyTo: 'other' }, { threadId: 'different' }, { status: 'seen' }]) {
    assert.equal(layoutMessages([photo('1'), photo('2', patch)]).length, 2, JSON.stringify(patch));
  }
});
