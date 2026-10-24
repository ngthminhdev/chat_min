import { test } from 'node:test';
import assert from 'node:assert/strict';

const invocations = [];
let selection = null;
let pickerError = null;
globalThis.window = {
  __TAURI_INTERNALS__: {
    invoke: async (command, args) => { invocations.push({ command, args }); if (pickerError !== null) throw pickerError; return selection; },
  },
};
globalThis.location = { search: '' };
const bridge = await import('./bridge.ts');

test('photo attachment opens the system media picker with multiple selection', async () => {
  invocations.length = 0;
  selection = ['content://media/external/images/media/123', 'content://media/external/video/media/456'];
  assert.equal(typeof bridge.pickMedia, 'function', 'photo attachment needs a media picker');
  assert.deepEqual(await bridge.pickMedia(), selection);
  assert.equal(invocations.length, 1);
  assert.equal(invocations[0].command, 'plugin:dialog|open');
  assert.equal(invocations[0].args.options.multiple, true);
  assert.equal(invocations[0].args.options.directory, false);
  assert.equal(invocations[0].args.options.pickerMode, 'media');
});

test('cancelled media picking returns no attachments', async () => {
  selection = null;
  assert.equal(typeof bridge.pickMedia, 'function', 'photo attachment needs a media picker');
  assert.deepEqual(await bridge.pickMedia(), []);
});

test('ordinary file picking retains its unrestricted desktop flow', async () => {
  invocations.length = 0;
  selection = ['/tmp/report.pdf'];
  assert.deepEqual(await bridge.pickFiles(), selection);
  assert.deepEqual(invocations[0].args.options, { multiple: true, directory: false });
});


test('Android media/file picker cancellation rejections quietly return no attachments', async () => {
  try {
    for (const error of ['File picker cancelled', new Error('File picker cancelled'), { message: 'File picker cancelled' }]) {
      pickerError = error;
      assert.deepEqual(await bridge.pickMedia(), []);
      assert.deepEqual(await bridge.pickFiles(), []);
    }
  } finally { pickerError = null; }
});

test('real picker failures propagate for an actionable composer error', async () => {
  try {
    for (const error of ['Failed to pick files', new Error('Media provider unavailable')]) {
      pickerError = error;
      await assert.rejects(bridge.pickMedia(), (received) => received === error);
      await assert.rejects(bridge.pickFiles(), (received) => received === error);
    }
  } finally { pickerError = null; }
});
