import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { api, openUrl } from "../lib/bridge";
import { norm, plain } from "../lib/format";
import { blankTodo, fromDateField, reminderFor, summarizeTodos, todoPeriod, toDateField, type Todo, type TodoDraft, type TodoSource } from "../lib/todos";
import { confirmDialog, fail, key, openAt, openChat, toast, useApp } from "../store";
import { refreshTodos, useTodoData } from "../todo-state";
import { Icon } from "../ui/Icon";
import "../styles/todo.css";

type Filter = "open" | "today" | "overdue" | "done" | "week" | "all";
type Editor = { id: number | null; source: TodoSource | null; draft: TodoDraft; accepting?: boolean };

const FILTERS: [Filter, string][] = [
  ["open", "Đang mở"], ["today", "Hạn hôm nay"], ["overdue", "Quá hạn"], ["done", "Hoàn thành"], ["all", "Tất cả"],
];
const DATE = new Intl.DateTimeFormat("vi-VN", { dateStyle: "medium", timeStyle: "short" });

function editTodo(item: Todo): Editor {
  return {
    id: item.id,
    source: item.source,
    accepting: item.status === "suggested",
    draft: {
      title: item.title, notes: item.notes, link: item.link, dueAt: item.dueAt,
      remindAt: item.status === "suggested" ? reminderFor(item.dueAt) : item.remindAt,
    },
  };
}

function SourceDetails({ source }: { source: TodoSource }) {
  const chatKey = key(source.accountId, source.chatId);
  const exists = useApp(s => !!s.chats[chatKey]);
  const open = async () => {
    if (!exists) return;
    if (source.preview || source.threadId) {
      openAt(chatKey, source.messageId, source.threadId);
      return;
    }
    await openChat(chatKey);
    if (useApp.getState().active === chatKey) useApp.setState({ jumpTo: source.messageId });
  };
  return (
    <details className="todo-source">
      <summary><Icon name="message-square-text" /> {source.label || "Hội thoại"} {source.preview && <span>· Xem trước</span>}</summary>
      {source.excerpt && <p>{source.preview ? source.excerpt : plain(source.excerpt)}</p>}
      {exists
        ? <button type="button" className="tool-btn" onClick={() => void open().catch(fail)}><Icon name="external-link" /> Mở nguồn</button>
        : <span>Hội thoại gốc không còn trong danh sách.</span>}
    </details>
  );
}

function TodoEditor({ editor, busy, error, onClose, onSubmit }: {
  editor: Editor;
  busy: boolean;
  error: string;
  onClose: () => void;
  onSubmit: (draft: TodoDraft) => void;
}) {
  const [title, setTitle] = useState(editor.draft.title);
  const [notes, setNotes] = useState(editor.draft.notes);
  const [link, setLink] = useState(editor.draft.link);
  const [due, setDue] = useState(toDateField(editor.draft.dueAt));
  const [reminder, setReminder] = useState(toDateField(editor.draft.remindAt));
  const [validation, setValidation] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const deadline = fromDateField(due);
  const quickReminder = reminderFor(deadline);
  const nearDeadline = quickReminder !== null && deadline !== null && deadline - quickReminder < 30 * 60_000;
  useEffect(() => { input.current?.focus(); }, []);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setValidation("");
    // Preserve sub-minute timestamps on unrelated edits to an existing task.
    const dueAt = due === toDateField(editor.draft.dueAt) ? editor.draft.dueAt : fromDateField(due);
    const remindAt = reminder === toDateField(editor.draft.remindAt) ? editor.draft.remindAt : fromDateField(reminder);
    if (!title.trim()) return setValidation("Nhập tên việc cần làm.");
    if ((due && dueAt === null) || (reminder && remindAt === null)) return setValidation("Chọn ngày giờ hợp lệ.");
    if (dueAt !== null && remindAt !== null && remindAt > dueAt) return setValidation("Thời gian nhắc phải trước hoặc bằng hạn chót.");
    onSubmit({ title, notes, link, dueAt, remindAt });
  };

  return (
    <form className="todo-editor" aria-label="Chi tiết việc cần làm" onSubmit={submit} onKeyDown={e => {
      if (e.key === "Escape" && !busy) { e.stopPropagation(); onClose(); }
    }}>
      <h2>{editor.accepting ? "Xem lại gợi ý" : editor.id !== null ? "Sửa việc" : "Việc mới"}</h2>
      <fieldset disabled={busy}>
        <label>Tên việc<input ref={input} value={title} onChange={e => setTitle(e.target.value)} required maxLength={160} /></label>
        <label>Ghi chú<textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} maxLength={5000} /></label>
        <div className="todo-form-dates">
          <label>Hạn chót<input type="datetime-local" value={due} onChange={e => setDue(e.target.value)} /></label>
          <label>Nhắc lúc<input type="datetime-local" value={reminder} onChange={e => setReminder(e.target.value)} /></label>
        </div>
        <div className="todo-form-hint">
          <button type="button" className="tool-btn" disabled={quickReminder === null} onClick={() => setReminder(toDateField(quickReminder))}>
            <Icon name="bell" /> {nearDeadline ? "Nhắc sát hạn" : "Nhắc trước hạn 30 phút"}
          </button>
          {reminder && <button type="button" className="tool-btn" onClick={() => setReminder("")}>Bỏ lịch nhắc</button>}
        </div>
        <label>Liên kết Jira hoặc tài liệu<input type="url" value={link} onChange={e => setLink(e.target.value)} placeholder="https://…" maxLength={2048} /></label>
      </fieldset>
      {editor.source && <SourceDetails source={editor.source} />}
      {(validation || error) && <p className="todo-error" role="alert">{validation || error}</p>}
      <div className="todo-actions">
        <button type="button" className="tool-btn" onClick={onClose} disabled={busy}>Huỷ</button>
        <button type="submit" className="tool-btn primary" disabled={busy}>{busy ? "Đang lưu…" : editor.id === null || editor.accepting ? "Thêm việc" : "Lưu thay đổi"}</button>
      </div>
    </form>
  );
}

export function TodoView() {
  const { items, loaded, error, intent } = useTodoData();
  const [filter, setFilter] = useState<Filter>("open");
  const [query, setQuery] = useState("");
  const [now, setNow] = useState(Date.now);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [formError, setFormError] = useState("");
  const [busy, setBusy] = useState(false);
  const mutation = useRef(false);
  const [focused, setFocused] = useState<number | null>(null);
  const focusRow = useRef<HTMLLIElement>(null);
  const stats = summarizeTodos(items, now);
  const { tomorrow, weekStart } = todoPeriod(now);
  const suggestions = useMemo(() => items.filter(t => t.status === "suggested"), [items]);
  const [showSuggestions, setShowSuggestions] = useState(true);

  useEffect(() => {
    void refreshTodos();
    const tick = () => setNow(Date.now());
    const timer = setInterval(tick, 15_000);
    window.addEventListener("focus", tick);
    return () => { clearInterval(timer); window.removeEventListener("focus", tick); };
  }, []);

  const openEditor = (value: Editor | null) => {
    setFormError("");
    setEditor(value);
  };

  useEffect(() => {
    if (!intent || !loaded) return;
    useTodoData.setState({ intent: null });
    if ("id" in intent) {
      setFilter("all");
      setQuery("");
      setFocused(intent.id);
      return;
    }
    const source = intent.source;
    const match = items.find(t => t.source?.accountId === source.accountId && t.source.chatId === source.chatId && t.source.messageId === source.messageId);
    openEditor(match ? editTodo(match) : {
      id: null, source,
      draft: { ...blankTodo(), title: Array.from(source.excerpt).slice(0, 160).join("") },
    });
  }, [intent, items, loaded]);

  useEffect(() => {
    if (focused === null) return;
    focusRow.current?.focus({ preventScroll: true });
    focusRow.current?.scrollIntoView({ block: "nearest" });
  }, [focused, filter, query]);

  const run = async <T,>(action: () => Promise<T>, onSuccess?: (value: T) => void, inForm = false) => {
    if (mutation.current) return;
    mutation.current = true;
    setBusy(true);
    try {
      const value = await action();
      await refreshTodos();
      onSuccess?.(value);
    } catch (error) {
      if (inForm) setFormError(String(error));
      else fail(error);
    } finally {
      mutation.current = false;
      setBusy(false);
    }
  };

  const saved = (id: number, message: string) => {
    openEditor(null);
    setQuery("");
    setFilter("all");
    setFocused(id);
    toast(message);
  };

  const q = norm(query.trim());
  const shown = items.filter(t => {
    if (t.status === "suggested") return false;
    if (q && !norm([t.title, t.notes, t.link, t.source?.label].join(" ")).includes(q)) return false;
    if (filter === "all") return true;
    if (filter === "done") return t.status === "done";
    if (filter === "week") return t.status === "done" && t.completedAt !== null && t.completedAt >= weekStart;
    if (t.status !== "open") return false;
    if (filter === "open") return true;
    if (t.dueAt === null) return false;
    return filter === "today" ? t.dueAt >= now && t.dueAt < tomorrow : t.dueAt < now;
  }).sort((a, b) => {
    if (a.status === "done" && b.status === "done") return (b.completedAt ?? 0) - (a.completedAt ?? 0);
    if (a.status === "done" || b.status === "done") return a.status === "done" ? 1 : -1;
    return (a.dueAt ?? Infinity) - (b.dueAt ?? Infinity) || b.id - a.id;
  });

  return (
    <div className="todo-page">
      <header className="todo-heading">
        <div><h1>Việc cần làm</h1><p>Việc cá nhân, hạn chót và nhắc việc từ các hội thoại.</p></div>
        <button type="button" className="tool-btn primary" disabled={busy} onClick={() => openEditor({ id: null, source: null, draft: blankTodo() })}><Icon name="plus" /> Việc mới</button>
      </header>
      {error && <div className="todo-error" role="alert">Chưa tải được danh sách. {error} <button className="tool-btn" onClick={() => void refreshTodos()}>Thử lại</button></div>}
      <div className="todo-stats" aria-label="Thống kê việc">
        {([
          ["open", stats.open, "Đang mở"],
          ["today", stats.today, "Hạn hôm nay"],
          ["overdue", stats.overdue, "Quá hạn"],
          ["week", stats.recentDone, "Xong trong 7 ngày"],
        ] as const).map(([value, count, label]) => (
          <button type="button" key={value} aria-pressed={filter === value} onClick={() => setFilter(value)}>
            <strong>{count}</strong><span>{label}</span>
          </button>
        ))}
      </div>

      {editor && <TodoEditor key={editor.id ?? editor.source?.messageId ?? "new"} editor={editor} busy={busy} error={formError}
        onClose={() => openEditor(null)} onSubmit={draft => void run(
          () => api.todoSave(editor.id, draft, editor.id === null ? editor.source : null),
          id => saved(id, editor.id === null || editor.accepting ? "Đã thêm việc" : "Đã lưu thay đổi"),
          true,
        )} />}

      {suggestions.length > 0 && (
        <section className="todo-suggestions" aria-labelledby="todo-suggestions-title">
          <h2 id="todo-suggestions-title">
            <button type="button" aria-expanded={showSuggestions} onClick={() => setShowSuggestions(!showSuggestions)}>
              <Icon name="sparkles" /> Gợi ý từ tin nhắn <span>{suggestions.length}</span><Icon name={showSuggestions ? "chevron-down" : "chevron-right"} />
            </button>
          </h2>
          {showSuggestions && <>
            <p className="todo-subtle">ChatMin tìm yêu cầu rõ ràng trong tin mới. Bạn chọn việc cần lưu.</p>
            <ul>
              {suggestions.map(t => <li className="todo-row" key={t.id}>
                <div className="todo-row-body">
                  <strong>{t.title}</strong>
                  {t.dueAt !== null && <p className="todo-meta"><Icon name="clock" /> Hạn gợi ý {DATE.format(t.dueAt)}</p>}
                  {t.source && <SourceDetails source={t.source} />}
                </div>
                <div className="todo-actions">
                  <button type="button" className="tool-btn primary" disabled={busy} onClick={() => void run(
                    () => api.todoSave(t.id, editTodo(t).draft, null), () => saved(t.id, "Đã thêm việc"),
                  )}><Icon name="plus" /> Thêm</button>
                  <button type="button" className="tool-btn icon-only" disabled={busy} aria-label="Chỉnh gợi ý trước khi thêm" data-tip="Chỉnh trước khi thêm" onClick={() => openEditor(editTodo(t))}><Icon name="pencil" /></button>
                  <button type="button" className="tool-btn icon-only" disabled={busy} aria-label="Bỏ qua gợi ý" data-tip="Bỏ qua" onClick={() => void run(() => api.todoDismiss(t.id), () => {
                    if (editor?.id === t.id) openEditor(null);
                  })}><Icon name="x" /></button>
                </div>
              </li>)}
            </ul>
          </>}
        </section>
      )}

      <section aria-labelledby="todo-list-title">
        <div className="todo-list-head">
          <h2 id="todo-list-title">Danh sách việc</h2>
          <input type="search" aria-label="Tìm việc" placeholder="Tìm việc…" value={query} onChange={e => setQuery(e.target.value)} />
        </div>
        <div className="todo-filters" aria-label="Lọc danh sách">
          {FILTERS.map(([value, label]) => <button key={value} type="button" className="tool-btn" aria-pressed={filter === value || (value === "done" && filter === "week")} onClick={() => setFilter(value)}>{label}</button>)}
        </div>
        {filter === "week" && <p className="todo-subtle">Hiển thị các việc hoàn thành trong 7 ngày gần đây.</p>}
        {!loaded && !error && <p className="todo-empty" role="status">Đang tải việc…</p>}
        {loaded && shown.length === 0 && <p className="todo-empty">{query || filter !== "open" ? "Không có việc phù hợp." : "Chưa có việc đang mở."}</p>}
        <ul>
          {shown.map(t => {
            const done = t.status === "done";
            return <li className={`todo-row${focused === t.id ? " todo-focused" : ""}`} key={t.id}
              tabIndex={-1} ref={focused === t.id ? focusRow : null}>
              <label className="todo-check-wrap"><input className="todo-checkbox" type="checkbox" checked={done} disabled={busy}
                aria-label={`${done ? "Mở lại" : "Hoàn thành"} ${t.title}`}
                onChange={() => void run(() => api.todoSetDone(t.id, !done), () => toast(done ? "Đã mở lại việc" : "Đã hoàn thành"))} /></label>
              <div className="todo-row-body">
                <strong className={done ? "todo-done" : undefined}>{t.title}</strong>
                {t.notes && <p className="todo-notes">{t.notes}</p>}
                {(t.dueAt !== null || t.remindAt !== null || t.completedAt !== null) && <div className="todo-meta">
                  {t.dueAt !== null && <span className={!done && t.dueAt < now ? "todo-late" : undefined}><Icon name="clock" /> {!done && t.dueAt < now ? "Quá hạn" : "Hạn"} {DATE.format(t.dueAt)}</span>}
                  {!done && t.remindAt !== null && <span><Icon name="bell" /> {t.remindedAt === null ? "Nhắc lúc" : "Lịch nhắc đã qua"} {DATE.format(t.remindAt)}</span>}
                  {t.completedAt !== null && <span><Icon name="check" /> Xong {DATE.format(t.completedAt)}</span>}
                </div>}
                {t.link && <button type="button" className="tool-btn todo-link" data-tip={t.link} onClick={() => void openUrl(t.link).catch(fail)}><Icon name="external-link" /> Mở liên kết</button>}
                {t.source && <SourceDetails source={t.source} />}
              </div>
              <div className="todo-actions">
                <button type="button" className="tool-btn icon-only" disabled={busy} aria-label={`Sửa ${t.title}`} data-tip="Sửa việc" onClick={() => openEditor(editTodo(t))}><Icon name="pencil" /></button>
                <button type="button" className="tool-btn icon-only" disabled={busy} aria-label={`Xoá ${t.title}`} data-tip="Xoá việc" onClick={() =>
                  confirmDialog("Xoá việc này?", t.title, "Xoá việc", () => void run(() => api.todoDelete(t.id), () => {
                    if (editor?.id === t.id) openEditor(null);
                    toast("Đã xoá việc");
                  }))}><Icon name="trash-2" /></button>
              </div>
            </li>;
          })}
        </ul>
        <p className="todo-footnote"><Icon name="info" /> ChatMin gửi nhắc việc khi ứng dụng đang chạy. Lịch nhắc bỏ lỡ sẽ được kiểm tra khi bạn mở lại.</p>
      </section>
    </div>
  );
}
