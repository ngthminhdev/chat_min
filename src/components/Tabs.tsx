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
  const focusTab = (target: string) => requestAnimationFrame(() => {
    const el = [...(strip.current?.querySelectorAll<HTMLElement>('[role="tab"]') ?? [])].find(node => node.dataset.tabKey === target);
    el?.focus({ preventScroll: true });
    el?.scrollIntoView({ block: "nearest", inline: "nearest" });
  });
  const close = (k: string) => {
    const row = [...(strip.current?.querySelectorAll<HTMLElement>('[role="tab"]') ?? [])].find(node => node.dataset.tabKey === k);
    const restore = !!row?.contains(document.activeElement);
    const index = tabs.indexOf(k);
    const rest = tabs.filter(tab => tab !== k);
    closeTab(k);
    if (restore) {
      const next = page ? "page" : rest[Math.min(index, rest.length - 1)];
      if (next) focusTab(next);
      else requestAnimationFrame(() => strip.current?.querySelector<HTMLButtonElement>(".tab-add")?.focus());
    }
  };

  useEffect(() => {
    strip.current?.querySelector(".tab.active")?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [active, route, tabs.length]);

  return (
    <nav className="tabs" ref={strip} aria-label="Hội thoại đang mở" role="tablist" onKeyDown={e => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key) || e.altKey || e.metaKey || e.ctrlKey) return;
      const items = [...(strip.current?.querySelectorAll<HTMLElement>('[role="tab"]') ?? [])]
        .filter(node => node.dataset.tabKey === "page" ? !!page : tabs.includes(node.dataset.tabKey ?? ""));
      const index = items.findIndex(node => node.contains(e.target as Node));
      if (index < 0 || !items.length) return;
      e.preventDefault(); e.stopPropagation();
      const next = e.key === "Home" ? 0 : e.key === "End" ? items.length - 1 : (index + (e.key === "ArrowRight" ? 1 : -1) + items.length) % items.length;
      const target = items[next].dataset.tabKey!;
      if (target !== "page") void openChat(target);
      focusTab(target);
    }}>
      <AnimatePresence initial={false}>
        {tabs.map((k, index) => {
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
              tabIndex={on ? 0 : -1}
              data-tab-key={k}
              data-tip={meta ? meta.title : c.title}
              data-kbd={index < 8 ? `⌘${index + 1}` : index === tabs.length - 1 ? "⌘9" : undefined}
              aria-selected={on}
              style={{ "--conn": `var(--conn-${a?.color ?? "blue"})` } as React.CSSProperties}
              onClick={() => void openChat(k)}
              onAuxClick={(e) => e.button === 1 && close(k)}
              onKeyDown={(e) => {
                if (e.target !== e.currentTarget) return;
                if (e.key === "Enter" || e.key === " ") { e.preventDefault(); void openChat(k); focusTab(k); }
                if (e.key === "Delete") { e.preventDefault(); close(k); }
              }}
            >
              <span className="conn-dot" aria-hidden="true" />
              {meta && <Icon name="message-circle-reply" className="tab-kind" />}
              {dot && <span className="tab-dirty-dot" role="img" aria-label={why} data-tip={why} />}
              <span className="tab-title">{meta ? meta.title : c.title}</span>
              <span className="tab-conn">{meta ? `#${c.title}` : a?.name}</span>
              <button
                className="tab-close"
                tabIndex={on ? 0 : -1}
                aria-label={`Đóng tab ${c.title}`}
                data-tip="Đóng tab"
                data-kbd="⌘W"
                onClick={(e) => {
                  e.stopPropagation();
                  close(k);
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
            data-tab-key="page"
            aria-selected
          >
            <Icon name={page[0]} />
            <span className="tab-title">{page[1]}</span>
            <button className="tab-close" aria-label={`Đóng ${page[1]}`} data-tip="Đóng" data-kbd="⌘W" onClick={() => {
              useApp.setState({ route: "shell" });
              if (active) focusTab(active);
              else requestAnimationFrame(() => strip.current?.querySelector<HTMLButtonElement>(".tab-add")?.focus());
            }}>
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
