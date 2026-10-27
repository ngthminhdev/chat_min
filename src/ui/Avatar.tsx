import { useEffect, useState } from "react";
import { api, fileSrc } from "../lib/bridge";
import { initials } from "../lib/format";
import { useApp } from "../store";
import type { Chat, Platform } from "../lib/types";
import { Glyph, Icon } from "./Icon";

// Telegram avatars arrive as TDLib file ids; download each once per session.
const downloads = new Map<string, Promise<string>>();

/** photo = local path | https URL | TDLib file id (digits). Returns an <img> src or "". */
export function useAvatar(accountId: string, photo: string): string {
  // Zalo URLs go through the bounded native cache once; never issue a duplicate browser fetch.
  const cacheZalo = accountId.startsWith("zalo-") && photo.startsWith("https://");
  const direct = cacheZalo || !photo ? "" : /^(https?|data):/.test(photo) ? photo : photo.startsWith("/") ? fileSrc(photo) : "";
  const identity = `${accountId}|${photo}`;
  const [resolved, setResolved] = useState({ identity, src: direct });
  useEffect(() => {
    setResolved({ identity, src: direct });
    if (!cacheZalo && (direct || !/^\d+$/.test(photo))) return;
    const k = `${accountId}|${photo}`;
    if (!downloads.has(k)) downloads.set(k, api.download(accountId, photo, "avatar").catch(() => { downloads.delete(k); return ""; }));
    let alive = true;
    downloads.get(k)!.then((p) => alive && p && setResolved({ identity, src: fileSrc(p) }));
    return () => {
      alive = false;
    };
  }, [accountId, photo]);
  // A reused row must never paint the previous person while its effect catches up.
  return resolved.identity === identity ? resolved.src : direct;
}

const HUES = ["blue", "purple", "green", "orange", "pink", "amber", "red", "slate"];
const hue = (s: string) => HUES[[...s].reduce((h, c) => (h * 31 + c.codePointAt(0)!) >>> 0, 7) % HUES.length];

function Face({ src, fallback, cls, title, tint, platform, online }: { src: string; fallback: React.ReactNode; cls: string; title?: string; tint: string; platform?: Platform; online?: boolean }) {
  const [brokenSrc, setBrokenSrc] = useState<string | null>(null);
  const broken = brokenSrc === src;
  return (
    <span className={`${cls}${src && !broken ? " has-img" : ""}${online ? " online" : ""}`} title={online ? `${title ?? ""} · đang online`.replace(/^ · /, "") : title} style={{ "--av": `var(--conn-${tint})` } as React.CSSProperties}>
      {src && !broken ? <img src={src} alt="" draggable={false} onError={() => setBrokenSrc(src)} /> : fallback}
      {platform && (
        <span className="avatar-badge" aria-hidden="true">
          <Glyph platform={platform} />
        </span>
      )}
    </span>
  );
}

/** Chat avatar: photo when known, else initials tinted per chat (circle = person, square = group). */
export function ChatAvatar({ chat, size = "", platform }: { chat: Chat; size?: "" | "sm" | "lg"; platform?: Platform }) {
  const src = useAvatar(chat.accountId, chat.photo || chat.photoRef);
  const group = chat.kind !== "dm";
  const fallback =
    chat.kind === "space" ? <Icon name="hash" /> : chat.kind === "channel" ? <Icon name="megaphone" /> : initials(chat.title || "?", group);
  // a Telegram private chat's id is the other user's id
  const online = useApp((s) => !group && !!s.online[`${chat.accountId}|${chat.id}`]);
  return <Face src={src} fallback={fallback} cls={`avatar tinted${group ? " group" : ""} ${size}`} tint={hue(chat.id)} platform={platform} online={online} />;
}

export function PersonAvatar({ name, size = "", accountId = "", photo = "", userId = "" }: { name: string; size?: "" | "sm" | "lg"; accountId?: string; photo?: string; userId?: string }) {
  const src = useAvatar(accountId, photo);
  const online = useApp((s) => !!userId && !!s.online[`${accountId}|${userId}`]);
  return <Face src={src} fallback={initials(name || "?")} cls={`avatar tinted ${size}`} title={name} tint={hue(name || "?")} online={online} />;
}
