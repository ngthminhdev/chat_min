import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const resource = new URL('../../src-tauri/resources/web-bridge.js', import.meta.url);
const script = readFileSync(resource, 'utf8');
function page(href = '/messages/e2ee/t/123/', unread = true, provider = 'messenger', badge = 'fa-5_Plus_24_Line') {
  let now = 0, next = 0, scans = 0, observer, selected = false;
  const timers = new Map(), sent = [], states = [], navigation = [], listeners = {};
  const row = { textContent: 'LanTin nhắn chưa đọc:Xin chào1 phút', innerText: `Lan\n${unread ? 'Tin nhắn chưa đọc: ' : ''}Xin chào\n1 phút`, querySelector: () => null };
  const child = { getBoundingClientRect: () => ({left:0,top:0,width:100,height:40}), dispatchEvent() {} };
  const zalo = { firstElementChild: child, click: () => { selected = true; }, className: 'conv-item', parentElement: { closest: () => null }, textContent: 'Lan 3 giờ Bạn: Xin chào',
    querySelector: (q) => q === '.truncate' ? { textContent: 'Lan' } : q.includes('z-conv-message') ? { textContent: 'Bạn: Xin chào' } : q.includes('unread-v2') ? { className: badge, textContent: '' } : null };
  const link = { parentElement: null, getAttribute: (k) => k === 'href' ? href : k === 'aria-label' ? 'Lan' : null, closest: () => row };
  const document = {
    head: { appendChild() {} }, body: {}, documentElement: {}, title: 'Messenger', hidden: false,
    getElementById: () => true,
    querySelector: () => null,
    querySelectorAll: (q) => { if (q === '.conv-item') return [zalo]; if (q.includes('href*=')) { scans++; return [link]; } return []; },
    addEventListener: (type, fn) => { listeners[type] = fn; },
  };
  const schedule = (fn, delay = 0, interval = 0) => { timers.set(++next, { fn, at: now + delay, interval }); return next; };
  const recoveryStorage = new Map();
  const context = {
    document, location: { hostname: provider === 'zalo' ? 'chat.zalo.me' : 'www.facebook.com', href: `https://${provider === 'zalo' ? 'chat.zalo.me' : 'www.facebook.com'}${href}`, pathname: href, assign: (url) => navigation.push(url), replace: (url) => navigation.push(url) },
    sessionStorage: { getItem: key => recoveryStorage.get(key) ?? null, setItem: (key,value) => recoveryStorage.set(key,value) },
    window: { addEventListener: (type,fn) => { listeners[type] = fn; }, innerWidth: 1000, open: (url) => { const u = new URL(url); if (u.hostname === 'rows') sent.push(JSON.parse(decodeURIComponent(u.pathname.slice(1)))); if (u.hostname === 'state') states.push(JSON.parse(decodeURIComponent(u.pathname.slice(1)))); } },
    setTimeout: (fn, delay) => schedule(fn, delay), clearTimeout: (id) => timers.delete(id),
    setInterval: (fn, delay) => schedule(fn, delay, delay), clearInterval: (id) => timers.delete(id),
    MutationObserver: class { constructor(fn) { observer = fn; } observe() {} disconnect() {} },
    PointerEvent: class {}, MouseEvent: class {}, URL, Date: class extends Date { static now() { return now; } },
  };
  vm.runInNewContext(script, context);
  const advance = (ms) => { const end = now + ms; let runs = 0; while (true) { const pair = [...timers].sort((a,b) => a[1].at-b[1].at)[0]; if (!pair || pair[1].at > end) break; assert.ok(++runs < 1000, 'timer storm'); const [id,t] = pair; now=t.at; timers.delete(id); if (t.interval) timers.set(id,{...t,at:now+t.interval}); t.fn(); } now=end; };
  return { sent, states, navigation, document, row, advance, open: (id) => context.window.__cm.open(id), selected: () => selected, mutate: () => observer?.([]), scans: () => scans, listeners };
}
test('encrypted Messenger threads synchronize immediately with their unread preview', () => {
  const p = page(); p.advance(200);
  assert.equal(p.sent.length, 1);
  assert.equal(p.sent[0][0].id, '123');
  assert.equal(p.sent[0][0].title, 'Lan');
  assert.equal(p.sent[0][0].unread, 1);
  assert.equal(p.sent[0][0].preview, 'Xin chào');
});
test('incoming DOM changes synchronize within 200 ms and duplicate mutations stay bounded', () => {
  const p = page('/messages/t/123/'); p.advance(3100); p.sent.length = 0;
  const before = p.scans();
  p.row.innerText = 'Lan\nTin nhắn chưa đọc: Tin mới\n1 phút'; p.row.textContent = 'LanTin nhắn chưa đọc: Tin mới1 phút';
  for (let i=0;i<100;i++) p.mutate();
  p.advance(200);
  assert.equal(p.sent.length, 1);
  assert.equal(p.sent[0][0].preview, 'Tin mới');
  assert.ok(p.scans()-before <= 3, 'one bounded scan per burst');
  for (let i=0;i<100;i++) p.mutate(); p.advance(200);
  assert.equal(p.sent.length, 1, 'unchanged snapshots do not cross native bridge');
});
test('ordinary Messenger routes remain supported', () => {
  const p=page('/messages/t/456/', false);p.advance(3100);
  assert.equal(p.sent[0]?.[0].id, '456');
  assert.equal(p.sent[0]?.[0].unread, 0);
});

test('Zalo capped badge variants and Unicode age units are parsed correctly', () => {
  for (const badge of ['fa-5_Plus_24_Line', 'fa-5plus_24_Line']) {
    const p = page('/', true, 'zalo', badge); p.advance(200);
    assert.equal(p.sent[0]?.[0].unread, 6, badge);
    assert.equal(p.sent[0]?.[0].ago, 10800);
    assert.equal(p.sent[0]?.[0].outgoing, true, 'own preview cannot trigger an incoming alert');
  }
});

test('idle reconciliation does not repeatedly read Messenger layout text', () => {
  const p = page(); p.advance(200);
  let reads = 0;
  Object.defineProperty(p.row, 'innerText', { get() { reads++; return 'Lan\nTin nhắn chưa đọc: Xin chào\n1 phút'; } });
  p.advance(46000);
  assert.equal(reads, 0, 'unchanged text content reuses the parsed row');
});

test('inactive Zalo sessions are surfaced instead of silently claiming to be connected', () => {
  const p = page('/', true, 'zalo');
  p.document.body.textContent = 'Bạn đang mở Zalo trên một Tab khác hoặc không sử dụng Zalo quá lâu Nhấn kích hoạt để sử dụng trên Tab này';
  p.document.querySelectorAll = () => [];
  p.advance(200);
  assert.equal(p.states.at(-1), 'inactive');
});

test('opening a Zalo conversation clicks its actionable row instead of an arbitrary leaf', () => {
  const p = page('/', true, 'zalo'); p.advance(200);
  p.open('Lan');
  assert.equal(p.selected(), true, 'the actual conversation row receives the click');
});

test('a Zalo open request survives an inactive page and retries when the list returns', () => {
  const p = page('/', true, 'zalo');
  const query = p.document.querySelectorAll;
  p.document.querySelectorAll = () => [];
  p.document.body.textContent = 'Bạn đang mở Zalo trên một Tab khác';
  p.open('Lan'); p.advance(11000);
  p.document.querySelectorAll = query; p.document.body.textContent = '';
  p.mutate(); p.advance(200);
  assert.equal(p.selected(), true);
});

test('opening an existing web conversation restores its editor without scrolling or changing the draft', () => {
  const p = page('/', true, 'zalo');
  const query = p.document.querySelectorAll;
  let focus = null;
  const editor = { getClientRects: () => [{}], focus: (options) => { focus = options; } };
  p.document.querySelectorAll = (q) => q.includes('contenteditable') ? [editor] : query(q);
  p.open('Lan'); p.advance(200);
  assert.equal(focus?.preventScroll, true);
});

test('Messenger goes straight to a cached thread outside its virtual list instead of waiting ten seconds', () => {
  const p = page('/messages/e2ee/t/123/');
  p.open('999');
  assert.equal(p.navigation[0], '/messages/e2ee/t/999/');
});
test('Messenger already at the requested URL can focus its editor without a rendered sidebar row', () => {
  const p = page('/messages/e2ee/t/999/');
  let focused = false;
  const editor = {getClientRects: () => [{}], focus: () => { focused = true; }};
  p.document.querySelectorAll = (q) => q.includes('contenteditable') ? [editor] : [];
  p.open('999'); p.advance(200);
  assert.equal(focused, true);
  assert.equal(p.navigation.length, 0);
});

test('Messenger waits for the selected conversation editor instead of focusing the previous chat during a route commit', () => {
  const p = page('/messages/e2ee/t/123/');
  const query = p.document.querySelectorAll;
  let oldFocused = false, newFocused = false;
  let editor = { getClientRects: () => [{}], getAttribute: () => 'Viết cho Other', focus: () => { oldFocused = true; } };
  p.document.querySelectorAll = (q) => q.includes('contenteditable') ? [editor] : q.includes('heading') ? [] : query(q);
  p.open('123'); p.advance(100);
  assert.equal(oldFocused, false);
  editor = { getClientRects: () => [{}], getAttribute: () => 'Viết cho Lan', focus: () => { newFocused = true; } };
  p.advance(200);
  assert.equal(newFocused, true);
});


test('Zalo recovers a timed-out application chunk without an infinite reload loop', () => {
  const p=page('/',true,'zalo');
  assert.equal(typeof p.listeners.unhandledrejection,'function');
  p.listeners.unhandledrejection({reason:Error('Loading chunk 2 failed. (timeout)')});
  p.advance(1200);
  assert.equal(p.navigation.length,1);
  assert.equal(new URL(p.navigation[0]).hostname,'chat.zalo.me');
  assert.ok(new URL(p.navigation[0]).searchParams.has('_cm_reload'));
  p.listeners.unhandledrejection({reason:Error('ChunkLoadError')});p.advance(1200);
  p.listeners.unhandledrejection({reason:Error('ChunkLoadError')});p.advance(1200);
  assert.equal(p.navigation.length,2);
  assert.ok(p.states.includes('load-error'));
});
