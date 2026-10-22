// Mirrors src-tauri/src/model.rs (serde camelCase).
export type Platform = "telegram" | "gchat";
export type HealthState = "ok" | "syncing" | "offline" | "reconnecting" | "expired" | "rate";

export interface Account {
  id: string;
  platform: Platform;
  name: string;
  color: string;
  handle: string;
  selfId: string;
}

export interface Health { health: HealthState; text: string; until: number }

export interface Chat {
  accountId: string;
  id: string;
  kind: "dm" | "group" | "channel" | "space";
  title: string;
  description: string;
  lastTs: number;
  preview: string;
  previewFrom: string;
  unread: number;
  mention: boolean;
  muted: boolean;
  memberCount: number;
  order: number;
  pinned: boolean;
  canSend: boolean;
  threaded: boolean;
  created: string;
  /** local path or https URL */
  photo: string;
  /** TDLib file id still to download */
  photoRef: string;
}

export interface Media {
  kind: "image" | "video" | "file" | "voice" | "sticker";
  name: string;
  size: number;
  mime: string;
  width: number;
  height: number;
  fileRef: string;
  localPath: string;
  thumb: string;
  url: string;
}

export interface LinkCard { url: string; site: string; title: string; desc: string }
export interface Reaction { emoji: string; count: number; mine: boolean }

export interface Msg {
  accountId: string;
  chatId: string;
  id: string;
  sort: number;
  senderId: string;
  senderName: string;
  /** local path, https URL, or TDLib file id */
  senderPhoto: string;
  outgoing: boolean;
  ts: number;
  edited: boolean;
  deleted: boolean;
  kind: "text" | "media" | "service";
  text: string;
  media: Media | null;
  link: LinkCard | null;
  replyTo: string;
  replyName: string;
  replyText: string;
  reactions: Reaction[];
  threadId: string;
  threadReply: boolean;
  status: "" | "sending" | "sent" | "seen" | "failed";
  error: string;
  pinned: boolean;
  mentionsMe: boolean;
  rev: string;
}

export interface Member { id: string; name: string; status: string; role: string }

export type CoreEvent =
  | { type: "accounts"; accounts: Account[] }
  | { type: "health"; accountId: string; health: HealthState; text: string; until: number }
  | { type: "auth"; accountId: string; step: "phone" | "code" | "password" | "qr" | "ready" | "error"; info: string; error: string }
  | { type: "chat"; chat: Chat }
  | { type: "chatRemoved"; accountId: string; chatId: string }
  | { type: "message"; msg: Msg; isNew: boolean }
  | { type: "messageIdChanged"; oldId: string; msg: Msg }
  | { type: "messagesDeleted"; accountId: string; chatId: string; ids: string[] }
  | { type: "readOutbox"; accountId: string; chatId: string; upTo: number }
  | { type: "typing"; accountId: string; chatId: string; who: string; on: boolean }
  | { type: "sync"; accountId: string; step: number; state: "run" | "ok" | "err"; log: string };

export interface AppState {
  accounts: Account[];
  health: Record<string, Health>;
  chats: Chat[];
  tgConfigured: boolean;
  gchatConfigured: boolean;
}

export interface AiView { format: "openai" | "anthropic"; endpoint: string; model: string; guide: string; hasKey: boolean }
export interface Suggestion { reply: string; meaning: string }
