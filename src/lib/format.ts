import { highlight } from "./code.ts";
// Text helpers shared by every view. Message markup from the backend is Google Chat's own
// syntax — *bold*, _italic_, ~strike~, `code`, ``` blocks, "* " / "- " bullets — plus
// @{mention} and [label](url). See render() in tg.rs and chat_markup() in gchat.rs.

export const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const INLINE = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s<]+[^\s<.,:;!?)\]'"])|@\{([^}]+)\}/g;

// *x* / _x_ / ~x~ only when they hug a word and aren't inside one: snake_case_names,
// 2 * 3 * 4 and ~/paths stay as typed
const EMPH: [RegExp, string][] = [
  // **x**: Markdown habit, Google Chat renders it bold too
  // a zero-width space right after a marker (U+200B) keeps it literal: tg.rs/gchat emit it
  // for markup characters that are plain text, the composer's "plain text" toggle too
  [/(^|[^\w*])\*\*(?=[^\s\u200B])([^*\n]*?\S)\*\*(?![\w*])/g, "strong"],
  [/(^|[^\w*])\*(?=[^\s\u200B])([^*\n]*?\S)\*(?![\w*])/g, "strong"],
  [/(^|[^\w_])_(?=[^\s\u200B])([^_\n]*?\S)_(?![\w_])/g, "em"],
  [/(^|[^\w~])~(?=[^\s\u200B])([^~\n]*?\S)~(?![\w~])/g, "s"],
];

function inline(s: string, me: string[]): string {
  return s
    .split(/(`[^`\n\u200B][^`\n]*`)/g)
    .map((part, i) => {
      if (i % 2) return `<code>${part.slice(1, -1)}</code>`;
      // links and mentions become placeholders first so emphasis never reaches inside a URL
      const kept: string[] = [];
      const hold = (html: string) => `\u0000${kept.push(html) - 1}\u0000`;
      let out = part.replace(INLINE, (_m, label, href, url, mention) => {
        if (label) return hold(`<a class="msg-link" href="${href}">${label}</a>`);
        if (url) return hold(`<a class="msg-link" href="${url}">${url}</a>`);
        return hold(`<span class="mention${me.includes(mention) ? " me" : ""}">@${mention}</span>`);
      });
      for (const [re, tag] of EMPH) out = out.replace(re, `$1<${tag}>$2</${tag}>`);
      return out.replace(/\u0000(\d+)\u0000/g, (_m, n) => kept[+n]).replace(/\n/g, "<br>");
    })
    .join("");
}

/** A paragraph: runs of "* " / "- " / "• " lines become a list, other lines stay lines. */
function para(p: string, me: string[]): string {
  let out = "";
  let text: string[] = [];
  let items: string[] = [];
  const flush = () => {
    if (text.length) out += `<p>${inline(text.join("\n"), me)}</p>`;
    if (items.length) out += `<ul>${items.map((l) => `<li>${inline(l, me)}</li>`).join("")}</ul>`;
    text = [];
    items = [];
  };
  for (const line of p.split("\n")) {
    const bullet = /^\s*[*\-•]\s+(.*)$/.exec(line);
    if (bullet ? text.length : items.length) flush();
    if (bullet) items.push(bullet[1]);
    else text.push(line);
  }
  flush();
  return out;
}

const COPY_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>';
/** A ``` block: language label, copy button (Message.tsx handles the click), coloured code. */
function codeBlock(code: string, lang: string): string {
  const h = highlight(code, lang);
  return `<div class="code-block"><div class="code-head"><span class="code-lang">${h.lang || "code"}</span><button type="button" class="code-copy" aria-label="Sao chép mã" data-tip="Sao chép">${COPY_SVG}</button></div><pre><code class="hljs">${h.html}</code></pre></div>`;
}

/** Escaped HTML for a message body. `me` = names that count as "mentions me". */
export function fmt(text: string, me: string[] = []): string {
  return text
    .split(/```([\w+#-]*)\n?([\s\S]*?)\n?```/g)
    .map((part, i, parts) =>
      i % 3 === 1
        ? codeBlock(parts[i + 1], part)
        : i % 3 === 2
        ? ""
        : esc(part)
            .replace(/^\n+|\n+$/g, "")
            .split(/\n{2,}/)
            .filter((p) => p.trim())
            .map((p) => para(p, me))
            .join(""),
    )
    .join("");
}

/** One line for previews, quotes, notifications and search snippets. */
export function plain(text: string): string {
  return text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/@\{([^}]+)\}/g, "@$1")
    .replace(/`/g, "")
    .replace(/\*\*(?=[^\s\u200B])([^*\n]*?\S)\*\*/g, "$1")
    .replace(/(^|[^\w*_~])[*_~](?=[^\s\u200B])([^*_~\n]*?\S)[*_~](?![\w*_~])/g, "$1$2")
    .replace(/^\s*[*-]\s+/gm, "• ")
    .replace(/\u200B/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Lowercase, no accents, đ → d: what search and filters compare. */
export const norm = (s: string) =>
  s.normalize("NFD").replace(/\p{M}/gu, "").replace(/đ/g, "d").replace(/Đ/g, "D").toLowerCase();

/** Chat / command finder match: every word of `query` is in `text`, or its letters appear
 *  in order ("bgo" finds "Backend Go", "mtran" finds "Minh Trần"). 0 = no match; higher
 *  = tighter (a word found whole beats one found letter by letter). */
export function fuzzy(query: string, text: string): number {
  const t = norm(text);
  let score = 0;
  for (const w of norm(query).trim().split(/\s+/).filter(Boolean)) {
    if (t.includes(w)) {
      score += 2;
      continue;
    }
    let i = 0;
    for (const c of t) if (c === w[i] && ++i === w.length) break;
    if (i < w.length) return 0;
    score += 1;
  }
  return score;
}

export function initials(name: string, lead = false): string {
  const words = name.replace(/\(.*?\)/g, "").replace(/[^\p{L}\p{N}\s]/gu, " ").trim().split(/\s+/).filter(Boolean);
  const pick = lead ? words.slice(0, 2) : words.slice(-2);
  return pick.map((w) => [...w][0]).join("").toUpperCase() || "?";
}

const pad = (n: number) => String(n).padStart(2, "0");
const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();
const WEEKDAY = ["Chủ Nhật", "Thứ Hai", "Thứ Ba", "Thứ Tư", "Thứ Năm", "Thứ Sáu", "Thứ Bảy"];
const WEEKDAY_SHORT = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"];

export const hm = (ts: number) => {
  const d = new Date(ts);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/** Sidebar / inbox time: 09:58 today, "Hôm qua", T5 this week, 22/10 older, 22/10/25 other years. */
export function listTime(ts: number, now = Date.now()): string {
  if (!ts) return "";
  const d = new Date(ts), n = new Date(now);
  if (sameDay(d, n)) return hm(ts);
  const y = new Date(now); y.setDate(n.getDate() - 1);
  if (sameDay(d, y)) return "Hôm qua";
  if (now - ts < 6 * 864e5) return WEEKDAY_SHORT[d.getDay()];
  if (d.getFullYear() === n.getFullYear()) return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}`;
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${String(d.getFullYear()).slice(2)}`;
}

/** Day separator: "Hôm nay · Thứ Năm 22/10". */
export function dayLabel(ts: number, now = Date.now()): string {
  const d = new Date(ts), n = new Date(now);
  const date = `${WEEKDAY[d.getDay()]} ${pad(d.getDate())}/${pad(d.getMonth() + 1)}${d.getFullYear() === n.getFullYear() ? "" : "/" + d.getFullYear()}`;
  if (sameDay(d, n)) return `Hôm nay · ${date}`;
  const y = new Date(now); y.setDate(n.getDate() - 1);
  if (sameDay(d, y)) return `Hôm qua · ${date}`;
  return date;
}

export const dayKey = (ts: number) => new Date(ts).toDateString();

export function fileSize(n: number): string {
  if (!n) return "";
  if (n >= 1e9) return (n / 1e9).toFixed(1) + " GB";
  if (n >= 1e6) return (n / 1e6).toFixed(1) + " MB";
  return Math.max(1, Math.round(n / 1e3)) + " KB";
}

export const fmtCount = (n: number) => n.toLocaleString("en-US");
