import test from 'node:test';import assert from 'node:assert/strict';import {EventEmitter} from 'node:events';import {GlobalBacklog} from './backlog.mjs';
function socket(pages){const s=new EventEmitter();s.requests=[];s.sendWs=p=>{s.requests.push(p);queueMicrotask(()=>s.emit('chatmin_history_page',pages.shift()));};return s;}
test('global replay runs first/null only once per socket and coalesces concurrent chat requests',async()=>{
 const s=socket([{type:0,messages:[{data:{msgId:'1'}}],more:false,lastActionId:'8'}]);const b=new GlobalBacklog(s);
 const [a,c]=await Promise.all([b.read(0),b.read(0)]);assert.equal(a.length,1);assert.equal(c.length,1);assert.equal(s.requests.length,1);assert.equal(s.requests[0].data.first,true);
 assert.deepEqual(await b.read(0),[]);assert.equal(s.requests.length,1);
});
test('continuation uses exact action cursor and first=false rather than message ID',async()=>{
 const s=socket([{type:0,messages:[{data:{msgId:'5'}}],more:true,lastActionId:'9007199254740999'},{type:0,messages:[{data:{msgId:'6'}}],more:0,lastActionId:'9007199254740998'}]);const b=new GlobalBacklog(s);
 const rows=await b.read(0);assert.equal(rows.length,2);assert.equal(s.requests[1].data.first,false);assert.equal(s.requests[1].data.lastId,'9007199254740999');
});
test('bounded replay continues on next request without restarting the first page',async()=>{
 const s=socket([{type:1,messages:[{data:{msgId:'5'}}],more:1,lastActionId:'100'},{type:1,messages:[],more:0,lastActionId:'99'}]);const b=new GlobalBacklog(s,{maxPages:1});
 await b.read(1);await b.read(1);assert.equal(s.requests.length,2);assert.equal(s.requests[1].data.lastId,'100');
});
test('a transient timeout stays retryable and a late page can recover cursor state',async()=>{
 const s=new EventEmitter();let calls=0;s.sendWs=()=>calls++;const b=new GlobalBacklog(s,{timeoutMs:5});
 await assert.rejects(b.read(0),/timeout/);await assert.rejects(b.read(0),/timeout/);assert.equal(calls,1);
 s.emit('chatmin_history_page',{type:0,messages:[],more:false,lastActionId:'5'});
 assert.deepEqual(await b.read(0),[]);
});
test('late recovery rejects rounded and unchanged continuation cursors',async()=>{
 const s=new EventEmitter();s.sendWs=()=>{};const b=new GlobalBacklog(s,{timeoutMs:5});
 await assert.rejects(b.read(0),/timeout/);
 s.emit('chatmin_history_page',{type:0,more:true,lastActionId:9007199254740999});
 assert.ok(b.states.get(0).error);
 await assert.rejects(b.read(0),/timeout/);
 s.emit('chatmin_history_page',{type:0,more:true,lastActionId:'100'});
 assert.equal(b.states.get(0).cursor,'100');
 await assert.rejects(b.read(0),/timeout/);
 s.emit('chatmin_history_page',{type:0,more:true,lastActionId:'100'});
 assert.ok(b.states.get(0).error);
 await assert.rejects(b.read(0),/timeout/);
});
