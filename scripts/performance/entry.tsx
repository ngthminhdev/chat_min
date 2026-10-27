import React from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import App from '../../src/App';
import '../../src/styles/layout.css';
import '../../src/styles/components.css';
import {Conversation} from '../../src/components/Conversation';
import {useApp,loadLatest,openChat} from '../../src/store';
import {api} from '../../src/lib/bridge';
import '../../src/styles/tokens.css';
import '../../src/styles/themes.css';
import '../../src/styles/base.css';
import '../../src/styles/chatmin.css';
document.head.insertAdjacentHTML('beforeend','<style>#root{height:100vh}.content{height:100%}</style>');
const provider=new URLSearchParams(location.search).get('provider') || 'telegram';
const a=provider==='zalo'?'zalo-perf':provider==='gchat'?'gc-perf':'tg-perf',keys=[a+'|1',a+'|2'];
const chats=Object.fromEntries(keys.map((k,i)=>[k,{accountId:a,id:String(i+1),kind:'group',description:'',lastTs:1700000000000,preview:'Performance',previewFrom:'',mention:false,muted:false,memberCount:4,order:i,pinned:false,created:'',title:'Performance '+i,photo:'',photoRef:'',canSend:true,unread:0,threaded:false}]));
const messages=(k)=>Array.from({length:Number(new URLSearchParams(location.search).get('count')||100)},(_,i)=>({accountId:a,chatId:k.split('|')[1],id:k+'-'+i,sort:i+1,ts:1700000000000+i*60000,senderId:'peer'+i%4,senderName:'Person '+i%4,senderPhoto:'',outgoing:false,edited:false,deleted:false,kind:'text',text:i%4===0 ? 'Example '+i+'\n```\nfunc handle(w http.ResponseWriter, r *http.Request) {\n  ctx := r.Context()\n  rows, err := db.QueryContext(ctx, "SELECT * FROM users WHERE id = $1", id)\n  if err != nil { return err }\n  defer rows.Close()\n}\n```' : 'Message '+i+' with *bold* and https://example.com/path and some ordinary text for testing the timeline.',media:null,link:null,replyTo:'',replyName:'',replyText:'',reactions:[],threadId:'',threadReply:false,status:'sent',error:'',pinned:false,mentionsMe:false,rev:'1'}));
const pages=Object.fromEntries(keys.map(k=>[k,messages(k)]));
Object.assign(api,{uiState:async()=>null,uiStateSet:async()=>{},cachedMessages:async(_a,c,limit)=>[structuredClone(pages[a+'|'+c].slice(-limit)),[]],messages:async(_a,c)=>structuredClone(pages[a+'|'+c].slice(-50)),appState:async()=>({accounts:useApp.getState().accounts,chats:Object.values(chats),health:{},tgConfigured:true,gchatConfigured:true,mutedThreads:[]}),inbox:async()=>[],presence:async()=>[],setOpen:async()=>{},read:async()=>{},logJs:async()=>{},members:async()=>[],seenBy:async()=>[]});
useApp.setState({accounts:[{id:a,platform:provider,name:'Perf',color:'blue',handle:'',selfId:'self'}],booted:true,chats,msgs:structuredClone(pages),active:keys[0],tabs:keys,older:Object.fromEntries(keys.map(k=>[k,'done'])),rightCollapsed:true});
const root=createRoot(document.getElementById('root'));flushSync(()=>root.render(new URLSearchParams(location.search).has('shell')?<App/>:<Conversation/>));
const paint=()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
window.runPerf=async()=>{
 const switching=[],refresh=[];let frame=0,last=performance.now();const gaps=[];const monitor=t=>{gaps.push(t-last);last=t;frame=requestAnimationFrame(monitor);};frame=requestAnimationFrame(monitor);const loaded=async()=>{for(let n=0;n<180;n++){if(document.querySelector('.msg')&&!document.querySelector('.timeline-skeleton,.text-skeleton'))return;await paint();}throw Error('timeline did not finish loading');};await loaded();
 for(let i=0;i<12;i++){
   const k=keys[i%2];let t=performance.now();flushSync(()=>useApp.setState({active:k}));const cpu=performance.now()-t;await loaded();await paint();switching.push({cpu,total:performance.now()-t});
   t=performance.now();await loadLatest(k);flushSync(()=>{});const cost=performance.now()-t;await paint();refresh.push({cpu:cost,total:performance.now()-t});
 }
 const stats=xs=>{const a=xs.map(x=>x.cpu).sort((a,b)=>a-b);return {median:a[Math.floor(a.length/2)],p95:a.at(-1),samples:xs};};
 cancelAnimationFrame(frame);gaps.sort((a,b)=>a-b);return {frameGaps:{p95:gaps[Math.floor(gaps.length*.95)],max:gaps.at(-1),over25:gaps.filter(x=>x>25).length,count:gaps.length},switching:stats(switching.slice(2)),refresh:stats(refresh.slice(2)),rows:document.querySelectorAll('.msg').length};
};
window.runFunctional=async()=>{
 const tick=async(n=12)=>{for(let i=0;i<n;i++)await new Promise(r=>requestAnimationFrame(r));};
 const ensure=(value,msg)=>{if(!value)throw Error(msg);};
 const state=useApp.getState;
 const k=state().active;
 const viewport=()=>document.querySelector('.virtual-scroller');
 await tick();
 const bounds=()=>viewport().getBoundingClientRect();
 const visible=id=>{const node=document.getElementById('m-'+id);if(!node)return false;const r=node.getBoundingClientRect(),v=bounds();return r.bottom>v.top&&r.top<v.bottom;};
 const list=state().msgs[k];
 ensure(visible(list.at(-1).id),'initial list must show newest message');
 ensure(document.querySelectorAll('.msg').length<30,'DOM must stay bounded');
 useApp.setState({jumpTo:list[10].id});await tick();
 ensure(visible(list[10].id),'jump must mount an offscreen loaded message');
 const anchor=()=>[...document.querySelectorAll('.msg')].find(n=>{const r=n.getBoundingClientRect();return r.top>bounds().top&&r.bottom<bounds().bottom;});
 const node=anchor(),id=node.id,top=node.getBoundingClientRect().top;
 const older=Array.from({length:20},(_,i)=>({...list[0],id:'older-'+i,sort:i-20,text:'older '+i}));
 useApp.setState(s=>({msgs:{...s.msgs,[k]:[...older,...s.msgs[k]]}}));await tick();
 const moved=document.getElementById(id).getBoundingClientRect().top-top;
 ensure(Math.abs(moved)<4,'prepend shifted anchor by '+moved);
 const appended={...list.at(-1),id:'new-arrival',uiKey:undefined,uiPreviousIds:undefined,sort:100000,text:'new arrival'};
 useApp.setState(s=>({msgs:{...s.msgs,[k]:[...s.msgs[k],appended]}}));await tick();
 ensure(Math.abs(document.getElementById(id).getBoundingClientRect().top-top)<4,'incoming moved reader away from anchor');
 ensure(document.querySelector('.jump-bottom')?.textContent.includes('tin mới'),'away reader gets new-message counter');
 useApp.setState(s=>({toLatest:s.toLatest+1}));await tick();ensure(visible('new-arrival'),'notification jump must show newest');
 const last={...appended,id:'follow-arrival',uiKey:undefined,uiPreviousIds:undefined,sort:100001,text:'follow arrival'};
 useApp.setState(s=>({msgs:{...s.msgs,[k]:[...s.msgs[k],last]}}));await tick();ensure(visible('follow-arrival'),'bottom reader follows incoming');
 const lastNode=document.getElementById('m-follow-arrival');const growth=document.createElement('div');growth.style.height='600px';lastNode.appendChild(growth);await tick();ensure(viewport().scrollHeight-viewport().clientHeight-viewport().scrollTop<85,'late content growth must restick bottom');
 return {lateGrowthFollow:true,offscreenJump:true,prependAnchorDelta:moved,awayAppendStable:true,notificationJump:true,bottomFollow:true,mounted:document.querySelectorAll('.msg').length};
};
window.runScroll=async()=>{
  const el=document.querySelector('.virtual-scroller');
  const gaps=[];let frame=0,last=0;
  const monitor=t=>{if(last)gaps.push(t-last);last=t;frame=requestAnimationFrame(monitor);};frame=requestAnimationFrame(monitor);
  const n=90;
  for(let i=0;i<n;i++){
    el.dispatchEvent(new WheelEvent('wheel',{bubbles:true,deltaY:-120}));el.scrollTop-=120;
    await new Promise(r=>requestAnimationFrame(r));
  }
  cancelAnimationFrame(frame);gaps.sort((a,b)=>a-b);
  return {frames:gaps.length,p95:gaps[Math.floor(gaps.length*.95)],max:gaps.at(-1),over25:gaps.filter(x=>x>25).length,mounted:document.querySelectorAll('.msg').length};
};
window.runThreadFunctional=async()=>{
 const tick=async()=>{for(let i=0;i<14;i++)await new Promise(r=>requestAnimationFrame(r));};
 const ensure=(v,msg)=>{if(!v)throw Error(msg);};const k=keys[0],T='perf-thread',tab='thread:'+k+':'+T;
 const base=messages(k)[0];const root={...base,id:'thread-root',sort:1,text:'Thread root',threadId:T,threadReply:false};
 const replies=Array.from({length:20},(_,i)=>({...base,id:'reply-'+(i+81),sort:i+81,text:'Reply '+(i+81),threadId:T,threadReply:true}));
 useApp.setState(s=>({active:tab,tabs:[...s.tabs,tab],chats:{...s.chats,[k]:{...s.chats[k],threaded:true}},msgs:{...s.msgs,[k]:[root,...replies]},threadTabs:{...s.threadTabs,[tab]:{chatKey:k,threadId:T,rootId:root.id,title:'Perf Thread'}},threadPages:{...s.threadPages,[tab]:{token:'older',limit:20}},older:{...s.older,[tab]:'idle'}}));await tick();
 useApp.setState({jumpTo:replies[5].id});await tick();
 const scroller=document.querySelector('.virtual-scroller'),view=scroller.getBoundingClientRect();
 const anchor=[...document.querySelectorAll('.msg')].find(n=>{const r=n.getBoundingClientRect();return r.top>view.top&&r.bottom<view.bottom;});
 ensure(anchor,'thread has visible anchor');const id=anchor.id,top=anchor.getBoundingClientRect().top;const beforeDebug={scroll:scroller.scrollTop,header:scroller.firstElementChild.firstElementChild.getBoundingClientRect().height,rows:[...document.querySelectorAll('.msg')].map(n=>[n.id,n.getBoundingClientRect().top,n.getBoundingClientRect().height])};
 const older=Array.from({length:20},(_,i)=>({...base,id:'reply-'+(i+61),sort:i+61,text:'Older reply '+i,threadId:T,threadReply:true}));
 useApp.setState(s=>({msgs:{...s.msgs,[k]:[root,...older,...replies]},threadPages:{...s.threadPages,[tab]:{token:'next',limit:40}}}));await tick();
 const current=document.getElementById(id);ensure(current,'anchor unmounted '+JSON.stringify({id,top,scrollTop:scroller.scrollTop,visible:[...document.querySelectorAll('.msg')].map(n=>[n.id,n.getBoundingClientRect().top])}));const delta=current.getBoundingClientRect().top-top;ensure(Math.abs(delta)<4,'thread prepend anchor moved '+delta+JSON.stringify({id,top,beforeDebug,header:scroller.firstElementChild.firstElementChild.getBoundingClientRect().height,now:document.getElementById(id)?.getBoundingClientRect().top,scrollTop:scroller.scrollTop,rows:[...document.querySelectorAll('.msg')].map(n=>[n.id,n.getBoundingClientRect().top,n.getBoundingClientRect().height])}));
 useApp.setState({jumpTo:root.id});await tick();const rect=document.getElementById('m-thread-root').getBoundingClientRect();
 ensure(rect.bottom>view.top&&rect.top<view.bottom,'thread root jump must reveal header');
 return {threadPrependAnchorDelta:delta,rootJump:true,mounted:document.querySelectorAll('.msg').length};
};

window.optionsTest={state:useApp.getState,set:useApp.setState,calls:[]};
api.reactions=async()=>['❤','👍','🔥','😂','😮','🙏'];
api.react=async(...args)=>{window.optionsTest.calls.push(args);};

window.optionsTest.group=()=>{const state=useApp.getState(),k=state.active;useApp.setState({chats:{...state.chats,[k]:{...state.chats[k],kind:'group'}},msgs:{...state.msgs,[k]:state.msgs[k].map((m,i,list)=>i===list.length-1?{...m,outgoing:false,senderId:'new-person',senderName:'Group sender',text:'Hi'}:m)}});};

api.browser=async()=>({current:'',installed:[]});
