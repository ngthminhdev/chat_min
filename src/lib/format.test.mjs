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
