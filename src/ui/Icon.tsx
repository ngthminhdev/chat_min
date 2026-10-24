import {
  ArrowDown, AtSign, AudioLines, Bell, BellOff, Check, CheckCheck, ChevronDown, ChevronLeft, ChevronRight, CircleAlert, Clock, Copy,
  CornerDownRight, Download, Ellipsis, ExternalLink, FileArchive, FileCode, FileText, Film, Folder, FolderOpen, FolderPlus, Forward, Hash, Image,
  Inbox, Info, KeyRound, Languages, Layers, Link, Lock, Mail, Megaphone, MessageCircleReply, MessageSquareText, MessagesSquare, Mic,
  Palette, PanelLeft, PanelRight, Paperclip, Pencil, Phone, Pin, PinOff, Play, Plus, Minus, QrCode, RefreshCw, Reply, RotateCw,
  Search, Send, Settings, Smile, Sparkles, Sticker, Trash2, Undo2, UserPlus, Users, WifiOff, X, type LucideIcon,
  // folder icons (Folders.tsx picker)
  Bookmark, BookOpen, Bot, Briefcase, Building2, Camera, Car, Cat, Cloud, Code, Coffee, Database, Dog, Dumbbell, Flag, Flame, Gamepad2,
  Gift, Globe, GraduationCap, Heart, Home, Leaf, Lightbulb, MessageCircle, Moon, Music, Newspaper, Plane, Rocket, Server, Shield,
  ShoppingBag, Star, Sun, Tag, Terminal, Wallet, Wrench, Zap,
} from "lucide-react";
import type { Platform } from "../lib/types";
import telegramLogo from "../assets/brands/telegram.svg";
import gchatLogo from "../assets/brands/gchat.svg";
import messengerLogo from "../assets/brands/messenger.svg";
import zaloLogo from "../assets/brands/zalo.svg";

const ICONS = {
  "arrow-down": ArrowDown, "at-sign": AtSign, "audio-lines": AudioLines, bell: Bell, "bell-off": BellOff, check: Check,
  "check-check": CheckCheck, "chevron-down": ChevronDown, "chevron-left": ChevronLeft, "chevron-right": ChevronRight, "circle-alert": CircleAlert,
  clock: Clock, copy: Copy, "corner-down-right": CornerDownRight, download: Download, ellipsis: Ellipsis,
  "external-link": ExternalLink, "file-archive": FileArchive, "file-code": FileCode, "file-text": FileText, film: Film,
  folder: Folder, "folder-open": FolderOpen, "folder-plus": FolderPlus, forward: Forward, hash: Hash, image: Image, inbox: Inbox, info: Info, "key-round": KeyRound,
  languages: Languages, layers: Layers, link: Link, lock: Lock, mail: Mail, megaphone: Megaphone, "message-circle-reply": MessageCircleReply,
  "message-square-text": MessageSquareText, "messages-square": MessagesSquare, mic: Mic, palette: Palette,
  "panel-left": PanelLeft, "panel-right": PanelRight, paperclip: Paperclip, pencil: Pencil, phone: Phone, pin: Pin,
  "pin-off": PinOff, play: Play, plus: Plus, minus: Minus, "qr-code": QrCode, "refresh-cw": RefreshCw, reply: Reply, "rotate-cw": RotateCw,
  search: Search, send: Send, settings: Settings, smile: Smile, sparkles: Sparkles, sticker: Sticker, "trash-2": Trash2, "undo-2": Undo2, "user-plus": UserPlus,
  users: Users, "wifi-off": WifiOff, x: X,
  bookmark: Bookmark, "book-open": BookOpen, bot: Bot, briefcase: Briefcase, "building-2": Building2, camera: Camera, car: Car, cat: Cat,
  cloud: Cloud, code: Code, coffee: Coffee, database: Database, dog: Dog, dumbbell: Dumbbell, flag: Flag, flame: Flame, "gamepad-2": Gamepad2,
  gift: Gift, globe: Globe, "graduation-cap": GraduationCap, heart: Heart, home: Home, leaf: Leaf, lightbulb: Lightbulb, "message-circle": MessageCircle,
  moon: Moon, music: Music, newspaper: Newspaper, plane: Plane, rocket: Rocket, server: Server, shield: Shield, "shopping-bag": ShoppingBag,
  star: Star, sun: Sun, tag: Tag, terminal: Terminal, wallet: Wallet, wrench: Wrench, zap: Zap,
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
