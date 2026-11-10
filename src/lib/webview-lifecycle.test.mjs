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

test('changing Messenger threads keeps the current WebView visible and navigates once', async () => {
  const calls = [];
  const start = createWebviewLifecycle({
    webShow: async (account, chat, bounds, navigate) => calls.push(['show', account, chat, bounds, navigate]),
    webHide: async (account) => calls.push(['hide', account]),
  }, (error) => { throw error; });
  const first = start('messenger', 'one');
  first.place(rect);
  await settle();
  first.dispose();
  const second = start('messenger', 'two');
  second.place(rect);
  await settle();
  assert.deepEqual(calls, [['show', 'messenger', 'one', rect, true], ['show', 'messenger', 'two', rect, true]]);
  second.dispose();
  await settle();
  assert.deepEqual(calls.at(-1), ['hide', 'messenger'], 'leaving for an overlay or native chat still hides it');
});

test('a resize burst sends only the latest pending bounds after an in-flight placement', async () => {
  const calls = [];
  let finish;
  const start = createWebviewLifecycle({
    webShow: async (_account, _chat, bounds, navigate) => {
      calls.push([bounds.w, navigate]);
      if (bounds.w === rect.w) await new Promise((resolve) => { finish = resolve; });
    },
    webHide: async () => {},
  }, (error) => { throw error; });
  const view = start('messenger', 'one');
  view.place(rect);
  await settle();
  view.place({ ...rect, w: 650 });
  view.place({ ...rect, w: 700 });
  view.place({ ...rect, w: 750 });
  finish();
  await settle();
  assert.deepEqual(calls, [[600, true], [750, false]]);
});

test('a failed same-account switch hides the old surface so its retry UI can show', async () => {
  const calls = [];
  const error = new Error('placement failed');
  const start = createWebviewLifecycle({
    webShow: async (_account, chat) => {
      calls.push(chat);
      if (chat === 'two') throw error;
    },
    webHide: async (account) => calls.push(account),
  }, (failure) => calls.push(failure));
  const first = start('messenger', 'one');
  first.place(rect);
  await settle();
  first.dispose();
  const second = start('messenger', 'two');
  second.place(rect);
  await settle();
  assert.deepEqual(calls, ['one', 'two', 'messenger', error]);
});
