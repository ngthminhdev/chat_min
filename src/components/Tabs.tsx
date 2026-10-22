import { useEffect, useRef } from "react";
import { AnimatePresence, motion } from "motion/react";
import { closeTab, openChat, useApp } from "../store";
import { Icon } from "../ui/Icon";

const PAGE_TABS = { inbox: ["inbox", "Tất cả hội thoại"], settings: ["settings", "Cài đặt"], search: ["search", "Tìm tin nhắn"] } as const;

export function Tabs() {
  const tabs = useApp((s) => s.tabs);
  const active = useApp((s) => s.active);
  const route = useApp((s) => s.route);
  const chats = useApp((s) => s.chats);
  const accounts = useApp((s) => s.accounts);
  const drafts = useApp((s) => s.drafts);
  const threadTabs = useApp((s) => s.threadTabs);
  const strip = useRef<HTMLElement>(null);
  const page = route === "inbox" || route === "settings" || route === "search" ? PAGE_TABS[route] : null;

  useEffect(() => {
    strip.current?.querySelector(".tab.active")?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [active, route, tabs.length]);

  return (
    <nav className="tabs" ref={strip} aria-label="Hội thoại đang mở" role="tablist">
      <AnimatePresence initial={false}>
        {tabs.map((k) => {
          const meta = threadTabs[k];
          const c = chats[meta ? meta.chatKey : k];
          if (!c) return null;
          const a = accounts.find((x) => x.id === c.accountId);
          const on = !page && k === active;
          const dot = (!meta && c.unread > 0 && !on) || !!drafts[k]?.trim();
          const why = drafts[k]?.trim() ? "có nháp chưa gửi" : "có tin chưa đọc";
          return (
            <motion.div
              key={k}
              layout="position"
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, transition: { duration: 0.12 } }}
              className={`tab${on ? " active" : ""}`}
              role="tab"
              tabIndex={0}
              aria-selected={on}
              style={{ "--conn": `var(--conn-${a?.color ?? "blue"})` } as React.CSSProperties}
              onClick={() => void openChat(k)}
              onAuxClick={(e) => e.button === 1 && closeTab(k)}
              onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), void openChat(k))}
            >
              <span className="conn-dot" aria-hidden="true" />
              {meta && <Icon name="message-circle-reply" className="tab-kind" />}
              {dot && <span className="tab-dirty-dot" role="img" aria-label={why} data-tip={why} />}
              <span className="tab-title">{meta ? meta.title : c.title}</span>
              <span className="tab-conn">{meta ? `#${c.title}` : a?.name}</span>
              <button
                className="tab-close"
                aria-label={`Đóng tab ${c.title}`}
                data-tip="Đóng tab"
                data-kbd="⌘W"
                onClick={(e) => {
                  e.stopPropagation();
                  closeTab(k);
                }}
              >
                ×
              </button>
            </motion.div>
          );
        })}
        {page && (
          <motion.div
            key="page"
            layout="position"
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, transition: { duration: 0.1 } }}
            className="tab active page-tab"
            role="tab"
            tabIndex={0}
            aria-selected
          >
            <Icon name={page[0]} />
            <span className="tab-title">{page[1]}</span>
            <button className="tab-close" aria-label={`Đóng ${page[1]}`} data-tip="Đóng" data-kbd="⌘W" onClick={() => useApp.setState({ route: "shell" })}>
              ×
            </button>
          </motion.div>
        )}
      </AnimatePresence>
      <button className="tab-add" data-tip="Mở chat" data-kbd="⌘K" onClick={() => useApp.setState({ palette: { mode: "chats" } })}>
        <Icon name="plus" />
        Chat
      </button>
    </nav>
  );
}
