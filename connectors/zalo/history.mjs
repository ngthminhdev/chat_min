// The SDK exposes a GLOBAL backlog, not history by chat. Serialize callers in runtime.
export function collectHistory(listener, {type,id,limit=50,before=0,timeoutMs=12000,maxPages=5}) {
  return new Promise((resolve,reject)=>{
    const selected=new Map(), seen=new Set();let pages=0, finished=false;
    const cleanup=()=>{clearTimeout(timer);listener.off('old_messages',page);listener.off('disconnected',disconnect);};
    const finish=(error)=>{if(finished)return;finished=true;cleanup();error?reject(error):resolve([...selected.values()].sort((a,b)=>Number(a.data.ts)-Number(b.data.ts)).slice(-limit));};
    const disconnect=()=>finish(new Error('Zalo đã ngắt kết nối khi tải tin cũ'));
    const request=(cursor)=>{try{listener.requestOldMessages(type,cursor);}catch{finish(new Error('Không yêu cầu được tin cũ Zalo'));}};
    const page=(messages,oldType)=>{
      if(oldType!==type || !Array.isArray(messages))return;
      pages++;let fresh=0;
      for(const m of messages){const key=String(m.data?.msgId || '');if(!key || seen.has(key))continue;seen.add(key);fresh++;
        if(String(m.threadId)===id && (!before || Number(m.data.ts)<before))selected.set(key,m);
      }
      if(!fresh || selected.size>=limit || pages>=maxPages)return finish();
      const oldest=[...messages].sort((a,b)=>Number(a.data.ts)-Number(b.data.ts))[0];
      request(String(oldest.data.msgId));
    };
    const timer=setTimeout(()=>selected.size?finish():finish(new Error('Zalo chưa trả tin cũ; tin đã lưu vẫn còn trên máy')),timeoutMs);
    listener.on('old_messages',page);listener.once('disconnected',disconnect);request();
  });
}
