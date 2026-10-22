import { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { api } from "../lib/bridge";
import { EASE } from "../lib/motion";
import type { StickerPack, StickerView } from "../lib/types";
import { fail } from "../store";
import { useAvatar } from "../ui/Avatar";
import { Icon } from "../ui/Icon";

// ── sticker picker (Telegram) ───────────────────────────────────────────────
const packsCache = new Map<string, Promise<StickerPack[]>>();

export function StickerPanel({ accountId, onPick, onClose }: { accountId: string; onPick: (s: StickerView) => void; onClose: () => void }) {
  const [packs, setPacks] = useState<StickerPack[] | null>(null);
  const [tab, setTab] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!packsCache.has(accountId)) packsCache.set(accountId, api.stickers(accountId).catch((e) => (packsCache.delete(accountId), fail(e), [])));
    let alive = true;
    void packsCache.get(accountId)!.then((p) => alive && setPacks(p));
    return () => {
      alive = false;
    };
  }, [accountId]);
  // click outside / Esc closes
  useEffect(() => {
    const down = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && onClose();
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    setTimeout(() => document.addEventListener("mousedown", down));
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("mousedown", down);
      document.removeEventListener("keydown", key);
    };
  }, [onClose]);
  const pack = packs?.[tab];
  return (
    <motion.div
      ref={ref}
      className="sticker-panel"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.16, ease: EASE }}
      role="dialog"
      aria-label="Sticker"
    >
      {!packs ? (
        <div className="sticker-empty"><span className="veil-spinner" /> Đang tải sticker…</div>
      ) : !packs.length ? (
        <div className="sticker-empty">Chưa có bộ sticker nào trong tài khoản Telegram này</div>
      ) : (
        <>
          <div className="sticker-tabs" role="tablist">
            {packs.map((p, i) => (
              <button key={p.id} role="tab" aria-selected={i === tab} className={i === tab ? "on" : ""} data-tip={p.title} onClick={() => setTab(i)}>
                {p.id === "recent" ? <Icon name="clock" /> : p.stickers[0] ? <Thumb accountId={accountId} s={p.stickers[0]} /> : p.title.slice(0, 2)}
              </button>
            ))}
          </div>
          <div className="sticker-title">{pack?.title}</div>
          <div className="sticker-grid">
            {pack?.stickers.map((s) => (
              <button key={s.id} aria-label={s.emoji || "sticker"} onClick={() => onPick(s)}>
                <Thumb accountId={accountId} s={s} />
              </button>
            ))}
          </div>
        </>
      )}
    </motion.div>
  );
}

function Thumb({ accountId, s }: { accountId: string; s: StickerView }) {
  const src = useAvatar(accountId, s.thumb);
  if (!src) return <span className="sticker-emoji">{s.emoji || "…"}</span>;
  return s.thumbKind === "video" ? <video src={src} muted loop autoPlay playsInline /> : <img src={src} alt={s.emoji} draggable={false} />;
}

// ── voice recording ─────────────────────────────────────────────────────────
// Opus where WebKit can record it (what Telegram voice notes use), AAC otherwise.
const MIMES: [string, string][] = [["audio/ogg;codecs=opus", "ogg"], ["audio/webm;codecs=opus", "webm"], ["audio/mp4", "m4a"]];

export function useRecorder() {
  const [secs, setSecs] = useState<number | null>(null);
  const rec = useRef<{ r: MediaRecorder; chunks: Blob[]; start: number; ext: string; timer: ReturnType<typeof setInterval> } | null>(null);

  const start = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const [mime, ext] = MIMES.find(([m]) => MediaRecorder.isTypeSupported(m)) ?? ["", "m4a"];
      const r = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      const chunks: Blob[] = [];
      r.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      r.start(250);
      const begun = Date.now();
      rec.current = { r, chunks, start: begun, ext, timer: setInterval(() => setSecs(Math.floor((Date.now() - begun) / 1000)), 250) };
      setSecs(0);
    } catch (e) {
      fail(`Không mở được micro: ${e}`);
    }
  };

  /** Stops; resolves to a cache file path + duration, or null when cancelled. */
  const stop = (keep: boolean): Promise<{ path: string; duration: number } | null> => {
    const cur = rec.current;
    rec.current = null;
    setSecs(null);
    if (!cur) return Promise.resolve(null);
    clearInterval(cur.timer);
    return new Promise((resolve) => {
      cur.r.onstop = async () => {
        cur.r.stream.getTracks().forEach((t) => t.stop());
        const duration = Math.max(1, Math.round((Date.now() - cur.start) / 1000));
        if (!keep || !cur.chunks.length) return resolve(null);
        const blob = new Blob(cur.chunks, { type: cur.r.mimeType });
        const data = await new Promise<string>((ok) => {
          const fr = new FileReader();
          fr.onload = () => ok(String(fr.result).split(",")[1] ?? "");
          fr.readAsDataURL(blob);
        });
        try {
          resolve({ path: await api.saveTemp(`voice-${Date.now()}.${cur.ext}`, data), duration });
        } catch (e) {
          fail(e);
          resolve(null);
        }
      };
      cur.r.stop();
    });
  };

  // never leave the mic open when the composer goes away
  useEffect(() => () => void stop(false), []);
  return { secs, recording: secs !== null, start, stop };
}

export const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
