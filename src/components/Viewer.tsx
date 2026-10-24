import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { EASE } from "../lib/motion";
import { isMobile } from "../lib/mobile";
import { api, fileSrc, isTauri, openPath, revealPath, streamSrc } from "../lib/bridge";
import { fileSize } from "../lib/format";
import type { Media } from "../lib/types";
import { chatKeyOf, fail, saveMedia, useApp } from "../store";
import { Icon } from "../ui/Icon";
import { viewerSwipe } from "../lib/mobile-gestures";
import { ZoomableImage, type ImageZoomControls } from "./ZoomableImage";

const gallery = (m: Media | null) => !!m && (m.kind === "image" || m.kind === "video") && !["Sticker", "GIF", "Video tròn"].includes(m.name);
const sameMedia = (a: Media, b: Media) => (a.fileRef && a.fileRef === b.fileRef) || (!!a.localPath && a.localPath === b.localPath);

/** Full-window viewer: images fit the window (click for 100%), videos play with sound.
 *  ← → (arrows, keys, a horizontal swipe) walk every photo/video of the open chat, like Telegram. */
export function Viewer() {
  const v = useApp((s) => s.viewer);
  const [zoom, setZoom] = useState(false);
  const [direction, setDirection] = useState(1);
  const [loadError, setLoadError] = useState(false);
  const [retryLoad, setRetryLoad] = useState(0);
  const swipe = useRef<{ x: number; y: number } | null>(null);
  const suppressClick = useRef(false);
  const imageZoom = useRef<ImageZoomControls>(null);
  const list = useApp((s) => { const k = chatKeyOf(s.active); return k ? s.msgs[k] : undefined; });
  const items = useMemo(() => (list ?? []).filter((m) => !m.deleted && gallery(m.media) && (!v?.galleryIds || v.galleryIds.includes(m.id))).map((m) => ({ id: m.id, media: m.media!, accountId: m.accountId })), [list, v?.galleryIds]);
  // the store's own Media object first (demo data shares fileRefs), then by file id/path once a reload replaced the message
  const idx = v ? (() => { const i = items.findIndex((i) => v.messageId ? i.id === v.messageId : i.media === v.media); return i >= 0 ? i : items.findIndex((i) => sameMedia(i.media, v.media)); })() : -1;
  const go = async (d: number) => {
    const t = idx < 0 ? undefined : items[idx + d];
    if (!t) return;
    setZoom(false);
    setDirection(d);
    const { media, accountId } = t;
    const context = { accountId, messageId: t.id, galleryIds: v?.galleryIds };
    if (media.kind === "video" && isTauri && !media.localPath && /^\d+$/.test(media.fileRef)) {
      return useApp.setState({ viewer: { media, path: "", src: streamSrc(accountId, media.fileRef, media.mime), ...context } });
    }
    // Select immediately: a slow download must not make swipes feel ignored or reopen a
    // dismissed viewer. The effect below only resolves the selection still on screen.
    useApp.setState({ viewer: { media, path: media.localPath || "", ...context } });
  };
  useEffect(() => {
    setLoadError(false);
    if (!v || v.path || v.src || !v.accountId) return;
    let live = true;
    void api.download(v.accountId, v.media.fileRef, v.media.name).then(path => {
      if (live && path && useApp.getState().viewer === v) useApp.setState({ viewer: { ...v, path } });
    }).catch(e => { if (live) { setLoadError(true); fail(e); } });
    return () => { live = false; };
  }, [v, retryLoad]);
  // a streaming video has no local file yet: saving/opening it downloads the whole thing first
  const local = async () => {
    if (!v) return "";
    if (v.path || !v.accountId) return v.path;
    return api.download(v.accountId, v.media.fileRef, v.media.name).catch((e) => (fail(e), ""));
  };
  const keep = (ask: boolean) => void local().then((p) => { if (p) void saveMedia(p, v!.media.name, ask); });
  // ⌘S saves to the download folder (Settings), ⌘⇧S asks where
  useEffect(() => {
    if (!v) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        keep(e.shiftKey);
      }
      if (e.key === "ArrowLeft") void go(-1);
      if (e.key === "ArrowRight") void go(1);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [v, idx, items]);
  const close = () => {
    setZoom(false);
    useApp.setState({ viewer: null });
  };
  return (
    <AnimatePresence>
      {v && (
        <motion.div
          className={`viewer${zoom ? " zoom" : ""}`}
          role="dialog"
          aria-label={v.media.name}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.16 }}
          onClick={close}
        >
          <div className="viewer-bar" onClick={(e) => e.stopPropagation()}>
            <span className="viewer-name">
              <strong>{v.media.name}</strong>
              {v.media.size > 0 && <small>{fileSize(v.media.size)}</small>}
              {idx >= 0 && items.length > 1 && <small>{idx + 1} / {items.length}</small>}
            </span>
            {isMobile && v.media.kind === "image" && <>
              <button className="tool-btn icon-only" aria-label="Thu nhỏ ảnh" disabled={!v.path} onClick={() => imageZoom.current?.zoomOut()}><Icon name="minus" /></button>
              <button className="tool-btn icon-only" aria-label="Phóng to ảnh" disabled={!v.path} onClick={() => imageZoom.current?.zoomIn()}><Icon name="plus" /></button>
            </>}
            <button className="tool-btn icon-only" aria-label="Lưu vào thư mục tải về" data-tip="Lưu vào thư mục tải về" data-kbd="⌘S" onClick={() => keep(false)}>
              <Icon name="download" />
            </button>
            {!isMobile && <button className="tool-btn icon-only" aria-label="Lưu thành" data-tip="Lưu thành…" data-kbd="⌘⇧S" onClick={() => keep(true)}>
              <Icon name="folder-open" />
            </button>}
            {!isMobile && <button className="tool-btn icon-only" aria-label="Mở bằng app mặc định" data-tip="Mở bằng app mặc định" onClick={() => void local().then((p) => { if (p) openPath(p).catch(fail); })}>
              <Icon name="external-link" />
            </button>}
            {!isMobile && <button className="tool-btn icon-only" aria-label="Hiện trong Finder" data-tip="Hiện trong Finder" onClick={() => void local().then((p) => { if (p) revealPath(p).catch(fail); })}>
              <Icon name="search" />
            </button>}
            <button className="tool-btn icon-only" aria-label="Đóng" data-tip="Đóng" data-kbd="Esc" onClick={close}>
              <Icon name="x" />
            </button>
          </div>
          {idx > 0 && !zoom && (
            <button className="viewer-nav prev" aria-label="Ảnh trước" onClick={(e) => { e.stopPropagation(); void go(-1); }}>
              <Icon name="chevron-left" />
            </button>
          )}
          {idx >= 0 && idx < items.length - 1 && !zoom && (
            <button className="viewer-nav next" aria-label="Ảnh sau" onClick={(e) => { e.stopPropagation(); void go(1); }}>
              <Icon name="chevron-right" />
            </button>
          )}
          <motion.div
            key={v.messageId || v.media.fileRef || v.path || v.src}
            className="viewer-stage"
            initial={isMobile ? { x: direction * 36, opacity: 0.5 } : { scale: 0.96, opacity: 0 }}
            animate={{ scale: 1, x: 0, opacity: 1 }}
            exit={{ scale: 0.96, opacity: 0 }}
            transition={{ duration: 0.2, ease: EASE }}
            onClick={(e) => { if (isMobile || suppressClick.current) e.stopPropagation(); suppressClick.current = false; }}
            onPointerDown={(e) => {
              if (e.pointerType !== "touch" || !e.isPrimary || zoom || (e.target as Element).closest("button")) { swipe.current = null; return; }
              // Leave the native video's bottom seek/control strip to the player.
              const video = (e.target as Element).closest("video");
              if (video && e.clientY > video.getBoundingClientRect().bottom - 64) { swipe.current = null; return; }
              suppressClick.current = false;
              swipe.current = { x: e.clientX, y: e.clientY };
            }}
            onPointerMove={(e) => {
              const s = swipe.current;
              if (!s) return;
              if (Math.hypot(e.clientX - s.x, e.clientY - s.y) > 12) suppressClick.current = true;
            }}
            onPointerCancel={() => { swipe.current = null; }}
            onPointerUp={(e) => {
              const s = swipe.current; swipe.current = null;
              if (!s) return;
              const action = viewerSwipe(e.clientX - s.x, e.clientY - s.y);
              if (action === "next") void go(1);
              else if (action === "previous") void go(-1);
              else if (action === "close") close();
            }}
          >
            {!v.path && !v.src ? <span className="viewer-loading" role="status">{loadError ? <>Không tải được ảnh <button className="tool-btn" onClick={() => setRetryLoad(n => n + 1)}>Thử lại</button></> : <><span className="veil-spinner" /> Đang tải ảnh…</>}</span> : v.media.kind === "video" ? (
              <video src={v.src ?? fileSrc(v.path)} controls autoPlay playsInline onClick={(e) => e.stopPropagation()} />
            ) : isMobile ? (
              <ZoomableImage ref={imageZoom} src={fileSrc(v.path)} alt={v.media.name} onSwipe={action => action === "close" ? close() : void go(action === "next" ? 1 : -1)} />
            ) : (
              <img
                src={fileSrc(v.path)}
                alt={v.media.name}
                draggable={false}
                onClick={(e) => {
                  e.stopPropagation();
                  if (!isMobile) setZoom((z) => !z);
                }}
              />
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
