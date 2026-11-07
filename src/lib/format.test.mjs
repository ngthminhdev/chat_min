import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { normalizeMessage } from "../../connectors/zalo/normalize.mjs";
import { fmt, plain, norm, initials, listTime, dayLabel } from "./format.ts";

test("fmt escapes, then renders code, links and mentions", () => {
  assert.equal(
    fmt("a <b> `x<y` @{Trí Võ} [PR](https://g.io/1) https://x.io/a."),
    '<p>a &lt;b&gt; <code>x&lt;y</code> <span class="mention">@Trí Võ</span> <a class="msg-link" href="https://g.io/1">PR</a> <a class="msg-link" href="https://x.io/a">https://x.io/a</a>.</p>',
  );
  assert.equal(fmt("@{tri} hi", ["tri"]), '<p><span class="mention me">@tri</span> hi</p>');
  assert.equal(fmt("a\nb\n\nc"), "<p>a<br>b<br><br>c</p>");
  // no linkifying inside code
  assert.equal(fmt("`https://x.io`"), "<p><code>https://x.io</code></p>");
});

test('location messages show the complete clickable Google Maps URL', () => {
  const url='https://www.google.com/maps/search/?api=1&query=10.7277429%2C106.7098618';
  const html=fmt(`Kids story 유치원\nQuận 7\n${url}`);
  const escaped=url.replaceAll('&','&amp;');
  assert.equal(html,`<p>Kids story 유치원<br>Quận 7<br><a class="msg-link" href="${escaped}">${escaped}</a></p>`);
});

test('a Zalo Maps recommendation with an empty title renders its full original link', () => {
  const [fixture]=JSON.parse(readFileSync(new URL('../../connectors/zalo/link-fixtures.json',import.meta.url),'utf8'));
  const m=normalizeMessage('zalo-a',{type:0,threadId:'42',data:{msgId:'123',ts:'1793000000000',msgType:'chat.recommended',content:fixture.content}},'me');
  const html=fmt(m.text),url=fixture.content.href;
  assert(html.includes(`<a class="msg-link" href="${url}">${url}</a>`));
  assert(html.includes('Quán cà phê · Hồ Chí Minh'));
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

test('message bodies retain blank lines, including leading and trailing breaks', () => {
  assert.equal(fmt('\nfirst\n\n\nlast\n'), '<p><br>first<br><br><br>last<br></p>');
  assert.equal(fmt('a\r\nb\r\n\r\nc'), '<p>a<br>b<br><br>c</p>');
});

test('bold closing whitespace never consumes the next line', () => {
  assert.equal(fmt('**hello\n**world'), '<p>**hello<br>**world</p>');
});

test("lists: numbered, blank lines between items, wrapped continuation lines; quotes", () => {
  assert.equal(fmt("plan:\n  - a long item,\n    wrapped by Google\n\n  - second"), "<p>plan:</p><ul><li>a long item,<br>wrapped by Google</li><li>second</li></ul>");
  assert.equal(fmt("1. one\n2. two\nend"), "<ol><li>one</li><li>two</li></ol><p>end</p>");
  assert.equal(fmt("3) c\n4) d"), '<ol start="3"><li>c</li><li>d</li></ol>');
  assert.equal(fmt("> quoted\n> *line*\nreply"), "<blockquote>quoted<br><strong>line</strong></blockquote><p>reply</p>");
  assert.equal(plain("> q\n- a"), "q • a");
  assert.equal(plain("~~gone~~ **b**"), "gone b");
  assert.equal(plain("# T\n__u__ ||s||"), "T u s");
});

test("a URL followed by a quote keeps the quote out of the link; bold inside link labels", () => {
  assert.equal(fmt("curl 'http://x.io/a?v&s=1'"), '<p>curl &#39;<a class="msg-link" href="http://x.io/a?v&amp;s=1">http://x.io/a?v&amp;s=1</a>&#39;</p>');
  assert.equal(fmt("see [**Open**](https://x.io) now"), '<p>see <a class="msg-link" href="https://x.io"><strong>Open</strong></a> now</p>');
  // Google wraps long labels at 80 columns, inside the bold run
  assert.equal(fmt("[**Open\nPositions**](https://x.io)"), '<p><a class="msg-link" href="https://x.io"><strong>Open Positions</strong></a></p>');
});

test("splitMessage cuts long texts at line breaks, then spaces, same lines in both forms", async () => {
  const { splitMessage } = await import("./format.ts");
  assert.deepEqual(splitMessage("short", "short", 10), [{ shown: "short", wire: "short" }]);
  const parts = splitMessage("aaaa\nbbbb\ncccc\ndddd", "aaaa\nbbbb\ncccc\ndddd", 10);
  assert.deepEqual(parts.map(p => p.shown), ["aaaa\nbbbb", "cccc\ndddd"]);
  const mention = splitMessage("hi @{Lan}\nxxxxxxxxxx\nok", "hi @[Lan](42)\nxxxxxxxxxx\nok", 14);
  assert.deepEqual(mention, [{ shown: "hi @{Lan}", wire: "hi @[Lan](42)" }, { shown: "xxxxxxxxxx\nok", wire: "xxxxxxxxxx\nok" }]);
  assert.deepEqual(splitMessage("one two three four", "one two three four", 9).map(p => p.shown), ["one two", "three", "four"]);
});

test("every markup the backends emit (tg.rs render, gchat.rs chat_markup), one case each", () => {
  const cases = [
    ["*bold*", "<p><strong>bold</strong></p>"],
    ["**bold**", "<p><strong>bold</strong></p>"],
    ["_italic_", "<p><em>italic</em></p>"],
    ["~strike~", "<p><s>strike</s></p>"],
    ["~~strike~~ and ~a~", "<p><s>strike</s> and <s>a</s></p>"],
    ["__under__ ||hidden|| snake__case", '<p><u>under</u> <span class="spoiler">hidden</span> snake__case</p>'],
    ["# Title\nbody", "<p><strong>Title</strong></p><p>body</p>"],
    ["- a\n  - a1\n  - a2\n- b", "<ul><li>a<ul><li>a1</li><li>a2</li></ul></li><li>b</li></ul>"],
    ["`code`", "<p><code>code</code></p>"],
    ["```js\nlet a = 1;\n```", '<div class="code-block"><div class="code-head"><span class="code-lang">javascript</span>'],
    ["```\nplain\n```", '<span class="code-lang">code</span>'],
    ["@{Lan}", '<p><span class="mention">@Lan</span></p>'],
    ["@{all}", '<p><span class="mention">@all</span></p>'],
    ["[doc](https://x.io/a)", '<p><a class="msg-link" href="https://x.io/a">doc</a></p>'],
    ["https://x.io/a?b=1&c=2", '<p><a class="msg-link" href="https://x.io/a?b=1&amp;c=2">https://x.io/a?b=1&amp;c=2</a></p>'],
    ["* a\n* b", "<ul><li>a</li><li>b</li></ul>"],
    ["- a\n- b", "<ul><li>a</li><li>b</li></ul>"],
    ["• a\n• b", "<ul><li>a</li><li>b</li></ul>"],
    ["1. a\n2. b", "<ol><li>a</li><li>b</li></ol>"],
    ["> q", "<blockquote>q</blockquote>"],
    ["*b* _i_ ~s~ `c` in one line", "<p><strong>b</strong> <em>i</em> <s>s</s> <code>c</code> in one line</p>"],
    ["*bold with `code` inside*", "<p>*bold with <code>code</code> inside*</p>"],
    ["_a_b_ snake_case 2*3*4 ~/path", "<p>_a_b_ snake_case 2*3*4 ~/path</p>"],
    ["*multi\nline*", "<p>*multi<br>line*</p>"],
    ["<script>x</script>", "<p>&lt;script&gt;x&lt;/script&gt;</p>"],
  ];
  for (const [input, expected] of cases) assert.ok(fmt(input).includes(expected), `${JSON.stringify(input)} → ${fmt(input)}`);
});
