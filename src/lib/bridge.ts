// The only place that talks to Rust. Outside Tauri (plain `vite` in a browser) every call
// goes to the in-memory demo backend, so the UI can be checked without real accounts.
import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { Account, AiView, AppState, CoreEvent, Member, Msg } from "./types";

export const isTauri = "__TAURI_INTERNALS__" in window;

type Demo = typeof import("./demo");
let demo: Promise<Demo> | null = null;
const demoMod = () => (demo ??= import("./demo"));

function call<T>(cmd: string, args: Record<string, unknown> = {}): Promise<T> {
  if (isTauri) return invoke<T>(cmd, args);
  return demoMod().then((d) => d.call(cmd, args) as T);
}

export function onEvent(cb: (e: CoreEvent) => void): () => void {
  let off = () => {};
  if (isTauri) listen<CoreEvent>("chatmin", (e) => cb(e.payload)).then((u) => (off = u));
  else demoMod().then((d) => (off = d.onEvent(cb)));
  return () => off();
}

export const api = {
  appState: () => call<AppState>("app_state"),
  configSet: (a: { tgApiId?: string; tgApiHash?: string; gchatJson?: string }) => call<void>("config_set", a),
  tgLoginStart: (accountId?: string) => call<string>("tg_login_start", { accountId }),
  tgPhone: (accountId: string, phone: string) => call<void>("tg_phone", { accountId, phone }),
  tgCode: (accountId: string, code: string) => call<void>("tg_code", { accountId, code }),
  tgPassword: (accountId: string, password: string) => call<void>("tg_password", { accountId, password }),
  tgQr: (accountId: string) => call<void>("tg_qr", { accountId }),
  tgResend: (accountId: string) => call<void>("tg_resend", { accountId }),
  gchatLogin: () => call<Account>("gchat_login"),
  loginCancel: (accountId?: string) => call<void>("login_cancel", { accountId }),
  accountUpdate: (id: string, patch: { name?: string; color?: string }) => call<void>("account_update", { id, ...patch }),
  accountRemove: (id: string) => call<void>("account_remove", { id }),
  messages: (accountId: string, chatId: string, before: number, limit: number) =>
    call<Msg[]>("messages", { accountId, chatId, before, limit }),
  thread: (accountId: string, chatId: string, threadId: string) => call<Msg[]>("thread", { accountId, chatId, threadId }),
  pinned: (accountId: string, chatId: string) => call<Msg[]>("pinned", { accountId, chatId }),
  members: (accountId: string, chatId: string) => call<Member[]>("members", { accountId, chatId }),
  send: (a: { accountId: string; chatId: string; text: string; replyTo?: string; threadId?: string; file?: string }) => call<Msg>("send", a),
  edit: (accountId: string, chatId: string, msgId: string, text: string) => call<void>("edit", { accountId, chatId, msgId, text }),
  deleteMsg: (accountId: string, chatId: string, msgId: string) => call<void>("delete_msg", { accountId, chatId, msgId }),
  react: (accountId: string, chatId: string, msgId: string, emoji: string, add: boolean) =>
    call<void>("react", { accountId, chatId, msgId, emoji, add }),
  pin: (accountId: string, chatId: string, msgId: string, on: boolean) => call<void>("pin", { accountId, chatId, msgId, on }),
  markRead: (accountId: string, chatId: string, msgIds: string[]) => call<void>("mark_read", { accountId, chatId, msgIds }),
  setOpen: (accountId: string, chatId: string, open: boolean) => call<void>("set_open", { accountId, chatId, open }),
  setMuted: (accountId: string, chatId: string, muted: boolean) => call<void>("set_muted", { accountId, chatId, muted }),
  download: (accountId: string, fileRef: string, name: string) => call<string>("download", { accountId, fileRef, name }),
  search: (query: string, limit = 40, accountId?: string, chatId?: string) => call<Msg[]>("search", { query, limit, accountId, chatId }),
  aiConfig: () => call<AiView>("ai_config"),
  aiConfigSet: (a: Omit<AiView, "hasKey"> & { key?: string }) => call<void>("ai_config_set", a),
  /** translate/translate_to/translate_many → string[]; suggest → Suggestion[] */
  aiRun: <T = string>(task: string, texts: string[], me: string, to: string) => call<T[]>("ai_run", { task, texts, me, to }),
  setBadge: (count: number) => (isTauri ? call<void>("set_badge", { count }) : Promise.resolve()),
};

export const fileSrc = (path: string) => (isTauri && path && !path.startsWith("data:") ? convertFileSrc(path) : path);

export async function openUrl(url: string) {
  if (!isTauri) return void window.open(url, "_blank", "noopener");
  const { openUrl } = await import("@tauri-apps/plugin-opener");
  await openUrl(url);
}

export async function openPath(path: string) {
  if (!isTauri) return;
  const { openPath } = await import("@tauri-apps/plugin-opener");
  await openPath(path);
}

export async function revealPath(path: string) {
  if (!isTauri) return;
  const { revealItemInDir } = await import("@tauri-apps/plugin-opener");
  await revealItemInDir(path);
}

export async function pickFile(filters?: { name: string; extensions: string[] }[]): Promise<string | null> {
  if (!isTauri) return null;
  const { open } = await import("@tauri-apps/plugin-dialog");
  const picked = await open({ multiple: false, directory: false, filters });
  return typeof picked === "string" ? picked : null;
}

export async function notify(title: string, body: string) {
  if (!isTauri) return;
  const n = await import("@tauri-apps/plugin-notification");
  let ok = await n.isPermissionGranted();
  if (!ok) ok = (await n.requestPermission()) === "granted";
  if (ok) n.sendNotification({ title, body });
}
