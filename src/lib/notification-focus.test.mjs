import { test } from 'node:test';
import assert from 'node:assert/strict';
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
const K = 'gc-test|spaces/test', T = 'thread';
const settle = async () => { for (let i=0;i<30;i++) await Promise.resolve(); };
function fixture(accepted = true, subscriptionReady = Promise.resolve()) {
  const reads = [], snapshots = [], timers = new Map(); let timerId=0, receive;
  const account = {id:'gc-test',platform:'gchat'};
  const chat = {accountId:account.id,id:'spaces/test',kind:'dm',unread:5,lastTs:1};
  const api = new Proxy({
    markRead: async (...args) => { reads.push(args); return accepted; },
    appState: async () => ({accounts:[account],chats:[chat],health:{},mutedThreads:[]}),
    uiState: async () => null, windowPresence: async () => { snapshots.push(true);return {foreground:false,revision:1}; },
    cachedMessages: async () => [[],[]],
    primaryMessages: async () => ({messages:[],before:0,hasMore:false}),
    threadList: async () => ({threads:[],hasMore:false}),
  }, {get:(o,k)=>o[k] ?? (async()=>[])});
  const modules = {
    zustand:require('zustand'), './lib/bridge':{api,isTauri:true,onEvent:cb=>{receive=cb;return Object.assign(()=>{},{ready:subscriptionReady});}},
    './lib/message-identity':identity,'./lib/ui-persistence':persistence,
    './lib/micro-ux':{bare:x=>x},'./lib/appearance':{windowAppearance:()=>({mode:'solid',transparency:0})},
    './lib/format':{plain:x=>x},'./lib/mobile':{isMobile:false},
    './lib/mobile-navigation':{mobileConversationVisible:()=>true},'./lib/platforms':{PLATFORMS:{gchat:{caps:{}}}},
    './lib/themes':{},'./lib/toast-queue':{queueToast:(items,item)=>[...items,item]},
  };
  const exports={};
  vm.runInNewContext(compiled, {exports,require:name=>{if(!(name in modules))throw Error(name);return modules[name];},
    localStorage:{getItem:()=>null,setItem:()=>{}},
    document:{documentElement:{classList:{contains:()=>false}},hasFocus:()=>true,hidden:false},
    window:{matchMedia:()=>({matches:false})},console,
    setTimeout:(fn,delay)=>{const id=++timerId;timers.set(id,{fn,delay});return id;},clearTimeout:id=>timers.delete(id),
  });
  exports.useApp.setState({accounts:[account],chats:{[K]:chat},msgs:{[K]:[]},active:K,route:'shell',atBottom:true,
    windowPresence:{foreground:true,revision:2}});
  return {...exports,reads,snapshots,set:exports.useApp.setState,state:exports.useApp.getState,receive:e=>receive(e),
    runReads:async()=>{for(const [id,timer] of [...timers])if(timer.delay===250){timers.delete(id);timer.fn();}await settle();}};
}
test('leaving the current desktop cancels an already queued automatic read despite stale DOM focus', async()=>{
  const f=fixture();f.markRead(K,true);
  f.set({windowPresence:{foreground:false,revision:3}});
  await f.runReads();assert.equal(f.reads.length,0);assert.equal(f.state().chats[K].unread,5);
});
test('a native rejection of automatic reading cannot zero the local unread badge', async()=>{
  const f=fixture(false);f.markRead(K,true);await f.runReads();
  assert.equal(f.reads.length,1);assert.equal(f.reads[0][3],true);assert.equal(f.state().chats[K].unread,5);
});
test('an older read acknowledgement cannot clear messages arriving while it was in flight',async()=>{
  let release; const pending = new Promise(resolve=>{release=resolve;});
  const f=fixture(pending);f.markRead(K,true);await f.runReads();
  f.set({chats:{[K]:{...f.state().chats[K],unread:6,lastTs:2}}});
  release(true);await settle();assert.equal(f.state().chats[K].unread,6);
});
test('same-millisecond incoming unread increases survive an older acknowledgement',async()=>{
  let release; const pending = new Promise(resolve=>{release=resolve;});
  const f=fixture(pending);f.markRead(K,true);await f.runReads();
  f.set({chats:{[K]:{...f.state().chats[K],unread:6}}});
  release(true);await settle();assert.equal(f.state().chats[K].unread,6);
});
test('explicit mark-as-read still works independently of foreground state', async()=>{
  const f=fixture();f.set({windowPresence:{foreground:false,revision:3}});f.markRead(K);
  await f.runReads();assert.equal(f.reads.length,1);assert.equal(f.state().chats[K].unread,0);
});
test('a loaded Google Chat thread does not become seen on another desktop',()=>{
  const f=fixture();const tab=f.threadTabKey(K,T);
  f.set({active:tab,threadTabs:{[tab]:{chatKey:K,threadId:T}},windowPresence:{foreground:false,revision:3}});
  f.seenThread(K,T,50);assert.equal(f.state().threadSeen[`${K}#${T}`],undefined);
  f.set({windowPresence:{foreground:true,revision:4}});f.seenThread(K,T,50);
  assert.equal(f.state().threadSeen[`${K}#${T}`],50);
});
test('late foreground snapshots cannot undo a newer desktop-loss event',async()=>{
  const f=fixture();await f.boot();
  f.receive({type:'windowPresence',foreground:true,revision:4});
  assert.equal(f.state().windowPresence.foreground,true);
  f.receive({type:'windowPresence',foreground:false,revision:5});
  f.receive({type:'windowPresence',foreground:true,revision:4});
  assert.equal(f.state().windowPresence.foreground,false);
  await f.runReads();assert.equal(f.reads.length,0);
});
test('returning to a thread never marks its whole parent space read',async()=>{
  const f=fixture();await f.boot();const tab=f.threadTabKey(K,T);
  f.set({active:tab,threadTabs:{[tab]:{chatKey:K,threadId:T}},windowPresence:{foreground:false,revision:3}});
  f.receive({type:'windowPresence',foreground:true,revision:4});
  await f.runReads();assert.equal(f.reads.length,0);assert.equal(f.state().chats[K].unread,5);
});
test('initial native snapshot waits until the event listener is installed',async()=>{
  let release; const ready=new Promise(resolve=>{release=resolve;});
  const f=fixture(true,ready);const boot=f.boot();await settle();
  assert.equal(f.snapshots.length,0);release();await boot;await settle();
  assert.equal(f.snapshots.length,1);
});
