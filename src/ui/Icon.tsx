import {
  ArrowDown, AtSign, AudioLines, Bell, BellOff, Check, CheckCheck, ChevronDown, ChevronRight, CircleAlert, Clock, Copy,
  CornerDownRight, Download, Ellipsis, ExternalLink, FileArchive, FileCode, FileText, Film, FolderOpen, Forward, Hash, Image,
  Inbox, Info, KeyRound, Languages, Layers, Link, Lock, Mail, Megaphone, MessageCircleReply, MessageSquareText, MessagesSquare, Mic,
  Palette, PanelLeft, PanelRight, Paperclip, Pencil, Phone, Pin, PinOff, Play, Plus, QrCode, RefreshCw, Reply, RotateCw,
  Search, Send, Settings, Smile, Sparkles, Sticker, Trash2, Undo2, UserPlus, Users, WifiOff, X, type LucideIcon,
} from "lucide-react";
import type { Platform } from "../lib/types";
import telegramLogo from "../assets/brands/telegram.svg";
import gchatLogo from "../assets/brands/gchat.svg";
import messengerLogo from "../assets/brands/messenger.svg";
import zaloLogo from "../assets/brands/zalo.svg";

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

// official colour logos (Wikimedia Commons), shown as <img> so their gradient ids never clash
const BRANDS: Record<Platform, string> = { telegram: telegramLogo, gchat: gchatLogo, messenger: messengerLogo, zalo: zaloLogo };

/** Platform logo in brand colours — sits next to the connection dot. */
export function Glyph({ platform }: { platform: Platform }) {
  return <img className="od-icon glyph" src={BRANDS[platform]} alt="" aria-hidden="true" draggable={false} />;
}
