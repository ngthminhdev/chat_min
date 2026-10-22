import { memo, useState } from "react";
import { motion } from "motion/react";
import { EASE } from "../lib/motion";
import { fileSrc, isTauri, openPath, openUrl, revealPath, streamSrc } from "../lib/bridge";
import { fileSize, fmt, hm, plain } from "../lib/format";
import { CAP_OFF_NOTE, type Cap } from "../lib/platforms";
import type { Chat, Media, Msg } from "../lib/types";
import { anchor, confirmDialog, fail, openThreadTab, retry, saveMedia, toast, toggleReaction, useApp, type MenuItem } from "../store";
import { api } from "../lib/bridge";
import { PersonAvatar, useAvatar } from "../ui/Avatar";
import { Icon, type IconName } from "../ui/Icon";
import { useDownload } from "./Conversation";
import { translateMsg, trKey } from "../ai";
import { fileActionLabel } from "../lib/micro-ux";

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
  const tr = useApp((s) => s.tr[trKey(k, m.id)]);
  const original = useApp((s) => m.replyTo ? s.msgs[k]?.find((x) => x.id === m.replyTo) : undefined);
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
      <b>{m.replyName || (original?.outgoing ? "Bạn" : original?.senderName) || "Tin nhắn được trả lời"}</b>
      <span>{plain(m.replyText || original?.text || "") || original?.media?.name || "Tin gốc chưa được tải · bấm để tìm"}</span>
    </button>
  ) : null;

  return (
    <Wrap className={cls} id={`m-${m.id}`} {...anim}
      onContextMenu={(e: React.MouseEvent) => {
        if (e.defaultPrevented) return;
        e.preventDefault();
        useApp.setState({ pop: { kind: "menu", x: e.clientX, y: e.clientY, top: e.clientY, items: menuFor(k, tab, m, caps) } });
      }}
      onKeyDown={(e: React.KeyboardEvent) => {
        if (e.key === "ContextMenu" || (e.shiftKey && e.key === "F10")) {
          e.preventDefault();
          useApp.setState({ pop: { kind: "menu", ...anchor(e.currentTarget), items: menuFor(k, tab, m, caps) } });
        }
      }}
    >
      {side}
      <div className="msg-col">
        {sender}
        <div className={`bubble${m.media?.kind === "sticker" && !m.text ? " sticker" : ""}`}>
          {quote}
          {m.media && <MediaView accountId={m.accountId} media={m.media} />}
          {m.text && <div className="tx" dangerouslySetInnerHTML={{ __html: fmt(m.text) }} />}
          {tr && (tr.state !== "ok" || tr.text) && (
            <motion.div
              className={`tx-tr${tr.state === "err" ? " err" : ""}`}
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              transition={{ duration: 0.18, ease: EASE }}
            >
              <Icon name="languages" />
              {tr.state === "loading" ? (
                <span className="tr-loading">Đang dịch…</span>
              ) : tr.state === "err" ? (
                <span>{tr.text}</span>
              ) : (
                <div className="tx" dangerouslySetInnerHTML={{ __html: fmt(tr.text) }} />
              )}
            </motion.div>
          )}
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
      <div className="msg-actions" role="toolbar" aria-label="Thao tác tin nhắn">
        <button aria-label="Trả lời" data-tip="Trả lời" onClick={() => setReply(tab, m)}>
          <Icon name="reply" />
        </button>
        {(!!m.text || !!m.media) && (
          <button aria-label="Sao chép" data-tip="Sao chép" onClick={() => copyMsg(m)}>
            <Icon name="copy" />
          </button>
        )}
        {caps.reactions && (
          <button
            aria-label="Thả biểu cảm"
            data-tip="Biểu cảm"
            onClick={(e) => {
              useApp.setState({ pop: { kind: "emoji", ...anchor(e.currentTarget), onPick: (emoji) => void toggleReaction(k, m, emoji) } });
            }}
          >
            <Icon name="smile" />
          </button>
        )}
        {!!m.text && (
          <button aria-label="Dịch" data-tip={tr ? "Ẩn bản dịch" : "Dịch"} aria-pressed={!!tr} onClick={() => void translateMsg(k, m)}>
            <Icon name="languages" />
          </button>
        )}
        {caps.threads && chat.threaded && (
          <button aria-label={replies?.length ? "Trả lời trong luồng" : "Mở luồng trả lời"} data-tip={replies?.length ? "Trả lời trong luồng" : "Mở luồng trả lời"} onClick={() => openThread(k, m)}>
            <Icon name="message-circle-reply" />
          </button>
        )}
        <button
          aria-label="Thêm"
          data-tip="Thêm"
          onClick={(e) => {
            useApp.setState({ pop: { kind: "menu", ...anchor(e.currentTarget), items: menuFor(k, tab, m, caps) } });
          }}
        >
          <Icon name="ellipsis" />
        </button>
      </div>
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
    <span className={`msg-meta${m.status === "sending" || m.status === "failed" ? " pending" : ""}`}>
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
  const isVideo = media.kind === "video";
  // GIFs, round videos and short clips play inline, muted, like Telegram
  const inline = isVideo && (media.name === "GIF" || media.name === "Video tròn" || (media.size > 0 && media.size < 5e6));
  const dl = useDownload(accountId, media, (isImage && (media.size === 0 || media.size < 15e6)) || inline);
  const [playing, setPlaying] = useState(false);
  const ratio = media.width && media.height ? `${media.width}/${media.height}` : undefined;
  // Telegram's ~320px thumbnail once it is here, the 40px blur until then
  const poster = useAvatar(accountId, media.thumbFile ?? "") || media.thumb;
  // Telegram videos (numeric TDLib file ids) stream: playback starts while the rest downloads
  const stream = isTauri && isVideo && !dl.path && /^\d+$/.test(media.fileRef);
  const busy = dl.state === "loading" ? (dl.pct != null ? <span className="dl-pct">{dl.pct}%</span> : <span className="veil-spinner" />) : null;

  const ensure = async () => {
    const p = dl.path || (await dl.get());
    if (!p) toast("Chưa tải được tệp. Hãy thử lại.", "circle-alert");
    return p;
  };
  const view = async () => {
    if (stream) return useApp.setState({ viewer: { media, path: "", src: streamSrc(accountId, media.fileRef, media.mime), accountId } });
    const p = await ensure();
    if (p) useApp.setState({ viewer: { media, path: p } });
  };
  const menu = (e: React.MouseEvent, viewable: boolean) => {
    e.preventDefault();
    e.stopPropagation();
    const items: MenuItem[] = media.url
      ? [{ icon: "external-link", label: "Mở trên Google Drive", run: () => void openUrl(media.url) }]
      : [
          ...(viewable ? [{ icon: "image" as const, label: "Xem", run: () => void view() }] : []),
          { icon: "external-link", label: "Mở bằng app mặc định", run: () => void ensure().then((p) => { if (p) openPath(p).catch(fail); }) },
          { icon: "folder-open", label: "Hiện trong Finder", run: () => void ensure().then((p) => { if (p) revealPath(p).catch(fail); }) },
          { icon: "download", label: "Lưu vào Downloads", run: () => void ensure().then((p) => { if (p) void saveMedia(p, media.name, false); }) },
          { icon: "download", label: "Lưu thành…", run: () => void ensure().then((p) => { if (p) void saveMedia(p, media.name, true); }) },
          { icon: "copy", label: "Sao chép tên tệp", run: () => void navigator.clipboard.writeText(media.name).then(() => toast("Đã sao chép")) },
        ];
    useApp.setState({ pop: { kind: "menu", x: e.clientX, y: e.clientY, top: e.clientY, items } });
  };

  if (isImage) {
    const src = dl.path ? fileSrc(dl.path) : poster;
    return (
      <figure
        className={`img-msg${media.kind === "sticker" ? " sticker" : ""}${dl.path ? "" : " pending"}`}
        style={{ aspectRatio: ratio }}
        onClick={() => void view()}
        onContextMenu={(e) => menu(e, true)}
      >
        {src ? <img className="od-media" src={src} alt={media.name} /> : <span className="veil-spinner" />}
      </figure>
    );
  }
  if (isVideo) {
    const live = inline && dl.path;
    return (
      <figure
        className={`img-msg video${media.name === "Video tròn" ? " round" : ""}`}
        style={{ aspectRatio: ratio ?? "16/9" }}
        onClick={() => void view()}
        onContextMenu={(e) => menu(e, true)}
      >
        {live ? (
          <video className="od-media" src={fileSrc(dl.path)} poster={poster || undefined} muted loop autoPlay playsInline />
        ) : poster ? (
          <img className="od-media" src={poster} alt={media.name} />
        ) : null}
        {!live && <span className="play">{busy ?? <Icon name="play" />}</span>}
        <span className="media-badge">{media.name === "GIF" ? "GIF" : media.size > 0 ? fileSize(media.size) : "Video"}</span>
      </figure>
    );
  }
  const voice = media.kind === "voice";
  const icon: IconName = voice ? "audio-lines" : FILE_ICON(media.name);
  const act = async () => {
    if (media.url) return void openUrl(media.url);
    const p = await ensure();
    if (!p) return;
    if (voice) setPlaying(true);
    else openPath(p).catch(fail);
  };
  return (
    <>
      <div className="file-card" onContextMenu={(e) => menu(e, false)}>
        <span className="file-ic"><Icon name={icon} /></span>
        <span style={{ minWidth: 0 }}>
          <strong>{media.name}</strong>
          <small>{media.url ? "Google Drive" : [fileSize(media.size), dl.path ? "đã tải" : ""].filter(Boolean).join(" · ")}</small>
        </span>
        <button
          className="tool-btn icon-only"
          aria-label={fileActionLabel(media, !!dl.path)}
          data-tip={fileActionLabel(media, !!dl.path)}
          disabled={dl.state === "loading"}
          onClick={act}
        >
          {busy ?? (
            <Icon name={voice ? "play" : media.url ? "external-link" : dl.path ? "folder-open" : "download"} />
          )}
        </button>
      </div>
      {voice && playing && dl.path && <audio className="voice-audio" src={fileSrc(dl.path)} controls autoPlay />}
    </>
  );
}

function ThreadLink({ k, m, replies, open }: { k: string; m: Msg; replies?: Msg[]; open: boolean }) {
  const n = replies?.length ?? 0;
  if (!n) return null;
  const faces = [...new Map(replies!.map((r) => [r.senderName, r])).values()].slice(0, 3);
  return (
    <button className={`thread-link${open ? " open" : ""}`} onClick={() => openThread(k, m)}>
      <span className="faces">{faces.map((f) => <PersonAvatar key={f.senderName} name={f.senderName} accountId={f.accountId} photo={f.senderPhoto} />)}</span>
      {n} trả lời <Icon name="external-link" />
      <small>lần cuối {hm(replies![n - 1].ts)}</small>
    </button>
  );
}

/** Copies what the message says, line breaks kept and markup flattened. */
function copyMsg(m: Msg) {
  const text = m.text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, l, u) => (l === u ? u : `${l} (${u})`)).replace(/@\{([^}]+)\}/g, "@$1").replace(/`/g, "");
  void navigator.clipboard.writeText(text.trim() || m.media?.name || "").then(() => toast("Đã sao chép"));
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

function menuFor(k: string, tab: string, m: Msg, caps: Record<Cap, boolean>): MenuItem[] {
  const items: (MenuItem | false)[] = [
    { icon: "reply", label: "Trả lời", run: () => setReply(tab, m) },
    caps.reactions && { icon: "smile", label: "Thả biểu cảm", run: () => {
      const el = document.getElementById(`m-${m.id}`);
      useApp.setState({ pop: { kind: "emoji", ...(el ? anchor(el.querySelector('.bubble') ?? el) : {x: 40, y: 80, top: 80}), onPick: (emoji) => void toggleReaction(k, m, emoji) } });
    } },
    caps.threads && !!m.threadId && { icon: "message-circle-reply", label: "Mở luồng trả lời trong tab", run: () => openThread(k, m) },
    !!m.text && { icon: "languages", label: useApp.getState().tr[trKey(k, m.id)] ? "Ẩn bản dịch" : "Dịch", run: () => void translateMsg(k, m) },
    {
      icon: "copy",
      label: "Sao chép văn bản",
      kbd: "⌘C",
      run: () => copyMsg(m),
    },
    !m.deleted && m.kind !== "service" && { icon: "forward", label: "Chuyển tiếp…", run: () => useApp.setState({ palette: { mode: "chats", forward: m } }) },
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
