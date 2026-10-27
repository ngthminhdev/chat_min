import {normalizeMessage, normalizeChat, normalizeContact, splitChatKey, chatKey} from './normalize.mjs';
import {GlobalBacklog} from './backlog.mjs';
import {ProfileCache} from './profiles.mjs';
import {installGroupHistory} from './group-cloud.mjs';
export const REACTIONS={'❤️':'/-heart','👍':'/-strong','😂':':>','😮':':o','😢':':-((','😡':':-h'};
export class ZaloRuntime {
  constructor({accountId,api,emit,seedProfiles=[],onProfiles=()=>{}}) {
    this.accountId=accountId;this.api=api;this.emit=emit;this.me=String(api.getOwnId());this.users=new Map();this.groups=new Map();this.historyQueue=Promise.resolve();this.eventIds=new Set();
    this.profileCache=new ProfileCache({seed:seedProfiles,load:async ids=>Object.values((await api.getUserInfo(ids)).changed_profiles || {}),onUpdate:profiles=>{this.emit({event:'profiles',profiles});onProfiles(this.profileCache.snapshot());}});
    if(api.custom)installGroupHistory(api);
    this.requests=new Map();this.stickerCatalog=new Map();this.backlog=new GlobalBacklog(api.listener);
  }
  rememberStickers(rows){
    for(const s of rows || [])if(Number.isSafeInteger(s.id) && s.id>0){this.stickerCatalog.delete(s.id);this.stickerCatalog.set(s.id,s);}
    while(this.stickerCatalog.size>512)this.stickerCatalog.delete(this.stickerCatalog.keys().next().value);
  }
  async sticker(id){
    if(!/^[1-9]\d{0,9}$/.test(String(id)) || Number(id)>4294967295)throw Error('invalid_sticker_id');
    const number=Number(id);
    if(!this.stickerCatalog.has(number))this.rememberStickers(await this.api.getStickersDetail([number]));
    const s=this.stickerCatalog.get(number);if(!s)throw Error('sticker_asset_unavailable');return s;
  }
  toMessage(raw){
    const msg=normalizeMessage(this.accountId,raw,this.me),profile=this.profileCache.peek(msg.senderId);
    msg.senderPhoto=profile?.photo || this.users.get(msg.senderId)?.avatar || '';
    msg.senderName=profile?.name || msg.senderName;
    void this.profileCache.get(msg.senderId);
    return msg;
  }
  historyMessages(rows){
    const blocked=new Set();
    for(const raw of rows){
      if(!['chat.undo','chat.delete'].includes(raw.data?.msgType))continue;
      const target=raw.data.content && typeof raw.data.content==='object'?String(raw.data.content.globalMsgId || raw.data.msgId):String(raw.data.msgId);
      if(!/^\d+$/.test(target))continue;
      const chatId=chatKey(raw.type,raw.threadId);blocked.add(`${chatId}:${target}`);
      this.emit({event:'delete',chatId,ids:[target]});
    }
    return rows.filter(raw=>!['chat.undo','chat.delete'].includes(raw.data?.msgType) && !blocked.has(`${chatKey(raw.type,raw.threadId)}:${raw.data?.msgId}`));
  }
  chat(type,id,raw=null){
    const info=type===1?this.groups.get(id):this.users.get(id);
    const profile=type===0?this.profileCache.peek(id):null;
    const fallback=type===0 && !raw?.isSelf && String(raw?.data?.uidFrom)===id?raw.data.dName:'';
    return normalizeChat(this.accountId,type,id,profile?{name:profile.name,avatar:profile.photo}:info || {name:fallback});
  }
  message(raw,isNew) {
    try {
      const msg=this.toMessage(raw);
      const {type,id}=splitChatKey(msg.chatId),chat=this.chat(type,id,raw);
      this.emit({event:'message',msg,chat,isNew});return msg;
    } catch {this.emit({event:'diagnostic',code:'invalid_message'});}
  }
  attach() {
    const l=this.api.listener;
    l.on('message',m=>this.message(m,true));
    l.on('old_messages',ms=>{
      // Import old pages in bounded transactions/events, never as a notification burst.
      for(let i=0;i<(ms?.length || 0);i+=100){
        const messages=[],chats=new Map();
        for(const raw of this.historyMessages(ms.slice(i,i+100))){
          try{const msg=this.toMessage(raw);messages.push(msg);const {type,id}=splitChatKey(msg.chatId);chats.set(msg.chatId,this.chat(type,id,raw));}catch{}
        }
        if(messages.length)this.emit({event:'history',messages,chats:[...chats.values()]});
      }
    });
    l.on('undo',u=>this.emit({event:'delete',chatId:chatKey(u.isGroup?1:0,u.threadId),ids:[String(u.data.content.globalMsgId)]}));
    l.on('reaction',r=>{
      const eid=String(r.data.msgId);if(this.eventIds.has(eid))return;this.eventIds.add(eid);if(this.eventIds.size>2000)this.eventIds.delete(this.eventIds.values().next().value);
      const c=r.data.content;const emoji=Object.keys(REACTIONS).find(k=>REACTIONS[k]===c.rIcon) || c.rIcon;
      this.emit({event:'reaction',chatId:chatKey(r.isGroup?1:0,r.threadId),ids:(c.rMsg || []).map(m=>String(m.gMsgID)),senderId:String(r.data.uidFrom),emoji,remove:c.rType===-1 || !c.rIcon});
    });
    l.on('typing',t=>this.emit({event:'typing',chatId:chatKey(t.type,t.threadId),who:this.users.get(t.data.uid)?.displayName || 'Một người'}));
    l.on('seen_messages',rows=>{for(const s of rows || []){if(s.type===1 && !(s.data.seenUids || []).some(id=>String(id)!==this.me))continue;this.emit({event:'seen',chatId:chatKey(s.type,s.threadId),msgId:String(s.data.msgId)});}});
    l.on('error',()=>this.emit({event:'health',health:'reconnecting',text:'Kết nối Zalo gặp lỗi'}));
  }
  async discover() {
    const friends=await this.api.getAllFriends();
    for(const u of friends || [])this.users.set(String(u.userId),u);
    this.profileCache.remember(friends || []);
    void this.profileCache.get(this.me);
    this.emit({event:'sync',step:1,state:'run',log:'Đang tải nhóm và danh bạ Zalo'});
    const all=await this.api.getAllGroups();const ids=Object.keys(all?.gridVerMap || {});
    for(let i=0;i<ids.length;i+=20){
      const info=await this.api.getGroupInfo(ids.slice(i,i+20));
      for(const [id,g] of Object.entries(info.gridInfoMap || {})){this.groups.set(id,g);this.emit({event:'chat',chat:normalizeChat(this.accountId,1,id,g)});}
    }
    this.emit({event:'sync',step:1,state:'ok',log:'Đã tải nhóm; danh bạ có trong nút Hội thoại mới'});
    this.emit({event:'sync',step:2,state:'run',log:'Đang lấy tin gần đây Zalo trả về'});
    for(const type of [0,1])await this.backlog.read(type).catch(()=>{});
    this.emit({event:'sync',step:2,state:'ok',log:'Đã yêu cầu tin gần đây; lịch sử cũ có thể không đầy đủ'});
  }
  historyQueueRun(fn){const p=this.historyQueue.then(fn);this.historyQueue=p.catch(()=>{});return p;}
  async call(method,p={}) {
    const api=this.api, target=p.chatId?splitChatKey(p.chatId):null;
    switch(method){
      case 'group_history': {
        const id=String(p.groupId);if(!/^\d+$/.test(id))throw Error('invalid_group_history_identity');
        const c=p.checkpoint;
        if(p.before>0 && c?.hasMore===false && (c.before===0 || p.before<=c.before+1))return {messages:[],checkpoint:c};
        const useCheckpoint=p.before>0 && c?.cursor && c?.old!==null && p.before<=c.before+1;
        const key=`${id}:${p.before || 0}:${useCheckpoint?c.cursor:'0'}`;
        if(this.requests.has(key))return this.requests.get(key);
        const request=(async()=>{
          let cursor=useCheckpoint?c.cursor:'0',old=useCheckpoint?c.old:false,checkpoint=c || null;
          const messages=[],seen=new Set(),pairs=new Set();
          for(let i=0;i<3;i++){
            const pair=`${cursor}:${old}`;if(pairs.has(pair))break;pairs.add(pair);
            const page=await api.chatminGroupHistory({groupId:id,cursor,old,count:Math.min(50,p.limit || 50)});
            for(const raw of this.historyMessages(page.messages)){const m=this.toMessage(raw);if(!seen.has(m.id)){seen.add(m.id);messages.push(m);}}
            const oldest=Math.min(...messages.map(m=>m.sort));
            checkpoint={cursor:page.cursor,old:page.old,hasMore:page.hasMore,before:Number.isFinite(oldest)?oldest:p.before || 0,filtered:page.filtered};
            if(!p.before || messages.some(m=>m.sort<p.before) || page.hasMore!==true || !page.cursor || page.old===null)break;
            cursor=page.cursor;old=page.old;
          }
          const partial=!!p.before && checkpoint?.hasMore===true && !messages.some(m=>m.sort<p.before);
          return {messages,checkpoint,partial};
        })().finally(()=>this.requests.delete(key));
        this.requests.set(key,request);return request;
      }
      case 'stickers': {
        const packs=[];
        for(const [keyword,title] of [['hello','Chào hỏi'],['love','Yêu thương'],['haha','Vui vẻ']]){
          const ids=(await api.getStickers(keyword)).filter(id=>Number.isSafeInteger(id) && id>0 && id<=2147483647).slice(0,12);
          const details=ids.length?await api.getStickersDetail(ids):[];this.rememberStickers(details);
          const stickers=details.filter(s=>s.stickerWebpUrl || s.stickerUrl).map(s=>({id:s.id,thumb:s.stickerWebpUrl || s.stickerUrl,thumbKind:'img',emoji:s.text || 'Sticker',width:128,height:128}));
          if(stickers.length)packs.push({id:keyword,title,stickers});
        }
        return packs;
      }
      case 'send_sticker': {
        const s=await this.sticker(p.id);
        if(!Number.isInteger(s.cateId) || s.cateId<0 || !Number.isInteger(s.type) || s.type<=0)throw Error('invalid_sticker_metadata');
        const result=await api.sendSticker({id:s.id,cateId:s.cateId,type:s.type},target.id,target.type);
        if(!result?.msgId)throw Error('sticker_send_unconfirmed');
        return normalizeMessage(this.accountId,{type:target.type,threadId:target.id,isSelf:true,data:{msgId:String(result.msgId),cliMsgId:'',uidFrom:this.me,idTo:target.id,ts:String(Date.now()),dName:'Bạn',msgType:'chat.sticker',content:{id:s.id,catId:s.cateId,type:s.type}}},this.me);
      }
      case 'sticker': {
        const s=await this.sticker(p.id),url=s.stickerWebpUrl || s.stickerUrl;
        if(!url)throw Error('sticker_asset_unavailable');return url;
      }
      case 'contacts': return [...this.users.values()].map(normalizeContact);
      case 'chat': {const chat=this.chat(target.type,target.id);this.emit({event:'chat',chat});return chat;}
      case 'history': {
        const rows=await this.backlog.read(target.type);
        return rows.filter(m=>String(m.threadId)===target.id && (!p.before || Number(m.data.ts)<p.before)).map(m=>this.toMessage(m)).sort((a,b)=>a.sort-b.sort).slice(-Math.min(100,p.limit || 50));
      }
      case 'send': {
        if(p.replyTo && !p.source)throw new Error('Không còn dữ liệu tin trích dẫn');
        const content={msg:p.text || ''};if(p.source)content.quote=p.source;if(p.file)content.attachments=[p.file];
        const result=await api.sendMessage(content,target.id,target.type);
        const ids=[...(result.message?[result.message]:[]),...(result.attachment || [])];
        if(!ids.length)throw new Error('Zalo chưa xác nhận gửi tin');
        const msgs=ids.map((r,i)=>{
          const isFile=p.file && (result.message?i>0:true),now=Date.now();
          const raw={type:target.type,threadId:target.id,isSelf:true,data:{msgId:String(r.msgId),cliMsgId:'',uidFrom:this.me,idTo:target.id,ts:String(now),dName:'Bạn',msgType:'webchat',content:isFile?'':p.text || '',quote:p.source?{globalMsgId:p.source.msgId,fromD:p.source.dName,msg:typeof p.source.content==='string'?p.source.content:''}:undefined}};
          const m=normalizeMessage(this.accountId,raw,this.me);
          if(isFile){m.kind='media';m.media={kind:/\.(png|jpe?g|webp)$/i.test(p.file)?'image':'file',name:p.file.split(/[\\/]/).pop(),size:0,mime:'',width:0,height:0,fileRef:'',localPath:p.file,thumb:'',thumbFile:'',url:''};}
          return m;
        });
        for(const msg of msgs.slice(1))this.emit({event:'message',msg,isNew:false});
        return msgs[0];
      }
      case 'recall': {
        if(!p.source?.cliMsgId)throw new Error('Đợi Zalo đồng bộ tin trước khi thu hồi');
        await api.undo(p.source,target.id,target.type);this.emit({event:'delete',chatId:p.chatId,ids:[String(p.source.msgId)]});return null;
      }
      case 'react': {
        if(!p.source?.cliMsgId)throw new Error('Thiếu dữ liệu tin nhắn Zalo');
        const icon=p.add?REACTIONS[p.emoji]:'';if(icon===undefined)throw new Error('Biểu cảm chưa hỗ trợ');
        await api.addReaction(icon,{data:p.source,threadId:target.id,type:target.type});return null;
      }
      case 'read': if(p.sources?.length)await api.sendSeenEvent(p.sources,target.type);return null;
      case 'members': {
        if(target.type===0)return [];
        const info=await api.getGroupInfo(target.id),g=info.gridInfoMap?.[target.id];
        const ids=(g?.memVerList || []).map(s=>s.split('_')[0]);const users=[];
        for(let i=0;i<ids.length;i+=50){const r=await api.getUserInfo(ids.slice(i,i+50));users.push(...Object.values(r.changed_profiles || {}));}
        return users.map(u=>({id:String(u.userId),name:u.displayName || u.zaloName || String(u.userId),status:'',role:String(u.userId)===String(g?.creatorId)?'owner':'member'}));
      }
      default:throw new Error('Lệnh Zalo không hỗ trợ');
    }
  }
}
