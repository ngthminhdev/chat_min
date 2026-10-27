import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {PrivateCache} from './private-cache.mjs';
test('profile cache survives reopen with private permissions and coalesces newer snapshots',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'zalo-cache-'));try{const file=path.join(dir,'profiles.json'),cache=new PrivateCache(file);cache.schedule({users:[{id:'1',name:'old'}]});cache.schedule({users:[{id:'1',name:'new'}]});await cache.flush();assert.equal(new PrivateCache(file).read().users[0].name,'new');if(process.platform!=='win32')assert.equal(fs.statSync(file).mode&0o777,0o600);}finally{fs.rmSync(dir,{recursive:true,force:true});}
});
