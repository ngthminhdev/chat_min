import test from 'node:test';
import assert from 'node:assert/strict';
import CryptoJS from './node_modules/crypto-js/index.js';
import {decodeCacheRows,createCacheDecoder} from '../../scripts/decode-zalo-cache.mjs';
const owner='123456789',secret='synthetic-cache-secret';
const iv=CryptoJS.lib.WordArray.create([221,179,255,0,79,11,0,70,61,94,221,189,11,233,96,177]);
const key=CryptoJS.PBKDF2(secret,iv,{keySize:32,hasher:CryptoJS.algo.SHA1,iterations:1});
const enc=v=>CryptoJS.AES.encrypt(JSON.stringify(v),key,{iv,mode:CryptoJS.mode.CBC}).ciphertext.toString(CryptoJS.enc.Base64);
const fixture=()=>({ownerSelfId:owner,sourceFamily:'synthetic',sourceRecordID:1,data:{ev:1,msgId:'987654321',cliMsgId:'2',toUid:'g555',fromUid:'0',serverTime:'1793000000000',sendDttm:'1793000000000',originMsgType:'webchat',ttl:0,message:enc('Synthetic text'),dName:enc('Synthetic name'),quote:enc({globalMsgId:'123'}),mentions:[]}});
test('decodes exact legacy transform and maps self/group and quote',()=>{const {rows,report}=decodeCacheRows([fixture()],owner,secret);assert.equal(rows.length,1);assert.equal(rows[0].raw.data.content,'Synthetic text');assert.equal(rows[0].raw.data.dName,'Synthetic name');assert.equal(rows[0].raw.data.quote.globalMsgId,'123');assert.equal(rows[0].raw.threadId,'555');assert.equal(rows[0].raw.data.uidFrom,owner);assert.equal(rows[0].raw.isSelf,true);assert.equal(report.decrypted,1);});
test('rejects foreign owner before attempting decryption',()=>{const f=fixture();f.ownerSelfId='other';assert.throws(()=>decodeCacheRows([f],owner,secret),/ownership_mismatch/);});
test('excludes expiring and synthetic IDs, deduplicates typed identity',()=>{const a=fixture(),b=fixture(),c=fixture(),d=fixture();b.data.ttl=100;c.data.msgId='local-temp';d.sourceRecordID=9;const r=decodeCacheRows([a,b,c,d],owner,secret);assert.equal(r.rows.length,1);assert.equal(r.report.skipped_ttl,1);assert.equal(r.report.skipped_id,1);assert.equal(r.report.duplicates,1);});
test('wrong key never imports ciphertext as text',()=>{const r=decodeCacheRows([fixture()],owner,'wrong');assert.equal(r.rows.length,0);assert.equal(r.report.decode_failed,1);});
test('rejects unsupported transform and unsafe timestamps',()=>{const a=fixture(),b=fixture();a.data.ev=0;b.data.serverTime='NaN';const r=decodeCacheRows([a,b],owner,secret);assert.equal(r.rows.length,0);assert.equal(r.report.skipped_transform,1);assert.equal(r.report.skipped_shape,1);});

test('recall tombstones suppress older copies and references without resurrecting their text',()=>{
 const old=fixture(),undo=fixture(),quoted=fixture();undo.data.originMsgType='chat.undo';undo.data.message=enc('recalled');quoted.data.msgId='999';quoted.data.quote=enc({globalMsgId:old.data.msgId,msg:'old quoted text'});
 const r=decodeCacheRows([old,undo,quoted],owner,secret);assert.equal(r.rows.length,1);assert.equal(r.rows[0].raw.data.msgId,'999');assert.equal(r.rows[0].raw.data.quote,undefined);assert.equal(r.report.suppressed_recalled,2);
});
test('large numeric provider identifiers in encrypted JSON retain every decimal digit',()=>{
 const f=fixture();f.data.quote=CryptoJS.AES.encrypt('{"globalMsgId":9007199254740999}',key,{iv,mode:CryptoJS.mode.CBC}).ciphertext.toString(CryptoJS.enc.Base64);
 const r=decodeCacheRows([f],owner,secret);assert.equal(r.rows[0].raw.data.quote.globalMsgId,'9007199254740999');
});
