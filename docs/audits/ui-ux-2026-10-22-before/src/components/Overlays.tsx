import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { api } from "../lib/bridge";
import { esc, hm, norm, plain } from "../lib/format";
import { COLORS, COLOR_LABELS } from "../lib/platforms";
import type { Msg } from "../lib/types";
import { key, openChat, splitKey, useApp, type Pop } from "../store";
import { removeAccount, renameAccount } from "../App";
import { startWizard } from "../views/Wizard";
import { ChatAvatar, PersonAvatar } from "../ui/Avatar";
import { Glyph, Icon, type IconName } from "../ui/Icon";

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
  ["user-plus", "Thêm account", "⌘N", () => startWizard()],
  ["message-square-text", "Tìm trong tin nhắn", "⌘⇧F", () => useApp.setState({ palette: { mode: "msgs" } })],
  ["inbox", "All inboxes", "", () => useApp.setState({ route: "inbox" })],
  ["settings", "Settings", "⌘,", () => useApp.setState({ route: "settings" })],
  ["pencil", "Đổi tên account hiện tại", "⌘E", () => renameAccount()],
  ["panel-right", "Ẩn/hiện inspector", "⌘I", () => useApp.setState((s) => ({ rightCollapsed: !s.rightCollapsed }))],
  ["panel-left", "Ẩn/hiện sidebar", "⌘B", () => useApp.setState((s) => ({ leftCollapsed: !s.leftCollapsed }))],
  ["trash-2", "Xoá account hiện tại…", "⌘⌫", () => removeAccount()],
];

function Palette() {
  const palette = useApp((s) => s.palette);
  return (
    <AnimatePresence>
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
            role="dialog"
            aria-modal="true"
            aria-label="Command palette"
            initial={{ opacity: 0, scale: 0.98, y: -6 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.98, y: -6, transition: { duration: 0.1 } }}
            transition={{ duration: 0.16, ease: [0.2, 0, 0, 1] }}
          >
            <PaletteBody key={palette.mode + (palette.scope ?? "")} mode={palette.mode} scope={palette.scope} />
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function PaletteBody({ mode, scope }: { mode: "chats" | "msgs"; scope?: string }) {
  const chats = useApp((s) => s.chats);
  const accounts = useApp((s) => s.accounts);
  const tabs = useApp((s) => s.tabs);
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const [hits, setHits] = useState<Msg[] | null>(null);
  const list = useRef<HTMLDivElement>(null);
  const close = () => useApp.setState({ palette: null });
  const scopeChat = scope ? chats[scope] : undefined;
  const acc = (id: string) => accounts.find((a) => a.id === id);

  useEffect(() => {
    if (mode !== "msgs") return;
    const query = q.trim();
    if (query.length < 2) return setHits(null);
    const t = setTimeout(() => {
      const [a, c] = scope ? splitKey(scope) : [undefined, undefined];
      api.search(query, 40, a, c).then(setHits).catch(() => setHits([]));
    }, 140);
    return () => clearTimeout(t);
  }, [q, mode, scope]);

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
      matched.slice(0, nq ? 14 : 6).forEach((c, i) => {
        const a = acc(c.accountId);
        out.push({
          group: i === 0 ? (nq ? "Chat" : "Gần đây") : undefined,
          run: () => void openChat(key(c.accountId, c.id)),
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
      COMMANDS.filter(([, l]) => !nq || norm(l).includes(nq)).forEach(([ic, l, kbd, run], i) =>
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
    close();
    r?.run();
  };

  const placeholder =
    mode === "msgs" ? (scopeChat ? `Tìm trong ${scopeChat.title}…` : "Tìm nội dung tin nhắn trong mọi account…") : "Nhảy tới chat, người, hoặc gõ lệnh…";
  return (
    <>
      <input
        autoFocus
        placeholder={placeholder}
        aria-label="Tìm"
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
      <div className="palette-mode">
        <span className={mode === "chats" ? "on" : ""}>Chat & lệnh <kbd className="kbd">⌘K</kbd></span>
        <span className={mode === "msgs" ? "on" : ""}>Tin nhắn <kbd className="kbd">⌘⇧F</kbd></span>
      </div>
      <div className="cmd-list" role="listbox" ref={list}>
        {rows.map((r, i) => (
          <div key={i}>
            {r.group && <div className="cmd-group">{r.group}</div>}
            <div
              className={`cmd${mode === "msgs" ? " msg-hit" : ""}${i === sel ? " active" : ""}`}
              role="option"
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
          <div className="empty-note">Gõ ít nhất 2 ký tự — tìm xuyên {accounts.length} account, không dấu cũng được</div>
        )}
        {mode === "msgs" && hits && !hits.length && <div className="empty-note">Không thấy tin nào chứa “{q}” trong lịch sử đã đồng bộ</div>}
      </div>
      <div className="palette-foot">
        <span>↑↓ chọn</span>
        <span>↵ mở</span>
        <span>Esc đóng</span>
      </div>
    </>
  );
}

// ── popovers: emoji, message menu, account color ────────────────────────────
const EMOJI = ["👍", "❤️", "😂", "😮", "😢", "🙏", "🔥", "👀", "✅", "💯", "🫡", "🎉", "🤔", "😅", "🚀", "👏"];

function Popover() {
  const pop = useApp((s) => s.pop);
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const close = () => useApp.setState({ pop: null });

  useLayoutEffect(() => {
    if (!pop || !ref.current) return setPos(null);
    const w = ref.current.offsetWidth, h = ref.current.offsetHeight;
    let top = pop.y + 6;
    if (top + h > innerHeight - 36) top = pop.top - h - 6;
    setPos({ left: Math.max(12, Math.min(pop.x, innerWidth - w - 12)), top: Math.max(48, top) });
    ref.current.querySelector("button")?.focus();
  }, [pop]);

  useEffect(() => {
    if (!pop) return;
    const down = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && close();
    setTimeout(() => document.addEventListener("mousedown", down));
    return () => document.removeEventListener("mousedown", down);
  }, [pop]);

  return (
    <AnimatePresence>
      {pop && (
        <motion.div
          key={`${pop.kind}${pop.x}${pop.y}`}
          ref={ref}
          className={pop.kind === "emoji" ? "emoji-pop" : "index-context-menu account-pop"}
          role={pop.kind === "color" ? "dialog" : "menu"}
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
    return (
      <>
        {EMOJI.map((e) => (
          <button key={e} role="menuitem" aria-label={e} onClick={() => (close(), pop.onPick(e))}>
            {e}
          </button>
        ))}
      </>
    );
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

export function ColorPicker({ accountId, close, value, onPick }: { accountId?: string; close?: () => void; value?: string; onPick?: (c: string) => void }) {
  const current = useApp((s) => value ?? s.accounts.find((a) => a.id === accountId)?.color);
  return (
    <>
      {accountId && <div className="account-pop-head">Màu nhận diện</div>}
      <div className="account-colors" role="group" aria-label="Màu account">
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
  useEffect(() => {
    if (d?.kind === "prompt") {
      setValue(d.value);
      setTimeout(() => input.current?.select());
    } else if (d) setTimeout(() => cancel.current?.focus());
  }, [d]);
  const close = () => useApp.setState({ dialog: null });
  return (
    <AnimatePresence>
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
            role={d.kind === "confirm" ? "alertdialog" : "dialog"}
            aria-modal="true"
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
            <h3>{d.title}</h3>
            {d.kind === "confirm" ? (
              <p className="prompt-dialog-msg">{d.message}</p>
            ) : (
              <input ref={input} type="text" value={value} aria-label={d.title} onChange={(e) => setValue(e.target.value)} />
            )}
            <div className="prompt-dialog-foot">
              <button type="button" ref={cancel} className="tool-btn" onClick={close}>
                Huỷ <kbd className="kbd">Esc</kbd>
              </button>
              <button type="submit" className={`tool-btn ${d.kind === "confirm" ? "danger" : "primary"}`}>
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
    <div className="toast-stack">
      <AnimatePresence>
        {toasts.map((t) => (
          <motion.div
            key={t.id}
            layout
            className={`toast${t.icon === "circle-alert" ? " error" : ""}`}
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
    };
    const show = (el: HTMLElement) => {
      const t = tip.current!;
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
    document.addEventListener("mouseover", over);
    document.addEventListener("focusin", focus);
    document.addEventListener("scroll", hide, true);
    document.addEventListener("mousedown", hide);
    return () => {
      document.removeEventListener("mouseover", over);
      document.removeEventListener("focusin", focus);
      document.removeEventListener("scroll", hide, true);
      document.removeEventListener("mousedown", hide);
    };
  }, []);
  return <div className="tip" ref={tip} role="tooltip" />;
}
