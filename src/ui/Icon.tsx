import {
  ArrowDown, AtSign, AudioLines, Bell, BellOff, Check, CheckCheck, ChevronDown, ChevronRight, CircleAlert, Clock, Copy,
  CornerDownRight, Download, Ellipsis, ExternalLink, FileArchive, FileCode, FileText, Film, FolderOpen, Forward, Hash, Image,
  Inbox, Info, KeyRound, Languages, Layers, Link, Lock, Mail, Megaphone, MessageCircleReply, MessageSquareText, MessagesSquare, Mic,
  Palette, PanelLeft, PanelRight, Paperclip, Pencil, Phone, Pin, PinOff, Play, Plus, QrCode, RefreshCw, Reply, RotateCw,
  Search, Send, Settings, Smile, Sparkles, Sticker, Trash2, Undo2, UserPlus, Users, WifiOff, X, type LucideIcon,
} from "lucide-react";
import type { Platform } from "../lib/types";

const ICONS = {
  "arrow-down": ArrowDown, "at-sign": AtSign, "audio-lines": AudioLines, bell: Bell, "bell-off": BellOff, check: Check,
  "check-check": CheckCheck, "chevron-down": ChevronDown, "chevron-right": ChevronRight, "circle-alert": CircleAlert,
  clock: Clock, copy: Copy, "corner-down-right": CornerDownRight, download: Download, ellipsis: Ellipsis,
  "external-link": ExternalLink, "file-archive": FileArchive, "file-code": FileCode, "file-text": FileText, film: Film,
  "folder-open": FolderOpen, forward: Forward, hash: Hash, image: Image, inbox: Inbox, info: Info, "key-round": KeyRound,
  languages: Languages, layers: Layers, link: Link, lock: Lock, mail: Mail, megaphone: Megaphone, "message-circle-reply": MessageCircleReply,
  "message-square-text": MessageSquareText, "messages-square": MessagesSquare, mic: Mic, palette: Palette,
  "panel-left": PanelLeft, "panel-right": PanelRight, paperclip: Paperclip, pencil: Pencil, phone: Phone, pin: Pin,
  "pin-off": PinOff, play: Play, plus: Plus, "qr-code": QrCode, "refresh-cw": RefreshCw, reply: Reply, "rotate-cw": RotateCw,
  search: Search, send: Send, settings: Settings, smile: Smile, sparkles: Sparkles, sticker: Sticker, "trash-2": Trash2, "undo-2": Undo2, "user-plus": UserPlus,
  users: Users, "wifi-off": WifiOff, x: X,
} satisfies Record<string, LucideIcon>;

export type IconName = keyof typeof ICONS;

/** lucide icon with the design-system sizing hooks (.od-icon/.ic, --od-icon-size). */
export function Icon({ name, className = "" }: { name: IconName; className?: string }) {
  const C = ICONS[name];
  return <C className={`od-icon ic ${className}`} aria-hidden="true" />;
}

const GLYPHS: Record<Platform, string> = {
  telegram:
    "M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z",
  gchat:
    "M1.637 0C.733 0 0 .733 0 1.637v16.5c0 .904.733 1.636 1.637 1.636h3.955v3.323c0 .804.97 1.207 1.539.638l3.963-3.96h11.27c.903 0 1.636-.733 1.636-1.637V5.592L18.408 0Zm3.955 5.592h12.816v8.59H8.455l-2.863 2.863Z",
};

/** Platform logo, filled — sits next to the connection dot. */
export function Glyph({ platform }: { platform: Platform }) {
  return (
    <svg className="od-icon glyph" viewBox="0 0 24 24" aria-hidden="true">
      <path d={GLYPHS[platform]} />
    </svg>
  );
}
