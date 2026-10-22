import { useEffect, useMemo, useRef } from "react";
import { fmtCount, plain } from "../lib/format";
import { capsOf, openChat, toast, useApp } from "../store";
import { ChatAvatar } from "../ui/Avatar";
import { Icon } from "../ui/Icon";
import { Composer } from "./Composer";
import { MessageItem } from "./Message";
import { JumpBottom } from "./Conversation";
import { useStickyScroll } from "./useStickyScroll";
import { SummaryButton, SummaryCard } from "./Summary";

/** A Google Chat thread in its own workspace tab: root, replies, and a composer that answers in-thread. */
export function ThreadView({ tab }: { tab: string }) {
  const meta = useApp((s) => s.threadTabs[tab]);
  const chat = useApp((s) => (meta ? s.chats[meta.chatKey] : undefined));
  const platform = useApp((s) => s.accounts.find((a) => a.id === chat?.accountId)?.platform);
  const list = useApp((s) => (meta ? s.msgs[meta.chatKey] : undefined));
  const fresh = useApp((s) => s.fresh);
  const jumpTo = useApp((s) => s.jumpTo);
  const box = useRef<HTMLDivElement>(null);

  const root = list?.find((m) => m.id === meta?.rootId);
  // a Telegram topic is a plain timeline of its messages; a Google Chat thread is root + replies
  const replies = useMemo(
    () => (list ?? []).filter((m) => m.threadId === meta?.threadId && (meta?.topic || m.threadReply)),
    [list, meta?.threadId, meta?.topic],
  );

  const scroll = useStickyScroll(box, replies[replies.length - 1]?.id ?? root?.id);
  useEffect(() => {
    scroll.stick.current = true;
  }, [tab]);
  useEffect(() => {
    if (!jumpTo) return;
    const el = document.getElementById(`m-${jumpTo}`);
    if (el && box.current?.contains(el)) {
      scroll.release();
      el.scrollIntoView({ block: "center", behavior: "smooth" });
      el.classList.remove("flash");
      void el.offsetWidth;
      el.classList.add("flash");
    } else toast("Tin gốc không có trong thread đã tải", "info");
    useApp.setState({ jumpTo: null });
  }, [jumpTo]);

  if (!meta || !chat) {
    return (
      <div className="content empty">
        <div className="conv-empty">
          <span className="ring"><Icon name="message-circle-reply" /></span>
          <strong>Thread không còn khả dụng</strong>
        </div>
      </div>
    );
  }
  const caps = { ...capsOf(meta.chatKey), threads: false };
  return (
    <div className="content thread-content">
      <div className="conv-head">
        <button className="tool-btn icon-only back-btn" aria-label={`Về ${chat.title}`} data-tip={`Về ${chat.title}`} onClick={() => void openChat(meta.chatKey)}>
          <Icon name="chevron-right" />
        </button>
        <ChatAvatar chat={chat} platform={platform} />
        <div className="title">
          <strong>{meta.topic ? `# ${meta.title}` : root ? plain(root.text).slice(0, 90) || "Thread" : meta.title}</strong>
          <span>
            {meta.topic ? `Topic · ${chat.title} · ${fmtCount(replies.length)} tin đã tải` : `Thread trong tab riêng · ${chat.title} · ${fmtCount(replies.length)} trả lời`}
          </span>
        </div>
        <SummaryButton tab={tab} />
      </div>
      <SummaryCard tab={tab} />
      <div
        className="msgs"
        ref={box}
        onScroll={scroll.onScroll}
      >
        <div className="msgs-inner">
          {meta.error && <div className="empty-note" role="alert">Chưa tải được thread: {meta.error} <button className="tool-btn" onClick={() => void openChat(tab)}>Thử lại</button></div>}
          {meta.topic ? null : root ? (
            <div className="thread-root">
              <MessageItem k={meta.chatKey} tab={tab} m={root} chat={chat} caps={caps} first last fresh={false} threadOpen={false} />
            </div>
          ) : !meta.error ? (
            <div className="section-veil on" role="status"><span className="veil-spinner" /><span>Đang tải thread…</span></div>
          ) : null}
          {!meta.topic && <div className="day-sep" role="separator"><span>{replies.length ? `${replies.length} trả lời` : "Chưa có trả lời"}</span></div>}
          {meta.topic && !replies.length && !meta.error && <div className="section-veil on" role="status"><span className="veil-spinner" /><span>Đang tải topic…</span></div>}
          {replies.map((m, i) => {
            const prev = replies[i - 1];
            const next = replies[i + 1];
            const same = (a?: typeof m, b?: typeof m) => !!a && !!b && a.senderId === b.senderId && Math.abs(a.ts - b.ts) < 5 * 60e3;
            return (
              <MessageItem
                key={m.id}
                k={meta.chatKey}
                tab={tab}
                m={m}
                chat={chat}
                caps={caps}
                first={!same(prev, m)}
                last={!same(m, next)}
                fresh={!!fresh[m.id]}
                threadOpen={false}
              />
            );
          })}
        </div>
        <JumpBottom away={scroll.away} fresh={scroll.fresh} onClick={scroll.toBottom} />
      </div>
      <Composer k={tab} chatKey={meta.chatKey} threadId={meta.threadId} placeholder={meta.topic ? `Nhắn vào # ${meta.title}…` : "Trả lời trong thread…"} key={`c-${tab}`} />
    </div>
  );
}
