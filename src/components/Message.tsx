import { memo } from "react";
import { motion } from "motion/react";
import { EASE } from "../lib/motion";
import { fileSrc, openPath, openUrl, revealPath } from "../lib/bridge";
import { fileSize, fmt, hm, plain } from "../lib/format";
import { CAP_OFF_NOTE, type Cap } from "../lib/platforms";
import type { Chat, Media, Msg } from "../lib/types";
import { anchor, confirmDialog, fail, openThreadTab, retry, toast, toggleReaction, useApp, type MenuItem } from "../store";
import { api } from "../lib/bridge";
import { PersonAvatar } from "../ui/Avatar";
import { Icon, type IconName } from "../ui/Icon";
import { useDownload } from "./Conversation";

interface Props {
  k: string;
  /** tab whose composer replies/edits go to (a thread tab), defaults to the chat */
  tab?: string;
  m: Msg;
  chat: Chat;
  caps: Record<Cap, boolean>;
  first: boolean;
  last: boolean;
  fresh: boolean;
  replies?: Msg[];
  threadOpen: boolean;
}

export const MessageItem = memo(function MessageItem({ k, tab = k, m, chat, caps, first, last, fresh, replies, threadOpen }: Props) {
  if (m.kind === "service") {
    return (
      <div className="service-msg" id={`m-${m.id}`}>
        <span>{m.text}</span>
        <time>{hm(m.ts)}</time>
      </div>
    );
  }
  const me = m.outgoing;
  const cls = `msg${me ? " me" : ""}${first ? " first" : ""}${last ? " last" : ""}${m.mentionsMe ? " mentions-me" : ""}`;
  const side = me ? null : first ? <PersonAvatar name={m.senderName} accountId={m.accountId} photo={m.senderPhoto} /> : <span className="avatar-gap" />;
  const sender = !me && first && chat.kind !== "dm" ? <span className="sender">{m.senderName}</span> : null;
  const Wrap = fresh ? motion.div : "div";
  const anim = fresh ? { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.2, ease: EASE } } : {};

  if (m.deleted) {
    return (
      <Wrap className={cls} id={`m-${m.id}`} {...anim}>
        {side}
        <div className="msg-col">
          <div className="bubble deleted">
            <Icon name="trash-2" />
            <span>Tin nhắn đã bị xoá</span>
            <Meta m={m} caps={caps} />
          </div>
        </div>
      </Wrap>
    );
  }

  const quote = m.replyTo ? (
    <button className="quote" aria-label="Tới tin được trả lời" onClick={() => useApp.setState({ jumpTo: m.replyTo })}>
      <b>{m.replyName || "Tin nhắn"}</b>
      <span>{m.replyText || "Tin nhắn cũ hơn"}</span>
    </button>
  ) : null;

  return (
    <Wrap className={cls} id={`m-${m.id}`} {...anim}>
      {side}
      <div className="msg-col">
        {sender}
        <div className={`bubble${m.media?.kind === "sticker" && !m.text ? " sticker" : ""}`}>
          {quote}
          {m.media && <MediaView accountId={m.accountId} media={m.media} />}
          {m.text && <div className="tx" dangerouslySetInnerHTML={{ __html: fmt(m.text) }} />}
          {m.link && (
            <a className="link-card" href={m.link.url}>
              <span className="site">{m.link.site}</span>
              {m.link.title && <strong>{m.link.title}</strong>}
              {m.link.desc && <span>{m.link.desc}</span>}
            </a>
          )}
        </div>
        <Meta m={m} caps={caps} />
        {caps.reactions && m.reactions.length > 0 && (
          <div className="reactions">
            {m.reactions.map((r) => (
              <motion.button
                key={r.emoji}
                layout
                initial={fresh ? false : { scale: 0.6, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                className={`reaction${r.mine ? " mine" : ""}`}
                aria-pressed={r.mine}
                onClick={() => void toggleReaction(k, m, r.emoji)}
              >
                <span className="e">{r.emoji}</span>
                {r.count}
              </motion.button>
            ))}
          </div>
        )}
        {caps.threads && chat.threaded && <ThreadLink k={k} m={m} replies={replies} open={threadOpen} />}
        {m.status === "failed" && (
          <div className="fail-row">
            {m.error || "Không gửi được"}
            <button className="tool-btn" onClick={() => retry(k, m)}>
              <Icon name="rotate-cw" />
              Thử lại
            </button>
          </div>
        )}
      </div>
      <div className="msg-actions" role="toolbar" aria-label="Thao tác tin nhắn">
        <button aria-label="Trả lời" data-tip="Trả lời" onClick={() => setReply(tab, m)}>
          <Icon name="reply" />
        </button>
        {caps.reactions && (
          <button
            aria-label="Thả reaction"
            data-tip="Reaction"
            onClick={(e) => {
              useApp.setState({ pop: { kind: "emoji", ...anchor(e.currentTarget), onPick: (emoji) => void toggleReaction(k, m, emoji) } });
            }}
          >
            <Icon name="smile" />
          </button>
        )}
        {caps.threads && chat.threaded && (
          <button aria-label="Trả lời trong thread" data-tip="Trả lời trong thread" onClick={() => openThread(k, m)}>
            <Icon name="message-circle-reply" />
          </button>
        )}
        <button
          aria-label="Thêm"
          data-tip="Thêm"
          onClick={(e) => {
            useApp.setState({ pop: { kind: "menu", ...anchor(e.currentTarget), items: menuFor(tab, m, caps) } });
          }}
        >
          <Icon name="ellipsis" />
        </button>
      </div>
    </Wrap>
  );
});

function Meta({ m, caps }: { m: Msg; caps: Record<Cap, boolean> }) {
  let status: React.ReactNode = null;
  if (m.outgoing && !m.deleted) {
    if (m.status === "sending") status = <span data-tip="Đang gửi"><Icon name="clock" /></span>;
    else if (m.status === "failed") status = <span className="failed" data-tip="Gửi lỗi"><Icon name="circle-alert" /></span>;
    else if (m.status === "seen" && caps.readReceipts) status = <span className="seen" data-tip="Đã xem"><Icon name="check-check" /></span>;
    else status = <span data-tip={caps.readReceipts ? "Đã gửi" : `Đã gửi · ${CAP_OFF_NOTE.readReceipts}`}><Icon name="check" /></span>;
  }
  return (
    <span className="msg-meta">
      {m.edited && <span className="edited">đã sửa</span>}
      <time>{hm(m.ts)}</time>
      {status}
    </span>
  );
}

const FILE_ICON = (name: string): IconName =>
  /\.(zip|gz|tar|rar|7z)$/i.test(name) ? "file-archive" : /\.(js|ts|go|rs|py|json|sql|sh|yml|yaml)$/i.test(name) ? "file-code" : "file-text";

function MediaView({ accountId, media }: { accountId: string; media: Media }) {
  const isImage = media.kind === "image" || (media.kind === "sticker" && !!media.fileRef);
  const dl = useDownload(accountId, media, isImage && (media.size === 0 || media.size < 15e6));
  const ratio = media.width && media.height ? `${media.width}/${media.height}` : undefined;

  if (isImage) {
    const src = dl.path ? fileSrc(dl.path) : media.thumb;
    return (
      <figure
        className={`img-msg${media.kind === "sticker" ? " sticker" : ""}${dl.path ? "" : " pending"}`}
        style={{ aspectRatio: ratio }}
        onClick={() => dl.path && void openPath(dl.path)}
      >
        {src ? <img className="od-media" src={src} alt={media.name} /> : <span className="veil-spinner" />}
      </figure>
    );
  }
  if (media.kind === "video" && media.thumb) {
    return (
      <figure className="img-msg video" style={{ aspectRatio: ratio }} onClick={() => void dl.get().then((p) => { if (p) void openPath(p); })}>
        <img className="od-media" src={media.thumb} alt={media.name} />
        <span className="play">{dl.state === "loading" ? <span className="veil-spinner" /> : <Icon name="play" />}</span>
      </figure>
    );
  }
  const icon: IconName = media.kind === "voice" ? "audio-lines" : media.kind === "video" ? "film" : FILE_ICON(media.name);
  const act = async () => {
    if (media.url) return void openUrl(media.url);
    const p = dl.path || (await dl.get());
    if (p) void openPath(p);
    else toast("Tải file không được", "circle-alert");
  };
  return (
    <div className="file-card">
      <span className="file-ic"><Icon name={icon} /></span>
      <span style={{ minWidth: 0 }}>
        <strong>{media.name}</strong>
        <small>{media.url ? "Google Drive" : [fileSize(media.size), dl.path ? "đã tải" : ""].filter(Boolean).join(" · ")}</small>
      </span>
      <button
        className="tool-btn icon-only"
        aria-label={`Mở ${media.name}`}
        data-tip={media.url ? "Mở trên Drive" : dl.path ? "Mở" : "Tải về"}
        onClick={act}
        onContextMenu={(e) => {
          if (!dl.path) return;
          e.preventDefault();
          void revealPath(dl.path);
        }}
      >
        {dl.state === "loading" ? <span className="veil-spinner" /> : <Icon name={media.url ? "external-link" : dl.path ? "folder-open" : "download"} />}
      </button>
    </div>
  );
}

function ThreadLink({ k, m, replies, open }: { k: string; m: Msg; replies?: Msg[]; open: boolean }) {
  const n = replies?.length ?? 0;
  if (!n) {
    return (
      <button className={`thread-link${open ? " open" : ""}`} onClick={() => openThread(k, m)}>
        <Icon name="message-circle-reply" />
        Trả lời trong thread
      </button>
    );
  }
  const faces = [...new Map(replies!.map((r) => [r.senderName, r])).values()].slice(0, 3);
  return (
    <button className={`thread-link${open ? " open" : ""}`} onClick={() => openThread(k, m)}>
      <span className="faces">{faces.map((f) => <PersonAvatar key={f.senderName} name={f.senderName} accountId={f.accountId} photo={f.senderPhoto} />)}</span>
      {n} trả lời
      <small>lần cuối {hm(replies![n - 1].ts)}</small>
    </button>
  );
}

export const openThread = (k: string, m: Msg) => openThreadTab(k, m);

export function setReply(k: string, m: Msg) {
  useApp.setState((s) => ({ replyTo: { ...s.replyTo, [k]: m.id }, editing: { ...s.editing, [k]: "" } }));
  document.getElementById("composer-input")?.focus();
}

export function startEdit(k: string, m: Msg) {
  useApp.setState((s) => ({
    editing: { ...s.editing, [k]: m.id },
    replyTo: { ...s.replyTo, [k]: "" },
    drafts: { ...s.drafts, [k]: m.text },
  }));
  setTimeout(() => document.getElementById("composer-input")?.focus());
}

function menuFor(tab: string, m: Msg, caps: Record<Cap, boolean>): MenuItem[] {
  const items: (MenuItem | false)[] = [
    { icon: "reply", label: "Trả lời", run: () => setReply(tab, m) },
    {
      icon: "copy",
      label: "Sao chép văn bản",
      kbd: "⌘C",
      run: () => void navigator.clipboard.writeText(plain(m.text) || m.media?.name || "").then(() => toast("Đã sao chép")),
    },
    caps.pin && {
      icon: m.pinned ? "pin-off" : "pin",
      label: m.pinned ? "Bỏ ghim" : "Ghim",
      run: () =>
        api.pin(m.accountId, m.chatId, m.id, !m.pinned).then(() => toast(m.pinned ? "Đã bỏ ghim" : "Đã ghim tin nhắn")).catch(fail),
    },
    m.outgoing && caps.edit && !!m.text && m.kind === "text" && { icon: "pencil", label: "Sửa", kbd: "↑", run: () => startEdit(tab, m) },
    m.outgoing &&
      caps.delete && {
        icon: "trash-2",
        label: "Xoá với mọi người",
        danger: true,
        run: () =>
          confirmDialog("Xoá tin nhắn này với mọi người?", `“${plain(m.text).slice(0, 80) || m.media?.name || "Tin nhắn"}” sẽ bị xoá cho tất cả thành viên.`, "Xoá", () =>
            api.deleteMsg(m.accountId, m.chatId, m.id).catch(fail),
          ),
      },
  ];
  return items.filter(Boolean) as MenuItem[];
}
