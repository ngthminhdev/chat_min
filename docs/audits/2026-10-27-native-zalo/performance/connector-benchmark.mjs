// Offline only: all provider methods are in-memory fakes; no main.mjs/login/socket.
import {EventEmitter} from 'node:events';
import {performance} from 'node:perf_hooks';
import {writeFileSync} from 'node:fs';
import {normalizeMessage} from '../../../../connectors/zalo/normalize.mjs';
import {ZaloRuntime} from '../../../../connectors/zalo/runtime.mjs';
import {ProfileCache} from '../../../../connectors/zalo/profiles.mjs';
const now=Date.now(),n=10000,unique=250;
const rows=Array.from({length:n},(_,i)=>({type:1,threadId:'100',isSelf:false,data:{msgId:String(i+1),uidFrom:String(i%unique+1000),ts:String(now+i),dName:'Synthetic',msgType:i%4===0?'chat.photo':'webchat',content:i%4===0?{href:'',title:'Synthetic',params:'{"width":128,"height":128}'}:'Synthetic benchmark message'}}));
const stats=v=>{const a=[...v].sort((a,b)=>a-b);return {iterations:a.length,median_ms:a[Math.floor(a.length/2)],p95_ms:a[Math.ceil(a.length*.95)-1],max_ms:a.at(-1)};};
const syncBench=(fn,count=100)=>{for(let i=0;i<10;i++)fn();const times=[];for(let i=0;i<count;i++){const t=performance.now();fn();times.push(performance.now()-t);}return stats(times);};
const output={scope:'Offline production modules imported directly; synthetic rows and EventEmitter/fake APIs only. Excludes network/Rust ingestion/SQLite writes/IPC/UI.',node:process.version,rows:n,unique_senders:unique};
output.normalize_10000=syncBench(()=>{for(const r of rows)normalizeMessage('synthetic',r,'1');});
const seed=Array.from({length:unique},(_,i)=>({id:String(i+1000),name:'Synthetic',photo:'',updatedAt:now}));
let events=0,messages=0,profileCalls=0;
const api={listener:new EventEmitter(),getOwnId:()=> '1',getUserInfo:async ids=>{profileCalls++;return {changed_profiles:Object.fromEntries(ids.map(id=>[id,{userId:id,displayName:'Synthetic'}]))};}};
const runtime=new ZaloRuntime({accountId:'synthetic',api,seedProfiles:seed,emit:e=>{if(e.event==='history'){events++;messages+=e.messages.length;}}});runtime.attach();
output.old_messages_10000=syncBench(()=>api.listener.emit('old_messages',rows));
events=0;messages=0;api.listener.emit('old_messages',rows);
output.history_batching={input_messages:n,history_events:events,output_messages:messages,maximum_configured_batch:100,profile_api_calls_seeded:profileCalls};
// Cold cache: repeated requests coalesce by identity, unique identities batch by 50.
const profileSamples=[];let last;
for(let i=0;i<30;i++){
 let calls=0,loaded=0,maxBatch=0,updates=0;
 const cache=new ProfileCache({delayMs:0,load:async ids=>{calls++;loaded+=ids.length;maxBatch=Math.max(maxBatch,ids.length);return ids.map(id=>({userId:id,displayName:'Synthetic'}));},onUpdate:()=>updates++});
 const t=performance.now();
 await Promise.all(rows.map(r=>cache.get(r.data.uidFrom)));
 profileSamples.push(performance.now()-t);
 last={requests:n,distinct_identities:unique,load_calls:calls,loaded_identities:loaded,max_batch:maxBatch,profile_update_events:updates,cached_profiles:cache.snapshot().length};
}
output.profile_cold_10000_requests={...stats(profileSamples),...last,includes_timer_delay:true};
// Fake backlog reply exercises bounded pagination and concurrent reader sharing.
let backlogRequests=0;
const listener=new EventEmitter();
listener.sendWs=()=>{const page=backlogRequests++;queueMicrotask(()=>listener.emit('chatmin_history_page',{type:0,messages:rows.slice(page*100,page*100+100).map(r=>({...r,type:0})),more:page<2,lastActionId:String(page+1)}));};
const backlogRuntime=new ZaloRuntime({accountId:'synthetic',api:{...api,listener},seedProfiles:seed,emit:()=>{}});
const start=performance.now();const pages=await Promise.all(Array.from({length:20},()=>backlogRuntime.backlog.read(0)));
output.backlog_coalescing={concurrent_readers:20,fake_page_requests:backlogRequests,rows_each:pages[0].length,all_share_result:pages.every(p=>p===pages[0]),elapsed_ms:performance.now()-start};
let groupCalls=0;
const groupRuntime=new ZaloRuntime({accountId:'synthetic',api:{...api,listener:new EventEmitter(),chatminGroupHistory:async()=>{groupCalls++;await Promise.resolve();return {messages:rows.slice(0,50),cursor:'2',old:false,hasMore:false};}},seedProfiles:seed,emit:()=>{}});
const gstart=performance.now();const gp=await Promise.all(Array.from({length:20},()=>groupRuntime.call('group_history',{groupId:'100',before:0,limit:50})));
output.group_history_coalescing={concurrent_requests:20,fake_provider_calls:groupCalls,messages_each:gp[0].messages.length,elapsed_ms:performance.now()-gstart};
writeFileSync(new URL('./connector-results.json',import.meta.url),JSON.stringify(output,null,2)+'\n');
console.log(JSON.stringify(output,null,2));
