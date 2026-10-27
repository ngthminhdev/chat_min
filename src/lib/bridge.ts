// The only place that talks to Rust. Outside Tauri (plain `vite` in a browser) every call
// goes to the in-memory demo backend, so the UI can be checked without real accounts.
import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { Account, Chat, AiView, AppState, CoreEvent, Member, Msg, MsgPeople, StickerPack, ThreadSummary, Topic } from "./types";

// `?demo`: the in-memory backend even inside a Tauri webview — the Android webview pointed at
// the vite server (dev-only) still gets Tauri's IPC injected, which refuses a foreign origin
export const isTauri = "__TAURI_INTERNALS__" in window && !new URLSearchParams(location.search).has("demo");
export type Staged = { path: string; name: string; size: number };
export type StorageView = { downloadDir: string; cacheMb: number; keepDays: number; tgBytes: number; localBytes: number };

type Demo = typeof import("./demo");
let demo: Promise<Demo> | null = null;
const demoMod = () => (demo ??= import("./demo"));

function call<T>(cmd: string, args: Record<string, unknown> = {}): Promise<T> {
  if (isTauri) return invoke<T>(cmd, args);
  return demoMod().then((d) => d.call(cmd, args) as T);
}

export function onEvent(cb: (e: CoreEvent) => void): () => void {
  let off = () => {};
  let disposed = false;
  if (isTauri) listen<CoreEvent>("chatmin", (e) => { if (!disposed) cb(e.payload); }).then((u) => { if (disposed) u(); else off = u; });
  else demoMod().then((d) => { if (!disposed) off = d.onEvent(cb); });
  return () => { disposed = true; off(); };
}

export interface AppShortcut {
  key: string; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean; inField: boolean;
}

/** Provider webviews route app navigation back to the same handler as the React shell. */
export function onAppShortcut(cb: (shortcut: AppShortcut) => void): () => void {
  let off = () => {};
  let disposed = false;
  if (isTauri) listen<AppShortcut>("chatmin-shortcut", (e) => { if (!disposed) cb(e.payload); }).then((u) => { if (disposed) u(); else off = u; });
  return () => { disposed = true; off(); };
}

export const api = {
  appState: () => call<AppState>("app_state"),
  uiState: () => isTauri ? call<Record<string, unknown> | null>("ui_state") : Promise.resolve(null),
  uiStateSet: (value: object) => isTauri ? call<void>("ui_state_set", { value }) : Promise.resolve(),
  configSet: (a: { tgApiId?: string; tgApiHash?: string; gchatJson?: string }) => call<void>("config_set", a),
  tgLoginStart: (accountId?: string) => call<string>("tg_login_start", { accountId }),
  tgPhone: (accountId: string, phone: string) => call<void>("tg_phone", { accountId, phone }),
  tgCode: (accountId: string, code: string) => call<void>("tg_code", { accountId, code }),
  tgPassword: (accountId: string, password: string) => call<void>("tg_password", { accountId, password }),
  tgQr: (accountId: string) => call<void>("tg_qr", { accountId }),
  tgResend: (accountId: string) => call<void>("tg_resend", { accountId }),
  gchatLogin: () => call<Account>("gchat_login"),
  zaloLoginStart: (accountId?: string) => call<string>("zalo_login_start", { accountId }),
  zaloContacts: (accountId: string) => call<{ id: string; name: string; photo: string }[]>("zalo_contacts", { accountId }),
  zaloOpenChat: (accountId: string, chatId: string) => call<Chat>("zalo_open_chat", { accountId, chatId }),
  loginCancel: (accountId?: string) => call<void>("login_cancel", { accountId }),
  accountUpdate: (id: string, patch: { name?: string; color?: string }) => call<void>("account_update", { id, ...patch }),
  accountRemove: (id: string) => call<void>("account_remove", { id }),
  messages: (accountId: string, chatId: string, before: number, limit: number) =>
    call<Msg[]>("messages", { accountId, chatId, before, limit }),
  primaryMessages: (accountId: string, chatId: string, before: number, limit: number) =>
    call<{ messages: Msg[]; before: number; hasMore: boolean }>("primary_messages", { accountId, chatId, before, limit }),
  presence: () => (isTauri ? call<string[]>("presence") : Promise.resolve([] as string[])),
  inbox: (limit: number) => call<Msg[]>("inbox", { limit }),
  cachedMessages: (accountId: string, chatId: string, limit: number, primary = false) => call<[Msg[], Msg[]]>("cached_messages", { accountId, chatId, limit, primary }),
  thread: (accountId: string, chatId: string, threadId: string, pageToken = "", limit = 20) =>
    call<{ messages: Msg[]; nextPageToken: string }>("thread", { accountId, chatId, threadId, pageToken, limit }),
  threadRoot: (accountId: string, chatId: string, threadId: string) => call<Msg[]>("thread_root", { accountId, chatId, threadId }),
  threadList: (accountId: string, chatId: string, before: number, limit: number, remote: boolean) =>
    call<{ threads: ThreadSummary[]; hasMore: boolean }>("thread_list", { accountId, chatId, before, limit, remote }),
  threadCount: (accountId: string, chatId: string, threadId: string) => call<{ count: number; exact: boolean }>("thread_count", { accountId, chatId, threadId }),
  pinned: (accountId: string, chatId: string) => call<Msg[]>("pinned", { accountId, chatId }),
  members: (accountId: string, chatId: string) => call<Member[]>("members", { accountId, chatId }),
  /** `plain`: send the text as typed, no markdown (composer toggle) */
  send: (a: { accountId: string; chatId: string; text: string; replyTo?: string; threadId?: string; file?: string; voice?: number; plain?: boolean; asFile?: boolean }) => call<Msg>("send", a),
  webAdd: (platform: string) => call<Account>("web_add", { platform }),
  webShow: (accountId: string, chatId: string, r: { x: number; y: number; w: number; h: number }, navigate = false) => call<void>("web_show", { accountId, chatId, navigate, ...r }),
  webHide: (accountId: string) => call<void>("web_hide", { accountId }),
  webReload: (accountId: string) => call<void>("web_reload", { accountId }),
  webDevtools: (accountId: string) => call<void>("web_devtools", { accountId }),
  stickers: (accountId: string) => call<StickerPack[]>("stickers", { accountId }),
  sendSticker: (a: { accountId: string; chatId: string; threadId?: string; fileId: number; width: number; height: number; emoji: string }) => call<Msg>("send_sticker", a),
  /** base64 bytes → a cache file path that `send` can upload */
  saveTemp: (name: string, data: string) => call<string>("save_temp", { name, data }),
  /** paths of files copied in Finder (the web paste event only carries their names) */
  /** size + preview access for files about to be sent; folders are dropped */
  stageFiles: (paths: string[]) =>
    isTauri ? call<Staged[]>("stage_files", { paths }) : Promise.resolve(paths.map((path) => ({ path, name: path.split("/").pop() ?? path, size: 0 }))),
  clipboardFiles: () => (isTauri ? call<string[]>("clipboard_files") : Promise.resolve([] as string[])),
  edit: (accountId: string, chatId: string, msgId: string, text: string, plain?: boolean) => call<void>("edit", { accountId, chatId, msgId, text, plain }),
  deleteMsg: (accountId: string, chatId: string, msgId: string) => call<void>("delete_msg", { accountId, chatId, msgId }),
  react: (accountId: string, chatId: string, msgId: string, emoji: string, add: boolean) =>
    call<void>("react", { accountId, chatId, msgId, emoji, add }),
  /** Telegram: emoji this message accepts; null = any emoji */
  reactions: (accountId: string, chatId: string, msgId: string) => call<string[] | null>("reactions", { accountId, chatId, msgId }),
  /** who reacted / read one message (reaction tooltips, "seen by" list) */
  msgPeople: (accountId: string, chatId: string, msgId: string) => call<MsgPeople>("msg_people", { accountId, chatId, msgId }),
  pin: (accountId: string, chatId: string, msgId: string, on: boolean) => call<void>("pin", { accountId, chatId, msgId, on }),
  markRead: (accountId: string, chatId: string, msgIds: string[]) => call<void>("mark_read", { accountId, chatId, msgIds }),
  setOpen: (accountId: string, chatId: string, open: boolean) => call<void>("set_open", { accountId, chatId, open }),
  setMuted: (accountId: string, chatId: string, muted: boolean) => call<void>("set_muted", { accountId, chatId, muted }),
  threadMute: (accountId: string, chatId: string, threadId: string, muted: boolean) => call<void>("thread_mute", { accountId, chatId, threadId, muted }),
  topics: (accountId: string, chatId: string) => call<Topic[]>("topics", { accountId, chatId }),
  topicHistory: (accountId: string, chatId: string, topic: string, before: number, limit: number) =>
    call<Msg[]>("topic_history", { accountId, chatId, topic, before, limit }),
  forward: (accountId: string, chatId: string, fromChatId: string, msgId: string, topic?: string) => call<void>("forward", { accountId, chatId, fromChatId, msgId, topic }),
  deleteChat: (accountId: string, chatId: string, revoke: boolean) => call<void>("delete_chat", { accountId, chatId, revoke }),
  download: (accountId: string, fileRef: string, name: string, refresh = false) => call<string>("download", { accountId, fileRef, name, refresh }),
  search: (query: string, limit = 40, accountId?: string, chatId?: string) => call<Msg[]>("search", { query, limit, accountId, chatId }),
  aiConfig: () => call<AiView>("ai_config"),
  aiConfigSet: (a: Omit<AiView, "hasKey"> & { key?: string }) => call<void>("ai_config_set", a),
  /** translate/translate_to/translate_many → string[]; suggest → Suggestion[] */
  aiRun: <T = string>(task: string, texts: string[], me: string, to: string) => call<T[]>("ai_run", { task, texts, me, to }),
  emojiPalette: () => call<void>("emoji_palette"),
  /** browser for outside links: `current` "" = system default; `installed` = known browsers found on the machine */
  browser: () => call<{ current: string; installed: string[] }>("browser"),
  browserSet: (name: string) => call<void>("browser_set", { name }),
  storage: () => call<StorageView>("storage"),
  storageSet: (a: { downloadDir?: string; cacheMb?: number; keepDays?: number }) => call<void>("storage_set", a),
  /** bytes freed; `all` empties the media cache */
  storageClean: (all: boolean) => call<number>("storage_clean", { all }),
  logJs: (msg: string) => (isTauri ? call<void>("log_js", { msg }) : Promise.resolve()),
  /** per-account notification settings: Rust decides and sends notifications (notify.rs) */
  notifyPrefs: (prefs: Record<string, unknown>) => (isTauri ? call<void>("notify_prefs", { prefs }) : Promise.resolve()),
  notifyTest: () => (isTauri ? call<void>("notify_test") : Promise.resolve()),
  notifyIsland: (enabled?: boolean) => (isTauri ? call<boolean>("notify_island", { enabled }) : Promise.resolve(enabled ?? true)),
  notifyAppearance: (appearance: import("./island-appearance").IslandAppearance) => (isTauri ? call<void>("notify_appearance", { appearance }) : Promise.resolve()),
  /** Android: "granted" | "denied" | "prompt"; `ask` shows the system dialog when undecided */
  notifyPermission: (ask: boolean) => (isTauri ? call<string>("notify_permission", { ask }) : Promise.resolve("granted")),
  /** phone: app on screen or not — Rust mutes the open chat only while it is actually visible */
  setForeground: (fg: boolean) => (isTauri ? call<void>("set_foreground", { fg }) : Promise.resolve()),
};

export const fileSrc = (path: string) => (isTauri && path && !path.startsWith("data:") ? convertFileSrc(path) : path);

/** Telegram video played while it downloads (Range requests served by the tgstream protocol in lib.rs). */
// Android (like Windows) serves custom schemes as http://<scheme>.localhost; macOS as <scheme>://localhost
const STREAM_BASE = /Android/i.test(navigator.userAgent) ? "http://tgstream.localhost" : "tgstream://localhost";
export const streamSrc = (accountId: string, fileRef: string, mime: string) => `${STREAM_BASE}/${accountId}/${fileRef}?${mime || "video/mp4"}`;

// through Rust so the browser picked in settings applies everywhere
export async function openUrl(url: string) {
  if (!isTauri) return void window.open(url, "_blank", "noopener");
  await call<void>("open_url", { url });
}

// through Rust: files I sent live at their original path, outside the opener plugin's scope
export async function openPath(path: string) {
  if (!isTauri) return;
  await call<void>("open_local", { path, reveal: false });
}

export async function revealPath(path: string) {
  if (!isTauri) return;
  await call<void>("open_local", { path, reveal: true });
}

export async function pickFile(filters?: { name: string; extensions: string[] }[]): Promise<string | null> {
  if (!isTauri) return null;
  const { open } = await import("@tauri-apps/plugin-dialog");
  const picked = await open({ multiple: false, directory: false, filters });
  return typeof picked === "string" ? picked : null;
}

export async function pickFolder(): Promise<string | null> {
  if (!isTauri) return null;
  const { open } = await import("@tauri-apps/plugin-dialog");
  const picked = await open({ directory: true, multiple: false, title: "Thư mục tải về" });
  return typeof picked === "string" ? picked : null;
}

function pickerCancelled(error: unknown): boolean {
  return error === "File picker cancelled" ||
    (typeof error === "object" && error !== null && "message" in error && error.message === "File picker cancelled");
}

export async function pickFiles(): Promise<string[]> {
  if (!isTauri) return [];
  const { open } = await import("@tauri-apps/plugin-dialog");
  try {
    return (await open({ multiple: true, directory: false })) ?? [];
  } catch (error) {
    if (pickerCancelled(error)) return [];
    throw error;
  }
}

/** System photo/video picker. Android returns granted content URIs; stageFiles imports them. */
export async function pickMedia(): Promise<string[]> {
  if (!isTauri) return [];
  const { open } = await import("@tauri-apps/plugin-dialog");
  try {
    return (await open({ multiple: true, directory: false, pickerMode: "media" })) ?? [];
  } catch (error) {
    if (pickerCancelled(error)) return [];
    throw error;
  }
}

/** Copy a downloaded file out of the app: `ask` shows a save dialog, otherwise the download folder (Settings, default ~/Downloads/ChatMin).
 *  Resolves to the saved path, or null when the dialog was cancelled. */
export async function saveFile(src: string, name: string, ask: boolean): Promise<string | null> {
  if (!isTauri) return null;
  let dest: string | undefined;
  if (ask) {
    const { save } = await import("@tauri-apps/plugin-dialog");
    const picked = await save({ defaultPath: name, title: "Lưu file" });
    if (!picked) return null;
    dest = picked;
  }
  return invoke<string>("save_file", { src, name, dest });
}

