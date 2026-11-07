// Loads the real store.ts into an isolated VM with a fake provider API, for regression tests
// that must never touch a real account. Every API call is recorded in `calls`.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import * as identity from './message-identity.ts';
import * as persistence from './ui-persistence.ts';

const require = createRequire(import.meta.url);
const compiled = ts.transpileModule(readFileSync(new URL('../store.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText.replaceAll('import.meta.env.DEV', 'false').replaceAll('import.meta.hot', 'undefined');

export const settle = async (n = 40) => { for (let i = 0; i < n; i++) await Promise.resolve(); };
export const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };

/** `api`: overrides for the fake bridge; anything missing resolves to []. `timers`: run setTimeout callbacks (default: drop them). */
export function loadStore({ api: overrides = {}, platforms = {}, timers = false, focused = false } = {}) {
  const calls = [];
  const pending = [];
  const api = new Proxy({ ...overrides }, {
    get: (o, k) => {
      if (typeof k !== 'string') return undefined;
      const fn = o[k] ?? (async () => []);
      return (...args) => { calls.push([k, ...args]); return fn(...args); };
    },
  });
  const modules = {
    zustand: require('zustand'), './lib/bridge': { api, isTauri: false, onEvent: () => Object.assign(() => {}, { ready: Promise.resolve() }), saveFile: async () => null },
    './lib/message-identity': identity, './lib/ui-persistence': persistence,
    './lib/micro-ux': { bare: (e) => e.replace(/️/g, '') }, './lib/appearance': { windowAppearance: () => ({ mode: 'solid', transparency: 0 }) },
    './lib/format': { plain: (x) => x }, './lib/mobile': { isMobile: false },
    './lib/mobile-navigation': { mobileConversationVisible: () => true },
    './lib/platforms': { PLATFORMS: new Proxy(platforms, { get: (o, k) => o[k] ?? { caps: {}, name: String(k) } }) },
    './lib/themes': { themeBase: () => 'dark' }, './lib/toast-queue': { queueToast: (items, item) => [...items, item] },
  };
  const exports = {};
  vm.runInNewContext(compiled, {
    exports, require: (name) => { if (!(name in modules)) throw Error('unmocked module ' + name); return modules[name]; },
    localStorage: { getItem: () => null, setItem: () => {} },
    document: { documentElement: { classList: { contains: () => false } }, hasFocus: () => focused, hidden: !focused },
    window: { matchMedia: () => ({ matches: false }) },
    setTimeout: timers ? (fn) => { pending.push(fn); return pending.length; } : () => 0, clearTimeout: () => {}, console, Date, Promise, Map, Set, JSON, Number, Math, Object, Array, String, Error,
  });
  const flushTimers = async () => { while (pending.length) { pending.shift()(); await settle(); } };
  return { ...exports, api, calls, flushTimers, state: exports.useApp.getState, set: exports.useApp.setState, callsOf: (name) => calls.filter((c) => c[0] === name).map((c) => c.slice(1)) };
}
