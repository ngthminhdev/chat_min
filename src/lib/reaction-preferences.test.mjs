import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as ux from './micro-ux.ts';
test('quick choices preserve the provider heart code and exclude forbidden custom emoji', () => {
  const choices = ux.reactionChoices(['🔥','❤️'], ['❤','👍'], false);
  assert.deepEqual(choices.map(x => x[0]), ['❤','👍']);
});
test('custom quick slots stay unique and swap an existing selection', () => {
  const defaults = ux.quickReactions();
  const changed = ux.replaceQuickReaction(defaults,0,'🙏');
  assert.equal(changed[0],'🙏'); assert.equal(changed[5],'👍');
  assert.equal(new Set(changed.map(ux.bare)).size,6);
  assert.deepEqual(ux.reactionChoices(changed,undefined,false).slice(0,6).map(x=>x[0]),changed);
});
