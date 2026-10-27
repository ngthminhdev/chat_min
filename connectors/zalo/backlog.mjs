// Global replay belongs to the socket, not to the chat currently open in the UI.
export class GlobalBacklog {
  constructor(listener,{maxPages=3,timeoutMs=12000}={}){this.listener=listener;this.maxPages=maxPages;this.timeoutMs=timeoutMs;this.states=new Map();
    listener.on('chatmin_history_page',p=>{
      const state=this.states.get(p?.type);if(!state?.error)return;
      const more=p.more===true || p.more===1,ended=p.more===false || p.more===0;
      const cursor=String(p.lastActionId ?? '');
      if(ended || more && /^\d{1,30}$/.test(cursor) && (typeof p.lastActionId!=='number' || Number.isSafeInteger(p.lastActionId)) && cursor!==state.cursor){state.cursor=cursor;state.more=more;state.error=null;}
    });
  }
  read(type){
    let s=this.states.get(type);if(!s){s={first:true,cursor:null,more:true,pending:null,error:null};this.states.set(type,s);}
    if(s.pending)return s.pending;if(s.error)return Promise.reject(s.error);if(!s.more)return Promise.resolve([]);
    s.pending=(async()=>{const rows=[],seen=new Set(),cursors=new Set();
      for(let i=0;i<this.maxPages && s.more;i++){
        const first=s.first,cursor=s.cursor;s.first=false;
        const page=await this.page(type,first,cursor).catch(e=>{s.error=e;throw e;});
        for(const m of page.messages || []){const key=`${m.threadId}:${m.data?.msgId}`;if(!seen.has(key)){seen.add(key);rows.push(m);}}
        if(page.more!==true && page.more!==1 && page.more!==false && page.more!==0){s.error=Error('backlog_continuation_unknown');throw s.error;}
        s.more=page.more===true || page.more===1;
        if(!s.more)break;
        const next=String(page.lastActionId ?? '');
        if(!/^\d{1,30}$/.test(next) || typeof page.lastActionId==='number' && !Number.isSafeInteger(page.lastActionId) || next===cursor || cursors.has(next)){s.error=Error('backlog_cursor_stalled');throw s.error;}
        cursors.add(next);s.cursor=next;
      }
      return rows;
    })().finally(()=>{s.pending=null;});return s.pending;
  }
  page(type,first,cursor){return new Promise((resolve,reject)=>{
    const l=this.listener;
    const cleanup=()=>{clearTimeout(timer);l.off('chatmin_history_page',page);l.off('disconnected',disconnect);};
    const page=p=>{if(p?.type!==type)return;cleanup();resolve(p);};
    const disconnect=()=>{cleanup();reject(Error('backlog_disconnected'));};
    const timer=setTimeout(()=>{cleanup();reject(Error('backlog_timeout'));},this.timeoutMs);
    l.on('chatmin_history_page',page);l.once('disconnected',disconnect);
    try{l.sendWs({version:1,cmd:type===1?511:510,subCmd:1,data:{first,lastId:first?null:cursor,preIds:[]}});}catch{disconnect();}
  });}
}
