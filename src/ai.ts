// AI actions on top of the store: inline message translation, whole-chat translation,
// draft translation and reply suggestions. Prompts live in Rust (ai.rs).
import { api } from "./lib/bridge";
import { plain } from "./lib/format";
import type { Msg, Suggestion } from "./lib/types";
import { fail, useApp } from "./store";

/** [name sent to the model, label, short tag] */
export const LANGS = [
  ["Vietnamese", "Tiếng Việt", "VI"],
  ["English", "English", "EN"],
  ["Japanese", "日本語", "JA"],
  ["Chinese", "中文", "ZH"],
  ["Korean", "한국어", "KO"],
  ["Thai", "ไทย", "TH"],
  ["French", "Français", "FR"],
  ["German", "Deutsch", "DE"],
] as const;
export const langTag = (name: string) => LANGS.find((l) => l[0] === name)?.[2] ?? name.slice(0, 2).toUpperCase();
export const langLabel = (name: string) => LANGS.find((l) => l[0] === name)?.[1] ?? name;

export const trKey = (chatKey: string, id: string) => `${chatKey}#${id}`;
/** language to write in for this chat */
export const targetOf = (chatKey: string) => {
  const s = useApp.getState();
  return s.aiLang[chatKey] || s.prefs.aiTo;
};
const langs = (chatKey: string) => [useApp.getState().prefs.aiMe, targetOf(chatKey)] as const;
const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

const setTr = (patch: Record<string, { state: "loading" | "ok" | "err"; text: string }>) =>
  useApp.setState((s) => ({ tr: { ...s.tr, ...patch } }));

/** Toggle one message's translation under its bubble. */
export async function translateMsg(chatKey: string, m: Msg) {
  const id = trKey(chatKey, m.id);
  if (useApp.getState().tr[id]) {
    useApp.setState((s) => {
      const { [id]: _, ...tr } = s.tr;
      return { tr };
    });
    return;
  }
  // raw text, not plain(): line breaks and markup (`code`, @{mention}, [label](url)) must survive
  const text = m.text;
  if (!plain(text)) return;
  setTr({ [id]: { state: "loading", text: "" } });
  const [me, to] = langs(chatKey);
  try {
    const [out] = await api.aiRun("translate", [text], me, to);
    setTr({ [id]: { state: "ok", text: out } });
  } catch (e) {
    setTr({ [id]: { state: "err", text: String(e) } });
  }
}

/** Whole-chat mode: on → every loaded message gets translated, new ones as they arrive. */
export function toggleAutoTranslate(chatKey: string) {
  const on = !useApp.getState().trAuto[chatKey];
  useApp.setState((s) => {
    const tr = on ? s.tr : Object.fromEntries(Object.entries(s.tr).filter(([k]) => !k.startsWith(`${chatKey}#`)));
    return { trAuto: { ...s.trAuto, [chatKey]: on }, tr };
  });
}

const BATCH = 40;
/** Translate the newest untranslated messages in `list` (one request per call). */
export async function translateMissing(chatKey: string, list: Msg[]) {
  const s = useApp.getState();
  const todo = list
    .filter((m) => !m.outgoing && !m.deleted && m.kind !== "service" && plain(m.text).trim() && !s.tr[trKey(chatKey, m.id)])
    .slice(-BATCH);
  if (!todo.length) return;
  setTr(Object.fromEntries(todo.map((m) => [trKey(chatKey, m.id), { state: "loading" as const, text: "" }])));
  const [me, to] = langs(chatKey);
  try {
    const out = await api.aiRun("translate_many", todo.map((m) => m.text), me, to);
    // already in the reader's language → "ok" with empty text: nothing to show, nothing to redo
    setTr(Object.fromEntries(todo.map((m, i) => [trKey(chatKey, m.id), { state: "ok" as const, text: same(out[i], m.text) ? "" : out[i] }])));
  } catch (e) {
    // drop the placeholders so a later pass can retry; stop auto mode on config errors
    useApp.setState((st) => ({
      tr: Object.fromEntries(Object.entries(st.tr).filter(([k]) => !todo.some((m) => trKey(chatKey, m.id) === k))),
      trAuto: { ...st.trAuto, [chatKey]: false },
    }));
    fail(e);
  }
}

/** Draft → the chat's writing language. Returns null when there is nothing to do. */
export async function translateDraft(chatKey: string, draft: string, to = targetOf(chatKey)): Promise<string | null> {
  if (!draft.trim()) return null;
  const [out] = await api.aiRun("translate_to", [draft], useApp.getState().prefs.aiMe, to);
  return out || null;
}

/** Three replies for the last stretch of the conversation (thread-only when given). */
export async function suggestReplies(chatKey: string, threadId?: string): Promise<Suggestion[]> {
  const s = useApp.getState();
  const lines = (s.msgs[chatKey] ?? [])
    .filter((m) => !m.deleted && m.kind !== "service" && (!threadId || m.threadId === threadId))
    .slice(-20)
    .map((m) => `${m.outgoing ? "Me" : m.senderName}: ${plain(m.text) || `[${m.media?.kind ?? "attachment"}]`}`);
  if (!lines.length) return [];
  const [me, to] = langs(chatKey);
  return api.aiRun<Suggestion>("suggest", lines, me, to);
}
