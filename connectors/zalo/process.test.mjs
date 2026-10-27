import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync,statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import readline from 'node:readline';
import {once} from 'node:events';
const root=fileURLToPath(new URL('../../',import.meta.url));
test('packaged worker speaks only JSON, reports missing session, and exits on parent EOF',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'chatmin-zalo-test-'));
 const child=spawn(join(root,'src-tauri/resources/zalo/node'),[join(root,'src-tauri/resources/zalo/connector.cjs'),'zalo-test',dir,'resume'],{env:{PATH:''}});
 let stderr='';child.stderr.on('data',d=>stderr+=d);
 const frames=[];let resolveAuth,resolveReply;
 const auth=new Promise(r=>resolveAuth=r),reply=new Promise(r=>resolveReply=r);
 const lines=readline.createInterface({input:child.stdout});lines.on('line',line=>{const v=JSON.parse(line);frames.push(v);if(v.event==='auth')resolveAuth(v);if(v.id===1)resolveReply(v);});
 const timer=setTimeout(()=>child.kill('SIGKILL'),3000);
 try{
  const a=await auth;assert.equal(a.step,'error');
  child.stdin.write(JSON.stringify({id:1,method:'contacts',params:{}})+'\n');
  assert.ok((await reply).error);assert.equal(frames.some(f=>f.event==='account'),false);
  const closed=once(child,'exit');child.stdin.end();const [code]=await closed;assert.equal(code,0);assert.equal(stderr,'');
  if(process.platform!=='win32')assert.equal(statSync(dir).mode & 0o777,0o700);
 }finally{clearTimeout(timer);child.kill();rmSync(dir,{recursive:true,force:true});}
});
