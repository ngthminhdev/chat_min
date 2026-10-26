import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

// Run the real Composer and its effects. Only host boundaries (React, native event
// registration, file staging) are replaced; no copy of the drop handler lives here.
const source = readFileSync(new URL('../components/Composer.tsx', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
} }).outputText;
const settle = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
function composer(health = 'reconnecting') {
  const state = { accounts: [{ id: 'a', platform: 'telegram' }], drafts: {}, replyTo: {}, editing: {}, msgs: {},
    health: { a: { health } }, chats: { 'a|c': { title: 'Test', canSend: true } }, aiLang: {}, prefs: {}, active: 'a|c' };
  let cursor = 0, listener, unlistened = 0;
  const slots = [], effects = [], staged = [], errors = [];
  const useApp = Object.assign(select => select(state), { getState: () => state });
  const react = {
    useState(initial) { const i = cursor++; slots[i] ??= { value: initial }; return [slots[i].value, v => { slots[i].value = typeof v === 'function' ? v(slots[i].value) : v; }]; },
    useRef(initial) { const i = cursor++; return slots[i] ??= { current: initial }; },
    useId: () => 'test-id',
    useEffect(fn, deps) {
      const i = cursor++, old = slots[i];
      if (!old || deps.some((d, n) => !Object.is(d, old.deps[n]))) {
        slots[i] = { deps, cleanup: old?.cleanup };
        effects.push(() => { old?.cleanup?.(); slots[i].cleanup = fn(); });
      }
    },
  };
  const modules = {
    react,
    'react/jsx-runtime': { jsx: () => null, jsxs: () => null },
    'motion/react': { useReducedMotion: () => true, motion: new Proxy({}, { get: (_, key) => key }) },
    '../lib/bridge': { isTauri: true, api: { stageFiles: async paths => { staged.push(...paths); return paths.map(path => ({ path, name: path })); } } },
    '../store': { useApp, splitKey: k => k.split('|'), capsOf: () => ({}), fail: e => errors.push(e) },
    './ComposerExtras': { useRecorder: () => ({ recording: false }), useMentions: () => ({}) },
    '../lib/mobile': { isMobile: false },
    '../lib/format': {}, '../lib/platforms': { CAP_OFF_NOTE: {}, PLATFORMS: { telegram: { name: 'Telegram' } } }, '../ai': { langLabel: () => 'English', langTag: () => 'EN' },
    '@tauri-apps/api/webview': { getCurrentWebview: () => ({ onDragDropEvent: async cb => { listener = cb; return () => { unlistened++; }; } }) },
  };
  const exports = {};
  vm.runInNewContext(compiled, { exports, require: name => modules[name] ?? new Proxy({}, { get: () => () => {} }) });
  return {
    state, staged, errors,
    async render() { cursor = 0; exports.Composer({ k: 'a|c' }); effects.splice(0).forEach(f => f()); await settle(); },
    async drop(paths) { assert.ok(listener, 'native listener registered'); listener({ payload: { type: 'drop', paths } }); await settle(); },
    dispose() { slots.forEach(s => s.cleanup?.()); },
    get unlistened() { return unlistened; },
  };
}

test('drop after account reconnect stages the file using current composer state', async () => {
  const c = composer(); await c.render();
  c.state.health.a.health = 'ok'; await c.render();
  await c.drop(['/tmp/drop.txt']);
  assert.deepEqual(c.staged, ['/tmp/drop.txt']); assert.deepEqual(c.errors, []);
  c.dispose(); assert.equal(c.unlistened, 1);
});

test('drop is rejected after send permission is revoked, despite an earlier healthy render', async () => {
  const c = composer('ok'); await c.render();
  c.state.chats['a|c'].canSend = false; await c.render();
  await c.drop(['/tmp/private.txt']); assert.deepEqual(c.staged, []); c.dispose();
});

test('a background composer does not consume the active chat file drop', async () => {
  const c = composer('ok'); await c.render(); c.state.active = 'a|other';
  await c.drop(['/tmp/other.txt']); assert.deepEqual(c.staged, []); c.dispose();
});
