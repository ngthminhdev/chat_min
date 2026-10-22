import { memo, useEffect, useMemo } from "react";
import { AnimatePresence, motion, Reorder, useDragControls } from "motion/react";
import { api } from "../lib/bridge";
import { hm, listTime, norm, plain } from "../lib/format";
import { EASE } from "../lib/motion";
import { HEALTH_LABELS, PLATFORMS } from "../lib/platforms";
import type { Account, Chat, Msg } from "../lib/types";
import {
  chatKeyOf, fail, key, loadLatest, markRead, openChat, openThreadTab, orderedAccounts, sortedChats, toast, toggleFavorite,
  totalUnread, useApp, type MenuItem,
} from "../store";
import { ChatAvatar } from "../ui/Avatar";
import { Glyph, Icon } from "../ui/Icon";

const FILTERS = [["all", "Tất cả"], ["unread", "Chưa đọc"], ["mention", "@ Nhắc tên"]] as const;

/** Sidebar tree: Ghim (cross-account, drag to reorder) → accounts (drag by handle) → kinds → chats → recent threads. */
export function Sidebar() {
  const accounts = useApp((s) => s.accounts);
  const order = useApp((s) => s.accountOrder);
  const chats = useApp((s) => s.chats);
  const filter = useApp((s) => s.filter);
  const query = useApp((s) => s.query);
  const route = useApp((s) => s.route);
  const total = totalUnread(chats);
  const ordered = orderedAccounts(accounts, order);

  return (
    <aside className="sidebar" aria-label="Hội thoại">
      <div className="sidebar-top">
        <div className="side-search-wrap">
          <Icon name="search" />
          <input className="side-search" placeholder="Lọc hội thoại" aria-label="Lọc hội thoại" value={query} onChange={(e) => useApp.setState({ query: e.target.value })} />
        </div>
      </div>
      <div className="mini-tabs" role="tablist" aria-label="Bộ lọc">
        {FILTERS.map(([k, l]) => (
          <button key={k} role="tab" aria-selected={filter === k} className={filter === k ? "active" : ""} onClick={() => useApp.setState({ filter: k })}>
            {l}
          </button>
        ))}
      </div>
      <div className="side-scroll">
        <button
          className={`nav-item all-inbox${route === "inbox" ? " active" : ""}`}
          aria-current={route === "inbox" ? "page" : undefined}
          data-tip="Unified inbox — gộp mọi account theo thời gian"
          onClick={() => useApp.setState({ route: "inbox" })}
        >
          <Icon name="inbox" />
          <span>All inboxes</span>
          {total > 0 && <span className="badge unread">{total > 999 ? "999+" : total}</span>}
        </button>
        <Favorites />
        {accounts.length ? (
          <Reorder.Group axis="y" as="div" values={ordered.map((a) => a.id)} onReorder={(ids) => useApp.setState({ accountOrder: ids })}>
            {ordered.map((a, i) => (
              <AccountGroup key={a.id} account={a} index={i} chats={chats} filter={filter} query={query} />
            ))}
          </Reorder.Group>
        ) : (
          <div className="side-empty">
            Chưa có account nào.
            <br />
            Bấm <Icon name="user-plus" /> để thêm.
          </div>
        )}
      </div>
    </aside>
  );
}

function useRowState() {
  const active = useApp((s) => (s.route === "shell" ? chatKeyOf(s.active) : null));
  const drafts = useApp((s) => s.drafts);
  const typing = useApp((s) => s.typing);
  const expanded = useApp((s) => s.expanded);
  return { active, drafts, typing, expanded };
}

function Favorites() {
  const favorites = useApp((s) => s.favorites);
  const chats = useApp((s) => s.chats);
  const accounts = useApp((s) => s.accounts);
  const collapsed = useApp((s) => !!s.collapsed["fav"]);
  const filter = useApp((s) => s.filter);
  const q = norm(useApp((s) => s.query));
  const rs = useRowState();
  const live = favorites.filter((k) => chats[k]);
  if (!live.length) return null;
  const shown = live.filter((k) => {
    const c = chats[k];
    return (!q || norm(c.title).includes(q)) && (filter === "all" || (filter === "unread" ? c.unread > 0 : c.mention));
  });
  const unread = live.reduce((s, k) => s + (chats[k].muted ? 0 : chats[k].unread), 0);
  return (
    <div className="fav-group">
      <button
        className={`acc-head fav-head${collapsed ? " collapsed" : ""}`}
        aria-expanded={!collapsed}
        onClick={() => useApp.setState((s) => ({ collapsed: { ...s.collapsed, fav: !collapsed } }))}
      >
        <Icon name="chevron-down" className="chev" />
        <Icon name="pin" className="fav-ic" />
        <span className="acc-name">Ghim<small>kéo để đổi thứ tự · mọi account</small></span>
        {unread > 0 && <span className="badge">{unread}</span>}
      </button>
      {!collapsed && (
        <Reorder.Group axis="y" as="div" className="acc-chats" values={live} onReorder={(v) => useApp.setState({ favorites: v })}>
          {shown.map((k) => {
            const c = chats[k];
            const a = accounts.find((x) => x.id === c.accountId);
            return (
              <Reorder.Item
                key={k}
                value={k}
                as="div"
                className="reorder-row"
                whileDrag={{ scale: 1.02, boxShadow: "var(--shadow)", zIndex: 5 }}
                transition={{ duration: 0.18, ease: EASE }}
                style={{ "--conn": `var(--conn-${a?.color ?? "blue"})` } as React.CSSProperties}
              >
                <ChatRow chat={c} k={k} platform={a?.platform} {...rowProps(k, c, a, rs)} />
                {rs.expanded[k] && <ThreadPeek k={k} />}
              </Reorder.Item>
            );
          })}
        </Reorder.Group>
      )}
    </div>
  );
}

function rowProps(k: string, c: Chat, a: Account | undefined, rs: ReturnType<typeof useRowState>) {
  const t = rs.typing[k];
  return {
    active: k === rs.active,
    draft: k !== rs.active ? rs.drafts[k] ?? "" : "",
    typing: a?.platform === "telegram" && t?.until ? t.who || " " : "",
    expanded: !!rs.expanded[k] && c.threaded,
  };
}

function AccountGroup({ account: a, index, chats, filter, query }: { account: Account; index: number; chats: Record<string, Chat>; filter: string; query: string }) {
  const collapsed = useApp((s) => !!s.collapsed[a.id]);
  const health = useApp((s) => s.health[a.id]?.health ?? "ok");
  const favorites = useApp((s) => s.favorites);
  const rs = useRowState();
  const drag = useDragControls();
  const q = norm(query);
  const list = useMemo(
    () =>
      sortedChats(chats, a.id).filter(
        (c) =>
          !favorites.includes(key(c.accountId, c.id)) &&
          (!q || norm(c.title).includes(q)) &&
          (filter === "all" || (filter === "unread" ? c.unread > 0 : c.mention)),
      ),
    [chats, a.id, q, filter, favorites],
  );
  const unread = list.filter((c) => !c.muted).reduce((s, c) => s + c.unread, 0);
  const loading = !list.length && !q && filter === "all" && (health === "reconnecting" || health === "syncing");

  return (
    <Reorder.Item
      value={a.id}
      as="div"
      dragListener={false}
      dragControls={drag}
      className={`acc-group${collapsed ? " collapsed" : ""}`}
      style={{ "--conn": `var(--conn-${a.color})` } as React.CSSProperties}
      whileDrag={{ scale: 1.01, boxShadow: "var(--shadow)", zIndex: 5 }}
    >
      <button
        className="acc-head"
        aria-expanded={!collapsed}
        data-tip={`${PLATFORMS[a.platform].name} · ${a.handle}`}
        data-kbd={index < 9 ? `⌘${index + 1}` : undefined}
        onClick={() => useApp.setState((s) => ({ collapsed: { ...s.collapsed, [a.id]: !collapsed } }))}
      >
        <Icon name="chevron-down" className="chev" />
        <span className="conn-dot" />
        <Glyph platform={a.platform} />
        <span className="acc-name">
          {a.name}
          <small>{PLATFORMS[a.platform].name}</small>
        </span>
        {health !== "ok" && health !== "syncing" ? (
          <span className={`account-health ${health}`} title={HEALTH_LABELS[health]}>
            <i />
            <span>{HEALTH_LABELS[health]}</span>
          </span>
        ) : unread > 0 ? (
          <span className="badge">{unread}</span>
        ) : null}
        <span
          className="grip"
          aria-label="Kéo để đổi chỗ account"
          data-tip="Kéo để đổi chỗ"
          onPointerDown={(e) => {
            e.preventDefault();
            drag.start(e);
          }}
          onClick={(e) => e.stopPropagation()}
        >
          ⋮⋮
        </span>
      </button>
      <div className="acc-chats">
        {loading ? (
          <div className="side-empty"><span className="veil-spinner" /> Đang tải danh sách…</div>
        ) : list.length ? (
          sections(list).map(([sec, label, items]) => (
            <Section key={sec} id={`${a.id}:${sec}`} label={label} chats={items} forceOpen={!!q || filter !== "all"}>
              {items.map((c) => {
                const k = key(c.accountId, c.id);
                return (
                  <div key={k}>
                    <ChatRow chat={c} k={k} {...rowProps(k, c, a, rs)} />
                    {rs.expanded[k] && c.threaded && <ThreadPeek k={k} />}
                  </div>
                );
              })}
            </Section>
          ))
        ) : (
          <div className="side-empty">{q || filter !== "all" ? "Không có hội thoại khớp bộ lọc" : "Chưa có hội thoại"}</div>
        )}
      </div>
    </Reorder.Item>
  );
}

// Level 2 of the tree: chats of one account split by kind; platform-pinned chats keep their own shelf.
const SECTIONS: [string, string, (c: Chat) => boolean][] = [
  ["pinned", "Đã ghim trên nền tảng", (c) => c.pinned],
  ["dm", "Tin nhắn riêng", (c) => c.kind === "dm"],
  ["group", "Nhóm", (c) => c.kind === "group"],
  ["space", "Space", (c) => c.kind === "space"],
  ["channel", "Kênh", (c) => c.kind === "channel"],
];

function sections(list: Chat[]): [string, string, Chat[]][] {
  return SECTIONS.map(([id, label, match]) => [id, label, list.filter((c) => (id === "pinned" ? match(c) : !c.pinned && match(c)))] as [string, string, Chat[]]).filter(
    ([, , chats]) => chats.length,
  );
}

function Section({ id, label, chats, forceOpen, children }: { id: string; label: string; chats: Chat[]; forceOpen: boolean; children: React.ReactNode }) {
  const collapsed = useApp((s) => !!s.collapsed[id]) && !forceOpen;
  const unread = chats.filter((c) => !c.muted).reduce((s, c) => s + c.unread, 0);
  return (
    <>
      <button
        className={`sec-head${collapsed ? " collapsed" : ""}`}
        aria-expanded={!collapsed}
        onClick={() => useApp.setState((s) => ({ collapsed: { ...s.collapsed, [id]: !s.collapsed[id] } }))}
      >
        <Icon name="chevron-down" className="chev" />
        <span>{label}</span>
        <span className="sec-count">{unread > 0 && collapsed ? <span className="badge unread">{unread > 999 ? "999+" : unread}</span> : chats.length}</span>
      </button>
      <AnimatePresence initial={false}>
        {!collapsed && (
          <motion.div
            className="sec-body"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18, ease: EASE }}
          >
            {children}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

function chatMenu(k: string, c: Chat): MenuItem[] {
  const fav = useApp.getState().favorites.includes(k);
  const items: (MenuItem | false)[] = [
    { icon: "external-link", label: "Mở trong tab", run: () => void openChat(k) },
    { icon: fav ? "pin-off" : "pin", label: fav ? "Bỏ ghim khỏi đầu danh sách" : "Ghim lên đầu danh sách", run: () => toggleFavorite(k) },
    c.threaded && {
      icon: "message-circle-reply",
      label: useApp.getState().expanded[k] ? "Ẩn thread" : "Xem nhanh thread",
      run: () => useApp.setState((s) => ({ expanded: { ...s.expanded, [k]: !s.expanded[k] } })),
    },
    c.unread > 0 && { icon: "check-check", label: "Đánh dấu đã đọc", run: () => markRead(k) },
    {
      icon: c.muted ? "bell" : "bell-off",
      label: c.muted ? "Bật thông báo" : "Tắt thông báo",
      run: () => {
        useApp.setState((s) => ({ chats: { ...s.chats, [k]: { ...c, muted: !c.muted } } }));
        api.setMuted(c.accountId, c.id, !c.muted).catch(fail);
      },
    },
    { icon: "copy", label: "Sao chép ID chat", run: () => void navigator.clipboard.writeText(c.id).then(() => toast("Đã sao chép ID")) },
  ];
  return items.filter(Boolean) as MenuItem[];
}

interface RowProps {
  chat: Chat;
  k: string;
  active: boolean;
  draft: string;
  typing: string;
  expanded: boolean;
  platform?: Account["platform"];
}

const ChatRow = memo(function ChatRow({ chat: c, k, active, draft, typing, expanded, platform }: RowProps) {
  let preview: React.ReactNode =
    (c.previewFrom && c.kind !== "dm") || c.previewFrom === "Bạn" ? `${c.previewFrom}: ${c.preview}` : c.preview || "Chưa có tin nhắn";
  if (draft.trim()) preview = <><span className="draft-label">Nháp:</span> {draft}</>;
  else if (typing) preview = <span className="typing-label">{c.kind === "dm" || !typing.trim() ? "" : `${typing.split(" ")[0]} `}đang gõ…</span>;
  return (
    <div className={`chat-row-wrap${expanded ? " expanded" : ""}`}>
      <button
        className={`chat-row${active ? " active" : ""}${c.unread ? " unread" : ""}`}
        aria-label={`${c.title}${c.unread ? `, ${c.unread} chưa đọc` : ""}`}
        onClick={() => void openChat(k)}
        onContextMenu={(e) => {
          e.preventDefault();
          useApp.setState({ pop: { kind: "menu", x: e.clientX, y: e.clientY, top: e.clientY, items: chatMenu(k, c) } });
        }}
      >
        <ChatAvatar chat={c} platform={platform} />
        <span className="od-stack" style={{ "--od-gap": "2px" } as React.CSSProperties}>
          <span className="line">
            <span className="name">{c.title || "…"}</span>
            {c.pinned && <Icon name="pin" className="muted-ic" />}
            {c.muted && <Icon name="bell-off" className="muted-ic" />}
            <span className="time">{listTime(c.lastTs)}</span>
          </span>
          <span className="line">
            <span className="preview">{preview}</span>
            {c.mention && <Icon name="at-sign" className="mention-ic" />}
            {c.unread > 0 && (
              <span key={c.unread} className={`badge ${c.muted ? "idle" : "unread"} pop`}>
                {c.unread > 99 ? "99+" : c.unread}
              </span>
            )}
          </span>
        </span>
      </button>
      {c.threaded && (
        <button
          className={`row-expand${expanded ? " on" : ""}`}
          aria-label={expanded ? "Ẩn thread" : "Xem nhanh thread"}
          aria-expanded={expanded}
          data-tip={expanded ? "Ẩn thread" : "Xem nhanh thread"}
          onClick={() => useApp.setState((s) => ({ expanded: { ...s.expanded, [k]: !expanded } }))}
        >
          <Icon name="message-circle-reply" />
        </button>
      )}
    </div>
  );
});

/** Level 3: the space's most recently active threads, one click to open as a tab. */
function ThreadPeek({ k }: { k: string }) {
  const list = useApp((s) => s.msgs[k]);
  const tabs = useApp((s) => s.tabs);
  useEffect(() => {
    if (!list) void loadLatest(k);
  }, [k, !!list]);
  const threads = useMemo(() => {
    const replies: Record<string, Msg[]> = {};
    for (const m of list ?? []) if (m.threadReply) (replies[m.threadId] ??= []).push(m);
    return (list ?? [])
      .filter((m) => !m.threadReply && m.threadId && !m.deleted && m.kind !== "service")
      .map((root) => {
        const r = replies[root.threadId] ?? [];
        return { root, count: r.length, last: Math.max(root.ts, ...r.map((x) => x.ts)) };
      })
      .sort((a, b) => b.last - a.last)
      .slice(0, 6);
  }, [list]);
  return (
    <motion.div className="thread-peek" initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} transition={{ duration: 0.18, ease: EASE }}>
      {!list ? (
        <div className="peek-row muted"><span className="veil-spinner" /> Đang tải…</div>
      ) : threads.length ? (
        threads.map(({ root, count, last }) => (
          <button
            key={root.id}
            className={`peek-row${tabs.includes(`thread:${root.threadId}`) ? " open" : ""}`}
            onClick={() => openThreadTab(k, root)}
            title={plain(root.text)}
          >
            <span className="peek-text">
              <b>{root.outgoing ? "Bạn" : root.senderName.split(" ")[0]}:</b> {plain(root.text) || root.media?.name}
            </span>
            <span className="peek-meta">
              {count > 0 && <span className="peek-count">{count}</span>}
              {hm(last)}
            </span>
          </button>
        ))
      ) : (
        <div className="peek-row muted">Chưa có thread trong phần đã tải</div>
      )}
    </motion.div>
  );
}
