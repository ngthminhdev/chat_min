import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { dayKey, dayLabel, fmtCount } from "../lib/format";
import type { Msg } from "../lib/types";
import { capsOf, healthOf, loadLatest, loadOlder, markRead, splitKey, threadTabKey, threadUnread, toast, useApp, openSearch } from "../store";
import { api, openUrl } from "../lib/bridge";
import { startWizard } from "../views/Wizard";
import { ChatAvatar, PersonAvatar } from "../ui/Avatar";
import { Icon } from "../ui/Icon";
import { Composer } from "./Composer";
import { MessageItem } from "./Message";
import { SummaryButton, SummaryCard } from "./Summary";
import { useStickyScroll } from "./useStickyScroll";
import { useMessageArrivals } from "./useMessageArrivals";
import { messageRenderKey } from "../lib/message-identity";
import { TypingIndicator } from "./TypingIndicator";
import { DelayedLoading } from "./DelayedLoading";
import { langLabel, toggleAutoTranslate, translateMissing } from "../ai";
import { isMobile } from "../lib/mobile";
import { showMobileList } from "../mobile";
import { MobileActions } from "../ui/MobileActions";

const HEALTH_MSG: Record<string, string> = {
  offline: "Tài khoản đang mất kết nối. Nháp vẫn được giữ trên máy.",
  reconnecting: "Đang kết nối lại. Tin nhắn sẽ khả dụng khi có kết nối.",
  expired: "Phiên đăng nhập đã hết hạn.",
  rate: "Gửi quá nhanh. Thử lại sau",
};

export function Conversation() {
  const active = useApp((s) => s.active);
  const chat = useApp((s) => (s.active ? s.chats[s.active] : undefined));
  const health = useApp((s) => (chat ? s.health[chat.accountId] : undefined));
  const platform = useApp((s) => s.accounts.find((a) => a.id === chat?.accountId)?.platform);
  const accountName = useApp((s) => s.accounts.find((a) => a.id === chat?.accountId)?.name);
  const insp = useApp((s) => s.inspTab);
  const rightOff = useApp((s) => s.rightCollapsed);
  const threadCount = useApp((s) => (s.active && chat?.threaded ? new Set((s.msgs[s.active] ?? []).filter((m) => m.threadReply).map((m) => m.threadId)).size : 0));
  // replies I haven't caught up on, across this chat's threads (same rule as "· N mới")
  const threadNew = useApp((s) => {
    if (!s.active || !chat?.threaded) return 0;
    const byThread: Record<string, Msg[]> = {};
    for (const m of s.msgs[s.active] ?? []) if (m.threadReply) (byThread[m.threadId] ??= []).push(m);
    return Object.entries(byThread).reduce((n, [t, rs]) => n + threadUnread(s, s.active!, t, rs), 0);
  });
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
            {isMobile ? "Chọn hội thoại để xem và gửi tin nhắn." : <>Chọn một chat ở sidebar, hoặc nhấn <kbd className="kbd">⌘K</kbd> để nhảy tới chat bất kỳ.</>}
          </p>
          <button className="tool-btn primary" onClick={() => isMobile ? showMobileList() : useApp.setState({ palette: { mode: "chats" } })}>
            <Icon name="search" /> Mở hội thoại
          </button>
        </div>
      </div>
    );
  }
  if (chat.kind === "web") return <WebConversation chatKey={active} />;
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
        <button className="tool-btn icon-only conv-back" type="button" aria-label="Danh sách hội thoại" onClick={() => isMobile ? showMobileList() : useApp.setState({ leftCollapsed: false })}>
          <Icon name="chevron-left" />
        </button>
        <ChatAvatar chat={chat} platform={platform} />
        <div className="title">
          <strong>{chat.title}</strong>
          <span>{isMobile ? `${accountName} · ${sub}` : sub}</span>
        </div>
        <div className="conv-actions" role="group" aria-label="Thao tác hội thoại">
        <MobileActions label="Thao tác hội thoại">
        {(chat.threaded || chat.forum) && (
          <button
            className={`tool-btn conv-threads${insp === "threads" && !rightOff ? " active" : ""}${threadNew ? " has-new" : ""}`}
            aria-label={chat.forum ? "Chủ đề" : "Luồng trả lời"}
            aria-pressed={insp === "threads" && !rightOff}
            data-tip={chat.forum ? "Xem các chủ đề" : "Xem các luồng trả lời"}
            onClick={() => useApp.setState({ inspTab: "threads", rightCollapsed: false })}
          >
            <Icon name="message-circle-reply" />
            {chat.forum ? "Chủ đề" : "Luồng trả lời"}
            {!chat.forum && threadCount > 0 && <small>{threadCount}</small>}
            {threadNew > 0 && <b className="thread-new">{threadNew} mới</b>}
          </button>
        )}
        <SummaryButton tab={active} />
        <TranslateAllButton autoKey={active} />
        <button
          className="tool-btn icon-only"
          aria-label="Tìm trong chat này"
          data-tip="Tìm trong chat này"
          data-kbd="⌘F"
          onClick={() => openSearch(active)}
        >
          <Icon name="search" />
        </button>
        {capsOf(active).pin && (
          <button
            className={`tool-btn icon-only${insp === "pinned" && !rightOff ? " active" : ""}`}
            aria-label="Tin đã ghim"
            aria-pressed={insp === "pinned" && !rightOff}
            data-tip="Tin đã ghim"
            onClick={() => useApp.setState({ inspTab: "pinned", rightCollapsed: false })}
          >
            <Icon name="pin" />
          </button>
        )}
        <button
          className={`tool-btn icon-only${!rightOff ? " active" : ""}`}
          aria-label="Thông tin chat"
          aria-expanded={!rightOff}
          data-tip="Thông tin chat"
          data-kbd="⌘R"
          onClick={() => useApp.setState((s) => ({ rightCollapsed: !s.rightCollapsed, inspTab: "info" }))}
        >
          <Icon name="info" />
        </button>
        </MobileActions>
        </div>
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
      <SummaryCard tab={active} />
      <MessageList k={active} key={active} />
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
  const arrival = useMessageArrivals(list, fresh);

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

  useViewportTranslate(box, k, k, visible);

  const lastVisible = visible[visible.length - 1];
  const scroll = useStickyScroll(box, lastVisible ? messageRenderKey(lastVisible) : undefined, () => void loadOlder(k));
  // back at the newest message: what arrived meanwhile is now seen
  const onScroll = () => {
    scroll.onScroll();
    const bottom = scroll.stick.current;
    if (bottom !== useApp.getState().atBottom) {
      useApp.setState({ atBottom: bottom });
      const c = useApp.getState().chats[k];
      if (bottom && (c?.unread || c?.mention)) markRead(k);
    }
  };
  useEffect(() => () => useApp.setState({ atBottom: true }), [k]);

  useEffect(() => {
    if (!jumpTo) return;
    const el = document.getElementById(`m-${jumpTo}`);
    if (el) {
      scroll.toMessage(el);
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

  let body: React.ReactNode;
  if (!list) {
    body = (
      <DelayedLoading label="Đang tải tin nhắn…" />
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
            <Fragment key={messageRenderKey(m)}>
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
                fresh={arrival(m)}
                replies={m.threadId ? replies[m.threadId] : undefined}
                threadOpen={!!m.threadId && threadTabs.includes(threadTabKey(k, m.threadId))}
              />
            </Fragment>
          );
        })}
        <AnimatePresence>
          {caps.typing && typing?.until ? (
            <motion.div className="typing" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
              <PersonAvatar name={typing.who || chat?.title || "?"} size="sm" accountId={chat?.accountId} photo={chat?.kind === "dm" ? chat.photo || chat.photoRef : ""} />
              <TypingIndicator label={`${typing.who || chat?.title} đang gõ`} />
            </motion.div>
          ) : null}
        </AnimatePresence>
      </>
    );
  }

  return (
    <div className="msgs" ref={box} onScroll={onScroll} aria-live="polite">
      <div className="msgs-inner">{body}</div>
      <JumpBottom away={scroll.away} fresh={scroll.fresh} onClick={scroll.toBottom} />
    </div>
  );
}

/** Google Chat space as a list of threads, most recently active first. */
/** Messenger / Zalo: the site's own web app in a native webview laid over this box. */
function WebConversation({ chatKey }: { chatKey: string }) {
  const chat = useApp((s) => s.chats[chatKey]);
  const platform = useApp((s) => s.accounts.find((a) => a.id === chat?.accountId)?.platform);
  const account = useApp((s) => s.accounts.find((a) => a.id === chat?.accountId));
  // the webview is native and always on top: step aside while an overlay is up
  const covered = useApp((s) => !!(s.palette || s.pop || s.dialog || s.viewer));
  const host = useRef<HTMLDivElement>(null);
  const id = chat?.accountId ?? "";
  useEffect(() => {
    const el = host.current;
    if (!el || !id || isMobile) return;
    if (covered) {
      void api.webHide(id);
      return;
    }
    const place = () => {
      const r = el.getBoundingClientRect();
      void api.webShow(id, { x: r.left, y: r.top, w: r.width, h: r.height }).catch((e) => toast(String(e), "circle-alert"));
    };
    place();
    const ro = new ResizeObserver(place);
    ro.observe(el);
    window.addEventListener("resize", place);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", place);
      void api.webHide(id);
    };
  }, [id, covered]);
  if (!chat) return null;
  // phone: no child webview in Tauri Android — hand the site to the system (its app, if installed)
  if (isMobile) return (
    <div className="content empty">
      <div className="conv-empty">
        <span className="ring"><Icon name="external-link" /></span>
        <strong>{chat.title} mở bằng ứng dụng riêng</strong>
        <p>Trên điện thoại, {account?.name ?? chat.title} dùng app hoặc trình duyệt của máy. Tin nhắn không hiện trong ChatMin.</p>
        <button className="tool-btn primary" onClick={() => void openUrl(chat.description)}><Icon name="external-link" /> Mở {chat.title}</button>
        <button className="tool-btn" onClick={showMobileList}><Icon name="chevron-left" /> Về danh sách</button>
      </div>
    </div>
  );
  return (
    <div className="content web-content">
      <div className="conv-head">
        <button className="tool-btn icon-only conv-back" type="button" aria-label="Danh sách hội thoại" onClick={() => useApp.setState({ leftCollapsed: false })}>
          <Icon name="chevron-left" />
        </button>
        <ChatAvatar chat={chat} platform={platform} />
        <div className="title">
          <strong>{account?.name ?? chat.title}</strong>
          <span>{chat.description.replace(/^https:\/\//, "").replace(/\/$/, "")} · đăng nhập ngay trong khung bên dưới</span>
        </div>
        <button className="tool-btn icon-only" aria-label="Tải lại" data-tip="Tải lại trang" onClick={() => void api.webReload(id)}>
          <Icon name="rotate-cw" />
        </button>
      </div>
      <div className="web-host" ref={host}>
        <span className="veil-spinner" /> Đang mở {chat.title}…
      </div>
    </div>
  );
}

/** Floating "↓" — whenever scrolled away from the bottom, with a count of arrivals. */
export function JumpBottom({ away, fresh, onClick }: { away: boolean; fresh: number; onClick: () => void }) {
  return (
    <AnimatePresence>
      {(away || fresh > 0) && (
        <motion.button
          className={`jump-bottom${fresh ? " has-new" : ""}`}
          initial={{ opacity: 0, y: 8, scale: 0.9 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 8, scale: 0.9 }}
          onClick={onClick}
          aria-label="Xuống tin mới nhất"
          data-tip="Xuống tin mới nhất"
        >
          <Icon name="arrow-down" />
          {fresh > 0 && <span>{fresh} tin mới</span>}
        </motion.button>
      )}
    </AnimatePresence>
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
  const pct = useApp((s) => (media ? s.progress[`${accountId}|${media.fileRef}`] : undefined));
  // the cached localPath can be outside the asset scope after a restart (a file I sent from
  // Desktop) or gone: fetch it again once through `download`, which opens the scope
  const retried = useRef(false);
  const broken = () => {
    if (retried.current || !media?.fileRef) return;
    retried.current = true;
    setPath("");
    void get();
  };
  return { path, state, get, broken, pct: state === "loading" ? pct : undefined };
}

export const accountIdOf = (k: string) => splitKey(k)[0];

export function TranslateAllButton({ autoKey, chatKey = autoKey, msgs }: { autoKey: string; chatKey?: string; msgs?: Msg[] }) {
  const auto = useApp((s) => !!s.trAuto[autoKey]);
  const aiMe = useApp((s) => s.prefs.aiMe);
  return (
    <button
      className={`tool-btn icon-only${auto ? " active" : ""}`}
      aria-label="Dịch cả chat"
      aria-pressed={auto}
      data-tip={auto ? "Tắt dịch cả chat" : `Dịch cả chat sang ${langLabel(aiMe)}`}
      onClick={() => toggleAutoTranslate(autoKey, chatKey, msgs)}
    >
      <Icon name="languages" />
    </button>
  );
}

/** Whole-chat translation spends tokens only on what's read: the messages on screen ±5,
 *  more as the list scrolls (debounced) or grows. */
export function useViewportTranslate(box: React.RefObject<HTMLDivElement | null>, autoKey: string, chatKey: string, list: Msg[]) {
  const on = useApp((s) => !!s.trAuto[autoKey]);
  useEffect(() => {
    const el = box.current;
    if (!on || !el) return;
    let t = 0;
    const run = () => {
      clearTimeout(t);
      t = window.setTimeout(() => {
        const { top, bottom } = el.getBoundingClientRect();
        let lo = -1, hi = -1;
        list.forEach((m, i) => {
          const r = document.getElementById(`m-${m.id}`)?.getBoundingClientRect();
          if (r && r.bottom > top && r.top < bottom) {
            if (lo < 0) lo = i;
            hi = i;
          }
        });
        if (lo >= 0) void translateMissing(chatKey, list.slice(Math.max(0, lo - 5), hi + 6), autoKey);
      }, 250);
    };
    run();
    el.addEventListener("scroll", run, { passive: true });
    return () => {
      clearTimeout(t);
      el.removeEventListener("scroll", run);
    };
  }, [on, box, autoKey, chatKey, list]);
}
