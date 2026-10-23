import { test } from 'node:test';
import assert from 'node:assert/strict';

test('old preferences get glass, and malformed stored settings stay safe', async () => {
  const { windowAppearance } = await import('./appearance.ts');
  assert.deepEqual(windowAppearance({}), { mode: 'glass', transparency: 35 });
  assert.deepEqual(windowAppearance({ backgroundMode: 'invalid', backgroundTransparency: '80' }), { mode: 'glass', transparency: 35 });
  assert.equal(windowAppearance({ backgroundTransparency: Infinity }).transparency, 35);
  assert.equal(windowAppearance({ backgroundTransparency: -20 }).transparency, 0);
  assert.equal(windowAppearance({ backgroundTransparency: 200 }).transparency, 100);
  assert.equal(windowAppearance({ backgroundTransparency: 100 }).transparency, 100);
});

test('reduce transparency overrides both transparent modes without losing the saved amount', async () => {
  const { windowAppearance } = await import('./appearance.ts');
  for (const backgroundMode of ['glass', 'clear', 'solid']) {
    assert.deepEqual(windowAppearance({ backgroundMode, backgroundTransparency: 60 }, true), { mode: 'solid', transparency: 60 });
    assert.equal(windowAppearance({ backgroundMode }).mode, backgroundMode);
  }
});
