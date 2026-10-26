import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWebviewLifecycle } from './webview-lifecycle.ts';
const rect={x:100,y:80,w:600,h:500};
const settle=async()=>{for(let i=0;i<20;i++)await Promise.resolve();};
test('leaving Zalo waits for its pending placement then hides it before the next provider shows',async()=>{
  const calls=[];let finish;
  const start=createWebviewLifecycle({webShow:async(id)=>{calls.push(`show:${id}`);if(id==='zalo')await new Promise(r=>{finish=r;});},webHide:async(id)=>{calls.push(`hide:${id}`);}},e=>{throw e;});
  const zalo=start('zalo','zalo-chat');zalo.place(rect);await settle();
  zalo.dispose();const messenger=start('messenger','messenger-chat');messenger.place(rect);await settle();
  assert.deepEqual(calls,['show:zalo']);finish();await settle();
  assert.deepEqual(calls,['show:zalo','hide:zalo','show:messenger']);
});
test('a stale resize queued before leaving the provider cannot show it again over the active native chat',async()=>{
  const calls=[];
  const start=createWebviewLifecycle({webShow:async(id)=>calls.push(`show:${id}`),webHide:async(id)=>calls.push(`hide:${id}`)},e=>{throw e;});
  const zalo=start('zalo','chat');zalo.place(rect);zalo.dispose();await settle();
  assert.deepEqual(calls,['hide:zalo']);
  zalo.place({...rect,w:700});await settle();assert.deepEqual(calls,['hide:zalo']);
});
