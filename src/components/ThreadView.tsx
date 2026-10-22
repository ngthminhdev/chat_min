import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { fmtCount, plain } from "../lib/format";
import { capsOf, openChat, useApp } from "../store";
import { ChatAvatar } from "../ui/Avatar";
import { Icon } from "../ui/Icon";
import { Composer } from "./Composer";
import { MessageItem } from "./Message";

/** A Google Chat thread in its own workspace tab: root, replies, and a composer that answers in-thread. */
export function ThreadView({ tab }: { tab: string }) {
  const meta = useApp((s) => s.threadTabs[tab]);
  const chat = useApp((s) => (meta ? s.chats[meta.chatKey] : undefined));
  const platform = useApp((s) => s.accounts.find((a) => a.id === chat?.accountId)?.platform);
  const list = useApp((s) => (meta ? s.msgs[meta.chatKey] : undefined));
  const fresh = useApp((s) => s.fresh);
  const box = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  const root = list?.find((m) => m.id === meta?.rootId);
  const replies = useMemo(() => (list ?? []).filter((m) => m.threadReply && m.threadId === meta?.threadId), [list, meta?.threadId]);

  useLayoutEffect(() => {
    const el = box.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [replies.length, !!root]);
  useEffect(() => {
    stick.current = true;
  }, [tab]);

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
        <button className="tool-btn icon-only back-btn" aria-label={`Về #${chat.title}`} data-tip={`Về ${chat.title}`} onClick={() => void openChat(meta.chatKey)}>
          <Icon name="chevron-right" />
        </button>
        <ChatAvatar chat={chat} platform={platform} />
        <div className="title">
          <strong>{root ? plain(root.text).slice(0, 90) || "Thread" : meta.title}</strong>
          <span>
            thread · {chat.title} · {fmtCount(replies.length)} trả lời
          </span>
        </div>
      </div>
      <div
        className="msgs"
        ref={box}
        onScroll={() => {
          const el = box.current!;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
      >
        <div className="msgs-inner">
          {root ? (
            <div className="thread-root">
              <MessageItem k={meta.chatKey} tab={tab} m={root} chat={chat} caps={caps} first last fresh={false} threadOpen={false} />
            </div>
          ) : (
            <div className="section-veil on" role="status"><span className="veil-spinner" /><span>Đang tải thread…</span></div>
          )}
          <div className="day-sep" role="separator"><span>{replies.length ? `${replies.length} trả lời` : "Chưa có trả lời"}</span></div>
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
      </div>
      <Composer k={tab} chatKey={meta.chatKey} threadId={meta.threadId} placeholder="Trả lời trong thread…" key={`c-${tab}`} />
    </div>
  );
}
