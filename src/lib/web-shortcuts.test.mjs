import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const script = readFileSync(new URL('../../src-tauri/resources/web-shortcuts.js', import.meta.url), 'utf8');
function page() {
  const listeners = {}, sent = [], options = {};
  vm.runInNewContext(script, {
    document: { addEventListener: (name, fn, capture) => { listeners[name] = fn; options[name] = capture; } },
    window: { open: (url) => { const u = new URL(url); assert.equal(u.hostname, 'shortcut'); sent.push(JSON.parse(decodeURIComponent(u.pathname.slice(1)))); } },
  });
  return { sent, options, key(key, extra = {}) {
    const event = { key, code: '', metaKey: true, ctrlKey: false, shiftKey: false, altKey: false,
      isComposing: false, defaultPrevented: false, stopped: false,
      target: { isContentEditable: true, closest: () => ({}), blurred: false, blur() { this.blurred = true; } },
      preventDefault() { this.defaultPrevented = true; }, stopImmediatePropagation() { this.stopped = true; }, ...extra };
    listeners.keydown?.(event);
    return event;
  } };
}
test('app tab, palette and settings shortcuts cross the provider boundary even from a composer', () => {
  const p = page();
  for (const key of ['1', '2', '9', 'w', 'k', '[', ']', ',', 'n', 'f', 'b', 'r', 'e']) {
    const before = p.sent.length, e = p.key(key, { shiftKey: key === 'f' });
    assert.equal(p.sent.length, before + 1, key);
    assert.equal(e.defaultPrevented, true, key);
    assert.equal(e.stopped, true, key);
    assert.equal(p.sent.at(-1).inField, true);
  }
  assert.equal(p.options.keydown, true, 'capture before site key bindings');
});
test('editing keys, IME composition and unrelated browser shortcuts stay in the provider', () => {
  const p = page();
  for (const key of ['a', 'c', 'v', 'x', 'z', 'ArrowLeft', 'ArrowDown', 'Backspace', 'q', 'f']) {
    assert.equal(p.key(key).defaultPrevented, false, key);
  }
  assert.equal(p.key('w', { metaKey: false }).defaultPrevented, false);
  assert.equal(p.key('w', { isComposing: true }).defaultPrevented, false);
  assert.equal(p.key('w', { altKey: true }).defaultPrevented, false);
  assert.equal(p.sent.length, 0);
});
test('physical bracket keys and Ctrl+Tab retain navigation direction', () => {
  const p = page();
  p.key('{', { code: 'BracketLeft', shiftKey: true });
  assert.equal(p.sent.at(-1)?.key, '[');
  assert.equal(p.sent.at(-1)?.shiftKey, true);
  p.key('Tab', { metaKey: false, ctrlKey: true, shiftKey: true });
  assert.equal(p.sent.at(-1)?.key, 'Tab');
  assert.equal(p.sent.at(-1)?.ctrlKey, true);
  assert.equal(p.sent.at(-1)?.shiftKey, true);
});
test('unread navigation outside editing fields retains its field context', () => {
  const p = page();
  p.key('ArrowDown', { target: { isContentEditable: false, closest: () => null } });
  assert.equal(p.sent.at(-1)?.key, 'ArrowDown');
  assert.equal(p.sent.at(-1)?.inField, false);
});

test('opening a shell overlay relinquishes the provider editor before forwarding the command', () => {
  const p = page();
  assert.equal(p.key('k').target.blurred, true);
  assert.equal(p.key(',', { shiftKey: false }).target.blurred, true);
  assert.equal(p.key('w').target.blurred, false, 'tab changes manage their next editor separately');
});
