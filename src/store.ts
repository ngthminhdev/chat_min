import { create } from "zustand";
import { api, notify, onEvent } from "./lib/bridge";
import { plain } from "./lib/format";
import { PLATFORMS, type Cap } from "./lib/platforms";
import type { Account, Chat, CoreEvent, Health, Msg } from "./lib/types";
import type { IconName } from "./ui/Icon";

export type Route = "shell" | "inbox" | "settings" | "welcome" | "wizard";
export type InspTab = "info" | "members" | "files" | "media" | "pinned";

/** Chats and their message lists are keyed by "accountId|chatId". */
export const key = (accountId: string, chatId: string) => `${accountId}|${chatId}`;
export const splitKey = (k: string): [string, string] => {
  const i = k.indexOf("|");
  return [k.slice(0, i), k.slice(i + 1)];
};

export interface Prefs { size: number; theme: string; uiFont: string; monoFont: string; compact: boolean }
export interface NotifyPrefs { enabled: boolean; mentions: boolean; quiet: boolean; from: string; to: string; preview: boolean }
export const DEFAULT_NOTIFY: NotifyPrefs = { enabled: true, mentions: false, quiet: false, from: "22:00", to: "08:00", preview: true };

export interface MenuItem { icon: IconName; label: string; kbd?: string; danger?: boolean; run: () => void }
/** Popovers anchor below `y` (an element's bottom) and flip above `top` when they don't fit. */
export type Pop = { x: number; y: number; top: number } & (
  | { kind: "emoji"; onPick: (emoji: string) => void }
  | { kind: "menu"; items: MenuItem[] }
  | { kind: "color"; accountId: string }
);
export const anchor = (el: Element) => {
  const r = el.getBoundingClientRect();
  return { x: r.left, y: r.bottom, top: r.top };
};
export type Dialog =
  | { kind: "confirm"; title: string; message: string; ok: string; onOk: () => void }
  | { kind: "prompt"; title: string; value: string; onOk: (v: string) => void };
export interface ThreadTab { chatKey: string; threadId: string; rootId: string; title: string }
export interface Toast { id: number; text: string; icon: IconName }
export interface AuthState { step: string; info: string; error: string }
export interface SyncState { checks: ("idle" | "run" | "ok" | "err")[]; log: string[] }

interface State {
  booted: boolean;
  tgConfigured: boolean;
  gchatConfigured: boolean;
  accounts: Account[];
  health: Record<string, Health>;
  chats: Record<string, Chat>;
  msgs: Record<string, Msg[]>;
  older: Record<string, "idle" | "loading" | "done">;
  loadErr: Record<string, string>;
  /** sort key of the first unread message when the chat was opened → "N tin chưa đọc" line */
  unreadMark: Record<string, { sort: number; count: number }>;
  /** ids that arrived live (not from history) — they animate in */
  fresh: Record<string, true>;
  typing: Record<string, { who: string; until: number }>;
  tabs: string[];
  active: string | null;
  route: Route;
  wizardFor: string | null;
  drafts: Record<string, string>;
  replyTo: Record<string, string>;
  editing: Record<string, string>;
  inspTab: InspTab;
  /** Google Chat spaces: timeline or thread list */
  convTab: Record<string, "msgs" | "threads">;
  /** thread tabs ("thread:<threadId>") → the space they belong to */
  threadTabs: Record<string, ThreadTab>;
  /** ChatMin's own pins: cross-account, user-ordered, shown on top of the sidebar */
  favorites: string[];
  accountOrder: string[];
  /** sidebar rows showing their recent threads underneath */
  expanded: Record<string, boolean>;
  filter: "all" | "unread" | "mention";
  query: string;
  collapsed: Record<string, boolean>;
  leftCollapsed: boolean;
  rightCollapsed: boolean;
  palette: { mode: "chats" | "msgs"; scope?: string; forward?: Msg } | null;
  pop: Pop | null;
  dialog: Dialog | null;
  toasts: Toast[];
  prefs: Prefs;
  notif: Record<string, NotifyPrefs>;
  auth: Record<string, AuthState>;
  sync: Record<string, SyncState>;
  jumpTo: string | null;
}

const PERSIST = "chatmin.ui";
const saved: Partial<State> = (() => {
  try {
    return JSON.parse(localStorage.getItem(PERSIST) || "{}");
  } catch {
    return {};
  }
})();

export const useApp = create<State>(() => ({
  booted: false,
  tgConfigured: false,
  gchatConfigured: false,
  accounts: [],
  health: {},
  chats: {},
  msgs: {},
  older: {},
  loadErr: {},
  unreadMark: {},
  fresh: {},
  typing: {},
  tabs: saved.tabs ?? [],
  active: saved.active ?? null,
  route: "shell",
  wizardFor: null,
  drafts: saved.drafts ?? {},
  replyTo: {},
  editing: {},
  inspTab: "info",
  convTab: {},
  threadTabs: saved.threadTabs ?? {},
  favorites: saved.favorites ?? [],
  accountOrder: saved.accountOrder ?? [],
  expanded: {},
  filter: "all",
  query: "",
  collapsed: saved.collapsed ?? {},
  leftCollapsed: saved.leftCollapsed ?? false,
  rightCollapsed: saved.rightCollapsed ?? false,
  palette: null,
  pop: null,
  dialog: null,
  toasts: [],
  prefs: { size: 13, theme: "", uiFont: "", monoFont: "", compact: false, ...saved.prefs },
  notif: saved.notif ?? {},
  auth: {},
  sync: {},
  jumpTo: null,
}));

const get = useApp.getState;
const set = useApp.setState;

// persist the UI bits that should survive a restart (never message content)
let persistT: ReturnType<typeof setTimeout> | undefined;
useApp.subscribe((s) => {
  clearTimeout(persistT);
  persistT = setTimeout(() => {
    const { tabs, active, drafts, collapsed, leftCollapsed, rightCollapsed, prefs, notif, threadTabs, favorites, accountOrder } = s;
    try {
      localStorage.setItem(
        PERSIST,
        JSON.stringify({ tabs, active, drafts, collapsed, leftCollapsed, rightCollapsed, prefs, notif, threadTabs, favorites, accountOrder }),
      );
    } catch {}
  }, 300);
});

// ── selectors ───────────────────────────────────────────────────────────────
export const isThreadTab = (t: string | null | undefined): t is string => !!t && t.startsWith("thread:");
/** The chat behind a tab: itself, or the space a thread tab belongs to. */
export const chatKeyOf = (t: string | null | undefined): string | null => (isThreadTab(t) ? get().threadTabs[t]?.chatKey ?? null : t ?? null);
export const orderedAccounts = (accounts: Account[], order: string[]) =>
  [...accounts].sort((a, b) => {
    const i = order.indexOf(a.id), j = order.indexOf(b.id);
    return (i < 0 ? 1e9 : i) - (j < 0 ? 1e9 : j);
  });
export const accountOf = (id: string | undefined) => get().accounts.find((a) => a.id === id);
export const capsOf = (k: string | null): Record<Cap, boolean> => {
  const a = k ? accountOf(splitKey(k)[0]) : undefined;
  return PLATFORMS[a?.platform ?? "telegram"].caps;
};
export const healthOf = (accountId: string): Health => get().health[accountId] ?? { health: "ok", text: "", until: 0 };
export const sendBlocked = (accountId: string) => ["offline", "reconnecting", "expired", "rate"].includes(healthOf(accountId).health);
export const sortedChats = (chats: Record<string, Chat>, accountId: string) =>
  Object.values(chats)
    .filter((c) => c.accountId === accountId)
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.order - a.order || b.lastTs - a.lastTs);
export const totalUnread = (chats: Record<string, Chat>) =>
  Object.values(chats).filter((c) => !c.muted).reduce((s, c) => s + c.unread, 0);

// ── feedback ────────────────────────────────────────────────────────────────
let toastId = 0;
export function toast(text: string, icon: IconName = "check") {
  const id = ++toastId;
  set((s) => ({ toasts: [...s.toasts.slice(-2), { id, text, icon }] }));
  setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), 2800);
}
export const confirmDialog = (title: string, message: string, ok: string, onOk: () => void) =>
  set({ dialog: { kind: "confirm", title, message, ok, onOk } });
export const promptDialog = (title: string, value: string, onOk: (v: string) => void) =>
  set({ dialog: { kind: "prompt", title, value, onOk } });
export const fail = (e: unknown) => toast(String(e), "circle-alert");

// ── boot & events ───────────────────────────────────────────────────────────
export async function boot() {
  const st = await api.appState();
  const chats: Record<string, Chat> = {};
  for (const c of st.chats) chats[key(c.accountId, c.id)] = c;
  const tabs = get().tabs.filter((t) => chats[t] || (isThreadTab(t) && chats[get().threadTabs[t]?.chatKey ?? ""]));
  const active = get().active && tabs.includes(get().active!) ? get().active : tabs[0] ?? null;
  set({
    booted: true,
    accounts: st.accounts,
    health: st.health,
    chats,
    tabs,
    active,
    tgConfigured: st.tgConfigured,
    gchatConfigured: st.gchatConfigured,
    route: st.accounts.length ? "shell" : "welcome",
  });
  onEvent(applyEvent);
  if (active) void openChat(active);
}

function upsert(list: Msg[], m: Msg): Msg[] {
  const i = list.findIndex((x) => x.id === m.id);
  if (i >= 0) {
    const next = list.slice();
    next[i] = m;
    return next;
  }
  const next = [...list, m];
  if (list.length && list[list.length - 1].sort > m.sort) next.sort((a, b) => a.sort - b.sort);
  return next;
}

export function applyEvent(e: CoreEvent) {
  switch (e.type) {
    case "accounts": {
      const ids = new Set(e.accounts.map((a) => a.id));
      set((s) => {
        const chats = Object.fromEntries(Object.entries(s.chats).filter(([, c]) => ids.has(c.accountId)));
        const tabs = s.tabs.filter((t) => chats[t] || chats[s.threadTabs[t]?.chatKey ?? ""]);
        return {
          accounts: e.accounts,
          chats,
          tabs,
          active: s.active && tabs.includes(s.active) ? s.active : tabs[0] ?? null,
          route: !e.accounts.length && s.route !== "wizard" ? "welcome" : s.route === "welcome" && e.accounts.length ? "shell" : s.route,
        };
      });
      return;
    }
    case "health":
      set((s) => ({ health: { ...s.health, [e.accountId]: { health: e.health, text: e.text, until: e.until } } }));
      return;
    case "auth":
      set((s) => ({ auth: { ...s.auth, [e.accountId]: { step: e.step, info: e.info, error: e.error } } }));
      return;
    case "sync":
      set((s) => {
        const cur = s.sync[e.accountId] ?? { checks: ["idle", "idle", "idle"], log: [] };
        const checks = cur.checks.slice() as SyncState["checks"];
        checks[e.step] = e.state;
        return { sync: { ...s.sync, [e.accountId]: { checks, log: [...cur.log, e.log] } } };
      });
      return;
    case "chat": {
      const k = key(e.chat.accountId, e.chat.id);
      set((s) => ({ chats: { ...s.chats, [k]: e.chat } }));
      // the open chat stays read while it is on screen
      if (e.chat.unread > 0 && isWatching(k)) markRead(k);
      return;
    }
    case "chatRemoved": {
      const k = key(e.accountId, e.chatId);
      set((s) => {
        const chats = { ...s.chats };
        delete chats[k];
        const tabs = s.tabs.filter((t) => t !== k);
        return { chats, tabs, active: s.active === k ? tabs[0] ?? null : s.active };
      });
      return;
    }
    case "message": {
      const k = key(e.msg.accountId, e.msg.chatId);
      if (get().msgs[k]) {
        set((s) => ({
          msgs: { ...s.msgs, [k]: upsert(s.msgs[k], e.msg) },
          fresh: e.isNew || e.msg.outgoing ? { ...s.fresh, [e.msg.id]: true } : s.fresh,
          typing: e.isNew ? { ...s.typing, [k]: { who: "", until: 0 } } : s.typing,
        }));
      }
      if (e.isNew) {
        maybeNotify(k, e.msg);
        if (isWatching(k)) void markRead(k);
      }
      return;
    }
    case "messageIdChanged": {
      const k = key(e.msg.accountId, e.msg.chatId);
      set((s) => {
        const list = s.msgs[k];
        if (!list) return {};
        const without = list.filter((m) => m.id !== e.oldId && m.id !== e.msg.id);
        return { msgs: { ...s.msgs, [k]: upsert(without, e.msg) }, fresh: { ...s.fresh, [e.msg.id]: true } };
      });
      return;
    }
    case "messagesDeleted": {
      const k = key(e.accountId, e.chatId);
      const ids = new Set(e.ids);
      set((s) => (s.msgs[k] ? { msgs: { ...s.msgs, [k]: s.msgs[k].filter((m) => !ids.has(m.id)) } } : {}));
      return;
    }
    case "readOutbox": {
      const k = key(e.accountId, e.chatId);
      set((s) =>
        s.msgs[k]
          ? { msgs: { ...s.msgs, [k]: s.msgs[k].map((m) => (m.outgoing && m.status === "sent" && m.sort <= e.upTo ? { ...m, status: "seen" } : m)) } }
          : {},
      );
      return;
    }
    case "typing": {
      const k = key(e.accountId, e.chatId);
      set((s) => ({ typing: { ...s.typing, [k]: e.on ? { who: e.who, until: Date.now() + 6000 } : { who: "", until: 0 } } }));
      return;
    }
  }
}

/** The user is looking at this chat right now: new messages count as read. */
const isWatching = (k: string) => get().active === k && get().route === "shell" && document.hasFocus() && !document.hidden;

function quiet(p: NotifyPrefs) {
  if (!p.quiet) return false;
  const d = new Date();
  const now = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  return p.from <= p.to ? now >= p.from && now < p.to : now >= p.from || now < p.to;
}

function maybeNotify(k: string, m: Msg) {
  const chat = get().chats[k];
  if (!chat || chat.muted || m.outgoing || isWatching(k)) return;
  const p = get().notif[m.accountId] ?? DEFAULT_NOTIFY;
  if (!p.enabled || quiet(p) || (p.mentions && !m.mentionsMe)) return;
  const who = m.senderName || chat.title;
  const title = chat.kind === "dm" ? who : `${who} · ${chat.title}`;
  const body = p.preview ? plain(m.text) || (m.media ? m.media.name : "Tin nhắn mới") : "Bạn có tin nhắn mới";
  void notify(title, body);
}

// ── chats & messages ────────────────────────────────────────────────────────
const PAGE = 50;

export async function openChat(k: string) {
  const s = get();
  const prevChat = chatKeyOf(s.active);
  const tabs = s.tabs.includes(k) ? s.tabs : (() => {
    const t = s.tabs.slice();
    t.splice(s.active ? t.indexOf(s.active) + 1 : t.length, 0, k);
    return t;
  })();
  set({ tabs, active: k, route: "shell", inspTab: s.active === k ? s.inspTab : "info", ...(window.matchMedia("(max-width: 760px)").matches ? { leftCollapsed: true } : {}) });
  const chatKey = chatKeyOf(k);
  if (!chatKey) return;
  const [accountId, chatId] = splitKey(chatKey);
  if (prevChat && prevChat !== chatKey) void api.setOpen(...splitKey(prevChat), false).catch(() => {});
  void api.setOpen(accountId, chatId, true).catch(() => {});
  if (!get().msgs[chatKey]) await loadLatest(chatKey);
  else void loadLatest(chatKey);
  if (isThreadTab(k)) return void loadThread(k);
  if (get().chats[k]?.unread) void markRead(k);
}

/** Opens a Google Chat thread as its own workspace tab, next to its space. */
export function openThreadTab(chatKey: string, root: Msg) {
  const t = `thread:${root.threadId}`;
  set((s) => ({
    threadTabs: { ...s.threadTabs, [t]: { chatKey, threadId: root.threadId, rootId: root.id, title: plain(root.text).slice(0, 60) || root.media?.name || "Thread" } },
  }));
  void openChat(t);
}

async function loadThread(t: string) {
  const meta = get().threadTabs[t];
  if (!meta) return;
  const [accountId, chatId] = splitKey(meta.chatKey);
  try {
    const msgs = await api.thread(accountId, chatId, meta.threadId);
    set((s) => {
      let list = s.msgs[meta.chatKey] ?? [];
      for (const m of msgs) list = upsert(list, m);
      return { msgs: { ...s.msgs, [meta.chatKey]: list } };
    });
  } catch {}
}

export function toggleFavorite(k: string) {
  const on = get().favorites.includes(k);
  set((s) => ({ favorites: on ? s.favorites.filter((x) => x !== k) : [...s.favorites, k] }));
  toast(on ? "Đã bỏ ghim khỏi đầu danh sách" : "Đã ghim lên đầu danh sách", "pin");
}

export async function loadLatest(k: string) {
  const [accountId, chatId] = splitKey(k);
  const unread = get().chats[k]?.unread ?? 0;
  try {
    const page = await api.messages(accountId, chatId, 0, PAGE);
    set((s) => {
      // merge: keep older pages already loaded and anything that arrived meanwhile
      let list = s.msgs[k] ?? [];
      for (const m of page) list = upsert(list, m);
      const incoming = page.filter((m) => !m.outgoing && m.kind !== "service");
      const mark =
        unread > 0 && !s.unreadMark[k] && incoming.length
          ? { ...s.unreadMark, [k]: { sort: incoming[Math.max(0, incoming.length - unread)].sort, count: unread } }
          : s.unreadMark;
      return {
        msgs: { ...s.msgs, [k]: list },
        older: { ...s.older, [k]: page.length < PAGE ? "done" : s.older[k] ?? "idle" },
        loadErr: { ...s.loadErr, [k]: "" },
        unreadMark: mark,
      };
    });
  } catch (e) {
    set((s) => ({ loadErr: { ...s.loadErr, [k]: String(e) }, msgs: { ...s.msgs, [k]: s.msgs[k] ?? [] } }));
  }
}

export async function loadOlder(k: string) {
  const s = get();
  const list = s.msgs[k];
  if (!list?.length || s.older[k] === "loading" || s.older[k] === "done") return;
  set({ older: { ...s.older, [k]: "loading" } });
  const [accountId, chatId] = splitKey(k);
  try {
    const page = await api.messages(accountId, chatId, list[0].sort, PAGE);
    set((st) => {
      let next = st.msgs[k] ?? [];
      for (const m of page) next = upsert(next, m);
      return { msgs: { ...st.msgs, [k]: next }, older: { ...st.older, [k]: page.length < PAGE / 2 ? "done" : "idle" } };
    });
  } catch {
    set((st) => ({ older: { ...st.older, [k]: "idle" } }));
  }
}

let readT: Record<string, ReturnType<typeof setTimeout>> = {};
export function markRead(k: string) {
  clearTimeout(readT[k]);
  readT[k] = setTimeout(() => {
    const chat = get().chats[k];
    if (!chat) return;
    const ids = (get().msgs[k] ?? []).filter((m) => !m.outgoing).slice(-30).map((m) => m.id);
    set((s) => ({ chats: { ...s.chats, [k]: { ...chat, unread: 0, mention: false } } }));
    void api.markRead(chat.accountId, chat.id, ids).catch(() => {});
  }, 250);
}

export function closeTab(k: string) {
  set((s) => {
    const i = s.tabs.indexOf(k);
    const tabs = s.tabs.filter((t) => t !== k);
    const active = s.active === k ? tabs[Math.min(i, tabs.length - 1)] ?? null : s.active;
    const unreadMark = { ...s.unreadMark };
    delete unreadMark[k];
    const threadTabs = { ...s.threadTabs };
    delete threadTabs[k];
    return { tabs, active, unreadMark, threadTabs };
  });
  const closed = isThreadTab(k) ? null : k;
  if (closed && chatKeyOf(get().active) !== closed) void api.setOpen(...splitKey(closed), false).catch(() => {});
  const a = get().active;
  if (a) void openChat(a);
}

export function cycleTab(d: number) {
  const { tabs, active } = get();
  if (!tabs.length) return;
  const i = active ? tabs.indexOf(active) : -1;
  void openChat(tabs[(i + d + tabs.length) % tabs.length]);
}

export function jumpUnread(d: number) {
  const s = get();
  const order = orderedAccounts(s.accounts, s.accountOrder).flatMap((a) => sortedChats(s.chats, a.id)).map((c) => key(c.accountId, c.id));
  const cur = chatKeyOf(s.active);
  const i = cur ? order.indexOf(cur) : -1;
  for (let n = 1; n <= order.length; n++) {
    const k = order[(i + d * n + order.length * n) % order.length];
    if (s.chats[k]?.unread) return void openChat(k);
  }
  toast("Không còn chat chưa đọc", "info");
}

// ── sending ─────────────────────────────────────────────────────────────────
let localId = 0;
export async function send(k: string, text: string, opts: { replyTo?: string; threadId?: string; file?: string } = {}) {
  const [accountId, chatId] = splitKey(k);
  const temp: Msg = {
    accountId, chatId, id: `local-${++localId}`, sort: Number.MAX_SAFE_INTEGER - 1000 + localId, senderId: "", senderName: "", senderPhoto: "",
    outgoing: true, ts: Date.now(), edited: false, deleted: false, kind: opts.file ? "media" : "text", text,
    media: opts.file ? { kind: "file", name: opts.file.split("/").pop() ?? "file", size: 0, mime: "", width: 0, height: 0, fileRef: "", localPath: "", thumb: "", url: "" } : null,
    link: null, replyTo: opts.replyTo ?? "", replyName: "", replyText: "", reactions: [], threadId: opts.threadId ?? "",
    threadReply: !!opts.threadId, status: "sending", error: "", pinned: false, mentionsMe: false, rev: "",
  };
  const replied = opts.replyTo ? get().msgs[k]?.find((m) => m.id === opts.replyTo) : undefined;
  if (replied) {
    temp.replyName = replied.outgoing ? "Bạn" : replied.senderName;
    temp.replyText = plain(replied.text) || replied.media?.name || "";
  }
  set((s) => ({ msgs: { ...s.msgs, [k]: [...(s.msgs[k] ?? []), temp] }, fresh: { ...s.fresh, [temp.id]: true } }));
  try {
    const real = await api.send({ accountId, chatId, text, ...opts });
    set((s) => {
      const list = (s.msgs[k] ?? []).filter((m) => m.id !== temp.id);
      return { msgs: { ...s.msgs, [k]: list.some((m) => m.id === real.id) ? list : upsert(list, real) }, fresh: { ...s.fresh, [real.id]: true } };
    });
  } catch (e) {
    set((s) => ({ msgs: { ...s.msgs, [k]: (s.msgs[k] ?? []).map((m) => (m.id === temp.id ? { ...m, status: "failed", error: String(e) } : m)) } }));
  }
}

export function retry(k: string, m: Msg) {
  set((s) => ({ msgs: { ...s.msgs, [k]: (s.msgs[k] ?? []).filter((x) => x.id !== m.id) } }));
  if (!m.id.startsWith("local-")) void api.deleteMsg(m.accountId, m.chatId, m.id).catch(() => {});
  void send(k, m.text, { replyTo: m.replyTo || undefined, threadId: m.threadId || undefined });
}

export async function toggleReaction(k: string, m: Msg, emoji: string) {
  const r = m.reactions.find((x) => x.emoji === emoji);
  const add = !r?.mine;
  // optimistic: the platform confirms through a message update
  const reactions = add
    ? r ? m.reactions.map((x) => (x === r ? { ...x, count: x.count + 1, mine: true } : x)) : [...m.reactions, { emoji, count: 1, mine: true }]
    : m.reactions.map((x) => (x === r ? { ...x, count: x.count - 1, mine: false } : x)).filter((x) => x.count > 0);
  set((s) => ({ msgs: { ...s.msgs, [k]: (s.msgs[k] ?? []).map((x) => (x.id === m.id ? { ...x, reactions } : x)) } }));
  try {
    await api.react(m.accountId, m.chatId, m.id, emoji, add);
  } catch (e) {
    set((s) => ({ msgs: { ...s.msgs, [k]: (s.msgs[k] ?? []).map((x) => (x.id === m.id ? m : x)) } }));
    fail(e);
  }
}
