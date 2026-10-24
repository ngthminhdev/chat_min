import { memo, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { EASE } from "../lib/motion";
import { fileSrc, isTauri, openPath, openUrl, revealPath, streamSrc } from "../lib/bridge";
import { dayLabel, fileSize, fmt, hm, plain } from "../lib/format";
import { CAP_OFF_NOTE, type Cap } from "../lib/platforms";
import type { Chat, Media, Msg, MsgPeople } from "../lib/types";
import { anchor, confirmDialog, fail, openThreadTab, pickReaction, retry, threadUnread, saveMedia, toast, toggleReaction, useApp, type MenuItem } from "../store";
import { api } from "../lib/bridge";
import { PersonAvatar, useAvatar } from "../ui/Avatar";
import { Icon, type IconName } from "../ui/Icon";
import { useDownload } from "./Conversation";
import lottie from "lottie-web/build/player/lottie_light";
import { translateMsg, trKey } from "../ai";
import { fileActionLabel } from "../lib/micro-ux";
import { isMobile } from "../lib/mobile";
import { isReplySwipe } from "../lib/mobile-gestures";

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
  /** this message plus the photos/videos that follow it in one album: rendered as a grid under one time stamp */
  album?: Msg[];
}

export const MessageItem = memo(function MessageItem({ k, tab = k, m, chat, caps, first, last, fresh, replies, threadOpen, album }: Props) {
  const tr = useApp((s) => s.tr[trKey(k, m.id)]);
  // only when the platform didn't send the quote itself: an O(n) find per message on every
  // store change made long chats crawl
  const needOriginal = !!m.replyTo && !(m.replyName && m.replyText);
  const list = useApp((s) => (needOriginal ? s.msgs[k] : undefined));
  const original = useMemo(() => list?.find((x) => x.id === m.replyTo), [list, m.replyTo]);
  const enter = useRef(fresh).current;
  const reduceMotion = useReducedMotion();
  const swipe = useRef<{ x: number; y: number; msg: Msg } | null>(null);
  const ignoreClickUntil = useRef(0);
  const resetSwipe = (el: HTMLElement) => {
    swipe.current = null;
    el.style.removeProperty("--reply-drag");
    el.classList.remove("reply-dragging");
  };
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
  const side = me ? null : first ? <PersonAvatar name={m.senderName} accountId={m.accountId} photo={m.senderPhoto} userId={m.senderId} /> : <span className="avatar-gap" />;
  const sender = !me && first && chat.kind !== "dm" ? <span className="sender">{m.senderName}</span> : null;
  // Decide once for this bubble. History stays plain DOM; ACKs never switch its type.
  const Wrap = enter ? motion.div : "div";
  const anim = enter ? { initial: { opacity: 0, y: 6 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.18, ease: EASE } } : {};

  if (m.deleted) {
    return (
      <Wrap className={cls} id={`m-${m.id}`} {...anim}>
        {side}
        <div className="msg-col">
          <div className="bubble deleted">
            <Icon name="trash-2" />
            <span>Tin nhắn đã bị xoá</span>
          </div>
          <Meta m={m} caps={caps} />
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
      onPointerDown={(e: React.PointerEvent<HTMLElement>) => {
        if (!e.isPrimary) { resetSwipe(e.currentTarget); return; }
        if (!isMobile || e.pointerType !== "touch" || !e.isPrimary || !caps.reply || !chat.canSend || (e.target as Element).closest("button, a, input, textarea, audio, video")) return;
        const id = (e.target as Element).closest<HTMLElement>("[data-message-id]")?.dataset.messageId;
        swipe.current = { x: e.clientX, y: e.clientY, msg: album?.find(t => t.id === id) ?? m };
      }}
      onPointerMove={(e: React.PointerEvent<HTMLElement>) => {
        const s = swipe.current;
        if (!s) return;
        const dx = e.clientX - s.x, dy = e.clientY - s.y;
        if (Math.abs(dy) > 12 && Math.abs(dy) >= Math.abs(dx)) { resetSwipe(e.currentTarget); return; }
        if (dx < -12 && Math.abs(dx) > Math.abs(dy) * 1.5) {
          e.currentTarget.classList.add("reply-dragging");
          e.currentTarget.style.setProperty("--reply-drag", `${Math.max(-80, dx)}px`);
        }
      }}
      onPointerUp={(e: React.PointerEvent<HTMLElement>) => {
        const s = swipe.current;
        resetSwipe(e.currentTarget);
        if (!s) return;
        const dx = e.clientX - s.x, dy = e.clientY - s.y;
        if (Math.hypot(dx, dy) > 12) ignoreClickUntil.current = Date.now() + 600;
        if (isReplySwipe(dx, dy)) setReply(tab, s.msg);
      }}
      onPointerCancel={(e: React.PointerEvent<HTMLElement>) => resetSwipe(e.currentTarget)}
      onClickCapture={(e: React.MouseEvent) => {
        if (isMobile && Date.now() < ignoreClickUntil.current) { e.preventDefault(); e.stopPropagation(); }
      }}
      onClick={isMobile ? (e: React.MouseEvent) => {
        const target = e.target as Element;
        if (target.closest("button, a, input, textarea, audio, video, .img-msg, .file-card")) return;
        if (target.closest(".message-surface, .msg-meta")) showMessageMenu(e, k, tab, m, caps);
      } : undefined}
      onMouseEnter={me ? undefined : (e: React.MouseEvent) => fitActions(e.currentTarget as HTMLElement)}
      onContextMenu={(e: React.MouseEvent) => {
        if (e.defaultPrevented) return;
        resetSwipe(e.currentTarget as HTMLElement);
        ignoreClickUntil.current = Date.now() + 600;
        e.preventDefault();
        showMessageMenu(e, k, tab, m, caps);
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
        <div className="message-surface">
        {sender}
        <div className={`bubble${(m.media?.kind === "sticker" || m.media?.name === "Sticker") && !m.text ? " sticker" : ""}`}>
          {quote}
          {album ? (
            <div className={`media-grid album n${Math.min(album.length, 4)}`}>
              {album.map((t) => <MediaView key={t.id} accountId={t.accountId} media={t.media!} sending={t.status === "sending"} tile anchorId={t.id === m.id ? undefined : t.id} chatKey={k} messageId={t.id} galleryIds={album.map(t => t.id)} onMessageMenu={(e, items) => showMessageMenu(e, k, tab, t, caps, items)} />)}
            </div>
          ) : m.media && <MediaView accountId={m.accountId} media={m.media} sending={m.status === "sending"} chatKey={k} messageId={m.id} onMessageMenu={(e, items) => showMessageMenu(e, k, tab, m, caps, items)} />}
          {m.text && <div className="tx" dangerouslySetInnerHTML={{ __html: fmt(m.text) }} />}
          <AnimatePresence initial={false}>
          {tr && (tr.state !== "ok" || tr.text) && (
            <motion.div
              key="translation"
              className={`tx-tr${tr.state === "err" ? " err" : ""}`}
              initial={reduceMotion ? false : { opacity: 0, height: 0, marginTop: 0, paddingTop: 0, borderTopWidth: 0 }}
              animate={{ opacity: 1, height: "auto", marginTop: 6, paddingTop: 6, borderTopWidth: 1 }}
              exit={{ opacity: 0, height: 0, marginTop: 0, paddingTop: 0, borderTopWidth: 0, transition: { duration: reduceMotion ? 0 : 0.1, ease: EASE } }}
              transition={{ duration: reduceMotion ? 0 : 0.16, ease: EASE }}
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
          </AnimatePresence>
          {m.link && (
            <a className="link-card" href={m.link.url}>
              <span className="site">{m.link.site}</span>
              {m.link.title && <strong>{m.link.title}</strong>}
              {m.link.desc && <span>{m.link.desc}</span>}
            </a>
          )}
        </div>
        </div>
        <div className="message-footer">
        <AnimatePresence initial={false}>
        {caps.reactions && m.reactions.length > 0 && (
          <motion.div key="reactions" className="reactions" initial={{ opacity: 1 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.1 }}>
            {/* only reactions added while the message is on screen pop in; ones loaded with
                history don't (no `layout` either: it slid them around whenever the list
                scrolled or older pages landed above) */}
            <AnimatePresence initial={false}>
            {m.reactions.map((r) => (
              <motion.button
                key={r.emoji}
                initial={{ scale: 0.6, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.94, opacity: 0, transition: { duration: 0.1 } }}
                className={`reaction${r.mine ? " mine" : ""}`}
                aria-pressed={r.mine}
                onClick={() => void toggleReaction(k, m, r.emoji)}
                onMouseEnter={(e) => hoverTip(e.currentTarget, () => peopleOf(m).then((p) => joinNames(p.reactions.filter(([e]) => e === r.emoji).map(([, n]) => n))))}
              >
                <span className="e"><Emoji e={r.emoji} /></span>
                {r.count}
              </motion.button>
            ))}
            </AnimatePresence>
          </motion.div>
        )}
        </AnimatePresence>
        <Meta m={m} caps={caps} />
        </div>
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
              void pickReaction(k, m, anchor(e.currentTarget));
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

/** Incoming message: the toolbar hangs above the bubble's right end; a bubble narrower than
 *  the toolbar would push it over the avatar, so it starts at the bubble's left end instead. */
function fitActions(row: HTMLElement) {
  const col = row.querySelector<HTMLElement>(".msg-col");
  const bar = row.querySelector<HTMLElement>(".msg-actions");
  if (col && bar) row.classList.toggle("act-left", col.offsetWidth < bar.offsetWidth);
}

function Meta({ m, caps }: { m: Msg; caps: Record<Cap, boolean> }) {
  // an upload in flight: Rust reports it under the file's local path (tg.rs / gchat.rs)
  const up = useApp((s) => (m.status === "sending" && m.media?.localPath ? s.progress[`${m.accountId}|${m.media.localPath}`] : undefined));
  let status: React.ReactNode = null;
  if (m.outgoing && !m.deleted) {
    if (m.status === "sending") status = up != null && up < 100 ? <span className="dl-pct" data-tip="Đang tải lên">{up}%</span> : <span data-tip="Đang gửi"><Icon name="clock" /></span>;
    else if (m.status === "failed") status = <span className="failed" data-tip="Gửi lỗi"><Icon name="circle-alert" /></span>;
    else if (m.status === "seen" && caps.readReceipts)
      status = <span className="seen" data-tip="Đã xem" onMouseEnter={(e) => hoverTip(e.currentTarget, () => peopleOf(m).then((p) => (p.viewers.length ? `Đã xem · ${joinNames(p.viewers)}` : "Đã xem")))}><Icon name="check-check" /></span>;
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

/** Telegram animated sticker: gzipped Lottie JSON, inflated by the browser and looped. */
function TgsSticker({ path, poster }: { path: string; poster: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    let anim: ReturnType<typeof lottie.loadAnimation> | undefined;
    let gone = false;
    (async () => {
      try {
        const res = await fetch(fileSrc(path));
        const json = await new Response(res.body!.pipeThrough(new DecompressionStream("gzip"))).json();
        if (gone) return;
        anim = lottie.loadAnimation({ container: el, renderer: "svg", loop: true, autoplay: true, animationData: json });
        setReady(true);
      } catch (e) {
        void api.logJs(`tgs error ${String(e)} ${path}`);
      }
    })();
    return () => { gone = true; anim?.destroy(); };
  }, [path]);
  return (
    <>
      {!ready && poster && <img className="od-media" src={poster} alt="Sticker" />}
      <div className="od-media tgs" ref={box} style={ready ? undefined : { position: "absolute", inset: 0, opacity: 0 }} />
    </>
  );
}

/** Bubble width for a photo: the whole image shows (no crop), tall ones get narrower, like Telegram. */
function fitWidth(media: Media) {
  if (!media.width || !media.height || media.kind === "sticker" || media.name === "Sticker") return undefined;
  const maxW = isMobile ? 300 : 360;
  return `${Math.max(120, Math.min(maxW, Math.round(420 * media.width / media.height)))}px`;
}

function MediaView({ accountId, media, sending, tile, anchorId, chatKey, messageId, galleryIds, onMessageMenu }: { accountId: string; media: Media; sending?: boolean; tile?: boolean; anchorId?: string; chatKey: string; messageId: string; galleryIds?: string[]; onMessageMenu: (e: React.MouseEvent, items: MenuItem[]) => void }) {
  // my upload in flight: progress under the file's local path (see Meta)
  const up = useApp((s) => (sending && media.localPath ? s.progress[`${accountId}|${media.localPath}`] : undefined));
  const isImage = media.kind === "image" || (media.kind === "sticker" && !!media.fileRef);
  const isVideo = media.kind === "video";
  // GIFs, round videos and short clips play inline, muted, like Telegram
  const inline = isVideo && (media.name === "GIF" || media.name === "Sticker" || media.name === "Video tròn" || (media.size > 0 && media.size < 5e6));
  const dl = useDownload(accountId, media, (isImage && (media.size === 0 || media.size < 15e6)) || inline);
  const [playing, setPlaying] = useState(false);
  // an album tile is square and keeps the message id so quotes can still jump to it
  const ratio = tile ? "1" : media.width && media.height ? `${media.width}/${media.height}` : undefined;
  const box = { style: { aspectRatio: ratio, width: tile ? undefined : fitWidth(media) }, id: anchorId ? `m-${anchorId}` : undefined, "data-message-id": messageId };
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
  const view = () => {
    const all = useApp.getState().msgs[chatKey] ?? [];
    const albumId = all.find(m => m.id === messageId)?.albumId;
    const ids = albumId ? all.filter(m => m.albumId === albumId).map(m => m.id) : galleryIds;
    const context = { accountId, messageId, galleryIds: ids };
    if (stream) return useApp.setState({ viewer: { media, path: "", src: streamSrc(accountId, media.fileRef, media.mime), ...context } });
    useApp.setState({ viewer: { media, path: dl.path || media.localPath || "", ...context } });
  };
  const menu = (e: React.MouseEvent, viewable: boolean) => {
    e.preventDefault();
    e.stopPropagation();
    const items: MenuItem[] = media.url
      ? [{ icon: "external-link", label: "Mở trên Google Drive", run: () => void openUrl(media.url) }]
      : [
          ...(viewable ? [{ icon: "image" as const, label: "Xem", run: () => void view() }] : []),
          { icon: "external-link", label: "Mở bằng app mặc định", run: () => void ensure().then((p) => { if (p) openPath(p).catch(fail); }) },
          ...(!isMobile ? [{ icon: "folder-open" as const, label: "Hiện trong Finder", run: () => void ensure().then((p) => { if (p) revealPath(p).catch(fail); }) }] : []),
          { icon: "download", label: "Lưu vào thư mục tải về", run: () => void ensure().then((p) => { if (p) void saveMedia(p, media.name, false); }) },
          { icon: "download", label: "Lưu thành…", run: () => void ensure().then((p) => { if (p) void saveMedia(p, media.name, true); }) },
          { icon: "copy", label: "Sao chép tên tệp", run: () => void navigator.clipboard.writeText(media.name).then(() => toast("Đã sao chép")) },
        ];
    if (isMobile) onMessageMenu(e, items);
    else useApp.setState({ pop: { kind: "menu", x: e.clientX, y: e.clientY, top: e.clientY, items } });
  };

  if (media.mime === "application/x-tgsticker") {
    return (
      <figure className="img-msg sticker" data-message-id={messageId} style={{ aspectRatio: ratio }} onClick={isMobile ? (e) => menu(e, false) : undefined} onContextMenu={(e) => menu(e, false)}>
        {dl.path ? <TgsSticker path={dl.path} poster={poster} /> : poster ? <img className="od-media" src={poster} alt="Sticker" /> : <span className="veil-spinner" />}
      </figure>
    );
  }
  if (isImage) {
    const src = dl.path ? fileSrc(dl.path) : poster;
    return (
      <figure
        className={`img-msg${media.kind === "sticker" ? " sticker" : ""}${dl.path ? "" : " pending"}`}
        {...box}
        onClick={() => void view()}
        onContextMenu={(e) => menu(e, true)}
      >
        {src ? <img className="od-media" src={src} alt={media.name} onError={dl.path ? dl.broken : undefined} /> : <span className="veil-spinner" />}
        {src && busy && <span className="play">{busy}</span>}
      </figure>
    );
  }
  if (isVideo) {
    const live = inline && dl.path;
    return (
      <figure
        className={`img-msg video${media.name === "Video tròn" ? " round" : ""}${media.name === "Sticker" ? " sticker" : ""}`}
        {...box}
        style={{ ...box.style, aspectRatio: ratio ?? "16/9" }}
        onClick={() => void view()}
        onContextMenu={(e) => menu(e, true)}
      >
        {live && /\.gif$/i.test(dl.path) ? (
          // my own upload: Telegram serves the converted mp4, TDLib keeps the local .gif as its copy — <video> can't play that
          <img className="od-media" src={fileSrc(dl.path)} alt="GIF" onError={() => { void api.logJs(`gif img error ${dl.path}`); dl.broken(); }} />
        ) : live ? (
          <video
            className="od-media"
            src={fileSrc(dl.path)}
            poster={poster || undefined}
            muted
            loop
            autoPlay
            playsInline
            onPlaying={() => void api.logJs(`video playing ${media.name} ${dl.path}`)}
            onError={(e) => {
              const err = e.currentTarget.error;
              void api.logJs(`video error code=${err?.code} ${err?.message ?? ""} ${media.mime} ${media.size}B ${dl.path}`);
              dl.broken();
            }}
          />
        ) : poster ? (
          <img className="od-media" src={poster} alt={media.name} />
        ) : null}
        {!live && <span className="play">{busy ?? <Icon name="play" />}</span>}
        {media.name !== "Sticker" && <span className="media-badge">{media.name === "GIF" ? "GIF" : media.size > 0 ? fileSize(media.size) : "Video"}</span>}
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
      <div className="file-card" data-message-id={messageId} onClick={isMobile ? (e) => { if (!(e.target as Element).closest("button")) menu(e, false); } : undefined} onContextMenu={(e) => menu(e, false)}>
        <span className="file-ic"><Icon name={icon} /></span>
        <span style={{ minWidth: 0 }}>
          <strong>{media.name}</strong>
          <small>{media.url ? "Google Drive" : sending ? `Đang tải lên${up != null ? ` ${up}%` : "…"}` : [fileSize(media.size), dl.path ? "đã tải" : ""].filter(Boolean).join(" · ")}</small>
        </span>
        <button
          className="tool-btn icon-only"
          aria-label={fileActionLabel(media, !!dl.path)}
          data-tip={fileActionLabel(media, !!dl.path)}
          disabled={dl.state === "loading" || sending}
          onClick={act}
        >
          {busy ?? (sending ? <span className="veil-spinner" /> : null) ?? (
            <Icon name={voice ? "play" : media.url ? "external-link" : dl.path ? "folder-open" : "download"} />
          )}
        </button>
      </div>
      {voice && playing && dl.path && <audio className="voice-audio" src={fileSrc(dl.path)} controls autoPlay />}
    </>
  );
}

function ThreadLink({ k, m, replies, open }: { k: string; m: Msg; replies?: Msg[]; open: boolean }) {
  const unread = useApp((s) => (replies ? threadUnread(s, k, m.threadId, replies) : 0));
  const n = replies?.length ?? 0;
  if (!n) return null;
  const faces = [...new Map(replies!.map((r) => [r.senderName, r])).values()].slice(0, 3);
  return (
    <button className={`thread-link${open ? " open" : ""}${unread ? " has-new" : ""}`} onClick={() => openThread(k, m)}>
      <span className="faces">{faces.map((f) => <PersonAvatar key={f.senderName} name={f.senderName} accountId={f.accountId} photo={f.senderPhoto} />)}</span>
      {n} trả lời{unread > 0 && <b className="thread-new">· {unread} mới</b>} <Icon name="external-link" />
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

// Who reacted / read a message: asked on hover or from the menu, cached while the message
// stays the same (reaction counts and read status are part of the key).
const people = new Map<string, Promise<MsgPeople>>();
function peopleOf(m: Msg): Promise<MsgPeople> {
  const key = `${m.accountId}|${m.chatId}|${m.id}|${m.status}|${m.reactions.map((r) => r.emoji + r.count).join()}`;
  let p = people.get(key);
  if (!p) {
    p = api.msgPeople(m.accountId, m.chatId, m.id);
    people.set(key, p);
    p.catch(() => people.delete(key));
  }
  return p;
}
const joinNames = (names: string[]) => (names.length > 12 ? `${names.slice(0, 12).join(", ")} +${names.length - 12}` : names.join(", "));
/** Put the fetched text in the element's tooltip and re-show it if the pointer is still there. */
function hoverTip(el: HTMLElement, text: () => Promise<string>) {
  text().then((t) => {
    if (!t || !el.isConnected) return;
    el.dataset.tip = t;
    if (el.matches(":hover")) el.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
  }).catch(() => {});
}
/** Phone (no hover) and the context menu: the same names as a list. */
async function showPeople(m: Msg) {
  const el = document.getElementById(`m-${m.id}`);
  const at = el ? anchor(el.querySelector(".bubble") ?? el) : { x: 40, y: 80, top: 80 };
  try {
    const p = await peopleOf(m);
    const items: MenuItem[] = [
      ...p.reactions.map(([e, n]): MenuItem => ({ icon: "smile", label: `${e}  ${n}`, run: () => {} })),
      ...p.viewers.map((n): MenuItem => ({ icon: "check-check", label: n, run: () => {} })),
    ];
    if (!items.length) return toast("Chưa thấy ai");
    useApp.setState({ pop: { kind: "menu", ...at, title: p.viewers.length ? "Biểu cảm · Đã xem" : "Biểu cảm", items } });
  } catch (e) {
    fail(e);
  }
}

function showMessageMenu(e: React.MouseEvent, k: string, tab: string, m: Msg, caps: Record<Cap, boolean>, mediaItems: MenuItem[] = []) {
  e.preventDefault();
  e.stopPropagation();
  const quick = isMobile && caps.reactions && !m.deleted
    ? { pick: (emoji: string) => void toggleReaction(k, m, emoji), more: () => void pickReaction(k, m, { x: 0, y: 0, top: 0 }) }
    : undefined;
  useApp.setState({ pop: { kind: "menu", x: e.clientX, y: e.clientY, top: e.clientY,
    title: `${dayLabel(m.ts)} · ${hm(m.ts)}`, items: [...menuFor(k, tab, m, caps), ...mediaItems], quick } });
}

function menuFor(k: string, tab: string, m: Msg, caps: Record<Cap, boolean>): MenuItem[] {
  const items: (MenuItem | false)[] = [
    { icon: "reply", label: "Trả lời", run: () => setReply(tab, m) },
    caps.reactions && { icon: "smile", label: "Thả biểu cảm", run: () => {
      const el = document.getElementById(`m-${m.id}`);
      void pickReaction(k, m, el ? anchor(el.querySelector('.bubble') ?? el) : { x: 40, y: 80, top: 80 });
    } },
    (m.reactions.length > 0 || (m.outgoing && m.status === "seen" && caps.readReceipts)) && { icon: "users", label: "Ai đã xem / thả biểu cảm", run: () => void showPeople(m) },
    caps.threads && !!m.threadId && { icon: "message-circle-reply", label: isMobile ? "Mở luồng trả lời" : "Mở luồng trả lời trong tab", run: () => openThread(k, m) },
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

const glyphs = new Map<string, boolean>();
/** macOS lags Unicode: an emoji newer than Apple Color Emoji draws as an empty box.
 *  A drawn emoji has coloured pixels; the box is the plain fill colour. */
function hasGlyph(e: string) {
  let ok = glyphs.get(e);
  if (ok === undefined) {
    const g = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
    if (!g) return true;
    g.canvas.width = g.canvas.height = 24;
    g.font = "20px 'Apple Color Emoji'";
    g.textBaseline = "top";
    g.fillText(e, 0, 0);
    const px = g.getImageData(0, 0, 24, 24).data;
    ok = false;
    for (let i = 0; i < px.length && !ok; i += 4) ok = px[i + 3] > 0 && (px[i] !== px[i + 1] || px[i + 1] !== px[i + 2]);
    glyphs.set(e, ok);
  }
  return ok;
}

/** Falls back to Google's Noto emoji image for emoji the system font can't draw. */
function Emoji({ e }: { e: string }) {
  if (hasGlyph(e)) return <>{e}</>;
  const cp = [...e].map((c) => c.codePointAt(0)!.toString(16)).filter((h) => h !== "fe0f").join("_");
  return <img className="emoji-img" alt={e} src={`https://fonts.gstatic.com/s/e/notoemoji/latest/${cp}/emoji.svg`} />;
}
