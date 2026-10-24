import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { EASE } from "../lib/motion";
import { isMobile } from "../lib/mobile";
import { api, fileSrc, openPath, revealPath } from "../lib/bridge";
import { fileSize } from "../lib/format";
import { fail, saveMedia, useApp } from "../store";
import { Icon } from "../ui/Icon";

/** Full-window viewer: images fit the window (click for 100%), videos play with sound. */
export function Viewer() {
  const v = useApp((s) => s.viewer);
  const [zoom, setZoom] = useState(false);
  const swipe = useRef<number | null>(null);
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
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [v]);
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
          // phone: a downward swipe closes, like every gallery
          onTouchStart={(e) => { swipe.current = zoom ? null : e.touches[0].clientY; }}
          onTouchEnd={(e) => { if (swipe.current != null && e.changedTouches[0].clientY - swipe.current > 90) close(); swipe.current = null; }}
        >
          <div className="viewer-bar" onClick={(e) => e.stopPropagation()}>
            <span className="viewer-name">
              <strong>{v.media.name}</strong>
              {v.media.size > 0 && <small>{fileSize(v.media.size)}</small>}
            </span>
            <button className="tool-btn icon-only" aria-label="Lưu vào thư mục tải về" data-tip="Lưu vào thư mục tải về" data-kbd="⌘S" onClick={() => keep(false)}>
              <Icon name="download" />
            </button>
            <button className="tool-btn icon-only" aria-label="Lưu thành" data-tip="Lưu thành…" data-kbd="⌘⇧S" onClick={() => keep(true)}>
              <Icon name="folder-open" />
            </button>
            <button className="tool-btn icon-only" aria-label="Mở bằng app mặc định" data-tip="Mở bằng app mặc định" onClick={() => void local().then((p) => { if (p) openPath(p).catch(fail); })}>
              <Icon name="external-link" />
            </button>
            {!isMobile && <button className="tool-btn icon-only" aria-label="Hiện trong Finder" data-tip="Hiện trong Finder" onClick={() => void local().then((p) => { if (p) revealPath(p).catch(fail); })}>
              <Icon name="search" />
            </button>}
            <button className="tool-btn icon-only" aria-label="Đóng" data-tip="Đóng" data-kbd="Esc" onClick={close}>
              <Icon name="x" />
            </button>
          </div>
          <motion.div
            className="viewer-stage"
            initial={{ scale: 0.96, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.96, opacity: 0 }}
            transition={{ duration: 0.2, ease: EASE }}
          >
            {v.media.kind === "video" ? (
              <video src={v.src ?? fileSrc(v.path)} controls autoPlay playsInline onClick={(e) => e.stopPropagation()} />
            ) : (
              <img
                src={fileSrc(v.path)}
                alt={v.media.name}
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
