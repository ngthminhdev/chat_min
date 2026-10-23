import { useEffect, useRef, useState } from "react";
import { listTime, plain } from "../lib/format";
import { THEMES } from "../lib/themes";
import { inboxKey, inboxUnread, key, openAt, useApp, openSearch } from "../store";
import { useShallow } from "zustand/react/shallow";
import { startWizard } from "../views/Wizard";
import { Icon } from "../ui/Icon";
import { PersonAvatar } from "../ui/Avatar";

export function Titlebar() {
  const theme = useApp((s) => s.prefs.theme);
  const menu = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (menu.current?.open && !menu.current.contains(e.target as Node)) menu.current.open = false;
    };
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, []);

  return (
    <header className="titlebar" data-tauri-drag-region>
      <div className="traffic" data-tauri-drag-region>
        <span className="app-name">ChatMin</span>
      </div>
      <button className="search" type="button" aria-label="Tìm trong tin nhắn" onClick={() => openSearch()}>
        <Icon name="search" />
        <span>Tìm tin nhắn…</span>
        <kbd>⌘⇧F</kbd>
      </button>
      <div className="toolbar" data-tauri-drag-region>
        <Inbox />
        <details
          className="appearance-menu"
          ref={menu}
          onKeyDown={(e) => {
            if (e.key === "Escape" && menu.current?.open) {
              e.stopPropagation();
              menu.current.open = false;
            }
          }}
        >
          <summary className="tool-btn icon-only lg" aria-label="Giao diện" data-tip="Giao diện">
            <Icon name="palette" />
          </summary>
          <div className="appearance-panel">
            <label htmlFor="theme-select">Giao diện</label>
            <select
              className="theme-select"
              id="theme-select"
              value={theme}
              onChange={(e) => {
                const v = e.target.value;
                useApp.setState((s) => ({ prefs: { ...s.prefs, theme: v === "dark" ? "" : v } }));
                if (menu.current) menu.current.open = false;
              }}
            >
              <option value="">Bearded Arc · dark</option>
              {THEMES.filter((t) => t.id !== "dark" && t.id !== "default-dark").map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                  {t.base === "light" ? " · light" : ""}
                </option>
              ))}
            </select>
            <span>Áp dụng cho toàn bộ cửa sổ</span>
          </div>
        </details>
        <button className="tool-btn icon-only lg" type="button" aria-label="Thêm tài khoản" data-tip="Thêm tài khoản" data-kbd="⌘N" onClick={() => startWizard()}>
          <Icon name="user-plus" />
        </button>
        <button
          className="tool-btn icon-only lg"
          type="button"
          aria-label="Cài đặt"
          data-tip="Cài đặt"
          data-kbd="⌘,"
          onClick={() => useApp.setState({ route: "settings" })}
        >
          <Icon name="settings" />
        </button>
      </div>
    </header>
  );
}

/** Bell: mentions of me, DMs, replies in my threads, reactions to my messages. */
function Inbox() {
  const items = useApp((s) => s.inbox);
  const unread = useApp(useShallow((s) => s.inbox.filter((m) => inboxUnread(s, m)).map(inboxKey)));
  const chats = useApp((s) => s.chats);
  const [open, setOpen] = useState(false);
  const [all, setAll] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const isNew = new Set(unread);
  const shown = all ? items : items.filter((m) => isNew.has(inboxKey(m)));

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", esc); };
  }, [open]);

  return (
    <div className="inbox-menu" ref={box}>
      <button className="tool-btn icon-only lg" type="button" aria-label="Thông báo" aria-expanded={open} data-tip="Nhắc tới bạn, tin riêng, trả lời trong thread của bạn" onClick={() => setOpen(!open)}>
        <Icon name="bell" />
        {unread.length > 0 && <span className="inbox-count">{unread.length > 99 ? "99+" : unread.length}</span>}
      </button>
      {open && (
        <div className="inbox-panel" role="dialog" aria-label="Thông báo">
          <div className="inbox-head">
            <span className="mini-tabs inbox-filter" role="tablist">
              <button role="tab" aria-selected={!all} onClick={() => setAll(false)}>Chưa đọc{unread.length ? ` · ${unread.length}` : ""}</button>
              <button role="tab" aria-selected={all} onClick={() => setAll(true)}>Tất cả</button>
            </span>
            <button className="tool-btn inbox-readall" disabled={!unread.length} onClick={() => useApp.setState({ inboxSeen: Date.now(), inboxRead: {} })}>
              <Icon name="check-check" /> Đã đọc hết
            </button>
          </div>
          <div className="inbox-list">
            {shown.length === 0 && <div className="inbox-empty">{all ? "Chưa có gì" : "Không còn gì chưa đọc"}</div>}
            {shown.map((m) => {
              const chat = chats[key(m.accountId, m.chatId)];
              const k = inboxKey(m);
              return (
                <button key={`${k}|${m.ts}`} className={`inbox-row${isNew.has(k) ? " new" : ""}`} onClick={() => {
                  setOpen(false);
                  useApp.setState((s) => ({ inboxRead: { ...s.inboxRead, [k]: true } }));
                  openAt(key(m.accountId, m.chatId), m.id, m.threadReply ? m.threadId : "");
                  useApp.setState({ jumpTo: m.id });
                }}>
                  {m.reacted ? <span className="avatar inbox-emoji">{m.reacted}</span> : <PersonAvatar name={m.senderName} accountId={m.accountId} photo={m.senderPhoto} userId={m.senderId} />}
                  <span className="inbox-main">
                    <span className="inbox-who">
                      <b>{m.reacted ? `Thả ${m.reacted} vào tin của bạn` : m.senderName}</b>
                      {chat && (chat.kind !== "dm" || m.reacted) && <span className="inbox-chat">· {chat.title}</span>}
                      {m.mentionsMe && !m.reacted && <span className="inbox-at">@</span>}
                      {m.threadReply && !m.reacted && <Icon name="message-circle-reply" className="inbox-thread" />}
                    </span>
                    <span className="inbox-text">{plain(m.text) || m.media?.name || "Tệp đính kèm"}</span>
                  </span>
                  <time>{listTime(m.ts)}</time>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
