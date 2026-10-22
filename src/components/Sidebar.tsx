import { memo, useEffect, useMemo } from "react";
import { AnimatePresence, motion, Reorder, useDragControls } from "motion/react";
import { api } from "../lib/bridge";
import { hm, listTime, norm, plain } from "../lib/format";
import { EASE } from "../lib/motion";
import { HEALTH_LABELS, PLATFORMS } from "../lib/platforms";
import type { Account, Chat, Msg } from "../lib/types";
import {
  chatKeyOf, confirmDialog, fail, hideChat, key, loadTopics, openTopicTab, threadTabKey, loadLatest, markRead, openChat, openThreadTab, orderedAccounts, sortedChats, toast, toggleFavorite,
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
          aria-label="All inboxes"
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
  const chatOrder = useApp((s) => s.chatOrder);
  return { active, drafts, typing, expanded, chatOrder };
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
        aria-label="Hội thoại đã ghim"
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
        aria-label={`${a.name} · ${PLATFORMS[a.platform].name}${unread ? ` · ${unread} chưa đọc` : ""}`}
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
          sections(list).map(([sec, label, items]) => {
            const id = `${a.id}:${sec}`;
            const byKey = Object.fromEntries(items.map((c) => [key(c.accountId, c.id), c]));
            const natural = Object.keys(byKey);
            const shown = applyOrder(natural, rs.chatOrder[id]);
            return (
              <Section key={sec} id={id} label={label} chats={items} forceOpen={!!q || filter !== "all"}>
                <Reorder.Group axis="y" as="div" values={shown} onReorder={(v) => setOrder(id, v, natural)}>
                  {shown.map((k) => {
                    const c = byKey[k];
                    return (
                      <Reorder.Item key={k} value={k} as="div" className="reorder-row" whileDrag={{ scale: 1.02, boxShadow: "var(--shadow)", zIndex: 5 }} transition={{ duration: 0.18, ease: EASE }}>
                        <ChatRow chat={c} k={k} {...rowProps(k, c, a, rs)} />
                        {rs.expanded[k] && (c.threaded || c.forum) && <ThreadPeek k={k} />}
                      </Reorder.Item>
                    );
                  })}
                </Reorder.Group>
              </Section>
            );
          })
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
  ["web", "Ứng dụng web", (c) => c.kind === "web"],
];

/** Manually placed chats first (in their saved order), then the rest by activity. */
function applyOrder(natural: string[], saved: string[] | undefined): string[] {
  if (!saved?.length) return natural;
  const fixed = saved.filter((k) => natural.includes(k));
  return [...fixed, ...natural.filter((k) => !fixed.includes(k))];
}

/** Keep only the prefix the user actually rearranged, so chats below keep sorting by activity. */
function setOrder(id: string, v: string[], natural: string[]) {
  let last = -1;
  for (let i = 0; i < v.length; i++) if (v[i] !== natural[i]) last = i;
  useApp.setState((s) => ({ chatOrder: { ...s.chatOrder, [id]: v.slice(0, last + 1) } }));
}

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
    (c.threaded || !!c.forum) && {
      icon: "message-circle-reply",
      label: useApp.getState().expanded[k] ? "Ẩn" : c.forum ? "Xem nhanh topic" : "Xem nhanh thread",
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
    ...unfixItem(k),
    ...removeItems(k, c),
  ];
  return items.filter(Boolean) as MenuItem[];
}

function unfixItem(k: string): MenuItem[] {
  const order = useApp.getState().chatOrder;
  const id = Object.keys(order).find((sec) => order[sec].includes(k));
  if (!id) return [];
  return [{
    icon: "refresh-cw",
    label: "Bỏ cố định vị trí",
    run: () => useApp.setState((s) => ({ chatOrder: { ...s.chatOrder, [id]: s.chatOrder[id].filter((x) => x !== k) } })),
  }];
}

function removeItems(k: string, c: Chat): MenuItem[] {
  const platform = useApp.getState().accounts.find((a) => a.id === c.accountId)?.platform;
  const name = c.title || "chat này";
  if (platform !== "telegram") {
    return [{
      icon: "x",
      label: "Ẩn khỏi ChatMin",
      run: () => {
        hideChat(k);
        toast(`Đã ẩn “${name}” — sẽ hiện lại khi có tin mới`, "info");
      },
    }];
  }
  const del = (title: string, message: string, ok: string, revoke: boolean) => () =>
    confirmDialog(title, message, ok, () =>
      api.deleteChat(c.accountId, c.id, revoke).then(() => toast(`Đã xoá “${name}”`)).catch(fail),
    );
  if (c.kind === "dm") {
    return [
      { icon: "trash-2", label: "Xoá chat…", danger: true, run: del(`Xoá chat với “${name}”?`, "Lịch sử bị xoá ở phía bạn. Người kia vẫn giữ tin nhắn.", "Xoá chat", false) },
      { icon: "trash-2", label: "Xoá cả hai phía…", danger: true, run: del(`Xoá chat với “${name}” cho cả hai bên?`, "Toàn bộ tin nhắn bị xoá ở cả hai phía. Không hoàn tác được.", "Xoá cả hai phía", true) },
    ];
  }
  const what = c.kind === "channel" ? "kênh" : "nhóm";
  return [{
    icon: "trash-2",
    label: `Rời ${what}…`,
    danger: true,
    run: del(`Rời ${what} “${name}”?`, `Bạn sẽ không nhận tin từ ${what} này nữa và nó biến khỏi danh sách chat.`, `Rời ${what}`, false),
  }];
}

// hover preview: rest on a row ~0.5s → the last messages of that chat beside the sidebar
let hoverT: ReturnType<typeof setTimeout> | undefined;
function hoverOn(k: string, el: HTMLElement) {
  clearTimeout(hoverT);
  hoverT = setTimeout(() => {
    const r = el.getBoundingClientRect();
    useApp.setState({ hoverPeek: { k, x: r.right + 8, y: r.top } });
    if (!useApp.getState().msgs[k]) void loadLatest(k);
  }, 500);
}
function hoverOff() {
  clearTimeout(hoverT);
  if (useApp.getState().hoverPeek) useApp.setState({ hoverPeek: null });
}

/** The floating card itself; rendered once by the sidebar. */
export function HoverPeek() {
  const peek = useApp((s) => s.hoverPeek);
  const chat = useApp((s) => (peek ? s.chats[peek.k] : undefined));
  const list = useApp((s) => (peek ? s.msgs[peek.k] : undefined));
  const last = (list ?? []).filter((m) => !m.deleted && m.kind !== "service" && !m.threadReply).slice(-5);
  const top = peek ? Math.min(peek.y, window.innerHeight - 340) : 0;
  return (
    <AnimatePresence>
      {peek && chat && (
        <motion.div
          className="hover-peek"
          style={{ left: peek.x, top: Math.max(8, top) }}
          initial={{ opacity: 0, x: -6 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, transition: { duration: 0.08 } }}
          transition={{ duration: 0.14, ease: EASE }}
          aria-hidden="true"
        >
          <header>
            <strong>{chat.title}</strong>
            {chat.unread > 0 && <span className={`badge ${chat.muted ? "idle" : "unread"}`}>{chat.unread}</span>}
          </header>
          {!list ? (
            <div className="hp-row muted"><span className="veil-spinner" /> Đang tải…</div>
          ) : last.length ? (
            last.map((m) => (
              <div key={m.id} className={`hp-row${m.outgoing ? " me" : ""}`}>
                <b>{m.outgoing ? "Bạn" : m.senderName.split(" ").slice(-1)[0]}</b>
                <span>{plain(m.text) || m.media?.name || "Tệp đính kèm"}</span>
                <time>{hm(m.ts)}</time>
              </div>
            ))
          ) : (
            <div className="hp-row muted">Chưa có tin nhắn</div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
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
  const rail = useApp((s) => s.leftCollapsed);
  let preview: React.ReactNode =
    (c.previewFrom && c.kind !== "dm") || c.previewFrom === "Bạn" ? `${c.previewFrom}: ${c.preview}` : c.preview || "Chưa có tin nhắn";
  if (draft.trim()) preview = <><span className="draft-label">Nháp:</span> {draft}</>;
  else if (typing) preview = <span className="typing-label">{c.kind === "dm" || !typing.trim() ? "" : `${typing.split(" ")[0]} `}đang gõ…</span>;
  return (
    <div className={`chat-row-wrap${expanded ? " expanded" : ""}`}>
      <button
        className={`chat-row${active ? " active" : ""}${c.unread ? " unread" : ""}`}
        aria-label={`${c.title}${c.unread ? `, ${c.unread} chưa đọc` : ""}`}
        data-tip={rail ? `${c.title}${c.unread ? ` · ${c.unread} chưa đọc` : ""}` : undefined}
        onClick={() => {
          hoverOff();
          void openChat(k);
        }}
        onMouseEnter={(e) => !active && !rail && hoverOn(k, e.currentTarget)}
        onMouseLeave={hoverOff}
        onContextMenu={(e) => {
          e.preventDefault();
          hoverOff();
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
      {(c.threaded || c.forum) && (
        <button
          className={`row-expand${expanded ? " on" : ""}`}
          aria-label={expanded ? "Ẩn" : c.forum ? "Xem nhanh topic" : "Xem nhanh thread"}
          aria-expanded={expanded}
          data-tip={expanded ? "Ẩn" : c.forum ? "Xem nhanh topic" : "Xem nhanh thread"}
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
  return useApp((s) => s.chats[k]?.forum) ? <TopicPeek k={k} /> : <GchatThreadPeek k={k} />;
}

function TopicPeek({ k }: { k: string }) {
  const topics = useApp((s) => s.topics[k]);
  const tabs = useApp((s) => s.tabs);
  useEffect(() => {
    void loadTopics(k);
  }, [k]);
  return (
    <motion.div className="thread-peek" initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} transition={{ duration: 0.18, ease: EASE }}>
      {!topics ? (
        <div className="peek-row muted"><span className="veil-spinner" /> Đang tải…</div>
      ) : topics.length ? (
        topics.slice(0, 8).map((t) => (
          <button key={t.id} className={`peek-row${tabs.includes(threadTabKey(k, t.id)) ? " open" : ""}`} onClick={() => openTopicTab(k, t)} title={t.name}>
            <span className="peek-text"><b># {t.name}</b> {t.preview}</span>
            <span className="peek-meta">
              {t.unread > 0 && <span className="peek-count">{t.unread}</span>}
              {listTime(t.lastTs)}
            </span>
          </button>
        ))
      ) : (
        <div className="peek-row muted">Nhóm chưa có topic</div>
      )}
    </motion.div>
  );
}

function GchatThreadPeek({ k }: { k: string }) {
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
            className={`peek-row${tabs.includes(threadTabKey(k, root.threadId)) ? " open" : ""}`}
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
