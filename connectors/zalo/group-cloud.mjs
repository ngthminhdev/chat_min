// Protocol evidence: zca-js PR370 (4eeceafa), zl-mcp group-history-page contract.
// Uses the current authenticated session and its advertised service, never a guessed host.
import {createDecipheriv} from 'node:crypto';
import JSONbig from 'json-bigint';
import {GroupMessage} from 'zca-js';
const parse=JSONbig({storeAsString:true}).parse;
function decimal(value){
  if(typeof value==='number' && !Number.isSafeInteger(value))throw Error('invalid_history_cursor');
  const s=String(value);if(!/^\d{1,30}$/.test(s))throw Error('invalid_history_cursor');return s;
}
function flag(v){if(v===undefined || v===null)return null;if(v===true || v===1)return true;if(v===false || v===0)return false;throw Error('invalid_history_flag');}
async function body(response){
  if(!response.ok)throw Error('group_history_http_'+response.status);
  const reader=response.body.getReader();let bytes=0;const parts=[];
  try{for(;;){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>8*1024*1024)throw Error('history_response_too_large');parts.push(Buffer.from(value));}}
  catch(e){await reader.cancel().catch(()=>{});throw e;}
  return parse(Buffer.concat(parts).toString('utf8'));
}
export function installGroupHistory(api){
  api.custom('chatminGroupHistory',async({ctx,utils,props:p})=>{
    const groupId=decimal(p.groupId),cursor=decimal(p.cursor ?? '0'),count=Math.max(1,Math.min(50,p.count || 50));
    const host=api.zpwServiceMap.group_cloud_message?.[0];if(!host)throw Error('group_history_source_unavailable');
    const payload=JSON.stringify({groupId,count,msgIds:[],imei:ctx.imei,src:3}).replace(/}$/,`,"globalMsgId":${cursor}}`);
    const params=utils.encodeAES(payload);if(!params)throw Error('history_encrypt_failed');
    const url=utils.makeURL(host+(p.old?'/api/cm/getoldv2':'/api/cm/getrecentv2'),{params,nretry:0});
    const outer=await body(await utils.request(url,{method:'GET',signal:AbortSignal.timeout(15000)}));
    if(outer.error_code!==0)throw Error('group_history_rejected');
    const key=Buffer.from(ctx.secretKey,'base64'),decipher=createDecipheriv(`aes-${key.length*8}-cbc`,key,Buffer.alloc(16));
    const decoded=Buffer.concat([decipher.update(Buffer.from(decodeURIComponent(outer.data),'base64')),decipher.final()]);
    if(decoded.length>8*1024*1024)throw Error('history_response_too_large');
    const inner=parse(decoded.toString('utf8'));if(inner.error_code!==0)throw Error('group_history_rejected');
    const leaf=typeof inner.data==='string'?parse(inner.data):inner.data;
    if(!leaf || !Array.isArray(leaf.groupMsgs) || leaf.groupMsgs.length>count)throw Error('invalid_group_history_page');
    if(leaf.error && leaf.error!==0)throw Error('group_history_rejected');
    const messages=leaf.groupMsgs.map(raw=>{
      if(String(raw.idTo)!==groupId || !raw.msgId || !raw.ts)throw Error('invalid_group_history_identity');
      for(const k of ['msgId','cliMsgId','uidFrom','idTo','ts'])if(raw[k]!==undefined)raw[k]=decimal(raw[k]);
      return new GroupMessage(String(ctx.uid),raw);
    });
    return {messages,cursor:leaf.lastMsgId===undefined || leaf.lastMsgId===null?null:decimal(leaf.lastMsgId),hasMore:flag(leaf.hasMore),old:flag(leaf.isOld),filtered:flag(leaf.isFiltered) || flag(leaf.isFilteredByPhase) || flag(leaf.isFilteredByTimeJoin)};
  });
}
