import { useEffect, useRef, useState } from "react";
import { listTime, plain } from "../lib/format";
import { themeBase } from "../lib/themes";
import { inboxKey, inboxUnread, key, openAt, useApp, openSearch, toggleTheme } from "../store";
import { useShallow } from "zustand/react/shallow";
import { startWizard } from "../views/Wizard";
import { Icon } from "../ui/Icon";
import { PersonAvatar } from "../ui/Avatar";
import { useMobileBack } from "../mobile";
import { isMobile } from "../lib/mobile";

export function Titlebar() {
  const dark = useApp((s) => themeBase(s.prefs.theme) === "dark");

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
        <Notifications />
        <button
          className="tool-btn icon-only lg"
          type="button"
          aria-label={dark ? "Chuyển sang giao diện sáng" : "Chuyển sang giao diện tối"}
          data-tip={dark ? "Giao diện sáng" : "Giao diện tối"}
          onClick={() => toggleTheme()}
        >
          <Icon name={dark ? "sun" : "moon"} />
        </button>
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
export function Notifications() {
  const items = useApp((s) => s.inbox);
  const unread = useApp(useShallow((s) => s.inbox.filter((m) => inboxUnread(s, m)).map(inboxKey)));
  const chats = useApp((s) => s.chats);
  const [open, setOpen] = useState(false);
  const [all, setAll] = useState(false);
  useMobileBack(() => setOpen(false), open);
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
    <div className="bell-menu" ref={box}>
      <button className="tool-btn icon-only lg" type="button" aria-label="Thông báo" aria-expanded={open} data-tip="Nhắc tới bạn, tin riêng, trả lời trong thread của bạn" onClick={() => setOpen(!open)}>
        <Icon name="bell" />
        {unread.length > 0 && <span className="bell-count">{unread.length > 99 ? "99+" : unread.length}</span>}
      </button>
      {open && (
        <div className="bell-panel" role="dialog" aria-label="Thông báo">
          <div className="bell-head">
            {isMobile && <button className="tool-btn icon-only" aria-label="Đóng thông báo" onClick={() => setOpen(false)}><Icon name="chevron-left" /></button>}
            <span className="mini-tabs bell-filter" role="tablist">
              <button role="tab" aria-selected={!all} onClick={() => setAll(false)}>Chưa đọc{unread.length ? ` · ${unread.length}` : ""}</button>
              <button role="tab" aria-selected={all} onClick={() => setAll(true)}>Tất cả</button>
            </span>
            <button className="tool-btn bell-readall" disabled={!unread.length} onClick={() => useApp.setState({ inboxSeen: Date.now(), inboxRead: {} })}>
              <Icon name="check-check" /> Đã đọc hết
            </button>
          </div>
          <div className="bell-list">
            {shown.length === 0 && <div className="bell-empty">{all ? "Chưa có gì" : "Không còn gì chưa đọc"}</div>}
            {shown.map((m) => {
              const chat = chats[key(m.accountId, m.chatId)];
              const k = inboxKey(m);
              return (
                <button key={`${k}|${m.ts}`} className={`bell-row${isNew.has(k) ? " new" : ""}`} onClick={() => {
                  setOpen(false);
                  useApp.setState((s) => ({ inboxRead: { ...s.inboxRead, [k]: true } }));
                  openAt(key(m.accountId, m.chatId), m.id, m.threadReply ? m.threadId : "");
                }}>
                  {m.reacted ? <span className="avatar bell-emoji">{m.reacted}</span> : <PersonAvatar name={m.senderName} accountId={m.accountId} photo={m.senderPhoto} userId={m.senderId} />}
                  <span className="bell-main">
                    <span className="bell-who">
                      <b>{m.reacted ? `Thả ${m.reacted} vào tin của bạn` : m.senderName}</b>
                      {chat && (chat.kind !== "dm" || m.reacted) && <span className="bell-chat">· {chat.title}</span>}
                      {m.mentionsMe && !m.reacted && <span className="bell-at">@</span>}
                      {m.threadReply && !m.reacted && <Icon name="message-circle-reply" className="bell-thread" />}
                    </span>
                    <span className="bell-text">{plain(m.text) || m.media?.name || "Tệp đính kèm"}</span>
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
