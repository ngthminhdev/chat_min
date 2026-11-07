import type { Msg } from "./types";

export interface TodoSource {
  accountId: string;
  chatId: string;
  messageId: string;
  threadId: string;
  label: string;
  excerpt: string;
  sentAt: number;
  preview: boolean;
}

export interface TodoDraft {
  title: string;
  notes: string;
  link: string;
  dueAt: number | null;
  remindAt: number | null;
}

export type TodoTranscriptLine = { author: string; time: string; text: string; selected: boolean; quote?: string };
export type AiTodo = { title: string; notes: string; deadline: string | null; link: string };

export function todoTranscript(selected: Msg, messages: Msg[], threaded: boolean): TodoTranscriptLine[] {
  const sameContext = (m: Msg) => m.accountId === selected.accountId && m.chatId === selected.chatId &&
    (!threaded || m.threadId === selected.threadId) && !m.deleted && m.kind !== "service" &&
    m.status !== "sending" && m.status !== "failed" && (!!m.text.trim() || !!m.media);
  const nearby = messages.filter(m => m.id !== selected.id && sameContext(m)).sort((a, b) => a.sort - b.sort);
  const before = nearby.filter(m => m.sort <= selected.sort);
  const context = before.slice(-12);
  // Keep the thread starter when a long thread pushes it outside the nearby window.
  const root = threaded && selected.threadId && selected.threadReply
    ? before.find(m => !m.threadReply) : undefined;
  if (root && !context.includes(root)) context.unshift(root);
  return [...context, selected, ...nearby.filter(m => m.sort > selected.sort).slice(0, 5)].map(m => ({
    author: m.outgoing ? "Me" : (m.senderName || "Participant").slice(0, 100),
    time: toDateField(m.ts),
    text: (m.text.trim() || m.media?.name || "[Attachment]").slice(0, m === selected ? 3200 : 900),
    selected: m === selected,
    ...(m === selected && m.replyText ? { quote: m.replyText.slice(0, 1000) } : {}),
  }));
}

export function aiTodoDraft(result: AiTodo, transcript: TodoTranscriptLine[]): TodoDraft {
  const title = result.title.trim().slice(0, 160);
  // Models add seconds, "Z" or a space despite the prompt: keep only the local date[Thh:mm] part.
  const deadline = (result.deadline ?? "").match(/^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2})?/)?.[0].replace(" ", "T") ?? "";
  const dueAt = fromDateField(/^\d{4}-\d{2}-\d{2}$/.test(deadline) ? `${deadline}T18:00` : deadline);
  const link = result.link.trim();
  const sourceUrls = transcript.flatMap(line => `${line.text} ${line.quote ?? ""}`.match(/https?:\/\/[^\s<>"')\]]+/g) ?? []);
  return {
    title,
    notes: result.notes.trim().slice(0, 5000),
    dueAt,
    remindAt: reminderFor(dueAt),
    link: sourceUrls.some(url => url.replace(/[.,;!?]+$/, "") === link) ? link : "",
  };
}

export interface Todo extends TodoDraft {
  id: number;
  status: "suggested" | "open" | "done";
  source: TodoSource | null;
  createdAt: number;
  completedAt: number | null;
  remindedAt: number | null;
}

export const blankTodo = (): TodoDraft => ({ title: "", notes: "", link: "", dueAt: null, remindAt: null });

export function toDateField(ts: number | null): string {
  if (ts === null) return "";
  const date = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${String(date.getFullYear()).padStart(4, "0")}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function fromDateField(value: string): number | null {
  if (!value) return null;
  const ts = new Date(value).getTime();
  return Number.isFinite(ts) && toDateField(ts) === value ? ts : null;
}

export function reminderFor(due: number | null, now = Date.now()): number | null {
  if (due === null || due <= now) return null;
  const minute = Math.floor(now / 60_000) * 60_000;
  return Math.min(due, Math.max(minute + 60_000, due - 30 * 60_000));
}

export function todoPeriod(now: number) {
  const midnight = new Date(now);
  midnight.setHours(0, 0, 0, 0);
  const tomorrow = new Date(midnight);
  tomorrow.setDate(tomorrow.getDate() + 1);
  midnight.setDate(midnight.getDate() - 6);
  return { tomorrow: +tomorrow, weekStart: +midnight };
}

export function summarizeTodos(todos: Todo[], now: number) {
  const { tomorrow, weekStart } = todoPeriod(now);
  const stats = { open: 0, overdue: 0, today: 0, recentDone: 0 };
  for (const todo of todos) {
    if (todo.status === "done" && todo.completedAt !== null && todo.completedAt >= weekStart) {
      stats.recentDone++;
    }
    if (todo.status !== "open") continue;
    stats.open++;
    if (todo.dueAt === null) continue;
    if (todo.dueAt < now) stats.overdue++;
    else if (todo.dueAt < tomorrow) stats.today++;
  }
  return stats;
}
