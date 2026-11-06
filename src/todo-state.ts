import { create } from "zustand";
import { api, onEvent } from "./lib/bridge";
import { plain } from "./lib/format";
import type { Msg } from "./lib/types";
import { key, useApp } from "./store";
import { todoTranscript, type Todo, type TodoSource, type TodoTranscriptLine } from "./lib/todos";

type TodoIntent = { source: TodoSource; transcript: TodoTranscriptLine[] } | { id: number };

export const useTodoData = create<{
  items: Todo[];
  loaded: boolean;
  error: string;
  intent: TodoIntent | null;
}>(() => ({ items: [], loaded: false, error: "", intent: null }));

let request = 0;
let refreshTimer: ReturnType<typeof setTimeout> | undefined;

export async function refreshTodos() {
  clearTimeout(refreshTimer);
  const version = ++request;
  try {
    const items = await api.todoList();
    if (version === request) useTodoData.setState({ items, loaded: true, error: "" });
  } catch (error) {
    if (version === request) useTodoData.setState({ error: String(error) });
  }
}

function invalidateTodos() {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => void refreshTodos(), 80);
}

export function watchTodos() {
  let disposed = false;
  const openPending = async () => {
    if (disposed) return;
    try {
      const id = await api.todoTakeOpen();
      if (id === null || disposed) return;
      useTodoData.setState({ intent: { id } });
      useApp.setState({ route: "todo" });
    } catch (error) {
      console.error("Could not open the task reminder", error);
    }
  };
  const unsubscribe = onEvent(event => {
    if (event.type === "todoChanged") invalidateTodos();
    if (event.type === "todoOpen") void openPending();
  });
  void unsubscribe.ready.then(() => {
    if (disposed) return;
    void refreshTodos();
    void openPending();
  }, () => { if (!disposed) void refreshTodos(); });
  return () => { disposed = true; unsubscribe(); };
}

export function addTodoFromMessage(m: Msg) {
  const state = useApp.getState();
  const chatKey = key(m.accountId, m.chatId);
  const chat = state.chats[chatKey];
  const transcript = todoTranscript(m, state.msgs[chatKey] ?? [], !!(m.threadReply || chat?.forum || chat?.threaded));
  useTodoData.setState({ intent: { transcript, source: {
    accountId: m.accountId, chatId: m.chatId, messageId: m.id,
    threadId: m.threadReply || chat?.forum ? m.threadId : "",
    label: chat?.title || m.senderName,
    excerpt: (plain(m.text) || m.media?.name || "Tin nhắn").slice(0, 600),
    sentAt: m.ts, preview: false,
  } } });
  useApp.setState({ route: "todo" });
}
