import { test } from 'node:test';
import assert from 'node:assert/strict';
import { persistedUiChanged } from './ui-persistence.ts';
test('incoming messages and transient UI events do not schedule localStorage writes', () => {
  const before = { drafts: {}, tabs: [], prefs: {}, chats: {}, msgs: {}, typing: {}, health: {} };
  for (const field of ['chats', 'msgs', 'typing', 'health', 'hoverPeek', 'fileProgress']) {
    assert.equal(persistedUiChanged({ ...before, [field]: { changed: true } }, before), false, field);
  }
});
test('drafts, account notification settings and saved tab state still persist', () => {
  const before = { drafts: {}, tabs: [], prefs: {}, notif: {} };
  for (const field of ['drafts', 'tabs', 'prefs', 'notif', 'favorites', 'plainSend']) {
    assert.equal(persistedUiChanged({ ...before, [field]: { changed: true } }, before), true, field);
  }
  assert.equal(persistedUiChanged(before, before), false);
});

test('durable snapshots whitelist settings and restore pins after WebView data is empty', async () => {
  const ui = await import('./ui-persistence.ts');
  const snapshot = ui.uiSnapshot({favorites:['a|chat'], prefs:{quickReactions:['🔥']}, notif:{a:{quiet:true}}, msgs:{secret:'not persisted'}, pop:{kind:'menu'}});
  assert.equal(snapshot.msgs,undefined); assert.equal(snapshot.pop,undefined);
  assert.deepEqual(ui.restoreUi({},snapshot).favorites,['a|chat']);
  assert.deepEqual(ui.restoreUi({prefs:{size:13}},snapshot).prefs,{size:13,quickReactions:['🔥']});
});
test('native snapshot writes serialize and coalesce so an old write cannot replace new pins', async () => {
  const {createUiWriter} = await import('./ui-persistence.ts');
  let release; const blocked = new Promise(r=>release=r); const writes=[];
  const save = createUiWriter(async value=>{writes.push(value); if(writes.length===1)await blocked;});
  const one=save({favorites:['old']}); await Promise.resolve();
  const two=save({favorites:['middle']}), three=save({favorites:['new']});
  assert.equal(writes.length,1); release(); await Promise.all([one,two,three]);
  assert.deepEqual(writes.map(x=>x.favorites),[['old'],['new']]);
});

test('a failed old write does not strand a newer queued pin change', async () => {
  const {createUiWriter} = await import('./ui-persistence.ts');
  let reject; const blocked = new Promise((_,r)=>reject=r); const writes=[];
  const save=createUiWriter(async snapshot=>{writes.push(snapshot);if(writes.length===1)await blocked;});
  const first=save({favorites:['old']});await Promise.resolve();
  const latest=save({favorites:['new']});reject(Error('temporary failure'));
  await Promise.allSettled([first,latest]);
  assert.deepEqual(writes.map(x=>x.favorites),[['old'],['new']]);
});
test('a newer browser backup survives an older native snapshot after an IPC failure', async () => {
  const {restoreUi} = await import('./ui-persistence.ts');
  assert.deepEqual(restoreUi({favorites:['new'],_savedAt:2},{favorites:['old'],_savedAt:1}).favorites,['new']);
  assert.deepEqual(restoreUi({favorites:['old'],_savedAt:1},{favorites:['new'],_savedAt:2}).favorites,['new']);
});
