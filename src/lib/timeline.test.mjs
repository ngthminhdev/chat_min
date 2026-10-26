import { test } from 'node:test';
import assert from 'node:assert/strict';
import { timelinePosition, timelineTarget, afterPaint } from './timeline.ts';
const row = (id, album) => ({ m: { id }, album });
test('prepending history preserves absolute indexes of existing rows', () => {
  const before = timelinePosition(undefined, ['b','c']);
  const after = timelinePosition(before, ['a','b','c']);
  assert.equal(after.firstIndex + 1, before.firstIndex);
  assert.equal(timelinePosition(after, ['b','c']).firstIndex, before.firstIndex);
});
test('append and a detached page keep indexes valid', () => {
  const before = timelinePosition(undefined, ['a','b']);
  assert.equal(timelinePosition(before, ['a','b','c']).firstIndex, before.firstIndex);
  assert.ok(timelinePosition(before, ['unrelated']).firstIndex > 0);
});
test('jump targets include virtualized album tiles and retired provider IDs', () => {
  const rows = [row('a'),row('b',[{id:'b'},{id:'c'}]),{m:{id:'final',uiPreviousIds:['temp']}}];
  assert.equal(timelineTarget(rows,'c'),1);
  assert.equal(timelineTarget(rows,'temp'),2);
  assert.equal(timelineTarget(rows,'missing'),-1);
});
test('deferred mount yields a paint and cancelling a stale tab prevents its reveal', () => {
  const frames = new Map(); let next=0, mounted=0;
  const scheduler={request:fn=>{frames.set(++next,fn);return next;},cancel:id=>frames.delete(id)};
  const cancel=afterPaint(()=>mounted++,scheduler);
  assert.equal(mounted,0);
  frames.get(1)(); frames.delete(1);
  assert.equal(mounted,0);
  cancel(); assert.equal(frames.size,0);
  afterPaint(()=>mounted++,scheduler); frames.get(3)(); frames.get(4)();
  assert.equal(mounted,1);
});
