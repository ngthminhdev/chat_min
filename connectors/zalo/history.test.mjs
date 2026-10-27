import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {collectHistory} from './history.mjs';
function listener(pages) {
  const l=new EventEmitter(); l.requests=[];
  l.requestOldMessages=(type,cursor)=>{l.requests.push([type,cursor]);queueMicrotask(()=>l.emit('old_messages',pages.shift() || [],type));};return l;
}
const msg=(id,chat='42',ts=100)=>({threadId:chat,data:{msgId:id,ts}});
test('history filters global backlog, advances by server ID and stops on duplicates', async()=>{
  const l=listener([[msg('1','99',200),msg('2','42',150)],[msg('2','42',150)]]);
  const rows=await collectHistory(l,{type:1,id:'42',limit:30,timeoutMs:100});
  assert.deepEqual(rows.map(m=>m.data.msgId),['2']);assert.equal(l.requests.length,2);assert.equal(l.requests[1][1],'2');
  assert.equal(l.listenerCount('old_messages'),0);
});
test('empty page completes promptly instead of waiting for timeout',async()=>{
  const l=listener([[]]);const rows=await collectHistory(l,{type:0,id:'42',limit:30,timeoutMs:100});
  assert.deepEqual(rows,[]);assert.equal(l.requests.length,1);
});
test('disconnect rejects and removes all request listeners',async()=>{
  const l=new EventEmitter();l.requestOldMessages=()=>queueMicrotask(()=>l.emit('disconnected',1));
  await assert.rejects(collectHistory(l,{type:0,id:'42',timeoutMs:100}),/ngắt/);
  assert.equal(l.listenerCount('old_messages'),0);assert.equal(l.listenerCount('disconnected'),0);
});
