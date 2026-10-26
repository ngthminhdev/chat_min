import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const compiled = ts.transpileModule(readFileSync(new URL('./format.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
function fixture() {
  let highlights = 0;
  const exports = {};
  vm.runInNewContext(compiled, { exports, require: () => ({ highlight: (code, lang) => {
    highlights++; return { html: code, lang };
  } }) });
  return { fmt: exports.fmt, get highlights() { return highlights; } };
}
const block = '```go\nfunc main() {\n  println("hello")\n}\n```';

test('revisiting a message reuses its formatted body across component mounts', () => {
  const f = fixture();
  const first = f.fmt(block);
  assert.equal(f.fmt(block), first);
  assert.equal(f.highlights, 1, 'syntax detection must not run again for unchanged history');
});

test('format reuse respects changed text and mention identities', () => {
  const f = fixture();
  assert.match(f.fmt('@{Alice}', ['Alice']), /mention me/);
  assert.doesNotMatch(f.fmt('@{Alice}', ['Bob']), /mention me/);
  assert.notEqual(f.fmt(block), f.fmt(block.replace('hello', 'edited')));
  assert.equal(f.highlights, 2);
});

test('format cache is bounded and recently visited messages survive eviction', () => {
  const f = fixture();
  const oldest = f.fmt(block);
  for (let i = 0; i < 300; i++) f.fmt(block + '\n' + i);
  const before = f.highlights;
  assert.equal(f.fmt(block), oldest);
  assert.equal(f.highlights, before + 1, 'old entries must be released');
  f.fmt(block);
  assert.equal(f.highlights, before + 1, 'the freshly visited entry is cached');
});

test('large formatted bodies are bounded by retained size as well as entry count', () => {
  const f = fixture();
  const large = block + 'x'.repeat(20_000);
  f.fmt(large);
  for (let i = 0; i < 40; i++) f.fmt(large + i);
  const before = f.highlights;
  f.fmt(large);
  assert.equal(f.highlights, before + 1, 'large entries cannot retain unlimited message text');
});
