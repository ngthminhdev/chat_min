import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';import {execFileSync} from 'node:child_process';
import {Zalo} from '../connectors/zalo/node_modules/zca-js/dist/index.js';
import {normalizeMessage,normalizeChat} from '../connectors/zalo/normalize.mjs';
export function prepareCache(rows,account,friends,chats){
  const users=new Map(friends.map(u=>[String(u.userId),u])),known=new Map(chats.map(c=>[c.id,c])),names=new Map();
  for(const r of rows)if(r.raw.type===0 && !r.raw.isSelf && r.raw.data.dName)names.set(String(r.raw.threadId),r.raw.data.dName);
  return rows.map(r=>{
    if(r.ownerSelfId!==account.selfId)throw Error('ownership_mismatch');
    const msg=normalizeMessage(account.id,r.raw,account.selfId),sender=users.get(msg.senderId);
    msg.senderPhoto=sender?.avatar || '';msg.rev=JSON.stringify({...r.raw.data,_cacheSource:{...r.source,importedAt:Date.now()}});
    const peer=String(r.raw.threadId),info=r.raw.type===0?users.get(peer):null;
    const chat=known.get(msg.chatId) || normalizeChat(account.id,r.raw.type,peer,info || {name:names.get(peer) || peer});
    return {ownerSelfId:account.selfId,msg,chat:{...chat,unread:0,mention:false,canSend:known.has(msg.chatId) || r.raw.type===0}};
  });
}
async function main(){
  const [database,input,output]=process.argv.slice(2);if(!database || !input || !output)throw Error('invalid_arguments');
  const metadata=fs.lstatSync(input);if(!metadata.isFile() || metadata.size>256<<20 || (metadata.mode&0o077))throw Error('input_not_private');
  const rows=fs.readFileSync(input,'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);if(!rows.length)throw Error('empty_import');
  const owner=rows[0].ownerSelfId;
  const code=`import sqlite3,json,sys\nc=sqlite3.connect('file:'+sys.argv[1]+'?mode=ro',uri=True)\na=[json.loads(r[0]) for r in c.execute("select data from accounts where json_extract(data,'$.platform')='zalo'")]\na=[r for r in a if r['selfId']==sys.argv[2]]\nassert len(a)==1\nchats=[json.loads(r[0]) for r in c.execute('select data from chats where account_id=?',[a[0]['id']])]\nprint(json.dumps({'account':a[0],'chats':chats}))`;
  const {account,chats}=JSON.parse(execFileSync('python3',['-c',code,database,owner],{encoding:'utf8',stdio:['ignore','pipe','pipe']}));
  const dir=path.join(path.dirname(database),'zalo',account.id);
  const api=await new Zalo({logging:false,checkUpdate:false}).login(JSON.parse(fs.readFileSync(path.join(dir,'session.json'),'utf8')));
  if(String(api.getOwnId())!==owner)throw Error('ownership_mismatch');
  const friends=await api.getAllFriends();
  const records=prepareCache(rows,account,friends,chats);
  const users=friends.map(u=>({id:String(u.userId),name:u.displayName || u.zaloName || String(u.userId),photo:u.avatar || '',updatedAt:Date.now()}));
  const profileTmp=path.join(dir,`profiles.import-${process.pid}.tmp`);fs.writeFileSync(profileTmp,JSON.stringify({users}),{mode:0o600});fs.chmodSync(profileTmp,0o600);fs.renameSync(profileTmp,path.join(dir,'profiles.json'));
  const parent=fs.statSync(path.dirname(path.resolve(output)));if(parent.mode&0o077)throw Error('output_not_private');
  const fd=fs.openSync(output,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL,0o600);
  try{for(const r of records)fs.writeSync(fd,JSON.stringify(r)+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
  console.log(JSON.stringify({prepared:records.length,conversations:new Set(records.map(r=>r.msg.chatId)).size,profiles:users.length,listenerStarted:false}));
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(()=>{process.stderr.write('cache_prepare_failed\n');process.exitCode=1;});
