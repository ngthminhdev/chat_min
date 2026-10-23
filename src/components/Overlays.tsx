import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { api } from "../lib/bridge";
import { esc, hm, norm, plain } from "../lib/format";
import { bare, EMOJI, nextEmojiIndex, searchEmoji } from "../lib/micro-ux";
import { COLORS, COLOR_LABELS } from "../lib/platforms";
import type { Msg } from "../lib/types";
import { forwardMsg, key, openChat, splitKey, useApp, openSearch, type Pop } from "../store";
import { removeAccount, renameAccount } from "../App";
import { startWizard } from "../views/Wizard";
import { ChatAvatar, PersonAvatar } from "../ui/Avatar";
import { Glyph, Icon, type IconName } from "../ui/Icon";

function useOverlayFocus(ref: React.RefObject<HTMLElement>, open: boolean) {
  const previous = useRef<HTMLElement | null>(null);
  const wasOpen = useRef(false);
  if (open && !wasOpen.current) previous.current = document.activeElement as HTMLElement | null;
  wasOpen.current = open;
  useLayoutEffect(() => {
    if (!open) return;
    const root = ref.current;
    if (!root) return;
    const focusable = () => [...root.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex="0"]')].filter((el) => el.getClientRects().length > 0);
    focusable()[0]?.focus();
    const trap = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const items = focusable();
      const first = items[0], last = items[items.length - 1];
      if (!first) { e.preventDefault(); return; }
      if (!root.contains(document.activeElement) || (e.shiftKey ? document.activeElement === first : document.activeElement === last)) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
      }
    };
    document.addEventListener("keydown", trap, true);
    return () => {
      document.removeEventListener("keydown", trap, true);
    };
  }, [open, ref]);
  // Restore after AnimatePresence removes the exiting input, otherwise its unmount
  // can reset focus back to <body>. Preserve focus set by a newly opened chat/dialog.
  return () => {
    requestAnimationFrame(() => {
      if (document.activeElement && document.activeElement !== document.body) return;
      const target = previous.current?.isConnected && previous.current !== document.body ? previous.current : document.querySelector<HTMLElement>(".titlebar .search");
      target?.focus();
    });
  };
}

export function Overlays() {
  return (
    <>
      <Palette />
      <Popover />
      <DialogLayer />
      <Toasts />
      <Tooltip />
    </>
  );
}

// ── command palette: ⌘K chats & commands, ⌘⇧F message search ────────────────
const COMMANDS: [IconName, string, string, () => void][] = [
  ["user-plus", "Thêm tài khoản", "⌘N", () => startWizard()],
  ["message-square-text", "Tìm trong tin nhắn", "⌘⇧F", () => openSearch()],
  ["inbox", "Tất cả hội thoại", "", () => useApp.setState({ route: "inbox" })],
  ["settings", "Cài đặt", "⌘,", () => useApp.setState({ route: "settings" })],
  ["pencil", "Đổi tên tài khoản hiện tại", "⌘E", () => renameAccount()],
  ["panel-right", "Ẩn/hiện chi tiết hội thoại", "⌘R", () => useApp.setState((s) => ({ rightCollapsed: !s.rightCollapsed }))],
  ["panel-left", "Ẩn/hiện danh sách hội thoại", "⌘B", () => useApp.setState((s) => ({ leftCollapsed: !s.leftCollapsed }))],
  ["trash-2", "Xoá tài khoản hiện tại…", "⌘⌫", () => removeAccount()],
];

function Palette() {
  const palette = useApp((s) => s.palette);
  const ref = useRef<HTMLDivElement>(null);
  const restoreFocus = useOverlayFocus(ref, !!palette);
  return (
    <AnimatePresence onExitComplete={restoreFocus}>
      {palette && (
        <motion.div
          className="command"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.1 } }}
          transition={{ duration: 0.12 }}
          onMouseDown={(e) => e.target === e.currentTarget && useApp.setState({ palette: null })}
        >
          <motion.div
            className="palette"
            ref={ref}
            role="dialog"
            aria-modal="true"
            aria-label="Bảng lệnh"
            initial={{ opacity: 0, scale: 0.98, y: -6 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.98, y: -6, transition: { duration: 0.1 } }}
            transition={{ duration: 0.16, ease: [0.2, 0, 0, 1] }}
          >
            <PaletteBody key={palette.mode + (palette.scope ?? "") + (palette.forward?.id ?? "")} mode={palette.mode} scope={palette.scope} forward={palette.forward} />
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function PaletteBody({ mode, scope, forward }: { mode: "chats" | "msgs"; scope?: string; forward?: Msg }) {
  const chats = useApp((s) => s.chats);
  const accounts = useApp((s) => s.accounts);
  const tabs = useApp((s) => s.tabs);
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const [hits, setHits] = useState<Msg[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const list = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { input.current?.focus(); }, []);
  const close = () => useApp.setState({ palette: null });
  const scopeChat = scope ? chats[scope] : undefined;
  const acc = (id: string) => accounts.find((a) => a.id === id);

  useEffect(() => {
    if (mode !== "msgs") return;
    let cancelled = false;
    const query = q.trim();
    setHits(null);
    setSearchError(false);
    setSearching(query.length >= 2);
    if (query.length < 2) return;
    const t = setTimeout(() => {
      const [a, c] = scope ? splitKey(scope) : [undefined, undefined];
      api.search(query, 40, a, c)
        .then((results) => { if (!cancelled) setHits(results); })
        .catch(() => { if (!cancelled) setSearchError(true); })
        .finally(() => { if (!cancelled) setSearching(false); });
    }, 140);
    return () => { cancelled = true; clearTimeout(t); };
  }, [q, mode, scope, attempt]);

  type Row = { node: React.ReactNode; run: () => void; group?: string };
  const rows: Row[] = useMemo(() => {
    const out: Row[] = [];
    const nq = norm(q.trim());
    if (mode === "chats") {
      const recent = [...tabs.map((k) => chats[k]).filter(Boolean), ...Object.values(chats).sort((a, b) => b.lastTs - a.lastTs)];
      const seen = new Set<string>();
      const matched = recent.filter((c) => {
        const k = key(c.accountId, c.id);
        if (seen.has(k)) return false;
        seen.add(k);
        return !nq || norm(c.title).includes(nq) || norm(acc(c.accountId)?.name ?? "").includes(nq);
      });
      matched.filter((c) => !forward || c.canSend).slice(0, nq || forward ? 14 : 6).forEach((c, i) => {
        const a = acc(c.accountId);
        out.push({
          group: i === 0 ? (forward ? "Chuyển tiếp tới" : nq ? "Chat" : "Gần đây") : undefined,
          run: () => (forward ? void forwardMsg(forward, key(c.accountId, c.id)) : void openChat(key(c.accountId, c.id))),
          node: (
            <>
              <ChatAvatar chat={c} size="sm" platform={a?.platform} />
              <span className="cmd-main">
                <span>{c.title}</span>
                {c.unread > 0 && <span className={`badge ${c.muted ? "idle" : "unread"}`}>{c.unread}</span>}
              </span>
              <span className="cmd-acc" style={{ "--conn": `var(--conn-${a?.color})` } as React.CSSProperties}>
                <span className="conn-dot" />
                {a && <Glyph platform={a.platform} />}
                {a?.name}
              </span>
            </>
          ),
        });
      });
      if (!forward) COMMANDS.filter(([, l]) => !nq || norm(l).includes(nq)).forEach(([ic, l, kbd, run], i) =>
        out.push({
          group: i === 0 ? "Lệnh" : undefined,
          run,
          node: (
            <>
              <Icon name={ic} />
              <span className="cmd-main"><span>{l}</span></span>
              {kbd ? <kbd className="kbd">{kbd}</kbd> : <span />}
            </>
          ),
        }),
      );
    } else {
      (hits ?? []).forEach((m, i) => {
        const k = key(m.accountId, m.chatId);
        const c = chats[k];
        const a = acc(m.accountId);
        const t = plain(m.text) || m.media?.name || "";
        const at = norm(t).indexOf(norm(q.trim().split(/\s+/)[0] ?? ""));
        const from = Math.max(0, at - 30);
        const len = q.trim().split(/\s+/)[0]?.length ?? 0;
        const snip = at < 0 ? esc(t.slice(0, 120)) : `${at > 30 ? "…" : ""}${esc(t.slice(from, at))}<mark>${esc(t.slice(at, at + len))}</mark>${esc(t.slice(at + len, at + len + 90))}`;
        out.push({
          group: i === 0 ? `${hits!.length} kết quả` : undefined,
          run: () => {
            void openChat(k);
            setTimeout(() => useApp.setState({ jumpTo: m.id }), 60);
          },
          node: (
            <>
              <PersonAvatar name={m.senderName || "Bạn"} size="sm" accountId={m.accountId} photo={m.senderPhoto} />
              <span style={{ minWidth: 0 }}>
                <span className="cmd-main">
                  <span>
                    <b>{m.outgoing ? "Bạn" : m.senderName}</b> · {c?.title ?? m.chatId}
                  </span>
                </span>
                <span className="snip" dangerouslySetInnerHTML={{ __html: snip }} />
              </span>
              <span className="cmd-acc" style={{ "--conn": `var(--conn-${a?.color})` } as React.CSSProperties}>
                <span className="conn-dot" />
                {hm(m.ts)}
              </span>
            </>
          ),
        });
      });
    }
    return out;
  }, [mode, q, chats, tabs, hits, accounts]);

  useEffect(() => setSel(0), [q, hits]);
  useEffect(() => {
    list.current?.querySelector(".cmd.active")?.scrollIntoView({ block: "nearest" });
  }, [sel]);

  const run = (i: number) => {
    const r = rows[i];
    if (!r) return;
    close();
    r.run();
  };

  const placeholder =
    forward ? `Chuyển tiếp “${(plain(forward.text) || forward.media?.name || "tin nhắn").slice(0, 40)}” tới…`
    : mode === "msgs" ? (scopeChat ? `Tìm trong ${scopeChat.title}…` : "Tìm nội dung tin nhắn trong mọi tài khoản…") : "Nhảy tới chat, người, hoặc gõ lệnh…";
  return (
    <>
      <input
        ref={input}
        placeholder={placeholder}
        aria-label="Tìm"
        role="combobox"
        aria-expanded="true"
        aria-autocomplete="list"
        aria-controls="palette-results"
        aria-activedescendant={rows[sel] ? `palette-option-${sel}` : undefined}
        autoComplete="off"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            const n = Math.max(1, rows.length);
            setSel((s) => (s + (e.key === "ArrowDown" ? 1 : -1) + n) % n);
          } else if (e.key === "Enter" && !e.nativeEvent.isComposing) {
            e.preventDefault();
            run(sel);
          }
        }}
      />
      <div className="palette-mode" role="group" aria-label="Phạm vi tìm kiếm">
        <button className={mode === "chats" ? "on" : ""} aria-pressed={mode === "chats"} onClick={() => useApp.setState({ palette: { mode: "chats" } })}>Chat & lệnh <kbd className="kbd">⌘K</kbd></button>
        <button className={mode === "msgs" ? "on" : ""} aria-pressed={mode === "msgs"} onClick={() => openSearch(scope)}>Tin nhắn <kbd className="kbd">⌘⇧F</kbd></button>
        <button className="palette-close" aria-label="Đóng tìm kiếm" onClick={close}><Icon name="x" /></button>
      </div>
      <div className="cmd-list" id="palette-results" role="listbox" aria-label="Kết quả tìm kiếm" aria-busy={searching} ref={list}>
        {rows.map((r, i) => (
          <div key={i}>
            {r.group && <div className="cmd-group">{r.group}</div>}
            <div
              className={`cmd${mode === "msgs" ? " msg-hit" : ""}${i === sel ? " active" : ""}`}
              role="option"
              id={`palette-option-${i}`}
              aria-selected={i === sel}
              onMouseMove={() => i !== sel && setSel(i)}
              onClick={() => run(i)}
            >
              {r.node}
            </div>
          </div>
        ))}
        {mode === "chats" && !rows.length && <div className="empty-note">Không có chat nào khớp “{q}”</div>}
        {mode === "msgs" && q.trim().length < 2 && (
          <div className="empty-note">Gõ ít nhất 2 ký tự — tìm xuyên {accounts.length} tài khoản, không dấu cũng được</div>
        )}
        {mode === "msgs" && searching && <div className="empty-note" role="status">Đang tìm tin nhắn…</div>}
        {mode === "msgs" && searchError && <div className="empty-note search-feedback" role="alert">Chưa tìm được tin nhắn. Kiểm tra kết nối và thử lại.<button className="tool-btn" onClick={() => { setAttempt((n) => n + 1); input.current?.focus(); }}>Thử lại</button></div>}
        {mode === "msgs" && !searching && !searchError && hits && !hits.length && <div className="empty-note" role="status">Không thấy tin nào chứa “{q}” trong lịch sử đã đồng bộ</div>}
      </div>
      <div className="palette-foot">
        <span>↑↓ chọn</span>
        <span>{forward ? "↵ chuyển tiếp" : "↵ mở"}</span>
        <span>Esc đóng</span>
      </div>
    </>
  );
}

// ── popovers: emoji, message menu, account color ────────────────────────────
function Popover() {
  const pop = useApp((s) => s.pop);
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const close = () => useApp.setState({ pop: null });
  const restoreFocus = useOverlayFocus(ref, !!pop);

  useLayoutEffect(() => {
    if (!pop || !ref.current) return setPos(null);
    const place = () => {
      if (!ref.current) return;
      const w = ref.current.offsetWidth, h = ref.current.offsetHeight;
      let top = pop.y + 6;
      if (top + h > innerHeight - 36) top = pop.top - h - 6;
      setPos({ left: Math.max(12, Math.min(pop.x, innerWidth - w - 12)), top: Math.max(48, top) });
    };
    place();
    ref.current.querySelector("button")?.focus();
    const observer = new ResizeObserver(place);
    observer.observe(ref.current);
    window.addEventListener("resize", place);
    return () => { observer.disconnect(); window.removeEventListener("resize", place); };
  }, [pop]);

  useEffect(() => {
    if (!pop) return;
    const down = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && close();
    document.addEventListener("mousedown", down);
    return () => document.removeEventListener("mousedown", down);
  }, [pop]);

  return (
    <AnimatePresence onExitComplete={restoreFocus}>
      {pop && (
        <motion.div
          key={`${pop.kind}${pop.x}${pop.y}`}
          ref={ref}
          className={pop.kind === "emoji" ? "emoji-pop" : "index-context-menu account-pop"}
          role={pop.kind === "menu" ? "menu" : "dialog"}
          aria-label={pop.kind === "emoji" ? "Chọn biểu cảm" : pop.kind === "color" ? "Màu tài khoản" : "Thao tác"}
          onKeyDown={(e) => {
            if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); return; }
            if ((e.target as HTMLElement).matches("input, textarea")) return;
            if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(e.key)) return;
            const items = [...(ref.current?.querySelectorAll<HTMLButtonElement>(pop.kind === "emoji" ? "[data-emoji]" : "button:not(:disabled)") ?? [])];
            const index = items.indexOf(document.activeElement as HTMLButtonElement);
            if (index < 0) return;
            e.preventDefault(); e.stopPropagation();
            const columns = pop.kind === "menu" ? 1 : items.filter((item) => item.offsetTop === items[0]?.offsetTop).length || 1;
            items[nextEmojiIndex(index, e.key, items.length, columns)]?.focus();
          }}
          style={{ position: "fixed", left: pos?.left ?? -9999, top: pos?.top ?? -9999 }}
          initial={{ opacity: 0, scale: 0.96, y: -4 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.97, transition: { duration: 0.08 } }}
          transition={{ duration: 0.14, ease: [0.2, 0, 0, 1] }}
        >
          <PopBody pop={pop} close={close} />
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function PopBody({ pop, close }: { pop: Pop; close: () => void }) {
  if (pop.kind === "emoji") {
    return <EmojiPicker only={pop.only} onPick={(emoji) => { close(); pop.onPick(emoji); }} />;
  }
  if (pop.kind === "menu") {
    return (
      <>
        {pop.items.map((it) => (
          <button key={it.label} className={`context-item${it.danger ? " danger" : ""}`} role="menuitem" onClick={() => (close(), it.run())}>
            <Icon name={it.icon} />
            <span>{it.label}</span>
            <kbd>{it.kbd ?? ""}</kbd>
          </button>
        ))}
      </>
    );
  }
  return <ColorPicker accountId={pop.accountId} close={close} />;
}

function EmojiPicker({ onPick, only }: { onPick: (emoji: string) => void; only?: string[] }) {
  const [expanded, setExpanded] = useState(false);
  const [query, setQuery] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const grid = useRef<HTMLDivElement>(null);
  const all = only ? only.map((e) => EMOJI.find((x) => bare(x[0]) === bare(e)) ?? ([e, e, ""] as const)) : EMOJI;
  const items = expanded ? searchEmoji(query, all) : all.slice(0, 16);
  useEffect(() => { if (expanded) input.current?.focus(); }, [expanded]);
  return (
    <>
      <div className="emoji-heading">{expanded ? "Biểu cảm" : "Biểu cảm nhanh"}</div>
      {expanded && <input ref={input} className="emoji-search" aria-label="Tìm biểu cảm" placeholder="Tìm biểu cảm…" value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => { if (e.key === "ArrowDown") { e.preventDefault(); e.stopPropagation(); grid.current?.querySelector<HTMLButtonElement>("button")?.focus(); } }} />}
      <div className="emoji-grid" ref={grid} role="group" aria-label="Các biểu cảm">
        {items.map(([emoji, label]) => <button key={emoji} data-emoji={emoji} aria-label={label} title={label} onClick={() => onPick(emoji)}>{emoji}</button>)}
      </div>
      {expanded && <span className="emoji-result-count" role="status">{items.length ? `${items.length} biểu cảm` : "Không có biểu cảm phù hợp"}</span>}
      <button className="emoji-more" aria-expanded={expanded} onClick={() => {
        setExpanded(!expanded); setQuery("");
        if (expanded) requestAnimationFrame(() => grid.current?.querySelector<HTMLButtonElement>("button")?.focus());
      }}>{expanded ? "Thu gọn" : "Thêm biểu cảm…"}</button>
    </>
  );
}

export function ColorPicker({ accountId, close, value, onPick }: { accountId?: string; close?: () => void; value?: string; onPick?: (c: string) => void }) {
  const current = useApp((s) => value ?? s.accounts.find((a) => a.id === accountId)?.color);
  return (
    <>
      {accountId && <div className="account-pop-head">Màu nhận diện</div>}
      <div className="account-colors" role="group" aria-label="Màu tài khoản">
        {COLORS.map((c) => (
          <button
            key={c}
            type="button"
            className={`color-choice${current === c ? " selected" : ""}`}
            style={{ "--conn": `var(--conn-${c})` } as React.CSSProperties}
            aria-label={COLOR_LABELS[c]}
            aria-pressed={current === c}
            onClick={() => {
              if (onPick) return onPick(c);
              if (accountId) void api.accountUpdate(accountId, { color: c });
              close?.();
            }}
          >
            <span className="conn-dot" />
            {current === c && <Icon name="check" />}
          </button>
        ))}
      </div>
    </>
  );
}

// ── dialogs ─────────────────────────────────────────────────────────────────
function DialogLayer() {
  const d = useApp((s) => s.dialog);
  const [value, setValue] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const restoreFocus = useOverlayFocus(form, !!d);
  useEffect(() => {
    if (d?.kind === "prompt") {
      setValue(d.value);
      setTimeout(() => input.current?.select());
    } else if (d) setTimeout(() => cancel.current?.focus());
  }, [d]);
  const close = () => useApp.setState({ dialog: null });
  return (
    <AnimatePresence onExitComplete={restoreFocus}>
      {d && (
        <motion.div
          className="modal"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.1 } }}
          onMouseDown={(e) => e.target === e.currentTarget && close()}
        >
          <motion.form
            className="prompt-dialog"
            ref={form}
            role={d.kind === "confirm" ? "alertdialog" : "dialog"}
            aria-modal="true"
            aria-labelledby="dialog-title"
            aria-describedby={d.kind === "confirm" ? "dialog-message" : undefined}
            initial={{ opacity: 0, scale: 0.97, y: 6 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.98 }}
            transition={{ duration: 0.16, ease: [0.2, 0, 0, 1] }}
            onSubmit={(e) => {
              e.preventDefault();
              close();
              if (d.kind === "confirm") d.onOk();
              else if (value.trim()) d.onOk(value.trim());
            }}
          >
            <h3 id="dialog-title">{d.title}</h3>
            {d.kind === "confirm" ? (
              <p className="prompt-dialog-msg" id="dialog-message">{d.message}</p>
            ) : (
              <input ref={input} type="text" value={value} aria-label={d.title} onChange={(e) => setValue(e.target.value)} />
            )}
            <div className="prompt-dialog-foot">
              <button type="button" ref={cancel} className="tool-btn" onClick={close}>
                Huỷ <kbd className="kbd">Esc</kbd>
              </button>
              <button type="submit" disabled={d.kind === "prompt" && !value.trim()} className={`tool-btn ${d.kind === "confirm" ? "danger" : "primary"}`}>
                {d.kind === "confirm" ? d.ok : "Lưu"}
              </button>
            </div>
          </motion.form>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function Toasts() {
  const toasts = useApp((s) => s.toasts);
  return (
    <div className="toast-stack" role="status" aria-live="polite" aria-atomic="false">
      <AnimatePresence>
        {toasts.map((t) => (
          <motion.div
            key={t.id}
            layout
            className={`toast ${t.icon === "circle-alert" ? "error" : t.icon === "info" ? "info" : "ok"}`}
            role="status"
            initial={{ opacity: 0, y: 12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6, transition: { duration: 0.15 } }}
          >
            <Icon name={t.icon} />
            <div className="toast-body">{t.text}</div>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

/** [data-tip] + optional [data-kbd] → one glass tooltip, like the prototype. */
function Tooltip() {
  const tip = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const hide = () => {
      clearTimeout(timer);
      tip.current?.classList.remove("on");
      if (tip.current) { tip.current.hidden = true; tip.current.setAttribute("aria-hidden", "true"); }
    };
    const show = (el: HTMLElement) => {
      const t = tip.current;
      if (!t || !el.isConnected || !el.matches(":hover, :focus-visible")) return;
      t.hidden = false;
      t.setAttribute("aria-hidden", "false");
      t.innerHTML = `<span>${esc(el.dataset.tip)}</span>${el.dataset.kbd ? `<kbd class="kbd">${esc(el.dataset.kbd)}</kbd>` : ""}`;
      const r = el.getBoundingClientRect();
      const w = t.offsetWidth, h = t.offsetHeight;
      let y = r.bottom + 6;
      if (y + h > innerHeight - 32) y = r.top - h - 6;
      t.style.left = `${Math.max(8, Math.min(r.left + r.width / 2 - w / 2, innerWidth - w - 8))}px`;
      t.style.top = `${y}px`;
      t.classList.add("on");
    };
    const over = (e: MouseEvent) => {
      const el = (e.target as HTMLElement).closest?.("[data-tip]") as HTMLElement | null;
      clearTimeout(timer);
      if (!el) return hide();
      timer = setTimeout(() => show(el), 350);
    };
    const focus = (e: FocusEvent) => {
      const el = e.target as HTMLElement;
      if (el.matches?.("[data-tip]:focus-visible")) show(el);
      else hide();
    };
    const out = (e: MouseEvent) => {
      const target = (e.target as HTMLElement).closest?.("[data-tip]");
      if (target && !target.contains(e.relatedTarget as Node | null)) hide();
    };
    // Closing a popover can synchronously restore focus while it is exiting.
    const key = () => { hide(); requestAnimationFrame(hide); };
    document.addEventListener("mouseover", over);
    document.addEventListener("mouseout", out);
    document.addEventListener("focusin", focus);
    document.addEventListener("focusout", hide);
    document.addEventListener("scroll", hide, true);
    document.addEventListener("mousedown", hide);
    document.addEventListener("click", hide);
    document.addEventListener("keydown", key, true);
    window.addEventListener("blur", hide);
    window.addEventListener("resize", hide);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("mouseover", over);
      document.removeEventListener("mouseout", out);
      document.removeEventListener("focusin", focus);
      document.removeEventListener("focusout", hide);
      document.removeEventListener("scroll", hide, true);
      document.removeEventListener("mousedown", hide);
      document.removeEventListener("click", hide);
      document.removeEventListener("keydown", key, true);
      window.removeEventListener("blur", hide);
      window.removeEventListener("resize", hide);
    };
  }, []);
  return <div className="tip" ref={tip} role="tooltip" hidden aria-hidden="true" />;
}
