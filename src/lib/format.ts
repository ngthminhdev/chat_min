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
  // **x**: Markdown habit, Google Chat renders it bold too — also "**Need help? **" and
  // "**Starting, **VIBE", which Google's rich composer writes for a bold run ending in a space
  // a zero-width space right after a marker (U+200B) keeps it literal: tg.rs/gchat emit it
  // for markup characters that are plain text, the composer's "plain text" toggle too
  [/(^|[^\w*])\*\*(?=[^\s\u200B])([^*\n]*?\S[^\S\r\n]*)\*\*(?!\*)/g, "strong"],
  [/(^|[^\w*])\*(?=[^\s\u200B])([^*\n]*?\S)\*(?![\w*])/g, "strong"],
  // ~~x~~: how Google's formattedText writes strikethrough
  [/(^|[^\w~])~~(?=[^\s\u200B])([^~\n]*?\S)~~(?!~)/g, "s"],
  // __x__ underline and ||x|| spoiler: Telegram entities (tg.rs render)
  [/(^|[^\w_])__(?=[^\s\u200B])([^_\n]*?\S)__(?!_)/g, "u"],
  [/(^|[^|])\|\|(?=[^\s\u200B])([^|\n]*?\S)\|\|(?!\|)/g, 'span class="spoiler"'],
  [/(^|[^\w_])_(?=[^\s\u200B])([^_\n]*?\S)_(?![\w_])/g, "em"],
  [/(^|[^\w~])~(?=[^\s\u200B])([^~\n]*?\S)~(?![\w~])/g, "s"],
];

const emph = (s: string) => EMPH.reduce((out, [re, tag]) => out.replace(re, `$1<${tag}>$2</${tag.split(" ")[0]}>`), s);

function inline(s: string, me: string[]): string {
  return s
    .split(/(`[^`\n\u200B][^`\n]*`)/g)
    .map((part, i) => {
      if (i % 2) return `<code>${part.slice(1, -1)}</code>`;
      // links and mentions become placeholders first so emphasis never reaches inside a URL
      const kept: string[] = [];
      const hold = (html: string) => `\u0000${kept.push(html) - 1}\u0000`;
      let out = part.replace(INLINE, (_m, label, href, url: string, mention) => {
        // Google writes **bold** inside a link label; the rich composer also wraps the whole link
        if (label) return hold(`<a class="msg-link" href="${href}">${emph(label.replace(/\n/g, " "))}</a>`);
        if (url) {
          // the text is escaped already: a quote right after the URL became &#39; / &quot;
          const tail = /&(#39|quot|gt|lt|amp)$/.exec(url)?.[0] ?? "";
          const clean = url.slice(0, url.length - tail.length).replace(/[.,:;!?)\]]+$/, "");
          return hold(`<a class="msg-link" href="${clean}">${clean}</a>`) + url.slice(clean.length);
        }
        return hold(`<span class="mention${me.includes(mention) ? " me" : ""}">@${mention}</span>`);
      });
      out = emph(out);
      return out.replace(/\u0000(\d+)\u0000/g, (_m, n) => kept[+n]).replace(/\n/g, "<br>");
    })
    .join("");
}

const LIST = /^(\s*)(?:([*\-•])|(\d{1,3})[.)])\s+(.*)$/;
const QUOTE = /^&gt;\s?(.*)$/;
const HEADING = /^#{1,6}\s+(\S.*)$/;
type Item = { text: string; subs: string[] };
/** A paragraph: runs of "* " / "- " / "1. " lines become a list (an item indented deeper than
 *  the first is nested one level), "> " lines a quote, "# " lines a bold line, other lines
 *  stay lines. A blank line between two bullets and an indented line under one (Google's
 *  rich composer wraps long items at 80 columns) keep the list going. */
function para(p: string, me: string[]): string {
  const lines = p.split("\n");
  let out = "";
  let text: string[] = [];
  let items: Item[] = [];
  let quote: string[] = [];
  let list = "";
  let indent = 0;
  const li = (l: string) => `<li>${inline(l, me)}</li>`;
  const flush = () => {
    if (text.length) out += `<p>${inline(text.join("\n"), me)}</p>`;
    if (items.length) out += `<${list}>${items.map((it) => `<li>${inline(it.text, me)}${it.subs.length ? `<ul>${it.subs.map(li).join("")}</ul>` : ""}</li>`).join("")}</${list.slice(0, 2)}>`;
    if (quote.length) out += `<blockquote>${inline(quote.join("\n"), me)}</blockquote>`;
    text = [];
    items = [];
    quote = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const q = QUOTE.exec(line);
    if (q) {
      if (text.length || items.length) flush();
      quote.push(q[1]);
      continue;
    }
    const h = HEADING.exec(line);
    if (h) {
      flush();
      out += `<p><strong>${inline(h[1], me)}</strong></p>`;
      continue;
    }
    const b = LIST.exec(line);
    if (b) {
      const kind = b[3] ? "ol" : "ul";
      // ponytail: one nesting level, deeper indents join it
      if (items.length && b[1].length > indent && !b[3]) {
        items[items.length - 1].subs.push(b[4]);
        continue;
      }
      if (text.length || quote.length || (items.length && kind !== list.slice(0, 2))) flush();
      if (!items.length) {
        list = kind === "ol" && b[3] !== "1" ? `ol start="${+b[3]}"` : kind;
        indent = b[1].length;
      }
      items.push({ text: b[4], subs: [] });
      continue;
    }
    if (items.length) {
      if (/^\s+\S/.test(line)) {
        const last = items[items.length - 1];
        if (last.subs.length) last.subs[last.subs.length - 1] += `\n${line.trim()}`;
        else last.text += `\n${line.trim()}`;
        continue;
      }
      if (!line.trim() && LIST.test(lines[i + 1] ?? "")) continue;
    }
    if (items.length || quote.length) flush();
    text.push(line);
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

// Shared across timeline mounts: switching tabs should not repeat syntax detection.
// Bound both entry count and retained text/HTML (UTF-16 characters, about 2 MB).
const formatted = new Map<string, string>();
let formattedChars = 0;
const FORMAT_CHARS = 1_000_000;

/** Escaped HTML for a message body. `me` = names that count as "mentions me". */
export function fmt(text: string, me: string[] = []): string {
  const key = text.length <= 64_000 ? JSON.stringify([text, me]) : "";
  const cached = key ? formatted.get(key) : undefined;
  if (cached !== undefined) {
    formatted.delete(key);
    formatted.set(key, cached);
    return cached;
  }
  const html = formatBody(text, me);
  if (key && key.length + html.length <= FORMAT_CHARS) {
    formatted.set(key, html);
    formattedChars += key.length + html.length;
    while (formatted.size > 256 || formattedChars > FORMAT_CHARS) {
      const oldest = formatted.keys().next().value!;
      formattedChars -= oldest.length + formatted.get(oldest)!.length;
      formatted.delete(oldest);
    }
  }
  return html;
}

function formatBody(text: string, me: string[]): string {
  return text.replace(/\r\n?/g, "\n")
    .split(/```([\w+#-]*)\n?([\s\S]*?)\n?```/g)
    .map((part, i, parts) => {
      if (i % 3 === 1) return codeBlock(parts[i + 1], part);
      if (i % 3 === 2) return "";
      // A fence occupies its own line; consume only its separating newline.
      if (i > 0) part = part.replace(/^\n/, "");
      if (i + 1 < parts.length) part = part.replace(/\n$/, "");
      return part ? para(esc(part), me) : "";
    })
    .join("");
}

/** Telegram and Google Chat both refuse texts over 4096 characters. */
export const MAX_SEND = 4000;

/** A long message as several, cut at line breaks (then spaces) so each fits `limit`.
 *  `wire` is the same text with mentions encoded (ComposerExtras): both are cut on the same
 *  lines, so a mention never straddles two messages. */
export function splitMessage(shown: string, wire = shown, limit = MAX_SEND): { shown: string; wire: string }[] {
  const a = shown.split("\n"), b = wire.split("\n");
  if (wire.length <= limit || a.length !== b.length) return [{ shown, wire }];
  const out: { shown: string; wire: string }[] = [];
  let cur = { shown: "", wire: "" };
  const push = () => { if (cur.wire.trim()) out.push(cur); cur = { shown: "", wire: "" }; };
  for (let i = 0; i < a.length; i++) {
    let s = a[i], w = b[i];
    // ponytail: an over-long single line is cut at the same index in both forms; a mention
    // right there would break, long lines without line breaks rarely carry one
    while (w.length > limit) {
      const at = Math.max(w.lastIndexOf(" ", limit), limit >> 1);
      if (cur.wire) push();
      out.push({ shown: s.slice(0, at), wire: w.slice(0, at) });
      s = s.slice(at).trimStart(); w = w.slice(at).trimStart();
    }
    if (cur.wire.length + w.length + 1 > limit) push();
    cur = { shown: cur.shown + (cur.shown || i ? "\n" : "") + s, wire: cur.wire + (cur.wire || i ? "\n" : "") + w };
  }
  push();
  return out.map(c => ({ shown: c.shown.trim(), wire: c.wire.trim() }));
}

/** One line for previews, quotes, notifications and search snippets. */
export function plain(text: string): string {
  return text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/@\{([^}]+)\}/g, "@$1")
    .replace(/`/g, "")
    .replace(/\*\*(?=[^\s\u200B])([^*\n]*?\S[^\S\r\n]*)\*\*/g, "$1")
    .replace(/~~(?=[^\s\u200B])([^~\n]*?\S)~~/g, "$1")
    .replace(/__(?=[^\s\u200B])([^_\n]*?\S)__/g, "$1")
    .replace(/\|\|(?=[^\s\u200B])([^|\n]*?\S)\|\|/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/(^|[^\w*_~])[*_~](?=[^\s\u200B])([^*_~\n]*?\S)[*_~](?![\w*_~])/g, "$1$2")
    .replace(/^\s*[*\-•]\s+/gm, "• ")
    .replace(/^>\s?/gm, "")
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
