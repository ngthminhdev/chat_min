import { memo, useEffect, useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { AnimatePresence, motion, Reorder, useDragControls } from "motion/react";
import { api } from "../lib/bridge";
import { fuzzy, hm, listTime, norm, plain } from "../lib/format";
import { EASE } from "../lib/motion";
import { HEALTH_LABELS, PLATFORMS } from "../lib/platforms";
import type { Account, Chat, Msg } from "../lib/types";
import {
  chatKeyOf, confirmDialog, fail, hideChat, key, loadTopics, openMainTimeline, openMessage, previewTarget, openTopicTab, threadTabKey, loadLatest, markRead, openChat, openThreadTab, orderedAccounts, sortedChats, toast, toggleFavorite,
  totalUnread, useApp, type MenuItem,
} from "../store";
import { ChatAvatar } from "../ui/Avatar";
import { Glyph, Icon } from "../ui/Icon";
import { ZaloContacts } from "./ZaloContacts";
import { TypingIndicator } from "./TypingIndicator";
import { FolderGroups, folderItems, inFolders } from "./Folders";

/** Rows slide only while the user drags. Otherwise collapsing a section makes every
 *  Reorder.Item around it run a layout animation: scale-squished text, siblings jumping. */
function useDragAnim() {
  const [on, setOn] = useState(false);
  // stable identity: groups and rows are memoized on it
  return useMemo(() => ({ transition: { duration: 0.18, ease: EASE, layout: { duration: on ? 0.18 : 0 } }, onDragStart: () => setOn(true), onDragEnd: () => setOn(false) }), [on]);
}

/** Each section shows its most recent chats; the rest on demand. Filtering (Chưa đọc, Nhắc tên)
 *  and searching keep the same bound: mounting every match of a 200-chat list at once froze the
 *  sidebar for several frames. "Xem thêm" reveals more in steps. */
const SECTION_LIMIT = 10;
const FILTER_STEP = 10;

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
  const accDrag = useDragAnim();
  useEffect(() => {
    const off = useApp.subscribe((state, previous) => {
      if (state.active !== previous.active || state.route !== previous.route || state.chats !== previous.chats ||
          state.leftCollapsed !== previous.leftCollapsed || state.pop !== previous.pop || state.dialog !== previous.dialog ||
          state.palette !== previous.palette || state.query !== previous.query || state.filter !== previous.filter || state.collapsed !== previous.collapsed) hoverOff();
    });
    document.addEventListener("scroll", hoverOff, true);
    document.addEventListener("pointerdown", hoverOff, true);
    document.addEventListener("keydown", hoverOff, true);
    document.addEventListener("visibilitychange", hoverOff);
    window.addEventListener("resize", hoverOff);
    window.addEventListener("blur", hoverOff);
    return () => {
      off(); hoverOff();
      document.removeEventListener("scroll", hoverOff, true);
      document.removeEventListener("pointerdown", hoverOff, true);
      document.removeEventListener("keydown", hoverOff, true);
      document.removeEventListener("visibilitychange", hoverOff);
      window.removeEventListener("resize", hoverOff);
      window.removeEventListener("blur", hoverOff);
    };
  }, []);

  return (
    <aside className="sidebar" aria-label="Hội thoại">
      <div className="sidebar-top">
        <div className="side-search-wrap">
          <Icon name="search" />
          <input className="side-search" placeholder="Lọc theo tên hội thoại" title="Lọc theo tên hội thoại. Tìm nội dung tin nhắn: ⌘⇧F" aria-label="Lọc hội thoại" value={query} onChange={(e) => useApp.setState({ query: e.target.value })} />
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
          aria-label="Tất cả hội thoại"
          aria-current={route === "inbox" ? "page" : undefined}
          data-tip="Hội thoại từ tất cả tài khoản, mới nhất trước"
          onClick={() => useApp.setState({ route: "inbox" })}
        >
          <Icon name="inbox" />
          <span>Tất cả hội thoại</span>
          {total > 0 && <span className="badge unread">{total > 999 ? "999+" : total}</span>}
        </button>
        <Favorites />
        <Latest />
        <FolderGroups />
        {accounts.length ? (
          <Reorder.Group axis="y" as="div" values={ordered.map((a) => a.id)} onReorder={(ids) => useApp.setState({ accountOrder: ids })}>
            {ordered.map((a) => (
              <AccountGroup key={a.id} account={a} filter={filter} query={query} drag={accDrag} />
            ))}
          </Reorder.Group>
        ) : (
          <div className="side-empty">
            Chưa có tài khoản nào.
            <br />
            Bấm <Icon name="user-plus" /> để thêm.
          </div>
        )}
      </div>
    </aside>
  );
}

/** What a group needs for its rows. Drafts, typing and the active chat are read by each row
 *  itself, so a keystroke in a draft or a typing indicator re-renders one row, not every group. */
export function useRowState() {
  const expanded = useApp((s) => s.expanded);
  const chatOrder = useApp((s) => s.chatOrder);
  return { expanded, chatOrder };
}

function Favorites() {
  const favorites = useApp((s) => s.favorites);
  const chats = useApp((s) => s.chats);
  const accounts = useApp((s) => s.accounts);
  const filter = useApp((s) => s.filter);
  const q = norm(useApp((s) => s.query));
  const collapsed = useApp((s) => !!s.collapsed["fav"]) && !q;
  const rs = useRowState();
  const dragAnim = useDragAnim();
  const live = favorites.filter((k) => chats[k]);
  if (!live.length) return null;
  const shown = live.filter((k) => {
    const c = chats[k];
    return (!q || fuzzy(q, c.title) > 0) && (filter === "all" || (filter === "unread" ? c.unread > 0 : c.mention));
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
        <span className="acc-name">Ghim</span>
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
                {...dragAnim}
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

/** The ten chats that moved last, whatever the account; pinned ones live in Favorites already. */
function Latest() {
  const favorites = useApp((s) => s.favorites);
  const chats = useApp((s) => s.chats);
  const accounts = useApp((s) => s.accounts);
  const collapsed = useApp((s) => !!s.collapsed["latest"]);
  const filter = useApp((s) => s.filter);
  const q = norm(useApp((s) => s.query));
  const rs = useRowState();
  const rows = useMemo(
    () =>
      Object.entries(chats)
        .filter(([k, c]) => !favorites.includes(k) && c.lastTs > 0)
        .sort((a, b) => b[1].lastTs - a[1].lastTs)
        .slice(0, 10),
    [chats, favorites],
  );
  if (!rows.length) return null;
  const shown = rows.filter(([, c]) => (!q || fuzzy(q, c.title) > 0) && (filter === "all" || (filter === "unread" ? c.unread > 0 : c.mention)));
  const unread = rows.reduce((s, [, c]) => s + (c.muted ? 0 : c.unread), 0);
  return (
    <div className="fav-group latest-group">
      <button
        className={`acc-head fav-head${collapsed ? " collapsed" : ""}`}
        aria-label="Hội thoại mới nhất"
        aria-expanded={!collapsed}
        onClick={() => useApp.setState((s) => ({ collapsed: { ...s.collapsed, latest: !collapsed } }))}
      >
        <Icon name="chevron-down" className="chev" />
        <Icon name="clock" className="fav-ic" />
        <span className="acc-name">Mới nhất</span>
        {unread > 0 && <span className="badge">{unread}</span>}
      </button>
      {!collapsed && (
        <div className="acc-chats">
          {shown.map(([k, c]) => {
            const a = accounts.find((x) => x.id === c.accountId);
            return (
              <div key={k} className="reorder-row" style={{ "--conn": `var(--conn-${a?.color ?? "blue"})` } as React.CSSProperties}>
                <ChatRow chat={c} k={k} platform={a?.platform} {...rowProps(k, c, a, rs)} />
                {rs.expanded[k] && <ThreadPeek k={k} />}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function rowProps(k: string, c: Chat, _a: Account | undefined, rs: ReturnType<typeof useRowState>) {
  return { expanded: !!rs.expanded[k] && c.threaded };
}

const AccountGroup = memo(function AccountGroup({ account: a, filter, query, drag: accDrag }: { account: Account; filter: string; query: string; drag: ReturnType<typeof useDragAnim> }) {
  // only this account's chats: another account's unread badge or preview doesn't re-render it
  const own = useApp(useShallow((s) => Object.values(s.chats).filter((c) => c.accountId === a.id)));
  // typing in the filter opens every group so the matches show; a click still folds it afterwards
  const collapsed = useApp((s) => !!s.collapsed[a.id]) && !norm(query);
  const health = useApp((s) => s.health[a.id]?.health ?? "ok");
  const favorites = useApp((s) => s.favorites);
  const folders = useApp((s) => s.folders);
  const foldered = useMemo(() => inFolders(folders), [folders]);
  const rs = useRowState();
  const drag = useDragControls();
  const rowDrag = useDragAnim();
  /** per section: how many rows beyond the first ten the user asked to see */
  const [extra, setExtra] = useState<Record<string, number>>({});
  const q = norm(query);
  const filtering = !!q || filter !== "all";
  // a new filter/search starts bounded again
  useEffect(() => { setExtra({}); }, [q, filter]);
  const list = useMemo(
    () =>
      sortedChats(Object.fromEntries(own.map((c) => [key(c.accountId, c.id), c])), a.id).filter(
        (c) =>
          !favorites.includes(key(c.accountId, c.id)) && !foldered.has(key(c.accountId, c.id)) &&
          (!q || fuzzy(q, c.title) > 0) &&
          (filter === "all" || (filter === "unread" ? c.unread > 0 : c.mention)),
      ),
    [own, a.id, q, filter, favorites, foldered],
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
      {...accDrag}
    >
      <button
        className="acc-head"
        aria-label={`${a.name} · ${PLATFORMS[a.platform].name}${unread ? ` · ${unread} chưa đọc` : ""}`}
        aria-expanded={!collapsed}
        data-tip={`${PLATFORMS[a.platform].name} · ${a.handle}`}
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
          aria-label="Kéo để đổi chỗ tài khoản"
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
      <AnimatePresence initial={false}>
        {!collapsed && (
          <motion.div className="acc-chats" initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.18, ease: EASE }}>
        {a.platform === "zalo" && <ZaloContacts accountId={a.id} />}
        {loading ? (
          <div className="side-empty"><span className="veil-spinner" /> Đang tải danh sách…</div>
        ) : list.length ? (
          sections(list).map(([sec, label, items]) => {
            const id = `${a.id}:${sec}`;
            const byKey = Object.fromEntries(items.map((c) => [key(c.accountId, c.id), c]));
            const natural = Object.keys(byKey);
            const ordered = applyOrder(natural, rs.chatOrder[id]);
            // unfiltered "Xem thêm" shows the whole section (as before); filtered views grow in steps
            const limit = filtering ? SECTION_LIMIT + (extra[id] ?? 0) : extra[id] ? Infinity : SECTION_LIMIT;
            const shown = ordered.length > limit ? ordered.slice(0, limit) : ordered;
            const full = shown.length === ordered.length;
            const more = ordered.length - shown.length;
            const expandedAll = !filtering && !!extra[id];
            return (
              <Section key={sec} id={id} label={label} chats={items} forceOpen={filtering}>
                {/* one tree in every mode: rows keep their identity when the filter changes (no remount);
                    dragging is off while filtered, since a filtered order isn't the section's order */}
                <Reorder.Group axis="y" as="div" values={shown} onReorder={(v) => { if (!filtering) setOrder(id, full ? v : [...v, ...ordered.slice(shown.length)], natural); }}>
                  {shown.map((k) => (
                    <SidebarItem key={k} k={k} chat={byKey[k]} expanded={!!rs.expanded[k]} drag={rowDrag} draggable={!filtering} />
                  ))}
                </Reorder.Group>
                {(more > 0 || expandedAll) && (
                  <button className="sec-more"
                    aria-label={expandedAll ? `Thu gọn ${label}` : `Xem thêm ${filtering ? Math.min(more, FILTER_STEP) : more} hội thoại trong ${label}`}
                    aria-expanded={expandedAll}
                    data-tip={expandedAll ? `Thu gọn ${label}` : filtering ? `Còn ${more} hội thoại khớp bộ lọc trong ${label}` : `Xem thêm ${more} hội thoại trong ${label}`}
                    onClick={() => setExtra((s) => ({ ...s, [id]: filtering ? (s[id] ?? 0) + FILTER_STEP : s[id] ? 0 : 1 }))}>
                    <span className="sec-more-label">{expandedAll ? "Thu gọn" : `Xem thêm ${filtering ? Math.min(more, FILTER_STEP) : more}`}</span>
                    {!expandedAll && <span className="sec-more-count" aria-hidden="true">{more > 99 ? "99+" : `+${more}`}</span>}
                    <Icon name="chevron-down" className={expandedAll ? "up" : ""} />
                  </button>
                )}
              </Section>
            );
          })
        ) : (
          <div className="side-empty">{q || filter !== "all" ? "Không có hội thoại khớp bộ lọc" : "Chưa có hội thoại"}</div>
        )}
          </motion.div>
        )}
      </AnimatePresence>
    </Reorder.Item>
  );
});

/** One sidebar row in a draggable section: re-renders only when its own chat (or expansion)
 *  changes, so the motion layout measurement stays per row. */
const SidebarItem = memo(function SidebarItem({ k, chat: c, expanded, drag, draggable }: { k: string; chat: Chat; expanded: boolean; drag: ReturnType<typeof useDragAnim>; draggable: boolean }) {
  return (
    <Reorder.Item value={k} as="div" className="reorder-row" dragListener={draggable} whileDrag={{ scale: 1.02, boxShadow: "var(--shadow)", zIndex: 5 }} {...drag}>
      <ChatRow chat={c} k={k} expanded={expanded && c.threaded} />
      {expanded && (c.threaded || c.forum) && <ThreadPeek k={k} />}
    </Reorder.Item>
  );
});

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

export function chatMenu(k: string, c: Chat, mobile = false): MenuItem[] {
  const fav = useApp.getState().favorites.includes(k);
  const items: (MenuItem | false)[] = [
    !mobile && { icon: "external-link", label: "Mở trong tab", run: () => void openChat(k) },
    (c.threaded || c.forum || !!previewTarget(c)) && { icon: "messages-square", label: "Mở hội thoại chính", run: () => void openMainTimeline(k) },
    { icon: fav ? "pin-off" : "pin", label: fav ? "Bỏ ghim khỏi đầu danh sách" : "Ghim lên đầu danh sách", run: () => toggleFavorite(k) },
    !mobile && (c.threaded || !!c.forum) && {
      icon: "message-circle-reply",
      label: useApp.getState().expanded[k] ? "Ẩn" : c.forum ? "Xem nhanh chủ đề" : "Xem nhanh luồng trả lời",
      run: () => useApp.setState((s) => ({ expanded: { ...s.expanded, [k]: !s.expanded[k] } })),
    },
    (c.unread > 0 || c.mention) && { icon: "check-check", label: "Đánh dấu đã đọc", run: () => markRead(k) },
    {
      icon: c.muted ? "bell" : "bell-off",
      label: c.muted ? "Bật thông báo" : "Tắt thông báo",
      run: () => {
        useApp.setState((s) => ({ chats: { ...s.chats, [k]: { ...c, muted: !c.muted } } }));
        api.setMuted(c.accountId, c.id, !c.muted).catch(fail);
      },
    },
    !mobile && { icon: "copy", label: "Sao chép ID chat", run: () => void navigator.clipboard.writeText(c.id).then(() => toast("Đã sao chép ID")) },
    ...(mobile ? [] : folderItems(k)),
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
let hoverCandidate: { el: HTMLElement; x: number; y: number } | null = null;
function hoverOn(k: string, el: HTMLElement, x: number, y: number) {
  if (useApp.getState().hoverPeek?.k === k) return;
  if (hoverCandidate?.el === el && Math.hypot(x - hoverCandidate.x, y - hoverCandidate.y) < 6) return;
  clearTimeout(hoverT);
  hoverCandidate = { el, x, y };
  const before = el.getBoundingClientRect();
  hoverT = setTimeout(() => {
    const r = el.getBoundingClientRect();
    const state = useApp.getState();
    if (!el.isConnected || !el.matches(":hover") || document.hidden || !document.hasFocus() ||
        Math.abs(r.top - before.top) > 1 || Math.abs(r.left - before.left) > 1 || state.route !== "shell" ||
        state.leftCollapsed || state.pop || state.dialog || state.palette) return;
    useApp.setState({ hoverPeek: { k, x: r.right + 8, y: r.top } });
    if (!useApp.getState().msgs[k]) void loadLatest(k);
  }, 500);
}
function hoverOff() {
  clearTimeout(hoverT);
  hoverCandidate = null;
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
  expanded: boolean;
  platform?: Account["platform"];
}

export const ChatRow = memo(function ChatRow({ chat: c, k, expanded, platform }: RowProps) {
  const rail = useApp((s) => s.leftCollapsed);
  // each row reads its own live bits: one draft keystroke / typing event re-renders one row
  const active = useApp((s) => s.route === "shell" && chatKeyOf(s.active) === k);
  const draft = useApp((s) => (active ? "" : s.drafts[k] ?? ""));
  const typing = useApp((s) => {
    const t = s.typing[k];
    return t?.until && s.accounts.find((a) => a.id === c.accountId)?.platform === "telegram" ? t.who || " " : "";
  });
  const unreadBefore = useRef(c.unread);
  const [pulse, setPulse] = useState(0);
  useEffect(() => {
    if (c.unread > unreadBefore.current) setPulse(c.unread);
    unreadBefore.current = c.unread;
  }, [c.unread]);
  // where the previewed message lives: "↳ thread" (Google Chat reply) / "# topic" (Telegram forum)
  const fallbackContext = useApp((s) => c.previewKind === "topic" && !c.previewContext
    ? s.topics[k]?.find((t) => t.id === c.previewThread)?.name ?? s.threadTabs[`thread:${k}:${c.previewThread}`]?.title ?? ""
    : c.previewKind === "reply" && !c.previewContext ? s.threadTabs[`thread:${k}:${c.previewThread}`]?.title ?? "" : "");
  const context = c.previewKind === "reply" ? `↳ ${c.previewContext || fallbackContext || "Luồng trả lời"}`
    : c.previewKind === "topic" ? `# ${c.previewContext || fallbackContext || "Chủ đề"}` : "";
  const from = (c.previewFrom && c.kind !== "dm") || c.previewFrom === "Bạn" ? `${c.previewFrom}: ` : "";
  let preview: React.ReactNode = context
    ? <><span className="preview-context">{context}</span><span className="preview-sep" aria-hidden="true"> · </span>{from}{c.preview}</>
    : from ? `${from}${c.preview}` : c.preview || "Chưa có tin nhắn";
  // drafts and typing take the line: the row then opens the chat as usual
  const showsMessage = !draft.trim() && !typing;
  if (draft.trim()) preview = <><span className="draft-label">Nháp:</span> {draft}</>;
  else if (typing) preview = <span className="typing-label"><TypingIndicator compact label={`${c.kind === "dm" || !typing.trim() ? "" : `${typing.split(" ")[0]} `}đang gõ`} /></span>;
  const target = showsMessage ? previewTarget(c) : null;
  return (
    <div className={`chat-row-wrap${expanded ? " expanded" : ""}`}>
      <button
        className={`chat-row${active ? " active" : ""}${c.unread ? " unread" : ""}`}
        data-account-id={c.accountId}
        data-chat-id={c.id}
        data-message-id={target?.id}
        data-thread-id={target?.threadId || undefined}
        data-preview-kind={target ? c.previewKind : undefined}
        aria-label={`${c.title}${c.unread ? `, ${c.unread} chưa đọc` : ""}${typing && !draft.trim() ? ", đang gõ" : ""}${target && context ? `, tin mới nhất trong ${c.previewKind === "topic" ? "chủ đề" : "luồng"} ${context.slice(2)}` : ""}`}
        data-tip={rail ? `${c.title}${c.unread ? ` · ${c.unread} chưa đọc` : ""}` : undefined}
        onClick={() => {
          hoverOff();
          // the preview names a message (thread reply, topic, threaded timeline): land on it
          if (target) return void openMessage(target);
          // the chat already on screen: a click means "take me to the newest message"
          if (active) useApp.setState((s) => ({ toLatest: s.toLatest + 1 }));
          void openChat(k);
        }}
        onPointerMove={(e) => e.pointerType !== "touch" && !active && !rail && hoverOn(k, e.currentTarget, e.clientX, e.clientY)}
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
            {/* CSS fade on state change: a motion component per row made mounting a filtered list cost ~1 ms/row */}
            <span className="preview"><span className="preview-state" key={draft.trim() ? "draft" : typing ? "typing" : "message"}>{preview}</span></span>
            {c.mention && <Icon name="at-sign" className="mention-ic" />}
            {c.unread > 0 && (
              <span key={c.unread} className={`badge ${c.muted ? "idle" : "unread"}${pulse === c.unread ? " pop" : ""}`}>
                {c.unread > 99 ? "99+" : c.unread}
              </span>
            )}
          </span>
        </span>
      </button>
      {(c.threaded || c.forum) && (
        <button
          className={`row-expand${expanded ? " on" : ""}`}
          aria-label={expanded ? "Ẩn" : c.forum ? "Xem nhanh chủ đề" : "Xem nhanh luồng trả lời"}
          aria-expanded={expanded}
          data-tip={expanded ? "Ẩn" : c.forum ? "Xem nhanh chủ đề" : "Xem nhanh luồng trả lời"}
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
        <div className="peek-row muted">Nhóm chưa có chủ đề</div>
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
        <div className="peek-row muted">Chưa có luồng trả lời trong phần đã tải</div>
      )}
    </motion.div>
  );
}
