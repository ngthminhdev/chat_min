import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { api, pickFile } from "../lib/bridge";
import { plain } from "../lib/format";
import { CAP_OFF_NOTE, PLATFORMS } from "../lib/platforms";
import { addMsg, anchor, capsOf, fail, send, splitKey, toast, useApp } from "../store";
import { Icon } from "../ui/Icon";
import { startEdit } from "./Message";
import { clock, StickerPanel, useRecorder } from "./ComposerExtras";
import { LANGS, langLabel, langTag, suggestReplies, translateDraft } from "../ai";
import type { Suggestion } from "../lib/types";

const BLOCKING = ["offline", "reconnecting", "expired", "rate"];

/** `k` keys the draft (a chat or thread tab); `chatKey` is where messages go. */
export function Composer({ k, chatKey = k, threadId, placeholder }: { k: string; chatKey?: string; threadId?: string; placeholder?: string }) {
  const [accountId] = splitKey(chatKey);
  const account = useApp((s) => s.accounts.find((a) => a.id === accountId));
  const draft = useApp((s) => s.drafts[k] ?? "");
  const replyId = useApp((s) => s.replyTo[k] ?? "");
  const editId = useApp((s) => s.editing[k] ?? "");
  const ref = useApp((s) => s.msgs[chatKey]?.find((m) => m.id === (editId || replyId)));
  const blocked = useApp((s) => BLOCKING.includes(s.health[accountId]?.health ?? "ok"));
  const canSend = useApp((s) => s.chats[chatKey]?.canSend ?? true);
  const caps = capsOf(chatKey);
  const ta = useRef<HTMLTextAreaElement>(null);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const lang = useApp((s) => s.aiLang[chatKey] || s.prefs.aiTo);
  const [sug, setSug] = useState<{ state: "loading" | "ok" | "err"; items: Suggestion[]; err?: string } | null>(null);
  /** the draft before AI translated it, for one-click undo */
  const [orig, setOrig] = useState<string | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [stickers, setStickers] = useState(false);
  const recorder = useRecorder();
  const sendVoice = async () => {
    const r = await recorder.stop(true);
    if (!r) return;
    void send(chatKey, "", { file: r.path, voice: r.duration, replyTo: replyId || undefined, threadId });
    useApp.setState((s) => ({ replyTo: { ...s.replyTo, [k]: "" } }));
  };
  const sendSticker = (st: import("../lib/types").StickerView) => {
    setStickers(false);
    const [a, c] = splitKey(chatKey);
    api.sendSticker({ accountId: a, chatId: c, threadId, fileId: st.id, width: st.width, height: st.height, emoji: st.emoji }).then(addMsg).catch(fail);
  };

  useLayoutEffect(() => {
    const el = ta.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 176)}px`;
  }, [draft]);

  useEffect(() => {
    if (!blocked) ta.current?.focus();
  }, [k, blocked]);

  const setDraft = (v: string) => useApp.setState((s) => ({ drafts: { ...s.drafts, [k]: v } }));
  const cancelRef = () =>
    useApp.setState((s) => ({
      replyTo: { ...s.replyTo, [k]: "" },
      editing: { ...s.editing, [k]: "" },
      drafts: s.editing[k] ? { ...s.drafts, [k]: "" } : s.drafts,
    }));

  const focus = () => requestAnimationFrame(() => ta.current?.focus());
  const suggest = async () => {
    if (sug?.state === "loading") return;
    setSug({ state: "loading", items: [] });
    try {
      const items = await suggestReplies(chatKey, threadId);
      if (!items.length) toast("Chưa có tin nào để gợi ý", "info");
      setSug(items.length ? { state: "ok", items } : null);
    } catch (e) {
      setSug({ state: "err", items: [], err: String(e) });
    }
  };
  const translate = async (to = lang) => {
    if (aiBusy || !draft.trim()) return;
    setAiBusy(true);
    try {
      const out = await translateDraft(chatKey, draft, to);
      if (out) {
        setOrig(orig ?? draft);
        setDraft(out);
      }
    } catch (e) {
      fail(e);
    } finally {
      setAiBusy(false);
      focus();
    }
  };
  const pickLang = (el: Element) =>
    useApp.setState({
      pop: {
        kind: "menu",
        ...anchor(el),
        items: LANGS.map(([name, label, tag]) => ({
          icon: name === lang ? "check" : "languages",
          label: `${label} · ${tag}`,
          run: () => {
            useApp.setState((s) => ({ aiLang: { ...s.aiLang, [chatKey]: name } }));
            if (draft.trim()) void translate(name);
          },
        })),
      },
    });

  const submit = async () => {
    const text = draft.trim();
    if (!text || blocked || !canSend || savingRef.current) return;
    if (editId) {
      const [a, c] = splitKey(chatKey);
      savingRef.current = true;
      setSaving(true);
      try {
        await api.edit(a, c, editId, text);
      } catch (e) {
        fail(e);
        return;
      } finally {
        savingRef.current = false;
        setSaving(false);
        requestAnimationFrame(() => ta.current?.focus());
      }
      useApp.setState((s) => ({
        msgs: { ...s.msgs, [chatKey]: (s.msgs[chatKey] ?? []).map((m) => (m.id === editId ? { ...m, text, edited: true } : m)) },
      }));
    } else {
      void send(chatKey, text, { replyTo: replyId || undefined, threadId });
    }
    setOrig(null);
    setSug(null);
    useApp.setState((s) => editId && (s.editing[k] !== editId || s.drafts[k] !== draft) ? {} : ({ drafts: { ...s.drafts, [k]: "" }, replyTo: { ...s.replyTo, [k]: "" }, editing: { ...s.editing, [k]: "" } }));
  };

  const attach = async () => {
    if (blocked || saving || editId) return;
    try {
      const path = await pickFile();
      if (!path) return;
      void send(chatKey, draft.trim(), { file: path, replyTo: replyId || undefined, threadId });
      useApp.setState((s) => ({ drafts: { ...s.drafts, [k]: "" }, replyTo: { ...s.replyTo, [k]: "" } }));
    } catch (e) { fail(e); }
  };

  if (!canSend) {
    return (
      <div className="composer">
        <div className="composer-inner">
          <div className="composer-readonly"><Icon name="lock" /> Bạn không có quyền gửi tin trong {PLATFORMS[account?.platform ?? "telegram"].name === "Telegram" ? "kênh" : "space"} này</div>
        </div>
      </div>
    );
  }

  return (
    <div className={`composer${blocked ? " composer-blocked" : ""}`}>
      <div className="composer-inner">
        <AnimatePresence initial={false}>
          {ref && (
            <motion.div
              className="reply-bar"
              initial={{ opacity: 0, height: 0, marginBottom: 0 }}
              animate={{ opacity: 1, height: "auto", marginBottom: 6 }}
              exit={{ opacity: 0, height: 0, marginBottom: 0 }}
            >
              <Icon name={editId ? "pencil" : "reply"} />
              <span className="what">
                <b>{editId ? "Đang sửa tin nhắn" : `Đang trả lời ${ref.outgoing ? "Bạn" : ref.senderName}`}</b>
                <span>{plain(ref.text) || ref.media?.name}</span>
              </span>
              <span className="esc">
                <kbd className="kbd">Esc</kbd>
                <button className="tool-btn icon-only" aria-label="Huỷ" disabled={saving} onClick={cancelRef}>
                  <Icon name="x" />
                </button>
              </span>
            </motion.div>
          )}
        </AnimatePresence>
        <AnimatePresence initial={false}>
          {sug && (
            <motion.div
              className="ai-suggest"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 6 }}
            >
              <Icon name="sparkles" />
              {sug.state === "loading" ? (
                <span className="ai-note">Đang nghĩ gợi ý…</span>
              ) : sug.state === "err" ? (
                <span className="ai-note err">{sug.err}</span>
              ) : (
                sug.items.map((it, i) => (
                  <motion.button
                    key={i}
                    className="ai-chip"
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0, transition: { delay: i * 0.05 } }}
                    onClick={() => {
                      setDraft(it.reply);
                      setSug(null);
                      focus();
                    }}
                  >
                    <span>{it.reply}</span>
                    {it.meaning && <small>{it.meaning}</small>}
                  </motion.button>
                ))
              )}
              <span className="ai-suggest-tools">
                {sug.state !== "loading" && (
                  <button className="tool-btn icon-only" aria-label="Gợi ý khác" data-tip="Gợi ý khác" onClick={() => void suggest()}>
                    <Icon name="refresh-cw" />
                  </button>
                )}
                <button className="tool-btn icon-only" aria-label="Đóng gợi ý" onClick={() => setSug(null)}>
                  <Icon name="x" />
                </button>
              </span>
            </motion.div>
          )}
        </AnimatePresence>
        <AnimatePresence>
          {stickers && caps.stickers && <StickerPanel accountId={accountId} onPick={sendSticker} onClose={() => setStickers(false)} />}
        </AnimatePresence>
        <div className="composer-box main-composer">
          {recorder.recording && (
            <div className="rec-bar" role="status">
              <span className="rec-dot" />
              Đang ghi âm <b>{clock(recorder.secs ?? 0)}</b>
              <small>Bấm Gửi để gửi · ✕ để huỷ</small>
            </div>
          )}
          <textarea
            style={recorder.recording ? { display: "none" } : undefined}
            id="composer-input"
            ref={ta}
            rows={1}
            placeholder={blocked ? "Chưa gửi được lúc này…" : placeholder ?? "Viết tin nhắn…"}
            aria-label="Soạn tin nhắn"
            value={draft}
            disabled={blocked || saving}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              const mod = e.metaKey || e.ctrlKey;
              if (mod && e.key.toLowerCase() === "j") {
                e.preventDefault();
                void suggest();
              } else if (mod && e.shiftKey && e.key.toLowerCase() === "l") {
                e.preventDefault();
                void translate();
              } else if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                submit();
              } else if (e.key === "ArrowUp" && !draft && caps.edit) {
                const last = [...(useApp.getState().msgs[chatKey] ?? [])]
                  .reverse()
                  .find((m) => m.outgoing && m.kind === "text" && m.text && !m.deleted && !m.id.startsWith("local-") && (!threadId || m.threadId === threadId));
                if (last) {
                  e.preventDefault();
                  startEdit(k, last);
                }
              }
            }}
          />
          <div className="composer-tools">
            <label className="composer-label" htmlFor="composer-input">
              <span className="conn-dot" style={{ "--conn": `var(--conn-${account?.color ?? "blue"})` } as React.CSSProperties} />
              <span className="composer-from">
                <span className="composer-from-prefix">Gửi từ </span>
                {account?.name}
              </span>
              <span className="composer-platform">{PLATFORMS[account?.platform ?? "telegram"].name}</span>
            </label>
            <span className="composer-sep" aria-hidden="true" />
            <button className="tool-btn icon-only" aria-label="Đính kèm file" data-tip={editId ? "Chỉ sửa nội dung tin nhắn" : "Đính kèm file"} disabled={blocked || saving || !!editId} onClick={attach}>
              <Icon name="paperclip" />
            </button>
            <button
              className="tool-btn icon-only"
              aria-label="Emoji"
              data-tip="Emoji"
              disabled={blocked || saving}
              onClick={(e) => {
                useApp.setState({
                  pop: {
                    kind: "emoji",
                    ...anchor(e.currentTarget),
                    onPick: (emoji) => {
                      const el = ta.current;
                      const p = el?.selectionStart ?? draft.length;
                      setDraft(draft.slice(0, p) + emoji + draft.slice(p));
                      setTimeout(() => {
                        el?.focus();
                        el?.setSelectionRange(p + emoji.length, p + emoji.length);
                      });
                    },
                  },
                });
              }}
            >
              <Icon name="smile" />
            </button>
            <span className="composer-sep" aria-hidden="true" />
            <button
              className={`tool-btn icon-only${sug ? " active" : ""}`}
              aria-label="Gợi ý trả lời"
              data-tip="Gợi ý trả lời"
              data-kbd="⌘J"
              disabled={blocked || saving}
              onClick={() => (sug ? setSug(null) : void suggest())}
            >
              <Icon name="sparkles" />
            </button>
            <span className="ai-translate">
              <button
                className="tool-btn icon-only"
                aria-label={`Dịch nháp sang ${langLabel(lang)}`}
                data-tip={draft.trim() ? `Dịch nháp sang ${langLabel(lang)}` : "Gõ nháp rồi dịch"}
                data-kbd="⌘⇧L"
                disabled={blocked || saving || !draft.trim() || aiBusy}
                onClick={() => void translate()}
              >
                {aiBusy ? <span className="veil-spinner" /> : <Icon name="languages" />}
              </button>
              <button className="lang-tag" aria-label="Chọn ngôn ngữ dịch" aria-haspopup="menu" data-tip="Ngôn ngữ viết cho chat này" onClick={(e) => pickLang(e.currentTarget)}>
                {langTag(lang)}
              </button>
            </span>
            {caps.stickers ? (
              <button className={`tool-btn icon-only${stickers ? " active" : ""}`} aria-label="Sticker" data-tip="Sticker" disabled={blocked || saving || !!editId} onClick={() => setStickers((v) => !v)}>
                <Icon name="sticker" />
              </button>
            ) : (
              <button className="tool-btn icon-only is-off" aria-disabled="true" aria-label="Sticker" data-tip={CAP_OFF_NOTE.stickers} onClick={() => toast(CAP_OFF_NOTE.stickers!, "info")}>
                <Icon name="sticker" />
              </button>
            )}
            <button
              className={`tool-btn icon-only${recorder.recording ? " rec-on" : ""}`}
              aria-label={recorder.recording ? "Huỷ ghi âm" : "Ghi tin nhắn thoại"}
              data-tip={recorder.recording ? "Huỷ ghi âm" : "Ghi tin nhắn thoại"}
              disabled={blocked || saving || !!editId}
              onClick={() => (recorder.recording ? void recorder.stop(false) : void recorder.start())}
            >
              <Icon name={recorder.recording ? "x" : "mic"} />
            </button>
            <span className="composer-key">↵ gửi · ⇧↵ xuống dòng</span>
            <button
              className="tool-btn primary"
              aria-label={editId ? "Lưu chỉnh sửa" : "Gửi"}
              data-tip={recorder.recording ? "Gửi tin thoại" : editId ? "Lưu chỉnh sửa" : "Gửi"}
              data-kbd="↵"
              disabled={blocked || saving || (!draft.trim() && !recorder.recording)}
              onClick={() => (recorder.recording ? void sendVoice() : void submit())}
            >
              {saving ? "Đang lưu…" : editId ? "Lưu" : "Gửi"} <Icon name={editId ? "check" : "send"} />
            </button>
          </div>
        </div>
        <div className="composer-hint">
          <span>
            {orig !== null ? (
              <button
                className="ai-undo"
                onClick={() => {
                  setDraft(orig);
                  setOrig(null);
                  focus();
                }}
              >
                <Icon name="undo-2" /> Khôi phục bản gốc
              </button>
            ) : ref ? "Esc để huỷ trả lời / sửa" : ""}
          </span>
          <span className="draft-saved">{draft.trim() && !editId ? "Nháp đã lưu cho tab này" : ""}</span>
        </div>
      </div>
    </div>
  );
}
