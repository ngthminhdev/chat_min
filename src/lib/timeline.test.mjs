import { test } from 'node:test';
import assert from 'node:assert/strict';
import { timelinePosition, timelineTarget } from './timeline.ts';
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
