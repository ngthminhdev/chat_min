// Text helpers shared by every view. Message markup from the backend is plain text plus
// `code`, @{mention} and [label](url) — see render() in tg.rs / to_msg() in gchat.rs.

export const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const INLINE = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s<]+[^\s<.,:;!?)\]'"])|@\{([^}]+)\}/g;

function inline(s: string, me: string[]): string {
  return s
    .split(/(`[^`\n]+`)/g)
    .map((part, i) => {
      if (i % 2) return `<code>${part.slice(1, -1)}</code>`;
      return part
        .replace(INLINE, (_m, label, href, url, mention) => {
          if (label) return `<a class="msg-link" href="${href}">${label}</a>`;
          if (url) return `<a class="msg-link" href="${url}">${url}</a>`;
          return `<span class="mention${me.includes(mention) ? " me" : ""}">@${mention}</span>`;
        })
        .replace(/\n/g, "<br>");
    })
    .join("");
}

/** Escaped HTML for a message body. `me` = names that count as "mentions me". */
export function fmt(text: string, me: string[] = []): string {
  return esc(text)
    .split(/\n{2,}/)
    .map((p) => `<p>${inline(p, me)}</p>`)
    .join("");
}

/** One line for previews, quotes, notifications and search snippets. */
export function plain(text: string): string {
  return text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/@\{([^}]+)\}/g, "@$1")
    .replace(/`/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Lowercase, no accents, đ → d: what search and filters compare. */
export const norm = (s: string) =>
  s.normalize("NFD").replace(/\p{M}/gu, "").replace(/đ/g, "d").replace(/Đ/g, "D").toLowerCase();

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
