import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { api, fileSrc, isTauri, pickFiles, pickMedia, type Staged } from "../lib/bridge";
import { fileSize, plain } from "../lib/format";
import { CAP_OFF_NOTE, PLATFORMS } from "../lib/platforms";
import { addMsg, anchor, capsOf, fail, send, splitKey, toast, useApp } from "../store";
import { Icon } from "../ui/Icon";
import { startEdit } from "./Message";
import { clock, StickerPanel, useMentions, useRecorder } from "./ComposerExtras";
import { LANGS, langLabel, langTag, suggestReplies, translateDraft } from "../ai";
import type { Suggestion } from "../lib/types";
import { ReplySuggestions, type ReplySuggestionsState } from "./ReplySuggestions";
import { EASE } from "../lib/motion";
import { isMobile } from "../lib/mobile";
import { enterSubmits } from "../lib/mobile-navigation";
import { useMobileBack } from "../mobile";
import { MobileActions } from "../ui/MobileActions";

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
  const [sug, setSug] = useState<ReplySuggestionsState | null>(null);
  const suggestionId = useId();
  const stickerId = useId();
  const suggestionButton = useRef<HTMLButtonElement>(null);
  const stickerButton = useRef<HTMLButtonElement>(null);
  const suggestionRun = useRef(0);
  const suggestionPending = useRef(false);
  const translationRun = useRef(0);
  const translationPending = useRef(false);
  const reduceMotion = useReducedMotion();
  /** the draft before AI translated it, for one-click undo */
  const [orig, setOrig] = useState<string | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [stickers, setStickers] = useState(false);
  const recorder = useRecorder();
  /** pasted / dropped files waiting for Enter; the draft goes out as the first one's caption */
  const [files, setFiles] = useState<Staged[]>([]);
  const [dropping, setDropping] = useState(false);
  const [attaching, setAttaching] = useState(false);
  const attachmentPending = useRef(false);
  const attachmentRun = useRef(0);
  const stage = async (paths: string[]) => {
    if (!paths.length || editId || blocked || !canSend || recorder.recording) return;
    const run = attachmentRun.current;
    const add = await api.stageFiles(paths);
    if (run !== attachmentRun.current) return;
    if (add.length < paths.length) toast("Thư mục không gửi được, chỉ đính kèm file", "info");
    setFiles((f) => [...f, ...add.filter((a) => !f.some((x) => x.path === a.path))]);
    if (!isMobile) ta.current?.focus();
  };
  useEffect(() => () => { attachmentRun.current++; }, [k]);
  // Tauri owns file drops (dragDropEnabled): the composer of the visible tab takes them
  useEffect(() => {
    if (!isTauri || isMobile) return;
    let off = () => {};
    let gone = false;
    void import("@tauri-apps/api/webview").then(({ getCurrentWebview }) =>
      getCurrentWebview().onDragDropEvent(({ payload }) => {
        if (useApp.getState().active !== k) return;
        if (payload.type === "enter" || payload.type === "over") setDropping(true);
        else {
          setDropping(false);
          if (payload.type === "drop") void stage(payload.paths).catch(fail);
        }
      }).then((u) => (gone ? u() : (off = u))),
    );
    return () => { gone = true; off(); };
  }, [k, editId]);
  const onPaste = (e: React.ClipboardEvent) => {
    const cd = e.clipboardData;
    const blobs = [...cd.files];
    if (!blobs.length && !cd.types.includes("Files")) return;
    e.preventDefault();
    void (async () => {
      try {
        // Finder copies: real paths, no need to read the bytes; screenshots/images: bytes only
        const paths = await api.clipboardFiles();
        if (paths.length) return await stage(paths);
        await stage(await Promise.all(blobs.map(async (b, i) => api.saveTemp(b.name || `paste-${Date.now()}-${i}.${b.type.split("/")[1] || "bin"}`, await b64(b)))));
      } catch (err) { fail(err); }
    })();
  };
  // A response from a previous composer must not update a newly opened chat.
  useEffect(() => () => { suggestionRun.current++; translationRun.current++; }, []);
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
    // Measuring with height:auto drops the textarea to one row for a moment; the chat box
    // above grew by the difference and WebKit clamped its scrollTop to that taller box, so
    // the list sat one composer-height above the bottom until the next render yanked it
    // back (visible as a jump on every keystroke). Hold the composer's height meanwhile.
    // KNOWN ISSUE (2026-10-24): not enough on macOS — js.log still shows "unstick dist=142"
    // (= the composer's growth) right after keystrokes with a long draft. Next thing to try:
    // measure in a hidden mirror element (same font/width) instead of touching this
    // textarea's height, or save/restore the .msgs scrollTop around the measurement.
    const shell = el.closest<HTMLElement>(".composer") ?? el.parentElement!;
    const held = shell.style.height;
    shell.style.height = `${shell.offsetHeight}px`;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 176)}px`;
    shell.style.height = held;
  }, [draft]);

  useEffect(() => {
    if (!blocked && !isMobile) ta.current?.focus();
  }, [k, blocked]);

  const setDraft = (v: string) => useApp.setState((s) => ({ drafts: { ...s.drafts, [k]: v } }));
  const mentions = useMentions(chatKey, ta, draft, setDraft);
  const cancelRef = () =>
    useApp.setState((s) => ({
      replyTo: { ...s.replyTo, [k]: "" },
      editing: { ...s.editing, [k]: "" },
      drafts: s.editing[k] ? { ...s.drafts, [k]: "" } : s.drafts,
    }));

  const focus = () => requestAnimationFrame(() => ta.current?.focus());
  const dismissSuggestions = () => {
    suggestionRun.current++;
    suggestionPending.current = false;
    setSug(null);
  };
  const closeSuggestions = () => { dismissSuggestions(); suggestionButton.current?.focus(); };
  useMobileBack(() => {
    if (recorder.recording) void recorder.stop(false);
    else if (stickers) setStickers(false);
    else dismissSuggestions();
  }, useApp((s) => s.route === "shell" && s.rightCollapsed && s.leftCollapsed) && (!!sug || stickers || recorder.recording));
  const chooseSuggestion = (item: Suggestion) => {
    if (draft.trim()) setOrig(orig ?? draft);
    setDraft(item.reply);
    dismissSuggestions();
    focus();
  };
  useEffect(() => {
    if (!sug && !stickers) return;
    const onKey = (e: KeyboardEvent) => {
      const state = useApp.getState();
      if (e.key !== "Escape" || state.pop || state.dialog || state.palette || state.viewer) return;
      e.preventDefault(); e.stopPropagation();
      if (stickers) { setStickers(false); stickerButton.current?.focus(); }
      else closeSuggestions();
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [!!sug, stickers]);

  const suggest = async () => {
    if (suggestionPending.current || blocked || saving) return;
    suggestionPending.current = true;
    const run = ++suggestionRun.current;
    setSug((current) => ({ state: "loading", items: current?.items ?? [] }));
    try {
      const items = await suggestReplies(chatKey, threadId);
      if (run !== suggestionRun.current) return;
      setSug({ state: "ok", items });
    } catch (e) {
      if (run === suggestionRun.current) setSug((current) => ({ state: "err", items: current?.items ?? [], err: String(e) }));
    } finally {
      if (run === suggestionRun.current) suggestionPending.current = false;
    }
  };
  const translate = async (to = lang) => {
    if (translationPending.current || !draft.trim() || blocked || saving) return;
    translationPending.current = true;
    const run = ++translationRun.current;
    setAiBusy(true);
    try {
      const out = await translateDraft(chatKey, draft, to);
      if (run !== translationRun.current) return;
      if ((useApp.getState().drafts[k] ?? "") !== draft) {
        toast("Nháp đã thay đổi. Nội dung mới của bạn được giữ nguyên.", "info");
        return;
      }
      if (out) {
        setOrig(orig ?? draft);
        setDraft(out);
      }
    } catch (e) {
      if (run === translationRun.current) fail(e);
    } finally {
      if (run === translationRun.current) {
        translationPending.current = false;
        setAiBusy(false);
        if (ta.current?.closest(".composer")?.contains(document.activeElement)) focus();
      }
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
    if (files.length && !editId && !blocked && canSend) {
      const { wire, shown } = mentions.encode(text);
      files.forEach((f, i) => void send(chatKey, i ? "" : shown, { file: f.path, replyTo: i ? undefined : replyId || undefined, threadId, wire: i ? undefined : wire }));
      setFiles([]);
      useApp.setState((s) => ({ drafts: { ...s.drafts, [k]: "" }, replyTo: { ...s.replyTo, [k]: "" } }));
      return;
    }
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
      const { wire, shown } = mentions.encode(text);
      void send(chatKey, shown, { replyTo: replyId || undefined, threadId, wire });
    }
    setOrig(null);
    dismissSuggestions();
    useApp.setState((s) => editId && (s.editing[k] !== editId || s.drafts[k] !== draft) ? {} : ({ drafts: { ...s.drafts, [k]: "" }, replyTo: { ...s.replyTo, [k]: "" }, editing: { ...s.editing, [k]: "" } }));
  };

  const attach = async (media = false) => {
    if (blocked || saving || editId || !canSend || recorder.recording || attachmentPending.current) return;
    attachmentPending.current = true;
    setAttaching(true);
    const run = attachmentRun.current;
    try {
      const paths = await (media ? pickMedia() : pickFiles());
      if (run === attachmentRun.current) await stage(paths);
    } catch (e) { if (run === attachmentRun.current) fail(e); }
    finally { attachmentPending.current = false; setAttaching(false); }
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
      <AnimatePresence>
        {dropping && (
          <motion.div className="drop-overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.12 }}>
            <div>
              <Icon name="paperclip" />
              <strong>Thả để đính kèm</strong>
              <span>Gửi tới {useApp.getState().chats[chatKey]?.title} · Enter để gửi, thêm chú thích nếu muốn</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
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
            <motion.div className="ai-suggest-reveal"
              initial={reduceMotion ? false : { opacity: 0, height: 0, y: 4 }}
              animate={{ opacity: 1, height: "auto", y: 0 }}
              exit={{ opacity: 0, height: 0, y: reduceMotion ? 0 : 4 }}
              transition={{ duration: reduceMotion ? 0 : 0.16, ease: EASE }}>
              <ReplySuggestions id={suggestionId} value={sug} language={langLabel(lang)} onRetry={() => void suggest()} onClose={closeSuggestions} onChoose={chooseSuggestion} />
            </motion.div>
          )}
        </AnimatePresence>
        <AnimatePresence>
          {stickers && caps.stickers && <StickerPanel id={stickerId} accountId={accountId} onPick={sendSticker} onClose={(restoreFocus) => { setStickers(false); if (restoreFocus) stickerButton.current?.focus(); }} />}
        </AnimatePresence>
        <AnimatePresence initial={false}>
          {files.length > 0 && (
            <motion.div className="attach-bar" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.16, ease: EASE }}>
              <AnimatePresence initial={false}>
                {files.map((f) => (
                  <motion.div className="attach-chip" key={f.path} title={f.path} layout initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }}>
                    {IMG.test(f.name) ? <img src={fileSrc(f.path)} alt="" /> : <span className="attach-ic"><Icon name={VID.test(f.name) ? "film" : "file-text"} /></span>}
                    <span className="attach-meta">
                      <b>{f.name}</b>
                      <small>{fileSize(f.size)}</small>
                    </span>
                    <button className="tool-btn icon-only" aria-label={`Bỏ ${f.name}`} onClick={() => setFiles((x) => x.filter((p) => p.path !== f.path))}>
                      <Icon name="x" />
                    </button>
                  </motion.div>
                ))}
              </AnimatePresence>
            </motion.div>
          )}
        </AnimatePresence>
        <div className={`composer-box main-composer${dropping ? " dropping" : ""}`}>
          {recorder.recording && (
            <div className="rec-bar" role="status">
              <span className="rec-dot" />
              Đang ghi âm <b>{clock(recorder.secs ?? 0)}</b>
              <small>Bấm Gửi để gửi · ✕ để huỷ</small>
            </div>
          )}
          {mentions.pop}
          <textarea
            style={recorder.recording ? { display: "none" } : undefined}
            id="composer-input"
            ref={ta}
            rows={1}
            placeholder={blocked ? "Chưa gửi được lúc này…" : placeholder ?? "Viết tin nhắn…"}
            aria-label="Soạn tin nhắn"
            value={draft}
            disabled={blocked || saving}
            onChange={(e) => {
              setDraft(e.target.value);
              mentions.detect(e.target.value, e.target.selectionStart);
            }}
            onPaste={onPaste}
            onKeyDown={(e) => {
              if (mentions.onKey(e)) return;
              const mod = e.metaKey || e.ctrlKey;
              if (mod && e.key.toLowerCase() === "j") {
                e.preventDefault();
                void suggest();
              } else if (e.altKey && !mod && e.code === "KeyR") {
                // ⌥R (what ReplyMin used); e.code because Option+R types "®"
                e.preventDefault();
                void translate();
              } else if (e.key === "Enter" && enterSubmits(isMobile, e.shiftKey, e.nativeEvent.isComposing)) {
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
            <MobileActions label="Thêm vào tin nhắn" icon="plus" disabled={blocked || saving || recorder.recording}>
            <button className="tool-btn icon-only" aria-label="Đính kèm tệp" data-tip={editId ? "Chỉ sửa nội dung tin nhắn" : "Đính kèm tệp"} disabled={blocked || saving || !!editId || attaching || recorder.recording} onClick={() => void attach()}>
              <Icon name="paperclip" />
            </button>
            <button
              className="tool-btn icon-only"
              aria-label="Emoji"
              data-tip="Emoji"
              disabled={blocked || saving}
              onClick={(e) => {
                // the app: macOS's full emoji picker types into the focused textarea; demo: quick set
                if (isTauri && !isMobile) {
                  ta.current?.focus();
                  return void api.emojiPalette().catch(fail);
                }
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
              ref={suggestionButton}
              className={`tool-btn icon-only${sug ? " active" : ""}`}
              aria-label="Gợi ý trả lời"
              aria-expanded={!!sug}
              aria-controls={sug ? suggestionId : undefined}
              data-tip={sug ? "Đóng gợi ý trả lời" : "Gợi ý trả lời"}
              data-kbd="⌘J"
              disabled={blocked || saving}
              onClick={() => (sug ? closeSuggestions() : void suggest())}
            >
              {sug?.state === "loading" ? <span className="veil-spinner" /> : <Icon name="sparkles" />}
            </button>
            <span className="ai-translate">
              <button
                className="tool-btn icon-only"
                aria-label={`Dịch nháp sang ${langLabel(lang)}`}
                data-tip={draft.trim() ? `Dịch nháp sang ${langLabel(lang)}` : "Gõ nháp rồi dịch"}
                data-kbd="⌥R"
                aria-busy={aiBusy}
                disabled={blocked || saving || !draft.trim() || aiBusy}
                onClick={() => void translate()}
              >
                {aiBusy ? <span className="veil-spinner" /> : <Icon name="languages" />}
              </button>
              <button className="lang-tag" aria-label={`Ngôn ngữ viết: ${langLabel(lang)}. Bấm để đổi`} aria-haspopup="menu" data-tip={`Ngôn ngữ viết: ${langLabel(lang)} · Bấm để đổi`} disabled={blocked || saving || aiBusy} onClick={(e) => pickLang(e.currentTarget)}>
                {langTag(lang)}
              </button>
            </span>
            {caps.stickers ? (
              <button ref={stickerButton} className={`tool-btn icon-only${stickers ? " active" : ""}`} aria-label="Sticker" aria-expanded={stickers} aria-controls={stickers ? stickerId : undefined} data-tip={stickers ? "Đóng sticker" : "Sticker"} disabled={blocked || saving || !!editId} onClick={() => setStickers((v) => !v)}>
                <Icon name="sticker" />
              </button>
            ) : (
              <button className="tool-btn icon-only is-off" aria-disabled="true" aria-label="Sticker" data-tip={CAP_OFF_NOTE.stickers} onClick={() => toast(CAP_OFF_NOTE.stickers!, "info")}>
                <Icon name="sticker" />
              </button>
            )}
            </MobileActions>
            {isMobile && <button
              className="tool-btn composer-media"
              aria-label="Ảnh/video"
              aria-busy={attaching}
              disabled={blocked || saving || !!editId || attaching || recorder.recording}
              onClick={() => void attach(true)}
            >
              {attaching ? <span className="veil-spinner" /> : <Icon name="image" />}
              <span>Ảnh/video</span>
            </button>}
            {(!isMobile || recorder.recording || (!draft.trim() && !files.length && !editId)) &&
            <button
              className={`tool-btn icon-only composer-record${recorder.recording ? " rec-on" : ""}`}
              aria-label={recorder.recording ? "Huỷ ghi âm" : "Ghi tin nhắn thoại"}
              data-tip={recorder.recording ? "Huỷ ghi âm" : "Ghi tin nhắn thoại"}
              disabled={blocked || saving || !!editId}
              onClick={() => (recorder.recording ? void recorder.stop(false) : void recorder.start())}
            >
              <Icon name={recorder.recording ? "x" : "mic"} />
            </button>
            }
            {(!isMobile || recorder.recording || !!draft.trim() || !!files.length || !!editId) &&
            <button
              className="tool-btn primary icon-only composer-send"
              aria-label={editId ? "Lưu chỉnh sửa" : "Gửi"}
              data-tip={recorder.recording ? "Gửi tin thoại" : editId ? "Lưu chỉnh sửa" : "Gửi"}
              data-kbd="↵"
              disabled={blocked || saving || (!draft.trim() && !recorder.recording && !files.length)}
              onClick={() => (recorder.recording ? void sendVoice() : void submit())}
            >
              <Icon name={editId ? "check" : "send"} />
            </button>
            }
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
            ) : null}
          </span>
        </div>
      </div>
    </div>
  );
}

const IMG = /\.(jpe?g|png|gif|webp|heic)$/i;
const VID = /\.(mp4|mov|m4v|webm)$/i;

const b64 = (b: Blob) =>
  new Promise<string>((ok, no) => {
    const fr = new FileReader();
    fr.onload = () => ok(String(fr.result).split(",")[1] ?? "");
    fr.onerror = () => no(fr.error);
    fr.readAsDataURL(b);
  });
