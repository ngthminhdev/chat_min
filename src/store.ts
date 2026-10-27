import { create } from "zustand";
import { createUiWriter, persistedUiChanged, restoreUi, uiSnapshot } from "./lib/ui-persistence";
import { api, isTauri, onEvent, saveFile } from "./lib/bridge";
import { plain } from "./lib/format";
import { bare } from "./lib/micro-ux";
import { windowAppearance, type BackgroundMode } from "./lib/appearance";
import { correlateAcknowledgement, reconcileMessage } from "./lib/message-identity";
import { queueToast } from "./lib/toast-queue";
import { isMobile } from "./lib/mobile";
import { mobileConversationVisible } from "./lib/mobile-navigation";
import { PLATFORMS, type Cap } from "./lib/platforms";
import { themeBase } from "./lib/themes";
import type { Account, Chat, CoreEvent, Folder, Health, Media, Msg, ThreadSummary, Topic } from "./lib/types";
import type { IconName } from "./ui/Icon";

export type Route = "shell" | "inbox" | "settings" | "search" | "welcome" | "wizard";
export type InspTab = "info" | "members" | "files" | "media" | "pinned" | "threads";

/** Chats and their message lists are keyed by "accountId|chatId". */
export const key = (accountId: string, chatId: string) => `${accountId}|${chatId}`;
export const splitKey = (k: string): [string, string] => {
  const i = k.indexOf("|");
  return [k.slice(0, i), k.slice(i + 1)];
};

export interface Prefs {
  size: number; theme: string; uiFont: string; monoFont: string; compact: boolean;
  backgroundMode: BackgroundMode; backgroundTransparency: number;
  /** AI: the language the user reads in, and the default one to write in */
  aiMe: string; aiTo: string;
  quickReactions?: string[];
}
/** `reacted`: someone added this emoji to my message; `ts` is then when it was seen */
export type InboxItem = Msg & { reacted?: string };
export const inboxKey = (m: InboxItem) => `${m.accountId}|${m.chatId}|${m.id}|${m.reacted ?? ""}`;
/** Unread until opened, marked all read, or read where it lives: a reply once its thread
 *  was open after it, a plain message once its chat has nothing unread. */
export function inboxUnread(s: Pick<State, "inboxSeen" | "inboxRead" | "chats" | "threadSeen">, m: InboxItem) {
  const k = key(m.accountId, m.chatId);
  if (m.ts <= s.inboxSeen || s.inboxRead[inboxKey(m)]) return false;
  if (m.reacted) return true;
  if (m.threadReply) return (s.threadSeen[`${k}#${m.threadId}`] ?? -Infinity) < m.sort;
  return (s.chats[k]?.unread ?? 1) > 0;
}
export interface Translation { state: "loading" | "ok" | "err"; text: string }
export interface NotifyPrefs { enabled: boolean; mentions: boolean; quiet: boolean; from: string; to: string; preview: boolean }
export const DEFAULT_NOTIFY: NotifyPrefs = { enabled: true, mentions: false, quiet: false, from: "22:00", to: "08:00", preview: true };

export interface MenuItem { icon: IconName; label: string; kbd?: string; danger?: boolean; run: () => void }
/** Popovers anchor below `y` (an element's bottom) and flip above `top` when they don't fit. */
export type Pop = { x: number; y: number; top: number } & (
  | { kind: "emoji"; onPick: (emoji: string) => void; only?: string[]; expanded?: boolean }
  /** `quick`: phone long-press sheet — a row of reactions above the items, `more` opens the full picker */
  | { kind: "menu"; items: MenuItem[]; title?: string; quick?: { pick: (emoji: string) => void; more: () => void } }
  | { kind: "color"; accountId?: string; value?: string; onPick?: (color: string) => void }
  | { kind: "icons"; value?: string; onPick: (name: IconName) => void }
);
export const anchor = (el: Element) => {
  const r = el.getBoundingClientRect();
  return { x: r.left, y: r.bottom, top: r.top };
};
export type Dialog =
  | { kind: "confirm"; title: string; message: string; ok: string; onOk: () => void }
  | { kind: "prompt"; title: string; value: string; onOk: (v: string) => void };
/** A thread (Google Chat) or forum topic (Telegram) opened in its own tab. */
export interface ThreadTab { chatKey: string; threadId: string; rootId: string; title: string; error?: string; errorOlder?: boolean; topic?: boolean }
export interface Toast { id: number; text: string; icon: IconName }
export interface AuthState { step: string; info: string; error: string }
export interface SyncState { checks: ("idle" | "run" | "ok" | "err")[]; log: string[] }

interface State {
  booted: boolean;
  tgConfigured: boolean;
  /** "chatKey|threadId" → muted: no banner, no bell entry (thread_mute) */
  mutedThreads: Record<string, true>;
  gchatConfigured: boolean;
  accounts: Account[];
  health: Record<string, Health>;
  chats: Record<string, Chat>;
  msgs: Record<string, Msg[]>;
  older: Record<string, "idle" | "loading" | "done">;
  loadErr: Record<string, string>;
  /** sort key of the first unread message when the chat was opened → "N tin chưa đọc" line */
  unreadMark: Record<string, { sort: number; count: number }>;
  /** ids that arrived live (not from history), also used by thread unread */
  fresh: Record<string, true>;
  /** latest reply sort seen per thread (`chatKey#threadId`): clears its "N mới" */
  threadSeen: Record<string, number>;
  /** mentions + DMs + reactions to my messages, newest first (titlebar bell) */
  inbox: InboxItem[];
  /** "account|user" → online (Telegram only: Google Chat has no presence API) */
  online: Record<string, true>;
  /** inbox items at or before this ts count as read ("Đánh dấu đã đọc") */
  inboxSeen: number;
  /** inbox items opened one by one (`inboxKey`) */
  inboxRead: Record<string, true>;
  typing: Record<string, { who: string; until: number }>;
  tabs: string[];
  active: string | null;
  route: Route;
  searchQuery: string;
  searchScope: string;
  searchAccount: string;
  wizardFor: string | null;
  drafts: Record<string, string>;
  replyTo: Record<string, string>;
  editing: Record<string, string>;
  inspTab: InspTab;
  /** Google Chat spaces: timeline or thread list */
  convTab: Record<string, "msgs" | "threads">;
  /** thread/topic tabs ("thread:<chatKey>:<threadId>") → the chat they belong to */
  threadTabs: Record<string, ThreadTab>;
  /** Transient Google thread pagination; never persisted with workspace tabs. */
  threadPages: Record<string, { token: string; limit: number; truncated?: boolean }>;
  /** Threaded spaces: the thread list by latest reply, a flow of its own (thread_list) */
  threadList: Record<string, { items: ThreadSummary[]; state: "idle" | "loading" | "done" }>;
  /** Google's reply totals ("chatKey#threadId"), asked only for threads on screen */
  threadCounts: Record<string, { count: number; exact: boolean }>;
  /** forum chat → topic the user opened last; opening the chat lands there (like Telegram) */
  lastTopic: Record<string, string>;
  /** user folders: sidebar groups holding chats from any account */
  folders: Folder[];
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
  /** forward sheet: the message and the chat picked in the palette */
  forward: { msg: Msg; to: string } | null;
  pop: Pop | null;
  dialog: Dialog | null;
  /** ⌘K → "Chọn giao diện…": the theme chip grid modal */
  themePicker: boolean;
  toasts: Toast[];
  prefs: Prefs;
  notif: Record<string, NotifyPrefs>;
  auth: Record<string, AuthState>;
  sync: Record<string, SyncState>;
  jumpTo: string | null;
  /** bumped to bring the open conversation to its newest message (notification click) */
  toLatest: number;
  /** bumped when I send: the timeline lands on my message, even scrolled up (incoming never) */
  sent: number;
  /** chats hidden from the sidebar → lastTs when hidden; a newer message brings them back */
  hidden: Record<string, number>;
  /** manual chat order per sidebar section ("accountId:section") — a prefix; the rest sorts by activity */
  chatOrder: Record<string, string[]>;
  /** sidebar hover preview */
  hoverPeek: { k: string; x: number; y: number } | null;
  /** Telegram forum topics per chat */
  topics: Record<string, Topic[]>;
  /** AI summaries, keyed by tab (chat or thread tab) — never persisted */
  summary: Record<string, { state: "loading" | "ok" | "err"; text: string; n: number }>;
  /** full-window image/video viewer */
  /** `src` set: a Telegram video streaming, `path` stays empty until it is downloaded */
  viewer: { media: Media; path: string; src?: string; accountId?: string; messageId?: string; galleryIds?: string[] } | null;
  /** `${accountId}|${fileRef}` → percent of a big download in progress */
  progress: Record<string, number>;
  /** Android notification permission: "granted" | "denied" | "prompt" (desktop: granted) */
  notifyPermission: string;
  /** the open chat is scrolled to its newest message: only then does a new one count as seen */
  atBottom: boolean;
  /** inline translations, keyed "chatKey#msgId" — never persisted */
  tr: Record<string, Translation>;
  /** chats translating every message as it loads */
  trAuto: Record<string, boolean>;
  /** per-chat language to write in, overrides prefs.aiTo */
  aiLang: Record<string, string>;
  /** composer toggle: send text as typed, *abc* is not bold (persisted) */
  plainSend: boolean;
}

const PERSIST = "chatmin.ui";
const saved: Partial<State> & { _savedAt?: number } = (() => {
  try {
    return JSON.parse(localStorage.getItem(PERSIST) || "{}");
  } catch {
    return {};
  }
})();

export const useApp = create<State>(() => ({
  booted: false,
  tgConfigured: false,
  mutedThreads: {},
  gchatConfigured: false,
  accounts: [],
  health: {},
  chats: {},
  msgs: {},
  older: {},
  loadErr: {},
  unreadMark: {},
  fresh: {},
  threadSeen: {},
  inbox: [],
  online: {},
  // first run: what is already in the cache is history, not news
  inboxSeen: saved.inboxSeen || Date.now(),
  inboxRead: saved.inboxRead ?? {},
  typing: {},
  tabs: saved.tabs ?? [],
  active: saved.active ?? null,
  route: "shell",
  searchQuery: "",
  searchScope: "",
  searchAccount: "",
  wizardFor: null,
  drafts: saved.drafts ?? {},
  replyTo: {},
  editing: {},
  inspTab: "info",
  convTab: {},
  threadTabs: saved.threadTabs ?? {},
  threadPages: {},
  threadList: {},
  threadCounts: {},
  lastTopic: saved.lastTopic ?? {},
  folders: saved.folders ?? [],
  favorites: saved.favorites ?? [],
  accountOrder: saved.accountOrder ?? [],
  expanded: {},
  filter: "all",
  query: "",
  collapsed: saved.collapsed ?? {},
  // phone: start on the list, inspector closed (it is a sheet there)
  leftCollapsed: document.documentElement.classList.contains("mobile") ? false : saved.leftCollapsed ?? false,
  rightCollapsed: document.documentElement.classList.contains("mobile") ? true : saved.rightCollapsed ?? false,
  palette: null,
  forward: null,
  pop: null,
  dialog: null,
  themePicker: false,
  toasts: [],
  notifyPermission: "granted",
  prefs: { size: 13, theme: "", uiFont: "", monoFont: "", compact: false, aiMe: "Vietnamese", aiTo: "English", ...saved.prefs,
    backgroundMode: windowAppearance(saved.prefs ?? {}).mode,
    backgroundTransparency: windowAppearance(saved.prefs ?? {}).transparency },
  notif: saved.notif ?? {},
  auth: {},
  sync: {},
  jumpTo: null,
  toLatest: 0,
  sent: 0,
  hidden: saved.hidden ?? {},
  viewer: null,
  progress: {},
  atBottom: true,
  chatOrder: saved.chatOrder ?? {},
  hoverPeek: null,
  topics: {},
  summary: {},
  tr: {},
  trAuto: saved.trAuto ?? {},
  aiLang: saved.aiLang ?? {},
  plainSend: saved.plainSend ?? false,
}));

const get = useApp.getState;
const set = useApp.setState;

// Browser cache plus a native backup outside WKWebView storage. Never save messages.
let persistT: ReturnType<typeof setTimeout> | undefined;
let durableReady = !isTauri;
let lastUiSavedAt = saved._savedAt ?? 0;
const saveNativeUi = createUiWriter((snapshot: Partial<State>) => api.uiStateSet(snapshot));
function persistUi(s: State, immediate = false) {
  lastUiSavedAt = Math.max(Date.now(), lastUiSavedAt + 1);
  const snapshot = { ...uiSnapshot(s), _savedAt: lastUiSavedAt };
  clearTimeout(persistT);
  const save = () => {
    try { localStorage.setItem(PERSIST, JSON.stringify(snapshot)); } catch {}
    if (isTauri && durableReady) void saveNativeUi(snapshot).catch(e => {
      console.error('Native UI preferences save failed', e);
      toast('Không lưu được cấu hình ứng dụng; thay đổi vẫn được giữ trong cửa sổ này', 'info');
    });
  };
  if (immediate) save(); else persistT = setTimeout(save, 300);
}
useApp.subscribe((s, previous) => {
  if (s.booted && persistedUiChanged(s, previous)) persistUi(s, s.favorites !== previous.favorites || s.prefs !== previous.prefs || s.notif !== previous.notif);
});

// ── selectors ───────────────────────────────────────────────────────────────
export const isThreadTab = (t: string | null | undefined): t is string => !!t && t.startsWith("thread:");
export const threadTabKey = (chatKey: string, threadId: string) => `thread:${chatKey}:${threadId}`;
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

/** Local only: drop a chat from the sidebar until its next message. */
export function hideChat(k: string) {
  set((s) => {
    const chats = { ...s.chats };
    const lastTs = chats[k]?.lastTs ?? Date.now();
    delete chats[k];
    const tabs = s.tabs.filter((t) => t !== k && s.threadTabs[t]?.chatKey !== k);
    return {
      chats,
      tabs,
      hidden: { ...s.hidden, [k]: lastTs },
      favorites: s.favorites.filter((f) => f !== k),
      active: s.active && tabs.includes(s.active) ? s.active : tabs[0] ?? null,
    };
  });
}

/** Save a downloaded file (quick → the download folder, else a dialog) and say where it went. */
export async function saveMedia(path: string, name: string, ask: boolean) {
  try {
    const out = await saveFile(path, name, ask);
    if (out) toast(`Đã lưu ${out.split("/").slice(-2).join("/")}`, "download");
  } catch (e) {
    fail(e);
  }
}

// ── feedback ────────────────────────────────────────────────────────────────
let toastId = 0;
export function toast(text: string, icon: IconName = "check") {
  const id = ++toastId;
  set((s) => ({ toasts: queueToast(s.toasts, { id, text, icon }) }));
}
export const dismissToast = (id: number) => set(s => ({ toasts: s.toasts.filter(t => t.id !== id) }));
export const confirmDialog = (title: string, message: string, ok: string, onOk: () => void) =>
  set({ dialog: { kind: "confirm", title, message, ok, onOk } });
export const promptDialog = (title: string, value: string, onOk: (v: string) => void) =>
  set({ dialog: { kind: "prompt", title, value, onOk } });
/** raw provider errors → what the user can act on */
const ERRORS: [RegExp, string][] = [
  [/reaction isn't available/i, "Chat này không cho thả biểu cảm đó (nhóm giới hạn biểu cảm)"],
  [/REACTIONS_TOO_MANY/i, "Telegram chỉ cho tối đa 3 biểu cảm mỗi tin (Premium) hoặc 1"],
];
export const fail = (e: unknown) => {
  const raw = String(e);
  toast(ERRORS.find(([re]) => re.test(raw))?.[1] ?? raw, "circle-alert");
};

// ── boot & events ───────────────────────────────────────────────────────────
let eventOff: (() => void) | null = null;
let bootPending: Promise<void> | null = null;
export function boot(): Promise<void> {
  return bootPending ??= bootOnce().finally(() => { bootPending = null; });
}
if (import.meta.hot) import.meta.hot.dispose(() => { eventOff?.(); eventOff = null; });

async function bootOnce() {
  let durableRead = true;
  const [st, durable] = await Promise.all([api.appState(), api.uiState().catch(e => {
    durableRead = false; console.error("Native UI preferences read failed", e); return null;
  })]);
  const restored = restoreUi({ ...uiSnapshot(get()), _savedAt: lastUiSavedAt }, durable);
  lastUiSavedAt = Math.max(lastUiSavedAt, Number((durable as { _savedAt?: number } | null)?._savedAt) || 0);
  set(restored);
  const chats: Record<string, Chat> = {};
  const hidden = get().hidden;
  for (const c of st.chats) if (!(c.lastTs <= hidden[key(c.accountId, c.id)])) chats[key(c.accountId, c.id)] = c;
  const tabs = get().tabs.filter((t) => chats[t] || (isThreadTab(t) && chats[get().threadTabs[t]?.chatKey ?? ""]));
  const active = get().active && tabs.includes(get().active!) ? get().active : tabs[0] ?? null;
  void api.inbox(100).then((inbox) => set({ inbox })).catch(() => {});
  void api.presence().then((ids) => set({ online: Object.fromEntries(ids.map((id) => [id, true as const])) })).catch(() => {});
  set({
    booted: true,
    accounts: st.accounts,
    health: st.health,
    chats,
    tabs,
    active,
    tgConfigured: st.tgConfigured,
    gchatConfigured: st.gchatConfigured,
    mutedThreads: Object.fromEntries(st.mutedThreads.map((k) => [k, true as const])),
    route: st.accounts.length ? "shell" : "welcome",
    ...(isMobile ? { leftCollapsed: false, rightCollapsed: true } : {}),
  });
  durableReady = durableRead;
  persistUi(get(), true);
  eventOff ??= onEvent(applyEvent);
  if (active && !isMobile) void openChat(active);
}

function upsert(list: Msg[], m: Msg): Msg[] {
  return reconcileMessage(list, m);
}

// Native echoes can beat the IPC send response. Keep the one optimistic bubble
// until the response supplies the provider ID; never guess which echo owns it.
const pendingTextSends = new Map<string, Map<string, { text: string; wire: string; thread: string; reply: string }>>();
const heldOutgoing = new Map<string, CoreEvent[]>();
function holdOutgoing(e: CoreEvent): boolean {
  if (e.type !== "message" && e.type !== "messageIdChanged") return false;
  const m = e.msg, k = key(m.accountId, m.chatId), pending = pendingTextSends.get(k);
  if (!m.outgoing || m.media || !pending?.size || get().msgs[k]?.some(x => x.id === m.id || x.uiPreviousIds?.includes(m.id))) return false;
  const text = plain(m.text);
  if (![...pending.values()].some(p => (text === p.text || text === p.wire) && (p.thread ? p.thread === m.threadId : !m.threadReply) && p.reply === (m.replyTo ?? ""))) return false;
  const queue = heldOutgoing.get(k) ?? [];
  queue.push(e); heldOutgoing.set(k, queue);
  return true;
}

export function applyEvent(e: CoreEvent) {
  if (holdOutgoing(e)) return;
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
    case "history": {
      set(s => {
        const msgs = { ...s.msgs }, chats = { ...s.chats };
        for (const chat of e.chats) chats[key(chat.accountId, chat.id)] = chat;
        for (const msg of e.messages) {
          const k = key(msg.accountId, msg.chatId);
          if (!msgs[k] || holdOutgoing({ type: "message", msg, isNew: false })) continue;
          msgs[k] = upsert(msgs[k], msg);
        }
        return { msgs, chats };
      });
      return;
    }
    case "profiles": {
      const profiles = new Map(e.profiles.map(p => [p.id, p]));
      set(s => {
        let changed = false;
        const msgs = { ...s.msgs };
        for (const [k, list] of Object.entries(s.msgs)) {
          if (!k.startsWith(`${e.accountId}|`)) continue;
          let touched = false;
          const next = list.map(m => {
            const p = profiles.get(m.senderId);
            if (!p) return m;
            const senderPhoto = p.photo || m.senderPhoto, senderName = p.name || m.senderName;
            if (senderPhoto === m.senderPhoto && senderName === m.senderName) return m;
            touched = true;
            return { ...m, senderPhoto, senderName };
          });
          if (touched) { msgs[k] = next; changed = true; }
        }
        return changed ? { msgs } : {};
      });
      return;
    }
    case "health":
      // just came online: Telegram's chat list is still streaming in, so give it a moment
      if (e.health === "ok" && get().health[e.accountId]?.health !== "ok") setTimeout(() => void prefetchUnread(e.accountId), 3000);
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
      const hid = get().hidden[k];
      if (hid !== undefined) {
        if (e.chat.lastTs <= hid) return;
        set((s) => {
          const { [k]: _, ...hidden } = s.hidden;
          return { hidden };
        });
      }
      set((s) => ({ chats: { ...s.chats, [k]: e.chat } }));
      // the open chat stays read while it is on screen
      if (e.chat.kind !== "web" && (e.chat.unread > 0 || e.chat.mention) && isWatching(k)) markRead(k);
      return;
    }
    case "chatRemoved": {
      const k = key(e.accountId, e.chatId);
      set((s) => {
        const chats = { ...s.chats };
        delete chats[k];
        const tabs = s.tabs.filter((t) => t !== k && s.threadTabs[t]?.chatKey !== k);
        return { chats, tabs, favorites: s.favorites.filter((f) => f !== k), active: s.active && tabs.includes(s.active) ? s.active : tabs[0] ?? null };
      });
      return;
    }
    case "message": {
      const k = key(e.msg.accountId, e.msg.chatId);
      const known = get().msgs[k]?.some((m) => m.id === e.msg.id) ?? false;
      if (e.isNew && e.msg.threadReply && e.msg.threadId) bumpThread(k, e.msg);
      if (get().msgs[k]) {
        set((s) => ({
          msgs: { ...s.msgs, [k]: upsert(s.msgs[k], e.msg) },
          fresh: e.isNew || (e.msg.outgoing && !known) ? { ...s.fresh, [e.msg.id]: true } : s.fresh,
          typing: e.isNew ? { ...s.typing, [k]: { who: "", until: 0 } } : s.typing,
        }));
      }
      // arriving where I'm looking (the chat, or for a reply its open thread tab): already read
      const here = e.msg.threadReply
        ? get().active === threadTabKey(k, e.msg.threadId) && (!isMobile || mobileConversationVisible(get())) && document.hasFocus() && !document.hidden
        : isWatching(k);
      if (e.inbox && here) set((s) => ({ inboxRead: { ...s.inboxRead, [inboxKey(e.msg)]: true } }));
      if (e.inbox)
        set((s) => ({ inbox: [e.msg, ...s.inbox.filter((x) => x.id !== e.msg.id || x.chatId !== e.msg.chatId)].slice(0, 100) }));
      // notifications and the Dock badge are decided in Rust (notify.rs): this webview
      // can be throttled while the window is hidden
      if (e.isNew && isWatching(k)) void markRead(k);
      return;
    }
    case "messageIdChanged": {
      const k = key(e.msg.accountId, e.msg.chatId);
      set((s) => {
        const list = s.msgs[k];
        if (!list) return {};
        return { msgs: { ...s.msgs, [k]: reconcileMessage(list, e.msg, e.oldId) }, fresh: { ...s.fresh, [e.msg.id]: true } };
      });
      return;
    }
    case "open": {
      // a notification was clicked (notify.rs); a thread reply opens its thread tab
      return openAt(e.key, e.msg, e.thread);
    }
    case "fileProgress":
      set((s) => ({ progress: { ...s.progress, [`${e.accountId}|${e.fileRef}`]: e.pct } }));
      return;
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
    case "reacted": {
      const it: InboxItem = { ...e.msg, ts: Date.now(), reacted: e.emoji };
      const here = isWatching(key(e.msg.accountId, e.msg.chatId));
      set((s) => ({ inbox: [it, ...s.inbox].slice(0, 100), inboxRead: here ? { ...s.inboxRead, [inboxKey(it)]: true } : s.inboxRead }));
      return;
    }
    case "presence": {
      const id = key(e.accountId, e.userId);
      set((s) => {
        const online = { ...s.online };
        if (e.online) online[id] = true;
        else delete online[id];
        return { online };
      });
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
// reading older messages up the list isn't seeing the new one: it stays unread (badge + "N tin mới")
const isWatching = (k: string) =>
  chatKeyOf(get().active) === k && get().route === "shell" && (!isMobile || mobileConversationVisible(get())) && get().atBottom && document.hasFocus() && !document.hidden;

// ── chats & messages ────────────────────────────────────────────────────────
const PAGE = 50;

export async function openChat(k: string) {
  const s = get();
  const prevChat = chatKeyOf(s.active);
  // not when coming back out of one of its topic tabs (that shows the forum itself)
  if (s.chats[k]?.forum && !(isThreadTab(s.active) && prevChat === k)) {
    const landing = await forumLanding(k);
    if (landing) return openChat(landing);
  }
  const tabs = s.tabs.includes(k) ? s.tabs : (() => {
    const t = s.tabs.slice();
    t.splice(s.active ? t.indexOf(s.active) + 1 : t.length, 0, k);
    return t;
  })();
  set({ tabs, active: k, route: "shell", inspTab: s.active === k ? s.inspTab : (() => { const c = s.chats[chatKeyOf(k) ?? k]; return c?.threaded || c?.forum ? "threads" : "info"; })(), ...(isMobile ? { leftCollapsed: true, rightCollapsed: true } : window.matchMedia("(max-width: 760px)").matches ? { leftCollapsed: true } : {}) });
  const chatKey = chatKeyOf(k);
  if (!chatKey) return;
  const [accountId, chatId] = splitKey(chatKey);
  if (prevChat && prevChat !== chatKey && get().chats[prevChat]?.kind !== "web") {
    void api.setOpen(...splitKey(prevChat), false).catch(() => {});
    trimLoaded(prevChat);
  }
  // The website owns read receipts; the native view controls web notification focus.
  if (get().chats[chatKey]?.kind === "web") return;
  void api.setOpen(accountId, chatId, true).catch(() => {});
  // An explicitly opened thread is its own bounded read, not another whole-space refresh.
  if (isThreadTab(k) && !get().threadTabs[k]?.topic) {
    if (!get().msgs[chatKey]) set(st => ({ msgs: { ...st.msgs, [chatKey]: [] } }));
    return void loadThread(k);
  }
  if (!get().msgs[chatKey]) await showCached(chatKey);
  if (!get().msgs[chatKey]) await loadLatest(chatKey);
  else void loadLatest(chatKey);
  if (get().chats[chatKey]?.threaded) {
    void primeRoots(chatKey);
    // cache only: the reply counts under thread starters, without touching the network
    if (!get().threadList[chatKey]) void loadThreadList(chatKey, false, false);
  }
  if (isThreadTab(k)) return void loadThread(k);
  const c = get().chats[k];
  if (c?.unread || c?.mention) void markRead(k);
}

/** Opens a Google Chat thread as its own workspace tab, next to its space. */
/** Opens the chat holding `msg`, or its thread tab when it's a reply in a threaded space. */
export function openAt(k: string, msg: string, thread: string) {
  const chat = get().chats[k];
  if (!chat) return toast("Chat này không còn trong danh sách", "info");
  set((s) => ({ toLatest: s.toLatest + 1 })); // land on the newest message (useStickyScroll)
  if (thread && chat.forum) {
    const topic = get().topics[k]?.find((t) => t.id === thread);
    return openTopicTab(k, topic ?? ({ id: thread, name: get().threadTabs[threadTabKey(k, thread)]?.title || "Chủ đề" } as Topic));
  }
  if (!thread || !chat.threaded) return void openChat(k);
  const m = get().msgs[k]?.find((x) => x.id === msg);
  if (m) return openThreadTab(k, m);
  const t = threadTabKey(k, thread);
  set((s) => ({ threadTabs: { ...s.threadTabs, [t]: s.threadTabs[t] ?? { chatKey: k, threadId: thread, rootId: msg, title: "Thread" } } }));
  void openChat(t);
}

/** Incoming replies the user hasn't caught up on: past the chat's unread line or arrived
 *  live, and newer than the last time the thread was open. */
export function threadUnread(s: Pick<State, "unreadMark" | "fresh" | "threadSeen">, k: string, threadId: string, replies: Msg[]) {
  const mark = s.unreadMark[k]?.sort;
  const seen = s.threadSeen[`${k}#${threadId}`] ?? -Infinity;
  return replies.filter((r) => !r.outgoing && r.sort > seen && ((mark !== undefined && r.sort >= mark) || s.fresh[r.id])).length;
}

export const seenThread = (k: string, thread: string, sort: number) =>
  set((s) => ((s.threadSeen[`${k}#${thread}`] ?? -Infinity) >= sort ? s : { threadSeen: { ...s.threadSeen, [`${k}#${thread}`]: sort } }));

export function openThreadTab(chatKey: string, root: Msg) {
  if (!root.threadId) return toast("Tin nhắn này chưa có thread ID từ Google Chat", "info");
  const threadId = root.threadId;
  if (root.threadReply) root = get().msgs[chatKey]?.find((m) => m.threadId === threadId && !m.threadReply) ?? root;
  const t = threadTabKey(chatKey, threadId);
  set((s) => ({
    threadTabs: { ...s.threadTabs, [t]: { chatKey, threadId, rootId: root.id, title: plain(root.text).slice(0, 60) || root.media?.name || "Thread" } },
  }));
  void openChat(t);
}

export async function loadTopics(k: string) {
  const [accountId, chatId] = splitKey(k);
  try {
    const topics = await api.topics(accountId, chatId);
    set((s) => ({ topics: { ...s.topics, [k]: topics } }));
  } catch (e) {
    fail(e);
  }
}

export function openTopicTab(chatKey: string, topic: Topic) {
  const t = threadTabKey(chatKey, topic.id);
  set((s) => ({ threadTabs: { ...s.threadTabs, [t]: { chatKey, threadId: topic.id, rootId: "", title: topic.name, topic: true } }, lastTopic: { ...s.lastTopic, [chatKey]: topic.id } }));
  void openChat(t);
}

/** Opening a forum from the list lands in the topic opened last (or the most recent one), not General.
 *  Back from a topic tab still shows the plain chat: `prevChat` is the forum itself then. */
async function forumLanding(k: string): Promise<string | null> {
  const s = get();
  const id = s.lastTopic[k];
  const tab = id ? threadTabKey(k, id) : "";
  if (tab && s.threadTabs[tab]) return tab;
  const topics = s.topics[k] ?? (await api.topics(...splitKey(k)).catch(() => [] as Topic[]));
  if (!s.topics[k] && topics.length) set((st) => ({ topics: { ...st.topics, [k]: topics } }));
  const newest = [...topics].sort((a, b) => b.lastTs - a.lastTs)[0];
  if (!newest) return null;
  const t = threadTabKey(k, newest.id);
  set((st) => ({ threadTabs: { ...st.threadTabs, [t]: { chatKey: k, threadId: newest.id, rootId: "", title: newest.name, topic: true } }, lastTopic: { ...st.lastTopic, [k]: newest.id } }));
  return t;
}

export async function loadOlderThread(t: string) {
  if (!get().threadPages[t]?.token || get().older[t] === "loading" || get().older[t] === "done") return;
  return loadThread(t, true);
}

async function loadThread(t: string, older = false) {
  const meta = get().threadTabs[t];
  if (!meta || get().older[t] === "loading") return;
  const [accountId, chatId] = splitKey(meta.chatKey);
  const previous = get().threadPages[t];
  const token = older ? previous?.token ?? "" : "";
  if (older && !token) return;
  set(st => ({ older: { ...st.older, [t]: "loading" } }));
  // The root can be weeks old. Fetch only that one message, independently of the tail.
  if (!meta.topic && !(get().msgs[meta.chatKey] ?? []).some(m => m.threadId === meta.threadId && !m.threadReply)) {
    void api.threadRoot(accountId, chatId, meta.threadId).then(roots => {
      set(st => {
        let list = st.msgs[meta.chatKey] ?? [];
        for (const m of roots) list = upsert(list, m);
        const root = roots.find(m => !m.threadReply);
        return { msgs: { ...st.msgs, [meta.chatKey]: list }, threadTabs: root && st.threadTabs[t] ? { ...st.threadTabs, [t]: { ...st.threadTabs[t], rootId: root.id } } : st.threadTabs };
      });
    }).catch(() => {});
  }
  try {
    const page = meta.topic
      ? { messages: await api.topicHistory(accountId, chatId, meta.threadId, 0, 50), nextPageToken: "" }
      : await api.thread(accountId, chatId, meta.threadId, token, 20);
    set(st => {
      if (!st.threadTabs[t] || (older && st.threadPages[t] !== previous)) return {};
      let list = st.msgs[meta.chatKey] ?? [];
      for (const m of page.messages) list = upsert(list, m);
      const root = list.find(m => m.threadId === meta.threadId && !m.threadReply);
      const current = st.threadPages[t];
      const known = (st.msgs[meta.chatKey] ?? []).filter(m => m.threadId === meta.threadId && m.threadReply);
      const gap = !older && known.length > 0 && page.messages.length > 0
        && page.messages[0].sort > known[known.length - 1].sort;
      // Refreshing a tab preserves its older-page cursor and already revealed history.
      const paging = older || !current || !current.token || gap
        ? { token: page.nextPageToken, limit: older ? (current?.limit ?? 20) + page.messages.length : 20 }
        : current;
      return {
        msgs: { ...st.msgs, [meta.chatKey]: list },
        threadPages: { ...st.threadPages, [t]: paging },
        older: { ...st.older, [t]: paging.token ? "idle" : "done" },
        threadTabs: st.threadTabs[t] ? { ...st.threadTabs, [t]: { ...st.threadTabs[t], rootId: root?.id ?? meta.rootId, error: "", errorOlder: false } } : st.threadTabs,
      };
    });
  } catch (e) {
    set(st => !st.threadTabs[t] || (older && st.threadPages[t] !== previous) ? {} : ({
      older: { ...st.older, [t]: "idle" },
      threadTabs: st.threadTabs[t] ? { ...st.threadTabs, [t]: { ...st.threadTabs[t], error: String(e), errorOlder: older } } : st.threadTabs,
    }));
  }
}

/** Keep closed thread previews small, while preserving pages the user explicitly opened. */
function threadPreviews(k: string, list: Msg[], pages = get().threadPages) {
  if (!get().chats[k]?.threaded) return { messages: list, pages };
  const counts = new Map<string, number>();
  const keep: Msg[] = [];
  let nextPages = pages;
  for (let i = list.length - 1; i >= 0; i--) {
    const m = list[i];
    if (m.threadReply && m.threadId) {
      const count = (counts.get(m.threadId) ?? 0) + 1;
      counts.set(m.threadId, count);
      const t = threadTabKey(k, m.threadId), page = pages[t];
      if (count > (page?.limit ?? 20)) {
        // New live replies can push previously complete history outside the kept window.
        // Its empty token no longer proves that the visible count is the total.
        if (page && !page.token && !nextPages[t].truncated) {
          nextPages = { ...nextPages, [t]: { ...page, truncated: true } };
        }
        continue;
      }
    }
    keep.push(m);
  }
  return { messages: keep.reverse(), pages: nextPages };
}

export function toggleFavorite(k: string) {
  const on = get().favorites.includes(k);
  set((s) => ({ favorites: on ? s.favorites.filter((x) => x !== k) : [...s.favorites, k] }));
  toast(on ? "Đã bỏ ghim khỏi đầu danh sách" : "Đã ghim lên đầu danh sách", "pin");
}

/** Warm the newest unread chats of an account so opening them shows the live page at once.
 *  One at a time, so it never competes with the chat the user actually opens. */
const prefetched = new Set<string>();
async function prefetchUnread(accountId: string) {
  const keys = Object.entries(get().chats)
    .filter(([k, c]) => c.accountId === accountId && c.unread > 0 && c.kind !== "web" && !prefetched.has(k))
    .sort(([, a], [, b]) => b.order - a.order)
    .slice(0, 10)
    .map(([k]) => k);
  for (const k of keys) {
    prefetched.add(k);
    if (get().msgs[k]) continue;
    const page = await api.messages(...splitKey(k), 0, PAGE).catch(() => null);
    if (page?.length && !get().msgs[k]) set((s) => ({ msgs: { ...s.msgs, [k]: page } }));
  }
}

/** First open since launch: paint the SQLite copy at once, the live page merges in after. */
async function showCached(k: string) {
  const started = Date.now();
  const primary = !!get().chats[k]?.threaded;
  const [page, roots] = await api.cachedMessages(...splitKey(k), PAGE, primary).catch(() => [[], []] as Msg[][]);
  if ((!page.length && !roots.length) || get().msgs[k]) return;
  if (roots.length) primed.add(k);
  let list = page;
  for (const m of roots) list = upsert(list, m);
  const preview = threadPreviews(k, list);
  list = preview.messages;
  set((s) => ({ msgs: { ...s.msgs, [k]: list }, threadPages: preview.pages }));
  void api.logJs(JSON.stringify({ event: "history", phase: "cached", chat: k, messages: list.length, primary: list.filter(m => !m.threadReply).length, elapsedMs: Date.now() - started }));
}

/** Where the next older page starts: the oldest message of the pages walked so far — not
 *  list[0], which can be a thread starter fillRoots pulled from weeks back (paging from
 *  there would skip everything in between). */
const cursor = new Map<string, number>();
// Primary history never advances from a thread reply or thread page token.
const primaryCursor = new Map<string, number>();

/** Leaving a chat drops the older pages it scrolled through: every loaded message is a
 *  mounted row (no virtualization), and nothing else ever shrank the list. */
function trimLoaded(k: string) {
  const list = get().msgs[k];
  const keep = pageSize(k) * 2;
  if (!list || list.length <= keep) return;
  const tail = list.slice(-keep);
  let next = tail;
  if (get().chats[k]?.threaded) {
    for (const root of list.filter(m => !m.threadReply).slice(-PAGE * 2)) next = upsert(next, root);
    const first = next.find(m => !m.threadReply);
    if (first) primaryCursor.set(k, first.sort);
  }
  cursor.set(k, next[0].sort);
  // A token beyond discarded replies would leave an unfillable gap on the next visit.
  set(s => {
    const threadPages = { ...s.threadPages };
    const older = { ...s.older, [k]: "idle" as const };
    for (const t of Object.keys(threadPages)) {
      if (s.threadTabs[t]?.chatKey === k) { delete threadPages[t]; older[t] = "idle"; }
    }
    const preview = threadPreviews(k, next, threadPages);
    return { msgs: { ...s.msgs, [k]: preview.messages }, threadPages: preview.pages, older };
  });
  for (const tried of rootTried) if (tried.startsWith(`${k}#`)) rootTried.delete(tried);
}
/** Threaded spaces: a page is mostly replies folded into a few rows, so take bigger pages. */
const pageSize = (k: string) => (get().chats[k]?.threaded ? 100 : PAGE);

const latestPending = new Map<string, Promise<void>>();
export function loadLatest(k: string): Promise<void> {
  const pending = latestPending.get(k);
  if (pending) return pending;
  const request = refreshLatest(k).finally(() => { latestPending.delete(k); });
  latestPending.set(k, request);
  return request;
}

async function refreshLatest(k: string) {
  const started = Date.now();
  const [accountId, chatId] = splitKey(k);
  const unread = get().chats[k]?.unread ?? 0;
  const size = pageSize(k);
  try {
    const fetched = await api.messages(accountId, chatId, 0, size);
    // Publish the primary page first. Missing thread starters are small background reads.
    const page = fetched;
    set((s) => {
      // merge: keep older pages already loaded and anything that arrived meanwhile —
      // unless a full page doesn't reach them (more than a page arrived while closed):
      // that gap would never fill, so start over from the live page
      let list = s.msgs[k] ?? [];
      const gap = !s.chats[k]?.threaded && fetched.length >= size && list.length > 0 && list[list.length - 1].sort < fetched[0].sort;
      if (gap) list = [];
      if (fetched.length && (gap || !cursor.has(k))) cursor.set(k, fetched[0].sort);
      for (const m of page) list = upsert(list, m);
      const incoming = fetched.filter((m) => !m.outgoing && m.kind !== "service");
      const mark =
        unread > 0 && !s.unreadMark[k] && incoming.length
          ? { ...s.unreadMark, [k]: { sort: incoming[Math.max(0, incoming.length - unread)].sort, count: unread } }
          : s.unreadMark;
      const preview = threadPreviews(k, list);
      return {
        msgs: { ...s.msgs, [k]: preview.messages },
        threadPages: preview.pages,
        older: { ...s.older, [k]: fetched.length ? s.older[k] ?? "idle" : "done" },
        loadErr: { ...s.loadErr, [k]: "" },
        unreadMark: mark,
      };
    });
    void api.logJs(JSON.stringify({ event: "history", phase: "live", chat: k, fetched: fetched.length, elapsedMs: Date.now() - started }));
    void fillRoots(k);
  } catch (e) {
    set((s) => ({ loadErr: { ...s.loadErr, [k]: String(e) }, msgs: { ...s.msgs, [k]: s.msgs[k] ?? [] } }));
  }
}

/** Recover only missing starters after the main page is visible; never fetch thread bodies. */
const rootTried = new Set<string>();
/** At most eight starter reads, with only two requests in flight. */
async function fetchRoots(k: string, list: Msg[]): Promise<Msg[]> {
  if (!get().chats[k]?.threaded) return [];
  const roots = new Set(list.filter((m) => !m.threadReply).map((m) => m.threadId));
  const missing = [...new Set(list.filter((m) => m.threadReply && m.threadId && !roots.has(m.threadId)).map((m) => m.threadId))]
    .filter((t) => !rootTried.has(`${k}#${t}`))
    .slice(-8);
  if (!missing.length) return [];
  const [accountId, chatId] = splitKey(k);
  const found: Msg[] = [];
  for (let i = 0; i < missing.length; i += 2) {
    const batch = missing.slice(i, i + 2);
    batch.forEach(t => rootTried.add(`${k}#${t}`));
    const pages = await Promise.all(batch.map(t => api.threadRoot(accountId, chatId, t).catch(() => {
      rootTried.delete(`${k}#${t}`);
      return [] as Msg[];
    })));
    found.push(...pages.flat());
    if (chatKeyOf(get().active) !== k) break;
  }
  return found;
}

async function fillRoots(k: string) {
  const found = await fetchRoots(k, get().msgs[k] ?? []);
  if (!found.length) return;
  set((st) => {
    let next = st.msgs[k] ?? [];
    for (const m of found) next = upsert(next, m);
    return { msgs: { ...st.msgs, [k]: next } };
  });
}

/** Threaded spaces: the newest 100 rows can all be replies of one or two busy threads, and
 *  a list filled by prefetch or a thread tab never got the starters. They are a page of
 *  their own (cache first), once per chat. */
const primed = new Set<string>();
async function primeRoots(k: string) {
  if (primed.has(k)) return;
  primed.add(k);
  const page = await api.primaryMessages(...splitKey(k), 0, PAGE).catch(() => null);
  if (!page) return void primed.delete(k);
  if (!page.messages.length || !get().msgs[k]) return;
  primaryCursor.set(k, Math.min(primaryCursor.get(k) ?? Infinity, page.before));
  set((s) => {
    let next = s.msgs[k] ?? [];
    for (const m of page.messages) next = upsert(next, m);
    return { msgs: { ...s.msgs, [k]: next } };
  });
}

// ── thread list: its own flow, never derived from the timeline's page ─────────
const THREAD_PAGE = 30;
const byLatest = (a: ThreadSummary, b: ThreadSummary) => b.lastSort - a.lastSort;

/** `remote`: when the cache runs out, let Rust walk three older history pages first. */
export async function loadThreadList(k: string, more = false, remote = true) {
  const current = get().threadList[k];
  if (current?.state === "loading" || (more && current?.state === "done")) return;
  const before = more ? current?.items[current.items.length - 1]?.lastSort ?? 0 : 0;
  set((s) => ({ threadList: { ...s.threadList, [k]: { items: current?.items ?? [], state: "loading" } } }));
  try {
    const page = await api.threadList(...splitKey(k), before, THREAD_PAGE, remote);
    set((s) => {
      // live replies may have moved threads up meanwhile: theirs win over the cached rows
      const held = more ? s.threadList[k]?.items ?? [] : (s.threadList[k]?.items ?? []).filter((t) => t.lastSort > (page.threads[0]?.lastSort ?? Infinity));
      const seen = new Set(held.map((t) => t.threadId));
      const items = [...held, ...page.threads.filter((t) => !seen.has(t.threadId))].sort(byLatest);
      return { threadList: { ...s.threadList, [k]: { items, state: page.hasMore ? "idle" : "done" } } };
    });
    void fillThreadRoots(k);
  } catch {
    set((s) => ({ threadList: { ...s.threadList, [k]: { items: s.threadList[k]?.items ?? [], state: "idle" } } }));
  }
}

/** Starters the cache doesn't have: at most eight per page, two in flight. */
async function fillThreadRoots(k: string) {
  const have = new Set((get().msgs[k] ?? []).filter((m) => !m.threadReply).map((m) => m.threadId));
  const missing = (get().threadList[k]?.items ?? [])
    .filter((t) => !t.root && !have.has(t.threadId) && !rootTried.has(`${k}#${t.threadId}`))
    .slice(0, 8)
    .map((t) => t.threadId);
  const [accountId, chatId] = splitKey(k);
  for (let i = 0; i < missing.length; i += 2) {
    const batch = missing.slice(i, i + 2);
    batch.forEach((t) => rootTried.add(`${k}#${t}`));
    const roots = (await Promise.all(batch.map((t) => api.threadRoot(accountId, chatId, t).catch(() => [] as Msg[])))).flat();
    if (!roots.length) continue;
    set((s) => {
      const list = s.threadList[k];
      if (!list) return {};
      const items = list.items.map((t) => (t.root ? t : { ...t, root: roots.find((r) => r.threadId === t.threadId && !r.threadReply) ?? null }));
      return { threadList: { ...s.threadList, [k]: { ...list, items } } };
    });
  }
}

/** A new reply moves its thread to the top of a loaded list and counts once. */
function bumpThread(k: string, m: Msg) {
  set((s) => {
    const list = s.threadList[k];
    const old = list?.items.find((t) => t.threadId === m.threadId);
    if (old?.recent.some((r) => r.id === m.id)) return {};
    const id = `${k}#${m.threadId}`, total = s.threadCounts[id];
    const threadCounts = total ? { ...s.threadCounts, [id]: { ...total, count: total.count + 1 } } : s.threadCounts;
    if (!list) return { threadCounts };
    const root = old?.root ?? s.msgs[k]?.find((x) => x.threadId === m.threadId && !x.threadReply) ?? null;
    const item: ThreadSummary = {
      threadId: m.threadId, root, replies: (old?.replies ?? 0) + 1,
      lastSort: Math.max(old?.lastSort ?? 0, m.sort), lastTs: Math.max(old?.lastTs ?? 0, m.ts),
      recent: [...(old?.recent ?? []), m].slice(-3),
    };
    const items = [item, ...list.items.filter((t) => t.threadId !== m.threadId)];
    return { threadCounts, threadList: { ...s.threadList, [k]: { ...list, items } } };
  });
}

// ── reply totals: a flow of their own, for threads on screen only ─────────────
const countQueue: { k: string; threadId: string }[] = [];
const countAsked = new Set<string>();
let counting = 0;
/** Newest ask first (what is on screen now), two requests in flight, once per session. */
export function wantThreadCount(k: string, threadId: string) {
  const id = `${k}#${threadId}`;
  if (countAsked.has(id) || get().chats[k]?.kind === "web") return;
  countAsked.add(id);
  countQueue.push({ k, threadId });
  pumpCounts();
}
function pumpCounts() {
  while (counting < 2 && countQueue.length) {
    const { k, threadId } = countQueue.pop()!;
    const id = `${k}#${threadId}`;
    counting++;
    void api.threadCount(...splitKey(k), threadId)
      .then((total) => set((s) => ({ threadCounts: { ...s.threadCounts, [id]: total } })))
      .catch(() => countAsked.delete(id))
      .finally(() => { counting--; pumpCounts(); });
  }
}

export async function loadOlder(k: string) {
  const s = get();
  const list = s.msgs[k];
  if (!list?.length || s.older[k] === "loading" || s.older[k] === "done") return;
  set({ older: { ...s.older, [k]: "loading" } });
  const [accountId, chatId] = splitKey(k);
  try {
    const primary = !!s.chats[k]?.threaded;
    const response = primary
      ? await api.primaryMessages(accountId, chatId, primaryCursor.get(k) ?? list.find(m => !m.threadReply)?.sort ?? cursor.get(k) ?? list[0].sort, PAGE)
      : null;
    const page = response?.messages ?? await api.messages(accountId, chatId, cursor.get(k) ?? list[0].sort, pageSize(k));
    if (response) primaryCursor.set(k, response.before);
    if (page.length) cursor.set(k, page[0].sort);
    let grew = false;
    set((st) => {
      let next = st.msgs[k] ?? [];
      for (const m of page) next = upsert(next, m);
      grew = next.length > (st.msgs[k]?.length ?? 0);
      const preview = threadPreviews(k, next);
      return { msgs: { ...st.msgs, [k]: preview.messages }, threadPages: preview.pages, older: { ...st.older, [k]: (response ? response.hasMore : page.length > 0) ? "idle" : "done" } };
    });
    // a page the cache already showed changes nothing on screen, and the list doesn't
    // scroll again to ask for the next one: keep walking back until something new comes
    if (!response && page.length && !grew) return loadOlder(k);
    void fillRoots(k);
  } catch {
    set((st) => ({ older: { ...st.older, [k]: "idle" } }));
  }
}

let readT: Record<string, ReturnType<typeof setTimeout>> = {};
export function markRead(k: string) {
  // Web providers have no mark-read REST endpoint. Opening the actual thread lets the
  // website acknowledge it; never zero its badge locally then call Google Chat.
  if (get().chats[k]?.kind === "web") { void openChat(k); return; }
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
    const threadPages = { ...s.threadPages };
    delete threadPages[k];
    const older = { ...s.older };
    if (isThreadTab(k)) delete older[k];
    return { tabs, active, unreadMark, threadTabs, threadPages, older };
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
/** Show a message the backend just returned (e.g. a sent sticker) without waiting for its event. */
export function addMsg(m: Msg) {
  const k = key(m.accountId, m.chatId);
  set((s) => ({ msgs: { ...s.msgs, [k]: upsert(s.msgs[k] ?? [], m) }, fresh: { ...s.fresh, [m.id]: true }, sent: s.sent + 1 }));
}

/** Message text for re-sending elsewhere: markup flattened, line breaks kept. */
const sendable = (t: string) => t.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, l, u) => (l === u ? u : `${l} (${u})`)).replace(/@\{([^}]+)\}/g, "@$1");

/** Forward `m` to chat `to`: native inside one Telegram account, otherwise a fresh
 *  message with a "forwarded from" line (media re-uploaded from the local copy). */
export async function forwardMsg(m: Msg, to: string, { comment = "", threadId }: { comment?: string; threadId?: string } = {}) {
  const s = get();
  const [accountId, chatId] = splitKey(to);
  const target = s.chats[to];
  try {
    // like Telegram: the comment goes first, as its own message
    if (comment.trim()) await send(to, comment.trim(), { threadId });
    const native = accountId === m.accountId && s.accounts.find((a) => a.id === accountId)?.platform === "telegram";
    if (native) {
      await api.forward(accountId, chatId, m.chatId, m.id, threadId);
    } else {
      const src = s.chats[key(m.accountId, m.chatId)];
      const from = `↪ Chuyển tiếp từ ${m.outgoing ? "tôi" : m.senderName}${src && src.kind !== "dm" ? ` · ${src.title}` : ""}`;
      let file: string | undefined;
      if (m.media && !m.media.url && m.media.fileRef) file = m.media.localPath || (await api.download(m.accountId, m.media.fileRef, m.media.name));
      const text = [from, sendable(m.text), m.media?.url ?? ""].filter((x) => x.trim()).join("\n");
      await send(to, text, { file, threadId });
    }
    toast(`Đã chuyển tiếp tới ${target?.title ?? "chat"}`);
  } catch (e) {
    fail(e);
  }
}

/** `wire`: the text the platform gets when it differs from the one shown (mentions) */
export async function send(k: string, text: string, { wire, ...opts }: { replyTo?: string; threadId?: string; file?: string; voice?: number; wire?: string; plain?: boolean; asFile?: boolean } = {}) {
  const [accountId, chatId] = splitKey(k);
  const temp: Msg = {
    accountId, chatId, id: `local-${++localId}`, sort: Number.MAX_SAFE_INTEGER - 1000 + localId, senderId: accountOf(accountId)?.selfId ?? "", senderName: "", senderPhoto: "",
    outgoing: true, ts: Date.now(), edited: false, deleted: false, kind: opts.file ? "media" : "text", text,
    media: opts.file ? { kind: opts.voice !== undefined ? "voice" : "file", name: opts.file.split("/").pop() ?? "file", size: 0, mime: "", width: 0, height: 0, fileRef: "", localPath: opts.file, thumb: "", url: "" } : null, // localPath: the upload progress key
    link: null, replyTo: opts.replyTo ?? "", replyName: "", replyText: "", reactions: [], threadId: opts.threadId ?? "",
    threadReply: !!opts.threadId, status: "sending", error: "", pinned: false, mentionsMe: false, rev: "",
  };
  const replied = opts.replyTo ? get().msgs[k]?.find((m) => m.id === opts.replyTo) : undefined;
  if (replied) {
    temp.replyName = replied.outgoing ? "Bạn" : replied.senderName;
    temp.replyText = plain(replied.text) || replied.media?.name || "";
  }
  if (!opts.file) {
    const pending = pendingTextSends.get(k) ?? new Map();
    pending.set(temp.id, { text: plain(text), wire: plain(wire ?? text), thread: opts.threadId ?? "", reply: opts.replyTo ?? "" });
    pendingTextSends.set(k, pending);
  }
  set((s) => ({ msgs: { ...s.msgs, [k]: [...(s.msgs[k] ?? []), temp] }, fresh: { ...s.fresh, [temp.id]: true }, sent: s.sent + 1 }));
  try {
    const response = await api.send({ accountId, chatId, text: wire ?? text, ...opts });
    const changes = (heldOutgoing.get(k) ?? []).filter((event): event is Extract<CoreEvent, { type: "messageIdChanged" }> => event.type === "messageIdChanged");
    const real = correlateAcknowledgement(response, changes);
    set((s) => {
      return { msgs: { ...s.msgs, [k]: reconcileMessage(s.msgs[k] ?? [], real, temp.id) }, fresh: { ...s.fresh, [real.id]: true } };
    });
  } catch (e) {
    set((s) => ({ msgs: { ...s.msgs, [k]: (s.msgs[k] ?? []).map((m) => (m.id === temp.id ? { ...m, status: "failed", error: String(e) } : m)) } }));
  } finally {
    const pending = pendingTextSends.get(k);
    pending?.delete(temp.id);
    if (!pending?.size) pendingTextSends.delete(k);
    const queued = heldOutgoing.get(k);
    heldOutgoing.delete(k);
    for (const event of queued ?? []) applyEvent(event);
  }
}

export function retry(k: string, m: Msg) {
  set((s) => ({ msgs: { ...s.msgs, [k]: (s.msgs[k] ?? []).filter((x) => x.id !== m.id) } }));
  if (!m.id.startsWith("local-")) void api.deleteMsg(m.accountId, m.chatId, m.id).catch(() => {});
  void send(k, m.text, { replyTo: m.replyTo || undefined, threadId: m.threadId || undefined });
}

/** Reaction picker limited to what the platform accepts (Telegram chats restrict reactions). */
export async function pickReaction(k: string, m: Msg, at: { x: number; y: number; top: number }) {
  const only = await allowedReactions(m);
  if (only && !only.length) return toast("Chat này không cho thả biểu cảm", "info");
  set({ pop: { kind: "emoji", ...at, only: only ?? undefined, onPick: (emoji) => void toggleReaction(k, m, emoji) } });
}

// Telegram chats can limit reactions to a list (or turn them off): a chip someone added
// before the limit, or the phone's quick row, can hold an emoji this chat no longer accepts
const allowed = new Map<string, Promise<string[] | null>>();
export function allowedReactions(m: Msg): Promise<string[] | null> {
  const key = `${m.accountId}|${m.chatId}|${m.id}`;
  let p = allowed.get(key);
  if (!p) {
    p = api.reactions(m.accountId, m.chatId, m.id).catch(() => null);
    allowed.set(key, p);
  }
  return p;
}

export async function toggleReaction(k: string, m: Msg, emoji: string) {
  const r = m.reactions.find((x) => bare(x.emoji) === bare(emoji));
  emoji = r?.emoji ?? emoji;
  const add = !r?.mine;
  if (add) {
    const only = await allowedReactions(m);
    const providerEmoji = only?.find(e => bare(e) === bare(emoji));
    if (only && !providerEmoji) {
      toast(only.length ? `Chat này không cho thả ${emoji} — bấm 🙂 để chọn biểu cảm khác` : "Chat này không cho thả biểu cảm", "info");
      return;
    }
    emoji = providerEmoji ?? emoji;
  }
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

/** Dedicated message search, independent of the command palette. */
/** "" = the default dark theme (Bearded Arc). */
export function setTheme(theme: string) {
  set((s) => ({ prefs: { ...s.prefs, theme } }));
}

/** Titlebar sun/moon: flip between the default dark and Min Light. */
export function toggleTheme() {
  setTheme(themeBase(useApp.getState().prefs.theme) === "dark" ? "light" : "");
}

export function openSearch(scope = "") {
  set({ route: "search", palette: null, pop: null, searchScope: scope, searchAccount: scope ? splitKey(scope)[0] : "" });
}

/** Mute/unmute a thread or topic: nothing from it rings or reaches the bell. */
export async function muteThread(chatKey: string, threadId: string, muted: boolean) {
  const k = `${chatKey}|${threadId}`;
  set((s) => {
    const mutedThreads = { ...s.mutedThreads };
    if (muted) mutedThreads[k] = true;
    else delete mutedThreads[k];
    return { mutedThreads, inbox: muted ? s.inbox.filter((m) => !(m.threadId === threadId && key(m.accountId, m.chatId) === chatKey)) : s.inbox };
  });
  const [accountId, chatId] = splitKey(chatKey);
  try {
    await api.threadMute(accountId, chatId, threadId, muted);
    toast(muted ? "Đã tắt thông báo luồng này" : "Đã bật lại thông báo luồng này");
  } catch (e) {
    fail(e);
  }
}
