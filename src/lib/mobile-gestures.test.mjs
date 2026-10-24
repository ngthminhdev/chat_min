import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isReplySwipe, viewerSwipe } from './mobile-gestures.ts';

test('reply requires a deliberate left swipe, never a tap, right swipe or vertical scroll', () => {
  assert.equal(isReplySwipe(-80, 8), true);
  for (const [x, y] of [[0, 0], [-20, 0], [80, 0], [-90, 120], [-70, 65]]) assert.equal(isReplySwipe(x, y), false);
});

test('gallery distinguishes next, previous and dismiss from jitter or diagonal gestures', () => {
  assert.equal(viewerSwipe(-90, 10), 'next');
  assert.equal(viewerSwipe(90, 10), 'previous');
  assert.equal(viewerSwipe(10, 120), 'close');
  for (const [x, y] of [[10, 10], [0, -120], [65, 60], [-65, 60]]) assert.equal(viewerSwipe(x, y), null);
});
