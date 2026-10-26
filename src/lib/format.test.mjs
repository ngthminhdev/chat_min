import { test } from "node:test";
import assert from "node:assert/strict";
import { fmt, plain, norm, initials, listTime, dayLabel } from "./format.ts";

test("fmt escapes, then renders code, links and mentions", () => {
  assert.equal(
    fmt("a <b> `x<y` @{Trí Võ} [PR](https://g.io/1) https://x.io/a."),
    '<p>a &lt;b&gt; <code>x&lt;y</code> <span class="mention">@Trí Võ</span> <a class="msg-link" href="https://g.io/1">PR</a> <a class="msg-link" href="https://x.io/a">https://x.io/a</a>.</p>',
  );
  assert.equal(fmt("@{tri} hi", ["tri"]), '<p><span class="mention me">@tri</span> hi</p>');
  assert.equal(fmt("a\nb\n\nc"), "<p>a<br>b</p><p>c</p>");
  // no linkifying inside code
  assert.equal(fmt("`https://x.io`"), "<p><code>https://x.io</code></p>");
});

test("**bold** with a space before the closing marker, as Google's rich composer writes it", () => {
  assert.equal(fmt("**Starting 26 October, **VIBE will"), "<p><strong>Starting 26 October, </strong>VIBE will</p>");
  assert.equal(fmt("**Need Support? **\nIf"), "<p><strong>Need Support? </strong><br>If</p>");
  assert.equal(fmt("2 ** 3 ** 4 and a**b**"), "<p>2 ** 3 ** 4 and a**b**</p>");
  assert.equal(plain("**Need Support? **If"), "Need Support? If");
});

test("plain / norm / initials", () => {
  assert.equal(plain("Hi @{Lan}  [doc](https://d.io) `go`\nok"), "Hi @Lan doc go ok");
  assert.equal(norm("Đồng Văn"), "dong van");
  assert.equal(initials("Nguyễn Hoàng Bảo Khánh (Mobile Team)"), "BK");
  assert.equal(initials("Backend Go — Mine Wallet", true), "BG");
});

test("times relative to now", () => {
  const now = new Date(2026, 9, 22, 12, 0).getTime();
  assert.equal(listTime(new Date(2026, 9, 22, 9, 58).getTime(), now), "09:58");
  assert.equal(listTime(new Date(2026, 9, 21, 20, 0).getTime(), now), "Hôm qua");
  assert.equal(listTime(new Date(2026, 9, 1).getTime(), now), "01/10");
  assert.equal(dayLabel(new Date(2026, 9, 22, 9).getTime(), now), "Hôm nay · Thứ Năm 22/10");
});

test('fuzzy: whole words, then letters in order, accents and đ ignored', async () => {
  const { fuzzy } = await import('./format.ts');
  assert.equal(fuzzy('backend', 'Backend Go — Mine Wallet'), 2);
  assert.equal(fuzzy('bgo', 'Backend Go — Mine Wallet'), 1);
  assert.equal(fuzzy('mtran', 'Minh Trần'), 1);
  assert.equal(fuzzy('go wallet', 'Backend Go — Mine Wallet'), 4);
  assert.equal(fuzzy('wallet go', 'Backend Go — Mine Wallet'), 4);
  assert.equal(fuzzy('đông', 'Hội anh em đi Đồng Văn'), 2);
  assert.equal(fuzzy('xyz', 'Backend Go'), 0);
  assert.equal(fuzzy('gob', 'Backend Go'), 0);
  assert.equal(fuzzy('', 'anything'), 0);
});

test("a zero-width space after a marker keeps it literal (plain-text sends, literal * in received text)", () => {
  const z = "​";
  assert.equal(fmt(`*${z}abc*${z} and *bold*`), `<p>*${z}abc*${z} and <strong>bold</strong></p>`);
  assert.equal(fmt(`\`${z}x\`${z}`), `<p>\`${z}x\`${z}</p>`);
  assert.equal(plain(`*${z}abc*${z} *b*`), "*abc* b");
});
