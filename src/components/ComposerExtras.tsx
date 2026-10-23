import { useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { api } from "../lib/bridge";
import { EASE } from "../lib/motion";
import { norm } from "../lib/format";
import type { Member, StickerPack, StickerView } from "../lib/types";
import { fail, splitKey, useApp } from "../store";
import { PersonAvatar, useAvatar } from "../ui/Avatar";
import { Icon } from "../ui/Icon";

// ── sticker picker (Telegram) ───────────────────────────────────────────────
const packsCache = new Map<string, Promise<StickerPack[]>>();

export function StickerPanel({ id, accountId, onPick, onClose }: { id?: string; accountId: string; onPick: (s: StickerView) => void; onClose: (restoreFocus?: boolean) => void }) {
  const [packs, setPacks] = useState<StickerPack[] | null>(null);
  const [tab, setTab] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const reduceMotion = useReducedMotion();
  useEffect(() => { ref.current?.querySelector<HTMLButtonElement>("button")?.focus(); }, []);
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
    const down = (e: MouseEvent) => {
      if ((e.target as HTMLElement).closest("button")?.getAttribute("aria-controls") === id) return;
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const key = (e: KeyboardEvent) => e.key === "Escape" && !e.defaultPrevented && onClose(true);
    document.addEventListener("mousedown", down);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("mousedown", down);
      document.removeEventListener("keydown", key);
    };
  }, [onClose, id]);
  const pack = packs?.[tab];
  return (
    <motion.div
      ref={ref}
      className="sticker-panel"
      id={id}
      initial={reduceMotion ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: reduceMotion ? 0 : 4 }}
      transition={{ duration: reduceMotion ? 0 : 0.16, ease: EASE }}
      role="dialog"
      aria-label="Sticker"
    >
      <div className="sticker-head"><strong>Sticker</strong><button type="button" className="tool-btn icon-only" aria-label="Đóng sticker" data-tip="Đóng sticker" data-kbd="Esc" onClick={() => onClose(true)}><Icon name="x" /></button></div>
      {!packs ? (
        <div className="sticker-empty"><span className="veil-spinner" /> Đang tải sticker…</div>
      ) : !packs.length ? (
        <div className="sticker-empty">Chưa có bộ sticker nào trong tài khoản Telegram này</div>
      ) : (
        <>
          <div className="sticker-tabs" role="tablist" aria-label="Bộ sticker">
            {packs.map((p, i) => (
              <button key={p.id} role="tab" aria-selected={i === tab} className={i === tab ? "on" : ""} aria-label={p.title} data-tip={p.title} onClick={() => setTab(i)}>
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

// ── @mentions ───────────────────────────────────────────────────────────────
const rosters = new Map<string, Promise<Member[]>>();

/** "@na…" in a group opens a member list; picked names go out as real mentions
 *  (`encode`): `<users/ID>` on Google Chat, `@[Name](id)` for tg.rs to turn into entities. */
export function useMentions(chatKey: string, ta: React.RefObject<HTMLTextAreaElement | null>, draft: string, setDraft: (v: string) => void) {
  const [accountId, chatId] = splitKey(chatKey);
  const account = useApp((s) => s.accounts.find((a) => a.id === accountId));
  const group = useApp((s) => !!s.chats[chatKey] && s.chats[chatKey].kind !== "dm");
  const [at, setAt] = useState<{ q: string; start: number } | null>(null);
  const [list, setList] = useState<Member[]>([]);
  const [sel, setSel] = useState(0);
  const picked = useRef(new Map<string, string>());
  useEffect(() => { picked.current.clear(); setAt(null); }, [chatKey]);

  useEffect(() => {
    if (!at || !group) return setList([]);
    if (!rosters.has(chatKey)) rosters.set(chatKey, api.members(accountId, chatId).catch(() => (rosters.delete(chatKey), [])));
    let alive = true;
    void rosters.get(chatKey)!.then((ms) => {
      if (!alive) return;
      const q = norm(at.q);
      const all: Member[] = account?.platform === "gchat" ? [{ id: "users/all", name: "all", status: "", role: "Mọi người trong space" }] : [];
      setList([...all, ...ms.filter((m) => m.id !== account?.selfId && m.name !== "Bạn" && m.name !== "Thành viên")]
        .filter((m) => norm(m.name).includes(q)).slice(0, 8));
      setSel(0);
    });
    return () => { alive = false; };
  }, [at?.q, chatKey, group]);

  /** call from onChange with the textarea's new value */
  const detect = (value: string, caret: number) => {
    const m = /(^|\s)@([^\n@]{0,30})$/.exec(value.slice(0, caret));
    setAt(m ? { q: m[2], start: caret - m[2].length - 1 } : null);
  };

  const pick = (m: Member) => {
    const el = ta.current;
    if (!at || !el) return;
    const caret = el.selectionStart;
    setDraft(draft.slice(0, at.start) + `@${m.name} ` + draft.slice(caret));
    picked.current.set(m.name, m.id);
    setAt(null);
    const p = at.start + m.name.length + 2;
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(p, p); });
  };

  /** true when the key was for the list */
  const onKey = (e: React.KeyboardEvent) => {
    if (!at || !list.length) return false;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") setSel((sel + (e.key === "ArrowDown" ? 1 : list.length - 1)) % list.length);
    else if ((e.key === "Enter" || e.key === "Tab") && !e.nativeEvent.isComposing) pick(list[sel]);
    else if (e.key === "Escape") setAt(null);
    else return false;
    e.preventDefault();
    e.stopPropagation();
    return true;
  };

  /** text for the platform (`wire`) and for the bubble while it sends (`shown`, @{Name} pills) */
  const encode = (text: string) => {
    let wire = text, shown = text;
    // longest first: "@Lan Phạm" before "@Lan"
    for (const [name, id] of [...picked.current].sort((a, b) => b[0].length - a[0].length)) {
      if (!text.includes(`@${name}`)) continue;
      wire = wire.split(`@${name}`).join(account?.platform === "gchat" ? `<${id}>` : `@[${name}](${id})`);
      shown = shown.split(`@${name}`).join(`@{${name}}`);
    }
    picked.current.clear();
    return { wire, shown };
  };

  const pop = at && list.length > 0 && (
    <div className="mention-pop" role="listbox" aria-label="Nhắc tên">
      {list.map((m, i) => (
        <button key={m.id} role="option" aria-selected={i === sel} className={i === sel ? "on" : ""} onMouseDown={(e) => e.preventDefault()} onClick={() => pick(m)}>
          {m.id === "users/all" ? <span className="avatar sm mention-all">@</span> : <PersonAvatar name={m.name} size="sm" accountId={accountId} userId={m.id} />}
          <span>{m.name}</span>
          {m.role && <small>{m.role}</small>}
        </button>
      ))}
    </div>
  );

  return { detect, onKey, encode, pop };
}
