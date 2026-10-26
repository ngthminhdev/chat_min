import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
const require = createRequire(import.meta.url);
const compiled = ts.transpileModule(readFileSync(new URL('../store.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText.replaceAll("import.meta.env.DEV", "false").replaceAll("import.meta.hot", "undefined");
const identity = await import('./message-identity.ts');
const persistence = await import('./ui-persistence.ts');
const settle = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b; }); return { promise, resolve, reject }; };
const K = 'gc-test|spaces/test', T = 'spaces/test/threads/a';
const msg = (id, sort, reply = true) => ({ id, sort, ts: sort, accountId: 'gc-test', chatId: 'spaces/test', kind: 'text', text: id, threadId: T, threadReply: reply });
function fixture(overrides = {}) {
  const calls = [];
  const api = new Proxy({
    messages: async () => [msg('reply', 2)],
    cachedMessages: async () => [[], []], setOpen: async () => {}, read: async () => {},
    thread: (...args) => { calls.push(['thread', ...args]); return new Promise(() => {}); },
    threadRoot: async (...args) => { calls.push(['root', ...args]); return [msg('root', 1, false)]; },
    ...overrides,
  }, { get: (o,k) => o[k] ?? (async () => []) });
  const messages = api.messages;
  api.messages = (a,c,b,...rest) => { calls.push(["messages",a,c,b,...rest]); return b > 0 ? Promise.resolve([]) : messages(a,c,b,...rest); };
  const modules = {
    zustand: require('zustand'), './lib/bridge': { api }, './lib/message-identity': identity,
    './lib/ui-persistence': persistence, './lib/appearance': { windowAppearance: () => ({ mode:'solid', transparency:0 }) },
    './lib/format': { plain: x => x }, './lib/mobile': { isMobile:false },
    './lib/mobile-navigation': { mobileConversationVisible: () => true }, './lib/platforms': { PLATFORMS: { gchat: { caps:{} } } }, './lib/themes': {}, './lib/toast-queue': {},
  };
  const exports = {};
  vm.runInNewContext(compiled, { exports, require: name => { if (!(name in modules)) throw Error(name); return modules[name]; },
    localStorage: { getItem: () => null, setItem: () => {} },
    document: { documentElement:{ classList:{ contains: () => false } }, hasFocus: () => false, hidden: true },
    window: { matchMedia: () => ({matches:false}) },
    setTimeout: () => 0, clearTimeout: () => {}, console,
  });
  exports.useApp.setState({ accounts:[{ id:'gc-test', platform:'gchat' }], chats:{ [K]:{ accountId:'gc-test', id:'spaces/test', threaded:true } }, active:K });
  return { ...exports, calls, state: exports.useApp.getState, set: exports.useApp.setState };
}

test('the main page paints and resolves without waiting for a thread response', async () => {
  const roots = deferred();
  const f = fixture({ threadRoot: () => roots.promise }); let resolved = false;
  void f.loadLatest(K).then(() => { resolved = true; }); await settle();
  assert.ok(f.state().msgs[K]?.some(m => m.id === 'reply'), 'primary response is already visible');
  assert.equal(resolved, true, 'thread loading cannot block primary completion');
  assert.equal(f.calls.filter(c => c[0] === 'thread').length, 0, 'missing roots never fetch full thread bodies');
});

test('a thread opens at 20 newest messages and only top-scroll requests the next page', async () => {
  const pages = [];
  const f = fixture({ messages: async () => [msg('root',1,false)], thread: async (...args) => {
    pages.push(args); return { messages:[msg(pages.length === 1 ? 'latest' : 'older', pages.length === 1 ? 100 : 50)], nextPageToken: pages.length === 1 ? 'next+token' : '' };
  }});
  f.set({ msgs:{ [K]:[msg('root',1,false)] } });
  f.openThreadTab(K, msg('root',1,false)); await settle();
  const tab = f.state().active;
  assert.equal(pages.length, 1); assert.equal(pages[0][3], '');
  assert.equal(pages[0][4], 20);
  assert.equal(f.state().older[tab], 'idle');
  await f.loadOlderThread(tab);
  assert.equal(pages.length, 2); assert.equal(pages[1][3], 'next+token');
  assert.equal(f.state().older[tab], 'done');
  assert.deepEqual(Array.from(f.state().msgs[K], m => m.id), ['root','older','latest']);
  await f.loadOlderThread(tab); assert.equal(pages.length, 2);
});

test('a failed older page preserves the current messages and retries the same cursor', async () => {
  const pending = deferred(); let calls = 0; const tokens = [];
  const f = fixture({ messages: async () => [msg('root',1,false)], thread: async (_a,_c,_t,token) => {
    calls++; tokens.push(token);
    if (calls === 1) return {messages:[msg('latest',100)], nextPageToken:'retry-me'};
    if (calls === 2) return pending.promise;
    return {messages:[msg('older',50)],nextPageToken:''};
  }});
  f.set({ msgs:{ [K]:[msg('root',1,false)] } }); f.openThreadTab(K,msg('root',1,false)); await settle();
  const tab = f.state().active;
  const first = f.loadOlderThread(tab); const duplicate = f.loadOlderThread(tab); await settle();
  assert.equal(calls, 2, 'concurrent scroll events coalesce');
  pending.reject(Error('network down')); await first; await duplicate;
  assert.ok(f.state().msgs[K].some(m => m.id === 'latest'));
  assert.match(f.state().threadTabs[tab].error, /network down/);
  assert.equal(f.state().threadTabs[tab].errorOlder, true);
  await f.loadOlderThread(tab);
  assert.deepEqual(tokens, ['', 'retry-me','retry-me']);
});


test('unopened thread previews keep only the newest 20 replies and retain primary messages', async () => {
  const replyPage = [msg('root',1,false), ...Array.from({length:80}, (_,i) => msg(`reply-${i+2}`,i+2)), msg('outside',200,false)];
  const f = fixture({ messages: async () => replyPage });
  await f.loadLatest(K); await settle();
  const list = f.state().msgs[K];
  assert.equal(list.filter(m => m.threadReply).length,20);
  assert.equal(list.find(m => m.threadReply).sort,62);
  assert.ok(list.some(m => m.id === 'outside'));
  assert.ok(list.some(m => m.id === 'root'));
});

test('refresh re-enables pagination when a previously complete short thread grows', async () => {
  let call = 0;
  const f = fixture({ thread: async () => ++call === 1
    ? {messages:[msg('old',10)],nextPageToken:''}
    : {messages:[msg('overlap',9),msg('old',10),msg('new',30)],nextPageToken:'now-more'} });
  f.set({ msgs:{[K]:[msg('root',1,false)]} });
  f.openThreadTab(K,msg('root',1,false)); await settle(); const tab=f.state().active;
  assert.equal(f.state().older[tab], 'done');
  await f.openChat(tab); await settle();
  assert.equal(f.state().older[tab], 'idle');
  assert.equal(f.state().threadPages[tab].token,'now-more');
});

test('trimming a large chat invalidates thread cursors so reopening cannot skip discarded pages', async () => {
  const f = fixture({thread: async () => ({messages:[msg('newest',500)],nextPageToken:'fresh'})});
  const tab=f.threadTabKey(K,T);
  f.set({msgs:{[K]:Array.from({length:300},(_,i)=>msg(`m-${i+1}`,i+1))},
    threadTabs:{[tab]:{chatKey:K,threadId:T,rootId:'root',title:'Thread'}},
    threadPages:{[tab]:{token:'already-past-these',limit:300}},
    chats:{...f.state().chats,'other|c':{accountId:'other',id:'c'}}});
  await f.openChat('other|c'); await settle();
  assert.equal(f.state().threadPages[tab], undefined);
  await f.openChat(tab); await settle();
  assert.equal(f.state().threadPages[tab].token,'fresh');
  assert.equal(f.state().threadPages[tab].limit,20);
});

test('closing a thread releases pagination and ignores a late page response', async () => {
  const pending=deferred();
  const f=fixture({thread:()=>pending.promise});
  f.set({msgs:{[K]:[msg('root',1,false)]}});
  f.openThreadTab(K,msg('root',1,false)); await settle(); const tab=f.state().active;
  f.closeTab(tab);
  pending.resolve({messages:[msg('late',100)],nextPageToken:'stale-token'}); await settle();
  assert.equal(f.state().threadPages[tab],undefined);
  assert.equal(f.state().older[tab],undefined);
});

test('an older request finishing after chat trimming cannot restore a discarded cursor', async () => {
  const pending=deferred();
  const f=fixture({thread:()=>pending.promise}); const tab=f.threadTabKey(K,T);
  f.set({msgs:{[K]:Array.from({length:300},(_,i)=>msg(`m-${i+1}`,i+1))},
    active:tab, tabs:[K,tab], threadTabs:{[tab]:{chatKey:K,threadId:T,rootId:'root',title:'Thread'}},
    threadPages:{[tab]:{token:'older',limit:300}},older:{[tab]:'idle'},
    chats:{...f.state().chats,'other|c':{accountId:'other',id:'c'}}});
  const request=f.loadOlderThread(tab); await settle();
  await f.openChat('other|c'); await settle();
  pending.resolve({messages:[msg('stale-older',0)],nextPageToken:'skip-discarded'}); await request;
  assert.equal(f.state().threadPages[tab],undefined);
  assert.equal(f.state().msgs[K].some(m=>m.id==='stale-older'),false);
});


test('a failed latest refresh retries latest rather than an exhausted older cursor', async () => {
  let calls=0;
  const f=fixture({thread:async()=>{ if(++calls===1) return {messages:[msg('last',10)],nextPageToken:''}; throw Error('refresh down'); }});
  f.set({msgs:{[K]:[msg('root',1,false)]}}); f.openThreadTab(K,msg('root',1,false)); await settle();
  const tab=f.state().active; await f.openChat(tab); await settle();
  assert.equal(f.state().threadTabs[tab].errorOlder,false);
});

test('Telegram topics retain their cached-chat-first loading path', async () => {
  const calls=[];
  const f=fixture({cachedMessages:async()=>{calls.push('cache');return [[msg('cached',2)],[]];},
    messages:async()=>{calls.push('space');return [];},
    topicHistory:async()=>{calls.push('topic');return [];}});
  const tab=f.threadTabKey(K,T);
  f.set({threadTabs:{[tab]:{chatKey:K,threadId:T,rootId:'',title:'Topic',topic:true}}});
  await f.openChat(tab); await settle();
  assert.equal(calls[0],'cache'); assert.ok(calls.includes('topic'));
  assert.equal(f.calls.some(c=>c[0]==='thread'),false);
});

test('a reply-heavy space does not download older pages just to manufacture 25 rows', async () => {
  const requests=[];
  const f=fixture({messages:async(...args)=>{requests.push(args);return Array.from({length:100},(_,i)=>msg(`r-${i}`,i+100));}});
  await f.loadLatest(K);await settle();
  assert.equal(f.calls.filter(c=>c[0]==="messages").length,1);
  assert.notEqual(f.state().older[K],'done','there can still be older history without reading it automatically');
});

test('threaded cache requests primary messages instead of a 400-reply window', async () => {
  const requests=[];
  const roots=Array.from({length:50},(_,i)=>msg(`root-${i}`,i+1,false));
  const f=fixture({cachedMessages:async(...args)=>{requests.push(args);return [[],roots];},messages:()=>new Promise(()=>{})});
  void f.openChat(K);await settle();
  assert.equal(requests[0][2],50);
  assert.equal(requests[0][3],true);
  assert.equal(f.state().msgs[K].filter(m=>!m.threadReply).length,50,'roots-only cache paints while network is pending');
});

test('capping a previously complete thread after live growth invalidates its exact-count claim', async () => {
  const f=fixture({messages:async()=>Array.from({length:10},(_,i)=>msg(`new-${i}`,i+42))});
  const tab=f.threadTabKey(K,T);
  f.set({msgs:{[K]:[msg('root',1,false),...Array.from({length:40},(_,i)=>msg(`old-${i}`,i+2))]},
    threadPages:{[tab]:{token:'',limit:40}}});
  await f.loadLatest(K);await settle();
  assert.equal(f.state().msgs[K].filter(m=>m.threadReply).length,40);
  assert.equal(f.state().threadPages[tab].truncated,true);
});

test('thread-heavy trimming retains main roots and main history uses an independent cursor', async () => {
  const requests=[];
  const roots=Array.from({length:50},(_,i)=>msg(`primary-${i}`,100+i,false));
  const f=fixture({primaryMessages:async(...args)=>{requests.push(args);return {messages:[msg('older-primary',90,false)],before:90,hasMore:true};},messages:async()=>Array.from({length:100},(_,i)=>msg(`tail-${i}`,500+i))});
  const tab=f.threadTabKey(K,T);
  f.set({msgs:{[K]:[...roots,...Array.from({length:300},(_,i)=>msg(`body-${i}`,200+i))]},
    threadTabs:{[tab]:{chatKey:K,threadId:T,rootId:'primary-0',title:'Thread'}},threadPages:{[tab]:{token:'thread-next',limit:300}},
    chats:{...f.state().chats,'other|c':{accountId:'other',id:'c'}}});
  await f.openChat('other|c');await settle();
  assert.equal(f.state().msgs[K].filter(m=>!m.threadReply).length,50);
  await f.openChat(K);await settle();
  assert.equal(f.state().msgs[K].filter(m=>!m.threadReply).length,50,'latest reply-only refresh preserves main roots');
  const threadPage=f.state().threadPages[tab];
  await f.loadOlder(K);await settle();
  assert.equal(requests[0][2],100,'main cursor starts at oldest primary, independent of reply history');
  assert.ok(f.state().msgs[K].some(m=>m.id==='older-primary'));
  assert.equal(f.state().threadPages[tab],threadPage);
});

test('a reply-only older main page keeps continuation without claiming history ended', async () => {
  const requests=[];
  const f=fixture({primaryMessages:async(_a,_c,before)=>{requests.push(before);return requests.length===1
    ? {messages:[],before:50,hasMore:true}:{messages:[msg('old-root',40,false)],before:40,hasMore:false};}});
  f.set({msgs:{[K]:[msg('root',100,false)]}});
  await f.loadOlder(K);
  assert.equal(f.state().older[K],'idle');
  await f.loadOlder(K);
  assert.deepEqual(requests,[100,50]);
  assert.equal(f.state().older[K],'done');
  assert.ok(f.state().msgs[K].some(m=>m.id==='old-root'));
});

test('rapidly reopening a chat coalesces the in-flight latest refresh', async () => {
  const pending = deferred(); let requests = 0;
  const f = fixture({ messages: () => { requests++; return pending.promise; } });
  f.set({ msgs: { [K]: [msg('root', 1, false)] } });
  await f.openChat(K); await f.openChat(K); await settle();
  assert.equal(requests, 1, 'switching back while the page is pending must reuse its request');
  pending.resolve([msg('root', 1, false)]); await settle();
  await f.openChat(K); await settle();
  assert.equal(requests, 2, 'a completed request does not suppress subsequent refreshes');
});

test('a failed latest request is released so opening the chat can retry', async () => {
  const pending = deferred(); let requests = 0;
  const f = fixture({ messages: () => { requests++; return requests === 1 ? pending.promise : Promise.resolve([msg('root', 1, false)]); } });
  const first = f.loadLatest(K), duplicate = f.loadLatest(K);
  pending.reject(Error('temporarily offline'));
  await Promise.all([first, duplicate]);
  assert.equal(requests, 1);
  await f.loadLatest(K);
  assert.equal(requests, 2);
  assert.equal(f.state().loadErr[K], '');
});
