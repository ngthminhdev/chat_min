import test from 'node:test';
import assert from 'node:assert/strict';
import {PLATFORMS} from './platforms.ts';
test('Zalo exposes shared timeline actions implemented by the native connector',()=>{
  const c=PLATFORMS.zalo.caps;
  assert.equal(c.stickers,true);assert.equal(c.reply,true);assert.equal(c.reactions,true);assert.equal(c.delete,true);
  assert.equal(c.edit,false);assert.equal(c.threads,false);assert.equal(c.voice,false);
});
