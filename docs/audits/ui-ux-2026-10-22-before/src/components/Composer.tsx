import { useEffect, useLayoutEffect, useRef } from "react";
import { AnimatePresence, motion } from "motion/react";
import { api, pickFile } from "../lib/bridge";
import { plain } from "../lib/format";
import { CAP_OFF_NOTE, PLATFORMS } from "../lib/platforms";
import { anchor, capsOf, fail, send, splitKey, toast, useApp } from "../store";
import { Icon } from "../ui/Icon";
import { startEdit } from "./Message";

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

  const submit = () => {
    const text = draft.trim();
    if (!text || blocked) return;
    if (editId) {
      const [a, c] = splitKey(chatKey);
      useApp.setState((s) => ({
        msgs: { ...s.msgs, [chatKey]: (s.msgs[chatKey] ?? []).map((m) => (m.id === editId ? { ...m, text, edited: true } : m)) },
      }));
      api.edit(a, c, editId, text).catch(fail);
    } else {
      void send(chatKey, text, { replyTo: replyId || undefined, threadId });
    }
    useApp.setState((s) => ({ drafts: { ...s.drafts, [k]: "" }, replyTo: { ...s.replyTo, [k]: "" }, editing: { ...s.editing, [k]: "" } }));
  };

  const attach = async () => {
    const path = await pickFile();
    if (!path) return;
    void send(chatKey, draft.trim(), { file: path, replyTo: replyId || undefined, threadId });
    useApp.setState((s) => ({ drafts: { ...s.drafts, [k]: "" }, replyTo: { ...s.replyTo, [k]: "" } }));
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
                <button className="tool-btn icon-only" aria-label="Huỷ" onClick={cancelRef}>
                  <Icon name="x" />
                </button>
              </span>
            </motion.div>
          )}
        </AnimatePresence>
        <div className="composer-box main-composer">
          <textarea
            id="composer-input"
            ref={ta}
            rows={1}
            placeholder={blocked ? "Chưa gửi được lúc này…" : placeholder ?? "Viết tin nhắn…"}
            aria-label="Soạn tin nhắn"
            value={draft}
            disabled={blocked}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
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
            <button className="tool-btn icon-only" aria-label="Đính kèm file" data-tip="Đính kèm file" disabled={blocked} onClick={attach}>
              <Icon name="paperclip" />
            </button>
            <button
              className="tool-btn icon-only"
              aria-label="Emoji"
              data-tip="Emoji"
              disabled={blocked}
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
            <button className="tool-btn icon-only is-off" aria-disabled="true" aria-label="Sticker" data-tip={CAP_OFF_NOTE.stickers} onClick={() => toast(CAP_OFF_NOTE.stickers!, "info")}>
              <Icon name="sticker" />
            </button>
            <button className="tool-btn icon-only is-off" aria-disabled="true" aria-label="Tin nhắn thoại" data-tip={CAP_OFF_NOTE.voice} onClick={() => toast(CAP_OFF_NOTE.voice!, "info")}>
              <Icon name="mic" />
            </button>
            <span className="composer-key">↵ gửi · ⇧↵ xuống dòng</span>
            <button className="tool-btn primary" aria-label="Gửi" data-tip="Gửi" data-kbd="↵" disabled={blocked || !draft.trim()} onClick={submit}>
              {editId ? "Lưu" : "Gửi"} <Icon name={editId ? "check" : "send"} />
            </button>
          </div>
        </div>
        <div className="composer-hint">
          <span>{ref ? "Esc để huỷ trả lời / sửa" : ""}</span>
          <span className="draft-saved">{draft.trim() && !editId ? "Nháp đã lưu cho tab này" : ""}</span>
        </div>
      </div>
    </div>
  );
}
