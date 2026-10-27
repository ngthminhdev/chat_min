// Coalesced, bounded user enrichment. No network wait on the live-message delivery path.
export class ProfileCache {
  constructor({load,onUpdate=()=>{},seed=[],delayMs=20,batchSize=50,now=Date.now}){
    this.load=load;this.onUpdate=onUpdate;this.delayMs=delayMs;this.batchSize=batchSize;this.now=now;
    this.entries=new Map(seed.slice(-4000).map(p=>[String(p.id),p]));this.pending=new Map();this.negative=new Map();this.running=false;this.timer=null;
  }
  peek(id){return this.entries.get(String(id));}
  snapshot(){return [...this.entries.values()];}
  remember(rows){
    const updated=[];
    for(const u of rows){const id=String(u.userId || u.id || '');if(!/^\d+$/.test(id))continue;
      const profile={id,name:u.displayName || u.zaloName || u.name || id,photo:u.avatar || u.photo || '',updatedAt:this.now()};
      this.entries.delete(id);this.entries.set(id,profile);updated.push(profile);
    }
    while(this.entries.size>4000)this.entries.delete(this.entries.keys().next().value);
    if(updated.length)this.onUpdate(updated);
    return updated;
  }
  get(id){
    id=String(id);if(!/^\d+$/.test(id))return Promise.resolve(null);
    const cached=this.peek(id);if(cached && this.now()-cached.updatedAt<86400000)return Promise.resolve(cached);
    if((this.negative.get(id) || 0)>this.now())return Promise.resolve(cached || null);
    if(this.pending.has(id))return this.pending.get(id).promise;
    if(this.pending.size>=4000)return Promise.resolve(cached || null);
    let resolve;const promise=new Promise(r=>resolve=r);this.pending.set(id,{promise,resolve});
    if(!this.timer && !this.running)this.timer=setTimeout(()=>{this.timer=null;void this.flush();},this.delayMs);
    return promise;
  }
  async flush(){
    if(this.running)return;this.running=true;
    try{while(this.pending.size){
      const ids=[...this.pending.keys()].slice(0,this.batchSize);
      let rows=[];try{rows=await this.load(ids);}catch{}
      const updated=this.remember(rows || []),found=new Set(updated.map(p=>p.id));
      for(const id of ids){if(!found.has(id))this.negative.set(id,this.now()+60000);const waiter=this.pending.get(id);this.pending.delete(id);waiter?.resolve(this.peek(id) || null);}
      while(this.negative.size>4000)this.negative.delete(this.negative.keys().next().value);
    }}finally{this.running=false;}
  }
}
