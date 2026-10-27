import test from 'node:test';import assert from 'node:assert/strict';import {ProfileCache} from './profiles.mjs';
test('coalesces concurrent sender lookups into one bounded batch and caches missing IDs',async()=>{
 const calls=[];const cache=new ProfileCache({delayMs:0,load:async ids=>{calls.push(ids);return [{userId:'42',displayName:'Lan',avatar:'https://a.zadn.vn/42.jpg'}];}});
 const [a,b,c]=await Promise.all([cache.get('42'),cache.get('43'),cache.get('42')]);
 assert.equal(calls.length,1);assert.equal(a.photo,'https://a.zadn.vn/42.jpg');assert.equal(c,a);assert.equal(b,null);
 await cache.get('43');assert.equal(calls.length,1);
});
test('seeded cached profiles are available synchronously without fetching on every message',async()=>{
 let calls=0;const cache=new ProfileCache({seed:[{id:'42',name:'Lan',photo:'https://a.zadn.vn/42.jpg',updatedAt:Date.now()}],load:async()=>{calls++;return [];}});
 for(let i=0;i<1000;i++)assert.equal(cache.peek('42').name,'Lan');
 assert.equal((await cache.get('42')).name,'Lan');assert.equal(calls,0);
});
test('caps profile request batch sizes and serializes network work',async()=>{
 let active=0,max=0;const sizes=[];const cache=new ProfileCache({delayMs:0,batchSize:2,load:async ids=>{active++;max=Math.max(max,active);sizes.push(ids.length);await new Promise(r=>setTimeout(r,1));active--;return ids.map(id=>({userId:id,displayName:id,avatar:''}));}});
 await Promise.all(['1','2','3','4','5'].map(id=>cache.get(id)));assert.deepEqual(sizes,[2,2,1]);assert.equal(max,1);
});
