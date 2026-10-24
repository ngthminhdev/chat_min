//! Platform-neutral shapes. Every connector translates into these; the frontend and the
//! SQLite cache only ever see these.
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Account {
    pub id: String,
    /// "telegram" | "gchat"
    pub platform: String,
    pub name: String,
    pub color: String,
    /// phone / @username / email — shown next to the name
    pub handle: String,
    /// platform user id of the logged-in user
    pub self_id: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct Chat {
    pub account_id: String,
    pub id: String,
    /// "dm" | "group" | "channel" | "space"
    pub kind: String,
    pub title: String,
    pub description: String,
    /// unix ms of the last message
    pub last_ts: i64,
    pub preview: String,
    pub preview_from: String,
    pub unread: i32,
    pub mention: bool,
    pub muted: bool,
    pub member_count: i32,
    /// sidebar order inside the account, higher first
    pub order: i64,
    pub pinned: bool,
    pub can_send: bool,
    /// gchat only: replies live in threads
    pub threaded: bool,
    pub created: String,
    /// avatar: local file path or https URL once known
    pub photo: String,
    /// TDLib file id still to download for the avatar
    pub photo_ref: String,
    /// Telegram supergroup with topics
    #[serde(default)]
    pub forum: bool,
}

/// A topic of a Telegram forum supergroup.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct Topic {
    pub account_id: String,
    pub chat_id: String,
    pub id: String,
    pub name: String,
    /// topic icon colour, 0xRRGGBB
    pub color: i32,
    pub unread: i32,
    pub mention: bool,
    pub last_ts: i64,
    pub preview: String,
    pub preview_from: String,
    pub pinned: bool,
    pub closed: bool,
    pub general: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct Media {
    /// "image" | "video" | "file" | "voice" | "sticker"
    pub kind: String,
    pub name: String,
    pub size: i64,
    pub mime: String,
    pub width: i32,
    pub height: i32,
    /// what `download` needs: TDLib file id, or a gchat attachment resource name
    pub file_ref: String,
    pub local_path: String,
    /// tiny inline preview (data: URL) shown until the real file arrives
    pub thumb: String,
    /// sharper preview than `thumb`: TDLib file id, or a local path once downloaded
    #[serde(default)]
    pub thumb_file: String,
    /// gchat Drive attachments open in the browser instead of downloading
    pub url: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct LinkCard {
    pub url: String,
    pub site: String,
    pub title: String,
    pub desc: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct Reaction {
    pub emoji: String,
    pub count: i32,
    pub mine: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct Msg {
    pub account_id: String,
    pub chat_id: String,
    pub id: String,
    /// ordering key inside a chat: TDLib message id, or gchat create time in ms
    pub sort: i64,
    pub sender_id: String,
    pub sender_name: String,
    /// sender avatar: local path, https URL, or a TDLib file id to download
    pub sender_photo: String,
    pub outgoing: bool,
    pub ts: i64,
    pub edited: bool,
    pub deleted: bool,
    /// "text" | "media" | "service"
    pub kind: String,
    /// plain text; `code` in backticks, mentions as @{Name}
    pub text: String,
    pub media: Option<Media>,
    /// Telegram media_album_id: photos/videos sent together render as one grid
    #[serde(default)]
    pub album_id: String,
    pub link: Option<LinkCard>,
    pub reply_to: String,
    pub reply_name: String,
    pub reply_text: String,
    pub reactions: Vec<Reaction>,
    /// gchat thread resource name
    pub thread_id: String,
    pub thread_reply: bool,
    /// "" | "sending" | "sent" | "seen" | "failed"
    pub status: String,
    pub error: String,
    pub pinned: bool,
    pub mentions_me: bool,
    /// gchat lastUpdateTime, needed to quote a message
    pub rev: String,
}

/// Who reacted to / read one message (reaction tooltips, "seen by" list).
#[derive(Clone, Debug, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct MsgPeople {
    /// (emoji, display name) per added reaction
    pub reactions: Vec<(String, String)>,
    /// names of readers — Telegram only, outgoing messages in groups of ≤ 100 members
    pub viewers: Vec<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Member {
    pub id: String,
    pub name: String,
    pub status: String,
    pub role: String,
}

/// Everything pushed to the frontend goes through one event name, tagged by `type`.
#[derive(Clone, Debug, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum Event {
    #[serde(rename_all = "camelCase")]
    Accounts { accounts: Vec<Account> },
    #[serde(rename_all = "camelCase")]
    Health { account_id: String, health: String, text: String, until: i64 },
    #[serde(rename_all = "camelCase")]
    Auth { account_id: String, step: String, info: String, error: String },
    Chat { chat: Chat },
    #[serde(rename_all = "camelCase")]
    ChatRemoved { account_id: String, chat_id: String },
    #[serde(rename_all = "camelCase")]
    /// `inbox`: a new message for the titlebar bell (mention, DM, reply in a thread I posted in)
    Message { msg: Msg, is_new: bool, #[serde(default)] inbox: bool },
    #[serde(rename_all = "camelCase")]
    MessageIdChanged { old_id: String, msg: Msg },
    #[serde(rename_all = "camelCase")]
    MessagesDeleted { account_id: String, chat_id: String, ids: Vec<String> },
    /// a notification was clicked: open this chat ("account|chat")
    Open { key: String, msg: String, thread: String },
    /// a big download in progress, in whole percent
    #[serde(rename_all = "camelCase")]
    FileProgress { account_id: String, file_ref: String, pct: i64 },
    #[serde(rename_all = "camelCase")]
    ReadOutbox { account_id: String, chat_id: String, up_to: i64 },
    /// someone else reacted to my message
    Reacted { msg: Msg, emoji: String },
    #[serde(rename_all = "camelCase")]
    Presence { account_id: String, user_id: String, online: bool },
    #[serde(rename_all = "camelCase")]
    Typing { account_id: String, chat_id: String, who: String, on: bool },
    #[serde(rename_all = "camelCase")]
    Sync { account_id: String, step: usize, state: String, log: String },
}
