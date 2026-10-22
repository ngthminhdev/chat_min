import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { EASE } from "../lib/motion";
import { fileSrc, openPath, revealPath } from "../lib/bridge";
import { fileSize } from "../lib/format";
import { fail, saveMedia, useApp } from "../store";
import { Icon } from "../ui/Icon";

/** Full-window viewer: images fit the window (click for 100%), videos play with sound. */
export function Viewer() {
  const v = useApp((s) => s.viewer);
  const [zoom, setZoom] = useState(false);
  // ⌘S saves to Downloads, ⌘⇧S asks where
  useEffect(() => {
    if (!v) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void saveMedia(v.path, v.media.name, e.shiftKey);
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
        >
          <div className="viewer-bar" onClick={(e) => e.stopPropagation()}>
            <span className="viewer-name">
              <strong>{v.media.name}</strong>
              {v.media.size > 0 && <small>{fileSize(v.media.size)}</small>}
            </span>
            <button className="tool-btn icon-only" aria-label="Lưu vào Downloads" data-tip="Lưu vào Downloads" data-kbd="⌘S" onClick={() => void saveMedia(v.path, v.media.name, false)}>
              <Icon name="download" />
            </button>
            <button className="tool-btn icon-only" aria-label="Lưu thành" data-tip="Lưu thành…" data-kbd="⌘⇧S" onClick={() => void saveMedia(v.path, v.media.name, true)}>
              <Icon name="folder-open" />
            </button>
            <button className="tool-btn icon-only" aria-label="Mở bằng app mặc định" data-tip="Mở bằng app mặc định" onClick={() => openPath(v.path).catch(fail)}>
              <Icon name="external-link" />
            </button>
            <button className="tool-btn icon-only" aria-label="Hiện trong Finder" data-tip="Hiện trong Finder" onClick={() => revealPath(v.path).catch(fail)}>
              <Icon name="search" />
            </button>
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
              <video src={fileSrc(v.path)} controls autoPlay playsInline onClick={(e) => e.stopPropagation()} />
            ) : (
              <img
                src={fileSrc(v.path)}
                alt={v.media.name}
                onClick={(e) => {
                  e.stopPropagation();
                  setZoom((z) => !z);
                }}
              />
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
