import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTextFormatter } from './format-worker-client.ts';
function fixture() {
  const sent=[];
  const worker={postMessage:m=>sent.push(m),onmessage:null,onerror:null,terminate(){}};
  const formatter=createTextFormatter(()=>worker);
  const finish=html=>worker.onmessage({data:{id:sent.at(-1).id,html}});
  return {formatter,worker,sent,finish};
}
test('formatting is asynchronous, coalesced and cached across mounts',()=>{
  const f=fixture();const results=[];
  f.formatter.subscribe('code',html=>results.push(html));
  f.formatter.subscribe('code',html=>results.push(html));
  assert.equal(f.sent.length,1);assert.equal(results.length,0);
  f.finish('<p>code</p>');
  assert.deepEqual(results,['<p>code</p>','<p>code</p>']);
  assert.equal(f.formatter.peek('code'),'<p>code</p>');
});
test('leaving a message cancels queued work and cannot deliver its late response',()=>{
  const f=fixture();const results=[];
  const cancel=f.formatter.subscribe('old',html=>results.push(html));
  const cancelQueued=f.formatter.subscribe('queued',html=>results.push(html));
  cancel();cancelQueued();f.finish('old html');
  assert.equal(results.length,0);assert.equal(f.sent.length,1);
  f.formatter.subscribe('edited',html=>results.push(html));f.finish('new html');
  assert.deepEqual(results,['new html']);
});
test('worker failure delivers safely escaped plain text without running syntax detection on UI',()=>{
  const f=fixture();const results=[];
  f.formatter.subscribe('<script>alert(1)</script>',html=>results.push(html));
  f.worker.onerror({preventDefault(){}});
  assert.match(results[0],/&lt;script&gt;/);assert.doesNotMatch(results[0],/<script>/);
  f.formatter.subscribe('next',html=>results.push(html));
  assert.match(results[1],/next/);assert.equal(f.sent.length,1);
});
test('cache releases old formatted bodies when retained text/HTML grows',()=>{
  const f=fixture();
  for(let i=0;i<40;i++){f.formatter.subscribe('x'.repeat(20_000)+i,()=>{});f.finish('h'.repeat(20_000));}
  assert.equal(f.formatter.peek('x'.repeat(20_000)+'0'),undefined);
});
