import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { dayLabel, fmtCount, plain } from "../lib/format";
import { capsOf, jumpDone, loadOlderThread, muteThread, openChat, seenThread, toast, useApp } from "../store";
import { ChatAvatar } from "../ui/Avatar";
import { Icon } from "../ui/Icon";
import { Composer } from "./Composer";
import { MessageItem } from "./Message";
import { TranslateAllButton, useViewportTranslate } from "./Conversation";
import { Timeline, TimelineSkeleton, type TimelineHandle } from "./Timeline";
import { SummaryButton, SummaryCard } from "./Summary";
import { useMessageArrivals } from "./useMessageArrivals";
import { layoutMessages } from "../lib/message-layout";
import { MobileActions } from "../ui/MobileActions";

/** A Google Chat thread in its own workspace tab: root, replies, and a composer that answers in-thread. */
export function ThreadView({ tab }: { tab: string }) {
  const meta = useApp((s) => s.threadTabs[tab]);
  const chat = useApp((s) => (meta ? s.chats[meta.chatKey] : undefined));
  const platform = useApp((s) => s.accounts.find((a) => a.id === chat?.accountId)?.platform);
  const list = useApp((s) => (meta ? s.msgs[meta.chatKey] : undefined));
  const fresh = useApp((s) => s.fresh);
  const windowForeground = useApp(s => s.windowPresence?.foreground);
  const older = useApp(s => s.older[tab]);
  const limit = useApp(s => s.threadPages[tab]?.limit ?? 20);
  const pageLoaded = useApp(s => !!s.threadPages[tab]);
  const muted = useApp((s) => (meta ? !!s.mutedThreads[`${meta.chatKey}|${meta.threadId}`] : false));
  const jumpTo = useApp((s) => s.jumpTo);
  const box = useRef<HTMLDivElement | null>(null);
  const timeline = useRef<TimelineHandle>(null);
  const arrival = useMessageArrivals(list, fresh);

  const root = list?.find((m) => m.id === meta?.rootId);
  // a Telegram topic is a plain timeline of its messages; a Google Chat thread is root + replies
  const replies = useMemo(
    () => {
      const found = (list ?? []).filter(m => m.threadId === meta?.threadId && (meta?.topic || m.threadReply));
      return meta?.topic ? found : found.slice(-limit);
    },
    [list, meta?.threadId, meta?.topic, limit],
  );

  const shown = useMemo(() => (root && !meta?.topic ? [root, ...replies] : replies), [root, replies, meta?.topic]);
  useViewportTranslate(box, tab, meta?.chatKey ?? "", shown);
  const last = replies[replies.length - 1]?.sort;
  // Read follows what is on screen: reading older replies up the thread leaves the newer ones
  // unread ("N mới") until the reader comes back down to them.
  const [atBottom, setAtBottom] = useState(true);
  const onBottom = useCallback((bottom: boolean) => {
    setAtBottom(bottom);
    if (useApp.getState().atBottom !== bottom) useApp.setState({ atBottom: bottom });
  }, []);
  useEffect(() => () => useApp.setState({ atBottom: true }), [tab]);
  useEffect(() => {
    const read = () => { if (meta && last !== undefined && atBottom) seenThread(meta.chatKey, meta.threadId, last); };
    read();
    window.addEventListener("focus", read);
    return () => window.removeEventListener("focus", read);
  }, [meta?.chatKey, meta?.threadId, last, windowForeground, atBottom]);
  const rows = useMemo(() => layoutMessages(replies), [replies]);
  useEffect(() => {
    if (!jumpTo) return;
    if (!timeline.current?.toMessage(jumpTo)) toast(meta?.topic ? "Tin này không có trong phần chủ đề đã tải" : "Tin này không có trong luồng trả lời đã tải", "info");
    jumpDone();
  }, [jumpTo, rows]);

  if (!meta || !chat) {
    return (
      <div className="content empty">
        <div className="conv-empty">
          <span className="ring"><Icon name="message-circle-reply" /></span>
          <strong>Luồng trả lời không còn khả dụng</strong>
        </div>
      </div>
    );
  }
  const caps = { ...capsOf(meta.chatKey), threads: false };
  return (
    <div className="content thread-content">
      <div className="conv-head">
        <button className="tool-btn icon-only back-btn" aria-label={`Về ${chat.title}`} data-tip={`Về ${chat.title}`} onClick={() => void openChat(meta.chatKey)}>
          <Icon name="chevron-left" />
        </button>
        <ChatAvatar chat={chat} platform={platform} />
        <div className="title">
          <strong>{meta.topic ? `# ${meta.title}` : root ? plain(root.text).slice(0, 90) || "Luồng trả lời" : meta.title}</strong>
          <span>
            {meta.topic ? `Topic · ${chat.title} · ${fmtCount(replies.length)} tin đã tải` : `Thread trong tab riêng · ${chat.title} · ${fmtCount(replies.length)} trả lời đã tải`}
          </span>
        </div>
        <div className="conv-actions"><MobileActions label="Thao tác luồng trả lời">
        <button
          className={`tool-btn icon-only${muted ? " active" : ""}`}
          aria-pressed={muted}
          aria-label={muted ? "Bật thông báo luồng này" : "Tắt thông báo luồng này"}
          data-tip={muted ? "Bật thông báo luồng này" : "Tắt thông báo luồng này"}
          onClick={() => void muteThread(meta.chatKey, meta.threadId, !muted)}
        >
          <Icon name={muted ? "bell-off" : "bell"} />
        </button>
        <TranslateAllButton autoKey={tab} chatKey={meta.chatKey} msgs={shown} />
        <SummaryButton tab={tab} />
        </MobileActions></div>
      </div>
      <SummaryCard tab={tab} />
      <Timeline ref={timeline} rows={rows} box={box} anchorKey={tab} headerMessage={meta.topic ? undefined : root} onTop={() => void loadOlderThread(tab)} onBottom={onBottom}
        header={<>
          {meta.error && <div className="empty-note" role="alert">Chưa tải được luồng trả lời: {meta.error} <button className="tool-btn" onClick={() => void (meta.errorOlder ? loadOlderThread(tab) : openChat(tab))}>Thử lại</button></div>}
          {!meta.topic && root && <><div className="day-sep" role="separator"><span>{dayLabel(root.ts)}</span></div><div className="thread-root"><MessageItem k={meta.chatKey} tab={tab} m={root} chat={chat} caps={caps} first last fresh={false} threadOpen={false} /></div></>}
          {!meta.topic && !root && !meta.error && !pageLoaded && <TimelineSkeleton />}
          {!meta.topic && <div className="day-sep" role="separator"><span>{replies.length ? `${replies.length} trả lời` : "Chưa có trả lời"}</span></div>}
          {older === "loading" && <div className="older-loading" role="status" aria-label={meta.topic ? "Đang tải tin cũ hơn của chủ đề" : "Đang tải trả lời cũ hơn"}><span className="veil-spinner" /></div>}
          {older === "idle" && pageLoaded && !meta.error && <div className="history-start"><button className="tool-btn" onClick={() => void loadOlderThread(tab)}>{meta.topic ? "Tải tin cũ hơn trong chủ đề" : "Tải trả lời cũ hơn"}</button></div>}
          {older === "done" && <div className="history-start">{meta.topic ? "Đầu chủ đề — đã tải hết lịch sử" : "Đã tải hết trả lời trong luồng"}</div>}
        </>}
        empty={!meta.error && !pageLoaded ? <TimelineSkeleton /> : <div className="empty-note">{meta.topic ? "Chủ đề chưa có tin nhắn" : "Chưa có trả lời"}</div>}
        renderRow={({m,album,first,last,newDay}) => <Fragment>
          {newDay && <div className="day-sep" role="separator"><span>{dayLabel(m.ts)}</span></div>}
          <div className={!meta.topic && root?.id === m.id ? "thread-root" : undefined}>
            <MessageItem k={meta.chatKey} tab={tab} m={m} chat={chat} caps={caps} first={first} last={last}
              album={album} fresh={root?.id === m.id ? false : arrival(m)} threadOpen={false} />
          </div>
        </Fragment>} />
      <Composer k={tab} chatKey={meta.chatKey} threadId={meta.threadId} placeholder={meta.topic ? `Nhắn vào # ${meta.title}…` : "Trả lời trong luồng…"} key={`c-${tab}`} />
    </div>
  );
}
