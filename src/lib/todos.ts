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
