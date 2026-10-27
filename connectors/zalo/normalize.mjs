// Wire objects match model.rs. Never convert provider identifiers to Number.
export function chatKey(type, id) {
  if (![0,1].includes(type) || !/^\d+$/.test(String(id))) throw new Error('Hội thoại Zalo không hợp lệ');
  return `${type === 1 ? 'g' : 'u'}:${id}`;
}
export function splitChatKey(key) {
  const m = /^([ug]):(\d+)$/.exec(key);
  if (!m) throw new Error('Hội thoại Zalo không hợp lệ');
  return {type:m[1] === 'g' ? 1 : 0, id:m[2]};
}
export function normalizeContact(u) {
  return {id:chatKey(0,u.userId),name:u.displayName || u.zaloName || String(u.userId),photo:u.avatar || ''};
}
export function normalizeChat(accountId, type, id, info = {}) {
  return {accountId,id:chatKey(type,id),kind:type===1?'group':'dm',title:info.name || info.displayName || String(id),description:'',lastTs:0,preview:'',previewFrom:'',unread:0,mention:false,muted:false,memberCount:info.totalMember || 0,order:0,pinned:false,canSend:true,threaded:false,created:'',photo:info.fullAvt || info.avt || info.avatar || '',photoRef:'',forum:false};
}
export function normalizeMessage(accountId, raw, me) {
  const d = raw.data ?? {}, ts = Number(d.ts);
  if (!d.msgId || !Number.isSafeInteger(ts) || ts <= 0) throw new Error('Tin Zalo thiếu ID hoặc thời gian');
  const c = d.content, object = c && typeof c === 'object' ? c : null;
  let params={}; try { params=typeof object?.params==='object'?object.params || {}:JSON.parse(object?.params || '{}'); } catch {}
  let media=null;
  const type = d.msgType || '';
  const kind = type==='chat.photo'?'image':type==='chat.video.msg'?'video':type==='chat.voice'?'voice':type==='chat.sticker'?'sticker':type==='share.file'?'file':null;
  if (kind && object) {
    const url=object.href || object.url || object.oriUrl || object.hdUrl || object.normalUrl || params.url || '';
    media={kind,name:object.title || (kind==='image'?'Ảnh':kind==='voice'?'Tin nhắn thoại':kind==='sticker'?'Sticker.webp':'Tệp'),size:Number(params.fileSize || params.size || 0),mime:'',width:Number(params.width || params.video_width || object.width || (kind==='sticker'?128:0)),height:Number(params.height || params.video_height || object.height || (kind==='sticker'?128:0)),fileRef:url || (kind==='sticker' && /^[1-9]\d{0,9}$/.test(String(object.id))?`zalo-sticker:${object.id}`:''),localPath:'',thumb:object.thumb || object.thumbUrl || '',thumbFile:'',url:''};
  }
  const q=d.quote;
  return {accountId,chatId:chatKey(raw.type,String(raw.threadId)),id:String(d.msgId),sort:ts,senderId:String(d.uidFrom || ''),senderName:d.dName || '',senderPhoto:'',outgoing:!!raw.isSelf || String(d.uidFrom)===me,ts,edited:false,deleted:false,kind:media?'media':'text',text:typeof c==='string'?c:media?'':object?.title || object?.description || '[Nội dung Zalo]',media,albumId:String(params.hdId || ''),link:null,replyTo:q?String(q.globalMsgId || ''):'',replyName:q?.fromD || '',replyText:q?.msg || '',reactions:[],threadId:'',threadReply:false,status:raw.isSelf?'sent':'',error:'',pinned:false,mentionsMe:(d.mentions || []).some(m=>String(m.uid)===me || String(m.uid)==='-1'),rev:JSON.stringify(d)};
}
