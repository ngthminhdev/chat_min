import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { dayKey, dayLabel, fmtCount, hm, plain } from "../lib/format";
import type { Msg } from "../lib/types";
import { capsOf, healthOf, loadLatest, loadOlder, splitKey, toast, useApp } from "../store";
import { api } from "../lib/bridge";
import { startWizard } from "../views/Wizard";
import { ChatAvatar, PersonAvatar } from "../ui/Avatar";
import { Icon } from "../ui/Icon";
import { Composer } from "./Composer";
import { MessageItem, openThread } from "./Message";
import { langLabel, toggleAutoTranslate, translateMissing } from "../ai";

const HEALTH_MSG: Record<string, string> = {
  offline: "Account đang offline. Nháp vẫn được giữ trên máy.",
  reconnecting: "Đang kết nối lại. Tin nhắn sẽ khả dụng khi có kết nối.",
  expired: "Phiên đăng nhập đã hết hạn.",
  rate: "Gửi quá nhanh. Thử lại sau",
};

export function Conversation() {
  const active = useApp((s) => s.active);
  const chat = useApp((s) => (s.active ? s.chats[s.active] : undefined));
  const health = useApp((s) => (chat ? s.health[chat.accountId] : undefined));
  const platform = useApp((s) => s.accounts.find((a) => a.id === chat?.accountId)?.platform);
  const view = useApp((s) => (s.active ? s.convTab[s.active] : undefined)) ?? "msgs";
  const auto = useApp((s) => (s.active ? !!s.trAuto[s.active] : false));
  const aiMe = useApp((s) => s.prefs.aiMe);
  const threadCount = useApp((s) => (s.active && chat?.threaded ? new Set((s.msgs[s.active] ?? []).filter((m) => m.threadReply).map((m) => m.threadId)).size : 0));
  const [, tick] = useState(0);

  // rate-limit countdown
  useEffect(() => {
    if (health?.health !== "rate") return;
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [health?.health]);

  if (!active || !chat) {
    return (
      <div className="content empty">
        <div className="conv-empty">
          <span className="ring"><Icon name="messages-square" /></span>
          <strong>Không có hội thoại nào đang mở</strong>
          <p>
            Chọn một chat ở sidebar, hoặc nhấn <kbd className="kbd">⌘K</kbd> để nhảy tới chat bất kỳ.
          </p>
          <button className="tool-btn primary" onClick={() => useApp.setState({ palette: { mode: "chats" } })}>
            <Icon name="search" /> Mở hội thoại
          </button>
        </div>
      </div>
    );
  }
  const h = healthOf(chat.accountId).health;
  const banner = HEALTH_MSG[h];
  const sub =
    chat.kind === "dm"
      ? chat.accountId.startsWith("gc-") ? "tin nhắn trực tiếp" : "chat riêng"
      : `${chat.kind === "space" ? "space" : chat.kind === "channel" ? "kênh" : "nhóm"}${chat.memberCount ? ` · ${fmtCount(chat.memberCount)} thành viên` : ""}`;
  const left = health?.until ? Math.max(0, Math.ceil((health.until - Date.now()) / 1000)) : 0;

  return (
    <div className={`content${banner ? " with-health" : ""}`}>
      <div className="conv-head">
        <ChatAvatar chat={chat} platform={platform} />
        <div className="title">
          <strong>{chat.title}</strong>
          <span>{sub}</span>
        </div>
        {chat.threaded && (
          <div className="mini-tabs conv-tabs" role="tablist" aria-label="Chế độ xem">
            {([["msgs", "Tin nhắn"], ["threads", "Threads"]] as const).map(([v, l]) => (
              <button
                key={v}
                role="tab"
                aria-selected={view === v}
                className={view === v ? "active" : ""}
                onClick={() => useApp.setState((s) => ({ convTab: { ...s.convTab, [active]: v } }))}
              >
                {l}
                {v === "threads" && threadCount > 0 && <small>{threadCount}</small>}
              </button>
            ))}
          </div>
        )}
        <button
          className={`tool-btn icon-only${auto ? " active" : ""}`}
          aria-label="Dịch cả chat"
          aria-pressed={auto}
          data-tip={auto ? "Tắt dịch cả chat" : `Dịch cả chat sang ${langLabel(aiMe)}`}
          onClick={() => toggleAutoTranslate(active)}
        >
          <Icon name="languages" />
        </button>
        <button
          className="tool-btn icon-only"
          aria-label="Tìm trong chat này"
          data-tip="Tìm trong chat này"
          data-kbd="⌘F"
          onClick={() => useApp.setState({ palette: { mode: "msgs", scope: active } })}
        >
          <Icon name="search" />
        </button>
        {capsOf(active).pin && (
          <button
            className="tool-btn icon-only"
            aria-label="Tin đã ghim"
            data-tip="Tin đã ghim"
            onClick={() => useApp.setState({ inspTab: "pinned", rightCollapsed: false })}
          >
            <Icon name="pin" />
          </button>
        )}
        <button
          className="tool-btn icon-only"
          aria-label="Thông tin chat"
          data-tip="Thông tin chat"
          data-kbd="⌘I"
          onClick={() => useApp.setState((s) => ({ rightCollapsed: !s.rightCollapsed }))}
        >
          <Icon name="info" />
        </button>
        {banner && (
          <div className={`health-banner ${h}`} role="status">
            <Icon name={h === "offline" ? "wifi-off" : "circle-alert"} />
            <span>
              {banner}
              {h === "rate" && <b> {left}s</b>}
            </span>
            {h === "expired" && (
              <button className="tool-btn" onClick={() => startWizard(chat.accountId)}>
                Đăng nhập lại
              </button>
            )}
          </div>
        )}
      </div>
      {chat.threaded && view === "threads" ? <ThreadList k={active} key={`t-${active}`} /> : <MessageList k={active} key={active} />}
      <Composer k={active} key={`c-${active}`} />
    </div>
  );
}

function MessageList({ k }: { k: string }) {
  const list = useApp((s) => s.msgs[k]);
  const chat = useApp((s) => s.chats[k]);
  const older = useApp((s) => s.older[k]);
  const err = useApp((s) => s.loadErr[k]);
  const mark = useApp((s) => s.unreadMark[k]);
  const typing = useApp((s) => s.typing[k]);
  const fresh = useApp((s) => s.fresh);
  const threadTabs = useApp((s) => s.tabs);
  const jumpTo = useApp((s) => s.jumpTo);
  const caps = capsOf(k);
  const box = useRef<HTMLDivElement>(null);
  const prevHeight = useRef(0);
  const prevFirst = useRef<string | undefined>(undefined);
  const stick = useRef(true);
  const [below, setBelow] = useState(0);
  const auto = useApp((s) => !!s.trAuto[k]);

  // threaded spaces show thread starters with their replies folded underneath; a thread
  // whose starter isn't loaded (older page, deleted) is led by its earliest reply instead
  const { visible, replies } = useMemo(() => {
    const all = list ?? [];
    const r: Record<string, Msg[]> = {};
    if (!chat?.threaded) return { visible: all, replies: r };
    const led = new Set(all.filter((m) => !m.threadReply).map((m) => m.threadId));
    const vis: Msg[] = [];
    for (const m of all) {
      if (!m.threadReply || !m.threadId) vis.push(m);
      else if (!led.has(m.threadId)) {
        led.add(m.threadId);
        vis.push(m);
      } else (r[m.threadId] ??= []).push(m);
    }
    return { visible: vis, replies: r };
  }, [list, chat?.threaded]);

  useEffect(() => {
    if (auto) void translateMissing(k, visible);
  }, [auto, k, visible.length, visible[visible.length - 1]?.id]);

  // keep the reading position: stick to the bottom for new messages, hold still when
  // older pages are prepended above
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const first = visible[0]?.id;
    if (prevFirst.current && first !== prevFirst.current && el.scrollHeight > prevHeight.current && !stick.current) {
      el.scrollTop += el.scrollHeight - prevHeight.current;
    } else if (stick.current) {
      el.scrollTop = el.scrollHeight;
    } else {
      setBelow((n) => n + 1);
    }
    prevFirst.current = first;
    prevHeight.current = el.scrollHeight;
  }, [visible.length, visible[visible.length - 1]?.id]);

  useEffect(() => {
    if (!jumpTo) return;
    const el = document.getElementById(`m-${jumpTo}`);
    if (el) {
      el.scrollIntoView({ block: "center", behavior: "smooth" });
      el.classList.remove("flash");
      void el.offsetWidth;
      el.classList.add("flash");
      useApp.setState({ jumpTo: null });
    } else if (list && older !== "done" && older !== "loading") {
      void loadOlder(k);
    } else if (older === "done") {
      toast("Không tìm thấy tin nhắn trong lịch sử đã tải", "info");
      useApp.setState({ jumpTo: null });
    }
  }, [jumpTo, list, older, k]);

  const onScroll = () => {
    const el = box.current!;
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (stick.current && below) setBelow(0);
    if (el.scrollTop < 200) {
      prevHeight.current = el.scrollHeight;
      void loadOlder(k);
    }
  };

  const toBottom = () => {
    box.current?.scrollTo({ top: box.current.scrollHeight, behavior: "smooth" });
    setBelow(0);
  };

  let body: React.ReactNode;
  if (!list) {
    body = (
      <div className="section-veil on" role="status">
        <span className="veil-spinner" />
        <span>Đang tải tin nhắn…</span>
      </div>
    );
  } else if (!visible.length) {
    body = err ? (
      <div className="conv-empty">
        <span className="ring"><Icon name="wifi-off" /></span>
        <strong>Không tải được tin nhắn</strong>
        <p>{err}</p>
        <button className="tool-btn" onClick={() => void loadLatest(k)}>
          <Icon name="rotate-cw" />
          Thử lại
        </button>
      </div>
    ) : (
      <div className="conv-empty">
        <span className="ring"><Icon name="message-square-text" /></span>
        <strong>Chưa có tin nhắn với {chat?.title}</strong>
        <p>Đây là đầu cuộc trò chuyện. Gửi lời chào đầu tiên. Nháp được lưu riêng cho tab này.</p>
      </div>
    );
  } else {
    body = (
      <>
        {older === "loading" && <div className="older-loading"><span className="veil-spinner" /></div>}
        {older === "done" && <div className="history-start">Đầu cuộc trò chuyện</div>}
        {visible.map((m, i) => {
          const prev = visible[i - 1];
          const next = visible[i + 1];
          const newDay = !prev || dayKey(prev.ts) !== dayKey(m.ts);
          const group = (a?: Msg, b?: Msg) =>
            !!a && !!b && a.kind !== "service" && b.kind !== "service" && a.senderId === b.senderId && a.outgoing === b.outgoing && Math.abs(a.ts - b.ts) < 5 * 60e3 && dayKey(a.ts) === dayKey(b.ts);
          const showUnread = mark && m.sort === mark.sort;
          return (
            <Fragment key={m.id}>
              {newDay && (
                <div className="day-sep" role="separator">
                  <span>{dayLabel(m.ts)}</span>
                </div>
              )}
              {showUnread && (
                <div className="unread-sep" role="separator">
                  <span>{mark.count} tin chưa đọc</span>
                </div>
              )}
              <MessageItem
                k={k}
                m={m}
                chat={chat!}
                caps={caps}
                first={!group(prev, m) || !!showUnread || newDay}
                last={!group(m, next)}
                fresh={!!fresh[m.id]}
                replies={m.threadId ? replies[m.threadId] : undefined}
                threadOpen={!!m.threadId && threadTabs.includes(`thread:${m.threadId}`)}
              />
            </Fragment>
          );
        })}
        <AnimatePresence>
          {caps.typing && typing?.until ? (
            <motion.div className="typing" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
              <PersonAvatar name={typing.who || chat?.title || "?"} size="sm" accountId={chat?.accountId} photo={chat?.kind === "dm" ? chat.photo || chat.photoRef : ""} />
              <span className="dots" aria-hidden="true"><i /><i /><i /></span>
              <span>{typing.who || chat?.title} đang gõ…</span>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </>
    );
  }

  return (
    <div className="msgs" ref={box} onScroll={onScroll} aria-live="polite">
      <div className="msgs-inner">{body}</div>
      <AnimatePresence>
        {below > 0 && (
          <motion.button
            className="jump-bottom"
            initial={{ opacity: 0, y: 8, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.9 }}
            onClick={toBottom}
            aria-label="Tới tin mới nhất"
          >
            <Icon name="arrow-down" />
            {below} tin mới
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  );
}

/** Google Chat space as a list of threads, most recently active first. */
function ThreadList({ k }: { k: string }) {
  const list = useApp((s) => s.msgs[k]);
  const tabs = useApp((s) => s.tabs);
  const rows = useMemo(() => {
    const roots = (list ?? []).filter((m) => !m.threadReply && m.threadId && !m.deleted && m.kind !== "service");
    const replies: Record<string, Msg[]> = {};
    for (const m of list ?? []) if (m.threadReply) (replies[m.threadId] ??= []).push(m);
    return roots
      .map((r) => ({ root: r, replies: replies[r.threadId] ?? [], last: Math.max(r.ts, ...(replies[r.threadId] ?? []).map((x) => x.ts)) }))
      .sort((a, b) => b.last - a.last);
  }, [list]);
  if (!list) return <div className="msgs"><div className="section-veil on"><span className="veil-spinner" /></div></div>;
  return (
    <div className="msgs">
      <div className="msgs-inner thread-list">
        {rows.length ? (
          rows.map(({ root, replies, last }) => {
            const faces = [...new Map(replies.map((r) => [r.senderName, r])).values()].slice(0, 3);
            return (
              <button key={root.id} className={`thread-row${tabs.includes(`thread:${root.threadId}`) ? " open" : ""}`} onClick={() => openThread(k, root)}>
                <PersonAvatar name={root.senderName} accountId={root.accountId} photo={root.senderPhoto} />
                <span style={{ minWidth: 0 }}>
                  <span className="hd">
                    <b>{root.outgoing ? "Bạn" : root.senderName}</b>
                    <time>{dayLabel(root.ts).split(" · ")[0]} {hm(root.ts)}</time>
                  </span>
                  <span className="tx">{plain(root.text) || root.media?.name}</span>
                  <span className="meta">
                    {replies.length ? (
                      <>
                        <span className="faces">
                          {faces.map((f) => <PersonAvatar key={f.senderName} name={f.senderName} accountId={f.accountId} photo={f.senderPhoto} />)}
                        </span>
                        {replies.length} trả lời
                        <small>lần cuối {hm(last)}</small>
                      </>
                    ) : (
                      <small>Chưa có trả lời</small>
                    )}
                  </span>
                </span>
                <Icon name="chevron-right" className="count" />
              </button>
            );
          })
        ) : (
          <div className="conv-empty">
            <span className="ring"><Icon name="message-circle-reply" /></span>
            <strong>Chưa có thread nào trong phần đã tải</strong>
            <p>Thread bắt đầu khi ai đó trả lời một tin trong space.</p>
          </div>
        )}
      </div>
    </div>
  );
}

export function useDownload(accountId: string, media: { fileRef: string; name: string; localPath: string } | null, auto: boolean) {
  const [path, setPath] = useState(media?.localPath ?? "");
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");
  const get = async () => {
    if (!media?.fileRef || state === "loading") return path;
    setState("loading");
    try {
      const p = await api.download(accountId, media.fileRef, media.name);
      setPath(p);
      setState("idle");
      return p;
    } catch {
      setState("error");
      return "";
    }
  };
  useEffect(() => {
    if (auto && !path && media?.fileRef) void get();
  }, [auto, media?.fileRef]);
  return { path, state, get };
}

export const accountIdOf = (k: string) => splitKey(k)[0];
