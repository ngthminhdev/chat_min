import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import {patchListener} from './sdk-patches.mjs';
test('patched pinned SDK decoder exposes action cursor without changing old message event',async()=>{
 const source=patchListener(fs.readFileSync(new URL('./node_modules/zca-js/dist/apis/listen.js',import.meta.url),'utf8'));
 const block=source.slice(source.indexOf('if (cmd == 510'),source.indexOf('if (cmd == 511'));
 const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
 const handler=new AsyncFunction('cmd','subCmd','decodeEventData','parsed','UserMessage','ThreadType',block);
 const events=[];await handler.call({ctx:{uid:'me'},emit:(...e)=>events.push(e)},510,1,async()=>({data:{msgs:[{msgId:'5'}],more:true,lastActionId:'9007199254740999'}}),{},class{constructor(_,data){this.data=data;}},{User:0});
 assert.equal(events[0][0],'old_messages');assert.equal(events[1][0],'chatmin_history_page');assert.equal(events[1][1].lastActionId,'9007199254740999');assert.equal(events[1][1].messages[0].data.msgId,'5');
});
