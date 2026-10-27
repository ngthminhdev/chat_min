import test from 'node:test';import assert from 'node:assert/strict';import {EventEmitter} from 'node:events';
import {startListener} from './lifecycle.mjs';
test('readiness waits for cipher handshake, then cleans up listeners',async()=>{
 const l=new EventEmitter();let ready=false;l.start=()=>{l.emit('connected');queueMicrotask(()=>{assert.equal(ready,false);l.emit('cipher_key','not-logged');});};l.stop=()=>{};
 await startListener(l,{timeoutMs:100});ready=true;assert.equal(l.listenerCount('cipher_key'),0);assert.equal(l.listenerCount('disconnected'),0);
});
test('timeout stops socket and removes startup listeners',async()=>{
 const l=new EventEmitter();let stopped=0;l.start=()=>{};l.stop=()=>stopped++;
 await assert.rejects(startListener(l,{timeoutMs:5}),/timeout/);assert.equal(stopped,1);assert.equal(l.listenerCount('cipher_key'),0);
});
test('startup disconnect fails promptly and cleans up',async()=>{
 const l=new EventEmitter();l.start=()=>queueMicrotask(()=>l.emit('disconnected',3000));l.stop=()=>{};
 await assert.rejects(startListener(l,{timeoutMs:100}),/disconnected/);assert.doesNotThrow(()=>l.emit('error',Error('late error after socket close')));
});
test('saved-session launch retries network and handshake failures, but not rejected credentials',async()=>{
 const {shouldRetryResume}=await import('./lifecycle.mjs');
 assert.equal(shouldRetryResume(new TypeError('fetch failed')),true);
 assert.equal(shouldRetryResume(Error('socket_timeout')),true);
 assert.equal(shouldRetryResume(Error('Đăng nhập thất bại')),false);
 assert.equal(shouldRetryResume(Object.assign(Error('missing'),{code:'ENOENT'})),false);
});
