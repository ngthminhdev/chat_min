import type { Platform } from "./types";

// CAPABILITY: one layout for every platform. A feature the platform lacks is hidden or
// dimmed with a tooltip — never a platform-specific screen. Messenger is web-backed; Zalo uses the native connector.
export type Cap = "reply" | "reactions" | "edit" | "delete" | "pin" | "threads" | "stickers" | "voice" | "readReceipts" | "typing";

export const PLATFORMS: Record<Platform, { name: string; caps: Record<Cap, boolean> }> = {
  telegram: {
    name: "Telegram",
    caps: { reply: true, reactions: true, edit: true, delete: true, pin: true, threads: false, stickers: true, voice: true, readReceipts: true, typing: true },
  },
  // web apps run in their own webview: ChatMin's own message tools don't apply
  messenger: { name: "Messenger", caps: { reply: false, reactions: false, edit: false, delete: false, pin: false, threads: false, stickers: false, voice: false, readReceipts: false, typing: false } },
  zalo: { name: "Zalo", caps: { reply: true, reactions: true, edit: false, delete: true, pin: false, threads: false, stickers: true, voice: false, readReceipts: true, typing: true } },
  gchat: {
    name: "Google Chat",
    caps: { reply: true, reactions: true, edit: true, delete: true, pin: false, threads: true, stickers: false, voice: true, readReceipts: false, typing: false },
  },
};

export const CAP_LABELS: Record<Cap, string> = {
  reply: "Trả lời / trích dẫn", reactions: "Biểu cảm", edit: "Sửa tin đã gửi", delete: "Xoá với mọi người",
  pin: "Ghim tin", threads: "Luồng trả lời trong không gian chung", stickers: "Sticker", voice: "Tin nhắn thoại",
  readReceipts: "Trạng thái đã xem", typing: "Đang gõ…",
};

export const CAP_OFF_NOTE: Partial<Record<Cap, string>> = {
  threads: "Dùng Trả lời để trích dẫn tin nhắn trên Telegram",
  stickers: "Google Chat không có sticker",
  readReceipts: "Google Chat không trả “đã xem” cho space/nhóm",
  pin: "Google Chat API không hỗ trợ ghim tin",
  typing: "Google Chat API không có trạng thái đang gõ",
};

export const COLORS = ["blue", "purple", "green", "orange", "red", "amber", "pink", "slate"] as const;
export const COLOR_LABELS: Record<string, string> = {
  blue: "Xanh dương", purple: "Tím", green: "Xanh lá", orange: "Cam", red: "Đỏ", amber: "Vàng", pink: "Hồng", slate: "Slate",
};
export const HEALTH_LABELS: Record<string, string> = {
  ok: "Đã đồng bộ", syncing: "Đang đồng bộ", offline: "Mất kết nối", reconnecting: "Đang kết nối lại", expired: "Phiên hết hạn", rate: "Tạm giới hạn yêu cầu",
};
