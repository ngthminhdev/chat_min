import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {ZaloRuntime} from './runtime.mjs';
const raw={type:0,threadId:'42',isSelf:false,data:{msgId:'5',cliMsgId:'6',uidFrom:'42',idTo:'me',dName:'Lan',ts:'1793000000000',msgType:'webchat',content:'hi'}};
function setup(){const events=[],calls=[],api={listener:new EventEmitter(),getOwnId:()=> 'me',sendMessage:async(...args)=>{calls.push(args);return {message:{msgId:'8'},attachment:[]};},undo:async()=>{throw Error('server rejected');}};return {events,calls,api,r:new ZaloRuntime({accountId:'zalo-a',api,emit:e=>events.push(e)})};}
test('live and backlog deliveries differ for notification purposes',()=>{
 const {r,api,events}=setup();r.attach();api.listener.emit('message',raw);api.listener.emit('old_messages',[raw],0);
 assert.equal(events.filter(e=>e.event==='message')[0].isNew,true);assert.equal(events.filter(e=>e.event==='history')[0].messages.length,1);
});
test('send quote uses persisted provider metadata after restart',async()=>{
 const {r,calls}=setup();const m=await r.call('send',{chatId:'u:42',text:'reply',source:raw.data});
 assert.equal(calls[0][0].quote.msgId,'5');assert.equal(calls[0][1],'42');assert.equal(m.id,'8');assert.equal(m.outgoing,true);
});
test('failed recall must not delete local message',async()=>{
 const {r,events}=setup();await assert.rejects(r.call('recall',{chatId:'u:42',source:raw.data}),/rejected/);
 assert.equal(events.some(e=>e.event==='delete'),false);
});
test('rejects commands requiring raw metadata rather than silently sending unquoted',async()=>{
 const {r,calls}=setup();await assert.rejects(r.call('send',{chatId:'u:42',text:'reply',replyTo:'missing'}),/trích dẫn/);assert.equal(calls.length,0);
});
test('group self-seen must not mark outgoing messages as seen by someone else',()=>{
 const {r,api,events}=setup();r.attach();
 api.listener.emit('seen_messages',[{type:1,threadId:'42',isSelf:true,data:{msgId:'5',seenUids:['me']}}]);
 assert.equal(events.some(e=>e.event==='seen'),false);
 api.listener.emit('seen_messages',[{type:1,threadId:'42',isSelf:false,data:{msgId:'5',seenUids:['other']}}]);
 assert.equal(events.filter(e=>e.event==='seen').length,1);
});
test('old-message bursts use bounded history batches and never live-message notifications',()=>{
 const {r,api,events}=setup();r.attach();const rows=Array.from({length:250},(_,i)=>({...raw,data:{...raw.data,msgId:String(i+1)}}));api.listener.emit('old_messages',rows,0);
 const batches=events.filter(e=>e.event==='history');assert.equal(batches.length,3);assert.equal(batches.reduce((n,e)=>n+e.messages.length,0),250);assert.equal(events.some(e=>e.event==='message'),false);assert.ok(batches.every(e=>e.messages.length<=100));
});
test('exhausted cloud source reuses checkpoint without re-fetching on every scroll',async()=>{
 const {r,api}=setup();let calls=0;api.chatminGroupHistory=async()=>{calls++;return {messages:[],cursor:'0',old:false,hasMore:false};};
 const first=await r.call('group_history',{groupId:'42',before:0,limit:50});
 const next=await r.call('group_history',{groupId:'42',before:1793000000000,limit:50,checkpoint:first.checkpoint});assert.equal(next.messages.length,0);assert.equal(calls,1);
});
test('bounded cloud scan reports partial rather than false end before a sparse old boundary',async()=>{
 const {r,api}=setup();let calls=0;api.chatminGroupHistory=async()=>{calls++;return {messages:[{...raw,type:1,threadId:'42',data:{...raw.data,msgId:String(calls),idTo:'42',ts:String(1100-calls*100)}}],cursor:String(50+calls),old:false,hasMore:true};};
 const page=await r.call('group_history',{groupId:'42',before:100,limit:50});assert.equal(calls,3);assert.equal(page.partial,true);assert.equal(page.checkpoint.hasMore,true);
});
test('historical undo removes its target before publishing any old body',()=>{
 const {r,api,events}=setup();r.attach();const undo={...raw,data:{...raw.data,msgId:'6',msgType:'chat.undo',content:{globalMsgId:'5'}}};api.listener.emit('old_messages',[raw,undo],0);
 assert.ok(events.some(e=>e.event==='delete' && e.ids.includes('5')));assert.equal(events.some(e=>e.event==='history'),false);
});
test('contact identity stays stable across live, history and opening the tab',async()=>{
 const {r,api,events}=setup();r.attach();
 r.users.set('42',{userId:'42',displayName:'Tên cũ',avatar:'https://a.zadn.vn/old.jpg'});
 r.profileCache.remember([{userId:'42',displayName:'Tên danh bạ',avatar:'https://a.zadn.vn/42.jpg'}]);
 const live=r.message(raw,true);assert.equal(live.senderName,'Tên danh bạ');
 assert.equal(events.find(e=>e.event==='message').chat.title,'Tên danh bạ');
 api.listener.emit('old_messages',[raw]);assert.equal(events.find(e=>e.event==='history').chats[0].title,'Tên danh bạ');
 const chat=await r.call('chat',{chatId:'u:42'});assert.equal(chat.title,'Tên danh bạ');assert.equal(chat.photo,'https://a.zadn.vn/42.jpg');
});
test('unknown group metadata never borrows a participant name or DM profile',()=>{
 const {r,events}=setup();r.profileCache.remember([{userId:'42',displayName:'Tên cá nhân',avatar:'https://a.zadn.vn/42.jpg'}]);
 r.message({...raw,type:1,threadId:'42'},true);
 const chat=events.find(e=>e.event==='message').chat;assert.equal(chat.title,'42');assert.equal(chat.photo,'');
});
test('sticker resolver validates identity and prefers animated WebP assets',async()=>{
 const {r,api}=setup();let calls=0;api.getStickersDetail=async ids=>{calls++;assert.deepEqual(ids,[123]);return [{id:123,stickerWebpUrl:'https://a.zdn.vn/s.webp',stickerUrl:'https://a.zdn.vn/s.png'}];};
 assert.equal(await r.call('sticker',{id:'123'}),'https://a.zdn.vn/s.webp');
 await assert.rejects(r.call('sticker',{id:'../123'}));assert.equal(calls,1);
});
test('sticker picker is bounded and sends SDK-verified category/type metadata',async()=>{
 const {r,api}=setup();let sent=null;api.getStickers=async()=>[123];api.getStickersDetail=async()=>[{id:123,cateId:7,type:3,text:'Hi',stickerUrl:'https://a.zdn.vn/s.png'}];
 api.sendSticker=async(...args)=>{sent=args;return {msgId:'9'};};
 const packs=await r.call('stickers');assert.equal(packs.length,3);assert.equal(packs[0].stickers[0].id,123);
 const msg=await r.call('send_sticker',{chatId:'u:42',id:123});
 assert.deepEqual(sent,[{id:123,cateId:7,type:3},'42',0]);assert.equal(msg.id,'9');assert.equal(msg.media.kind,'sticker');assert.equal(msg.media.fileRef,'zalo-sticker:123');
});
