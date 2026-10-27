// Offline only: owned, clone-decoded WebKit rows -> private SDK-style JSONL.
// Requires connectors/zalo npm dependencies. Input envelopes come from the
// google/dfindexeddb Safari v15 decoder; never pass a database to its CLI logger.
// Public protocol evidence: Zalo default-embed-render.2bae787e513bad5fdb28.js,
// module 9jfX and Message schema: PBKDF2 SHA1/1/32 words, legacy CryptoJS AES-CBC.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import CryptoJS from '../connectors/zalo/node_modules/crypto-js/index.js';
import JSONbig from '../connectors/zalo/node_modules/json-bigint/index.js';
const parseExact=JSONbig({storeAsString:true}).parse;
const MAX_FIELD=2*1024*1024,MAX_ROWS=100000;
const decimal=v=>typeof v==='string'&&/^\d{1,128}$/.test(v);
const IV=[221,179,255,0,79,11,0,70,61,94,221,189,11,233,96,177];
export function createCacheDecoder(secret){
  if(typeof secret!=='string'||!secret||secret.length>8192)throw Error('invalid_key');
  const iv=CryptoJS.lib.WordArray.create(IV);
  const key=CryptoJS.PBKDF2(secret,iv,{keySize:32,hasher:CryptoJS.algo.SHA1,iterations:1});
  return value=>{
    if(typeof value!=='string'||!value||value.length>MAX_FIELD||!/^[A-Za-z0-9+/]+={0,2}$/.test(value)||value.length%4)throw Error('invalid_ciphertext');
    const decoded=CryptoJS.AES.decrypt(value,key,{iv,mode:CryptoJS.mode.CBC}).toString(CryptoJS.enc.Utf8);
    if(!decoded||decoded.length>MAX_FIELD)throw Error('invalid_plaintext');
    return parseExact(decoded);
  };
}
export function decodeCacheRows(envelopes,owner,secret){
  if(!decimal(owner))throw Error('invalid_owner');
  const decode=createCacheDecoder(secret),map=new Map(),blocked=new Set();
  for(const envelope of envelopes){
    if(envelope?.ownerSelfId!==owner)throw Error('ownership_mismatch');
    const r=envelope.data;if(!r || !['chat.undo','chat.delete'].includes(r.originMsgType))continue;
    const group=/^g\d+$/.test(r.toUid),peer=group?r.toUid.slice(1):r.toUid;
    if(!decimal(peer))continue;
    const prefix=`${group?'g':'u'}:${peer}:`;
    if(decimal(r.msgId))blocked.add(prefix+r.msgId);
    try{const control=decode(r.message);if(control && typeof control==='object' && decimal(String(control.globalMsgId || '')))blocked.add(prefix+String(control.globalMsgId));}catch{}
  }
  const report={seen:0,decrypted:0,decode_failed:0,skipped_ttl:0,skipped_id:0,skipped_transform:0,skipped_shape:0,skipped_control:0,suppressed_recalled:0,duplicates:0,exported:0};
  for(const envelope of envelopes){
    if(++report.seen>MAX_ROWS)throw Error('row_budget');
    if(envelope?.ownerSelfId!==owner)throw Error('ownership_mismatch');
    const row=envelope.data;
    if(!row||typeof row!=='object'){report.skipped_shape++;continue;}
    if(row.ev!==1){report.skipped_transform++;continue;}
    if(!Number.isFinite(row.ttl)||row.ttl!==0){report.skipped_ttl++;continue;}
    if(!decimal(row.msgId)){report.skipped_id++;continue;}
    const group=/^g\d+$/.test(row.toUid),peer=group?row.toUid.slice(1):row.toUid;
    const ts=Number(row.serverTime);
    const identity=`${group?'g':'u'}:${peer}:${row.msgId}`;
    if(blocked.has(identity)){report.suppressed_recalled++;continue;}
    if(!decimal(peer)||!decimal(row.fromUid)||!Number.isSafeInteger(ts)||ts<=0||typeof row.originMsgType!=='string'||!row.originMsgType){report.skipped_shape++;continue;}
    if(['chat.undo','chat.delete'].includes(row.originMsgType)){report.skipped_control++;continue;}
    let content,name,quote;
    try{
      content=decode(row.message);
      name=row.dName?decode(row.dName):'';
      quote=typeof row.quote==='string'&&row.quote?decode(row.quote):undefined;
      if(typeof content!=='string'&&(!content||typeof content!=='object'))throw Error('invalid_content');
      if(typeof name!=='string'||(quote!==undefined&&(!quote||typeof quote!=='object')))throw Error('invalid_fields');
      report.decrypted++;
    }catch{report.decode_failed++;continue;}
    if(quote && blocked.has(`${group?'g':'u'}:${peer}:${quote.globalMsgId}`))quote=undefined;
    const isSelf=row.fromUid==='0';
    const data={msgId:row.msgId,cliMsgId:row.cliMsgId,uidFrom:isSelf?owner:row.fromUid,idTo:group?peer:isSelf?peer:owner,ts:String(ts),msgType:row.originMsgType,content,dName:name,mentions:Array.isArray(row.mentions)?row.mentions:[],...(quote?{quote}:{}),...(decimal(row.actionId)?{actionId:row.actionId}:{})};
    const item={ownerSelfId:owner,raw:{type:group?1:0,threadId:peer,isSelf,data},source:{provider:'zalo-web-cache',family:envelope.sourceFamily,recordId:envelope.sourceRecordID,serverTime:row.serverTime,localMsgType:row.msgType,localStatus:row.status}};
    const previous=map.get(identity);
    if(previous){report.duplicates++;if(Number(previous.raw.data.ts)>=ts)continue;}
    map.set(identity,item);
  }
  const rows=[...map.values()].sort((a,b)=>Number(a.raw.data.ts)-Number(b.raw.data.ts));report.exported=rows.length;
  return {rows,report};
}
function privateFile(file){const st=fs.lstatSync(file);if(!st.isFile()||st.isSymbolicLink()||(st.mode&0o077))throw Error('insecure_input');}
function main(){
  const args=process.argv.slice(2),opts={};for(let i=0;i<args.length;i+=2){if(!args[i]?.startsWith('--')||!args[i+1])throw Error('invalid_arguments');opts[args[i].slice(2)]=args[i+1];}
  for(const key of ['key-file','input','output','native-db'])if(!opts[key])throw Error('missing_argument');
  privateFile(opts['key-file']);privateFile(opts.input);
  const auth=JSON.parse(fs.readFileSync(opts['key-file'],'utf8'));
  // Capture only the owning selfId internally; never log native account data.
  const owner=execFileSync('python3',['-c',`import sqlite3,json,sys\nc=sqlite3.connect('file:'+sys.argv[1]+'?mode=ro',uri=True)\na=[json.loads(x[0]) for x in c.execute('select data from accounts')]\nm=[x['selfId'] for x in a if x.get('platform')=='zalo' and x.get('selfId')==sys.argv[2]]\nassert len(m)==1\nsys.stdout.write(m[0])`,opts['native-db'],String(auth.ownerId)],{encoding:'utf8',stdio:['ignore','pipe','pipe']});
  if(owner!==auth.ownerId)throw Error('ownership_mismatch');
  const stat=fs.statSync(opts.input);if(stat.size>256*1024*1024)throw Error('input_budget');
  const envelopes=fs.readFileSync(opts.input,'utf8').split('\n').filter(Boolean).map(s=>JSON.parse(s));
  const {rows,report}=decodeCacheRows(envelopes,owner,auth.dkey);
  const parent=fs.statSync(path.dirname(path.resolve(opts.output)));if(parent.mode&0o077)throw Error('insecure_output_directory');
  const fd=fs.openSync(opts.output,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL,0o600);
  try{for(const row of rows)fs.writeSync(fd,JSON.stringify(row)+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
  process.stdout.write(JSON.stringify({...report,ownership_verified:true})+'\n');
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){try{main();}catch{process.stderr.write('cache_export_failed\n');process.exitCode=1;}}
