import test from 'node:test';import assert from 'node:assert/strict';import {createCipheriv} from 'node:crypto';
import {installGroupHistory} from './group-cloud.mjs';
function apiFor(leaf){const requests=[],key=Buffer.alloc(16,3);const api={zpwServiceMap:{group_cloud_message:['https://group-cloud.example']},custom(name,fn){this[name]=props=>fn({ctx:{imei:'imei',uid:'1',secretKey:key.toString('base64')},utils:{encodeAES:text=>{requests.push(text);return 'encrypted';},makeURL:(url,p)=>url+'?'+new URLSearchParams(p),request:async url=>{requests.push(url);const c=createCipheriv('aes-128-cbc',key,Buffer.alloc(16));const data=Buffer.concat([c.update(JSON.stringify({error_code:0,data:leaf})),c.final()]).toString('base64');return new Response(JSON.stringify({error_code:0,data}));}},props});}};return {api,requests};}
test('group cloud uses advertised host and preserves exact numeric cursor',async()=>{
 const {api,requests}=apiFor({groupMsgs:[{msgId:'7',idTo:'42',uidFrom:'2',ts:'1793000000000',content:'old'}],lastMsgId:'9007199254740999',hasMore:1,isOld:1});installGroupHistory(api);
 const page=await api.chatminGroupHistory({groupId:'42',cursor:'9007199254740999',old:false,count:50});
 assert.ok(requests[0].includes('"globalMsgId":9007199254740999'));assert.ok(requests[1].startsWith('https://group-cloud.example/api/cm/getrecentv2?'));
 assert.equal(page.cursor,'9007199254740999');assert.equal(page.old,true);assert.equal(page.hasMore,true);assert.equal(page.messages[0].threadId,'42');
});
test('old phase follows explicit phase flag, never guesses from cursor',async()=>{
 const {api,requests}=apiFor({groupMsgs:[],hasMore:0,isOld:1});installGroupHistory(api);await api.chatminGroupHistory({groupId:'42',cursor:'9',old:true,count:10});assert.ok(requests[1].includes('/getoldv2?'));
});
test('invalid cross-chat records and unsafe numeric cursors fail before persistence',async()=>{
 const {api}=apiFor({groupMsgs:[{msgId:'7',idTo:'99',uidFrom:'2',ts:'1793000000000'}]});installGroupHistory(api);
 await assert.rejects(api.chatminGroupHistory({groupId:'42',cursor:'0',count:50}),/identity/);
 await assert.rejects(api.chatminGroupHistory({groupId:'42',cursor:9007199254740999,count:50}),/cursor/);
});
