import { test } from 'node:test';
import assert from 'node:assert/strict';
import { persistedUiChanged } from './ui-persistence.ts';
test('incoming messages and transient UI events do not schedule localStorage writes', () => {
  const before = { drafts: {}, tabs: [], prefs: {}, chats: {}, msgs: {}, typing: {}, health: {} };
  for (const field of ['chats', 'msgs', 'typing', 'health', 'hoverPeek', 'fileProgress']) {
    assert.equal(persistedUiChanged({ ...before, [field]: { changed: true } }, before), false, field);
  }
});
test('drafts, account notification settings and saved tab state still persist', () => {
  const before = { drafts: {}, tabs: [], prefs: {}, notif: {} };
  for (const field of ['drafts', 'tabs', 'prefs', 'notif', 'favorites', 'plainSend']) {
    assert.equal(persistedUiChanged({ ...before, [field]: { changed: true } }, before), true, field);
  }
  assert.equal(persistedUiChanged(before, before), false);
});
