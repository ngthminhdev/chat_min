//! Telegram through TDLib. One TDLib client per account; a single thread drains
//! `tdlib_rs::receive()` and routes every update to its account by client id. TDLib owns
//! sync, gaps and reconnects — this module only translates updates into the shared model.
use crate::model::{Account, Chat, LinkCard, Media, Member, Msg, Reaction, Topic};
use crate::Core;
use base64::Engine;
use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex};
use tdlib_rs::enums::{self, AuthorizationState, ChatType, MessageContent, MessageSender, Update};
use tdlib_rs::{functions as f, types as t};

#[derive(Default)]
pub struct Tg {
    accs: Mutex<HashMap<i32, Acc>>,
    started: std::sync::OnceLock<()>,
}

#[derive(Default)]
struct Acc {
    account_id: String,
    /// true until the login finishes; a pending account is not saved yet
    pending: bool,
    /// user asked to log out / remove — Closed is expected, not "session expired"
    closing: bool,
    me: i64,
    username: String,
    users: HashMap<i64, String>,
    /// user id → avatar (local path when downloaded, else TDLib file id)
    photos: HashMap<i64, String>,
    chats: HashMap<i64, Chat>,
    read_outbox: HashMap<i64, i64>,
    supergroups: HashMap<i64, i64>,
    /// supergroup ids that are forums (have topics)
    forums: HashSet<i64>,
    /// file id → last reported download percent
    progress: HashMap<i32, i64>,
    /// Telegram's per-kind defaults ("mute all channels"): kind ("dm"/"group"/"channel") → muted
    scope_muted: HashMap<String, bool>,
    /// chats that follow those defaults instead of their own mute setting
    default_mute: HashSet<i64>,
    /// unmuted groups/channels kept open in TDLib so their messages arrive live (`watch`)
    watched: HashSet<i64>,
    /// chats open on screen (set_open)
    ui_open: HashSet<i64>,
    /// users Telegram reports online right now
    online: HashSet<i64>,
    watching: bool,
}

type R<T> = Result<T, String>;
fn err(e: t::Error) -> String {
    e.message
}

impl Tg {
    /// Starts the receive loop the first time a client opens — before that TDLib would
    /// only log to stderr every two seconds.
    fn start(core: Arc<Core>) {
        let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<(Update, i32)>();
        std::thread::Builder::new()
            .name("tdlib-receive".into())
            .spawn(move || loop {
                if let Some(u) = tdlib_rs::receive() {
                    if tx.send(u).is_err() {
                        break;
                    }
                }
            })
            .expect("spawn tdlib thread");
        tauri::async_runtime::spawn(async move {
            while let Some((update, client_id)) = rx.recv().await {
                core.tg.handle(&core, client_id, update);
            }
        });
    }

    /// Opens (or reopens) the TDLib client for an account. TDLib replies with its
    /// authorization state, which drives everything else.
    pub fn open(&self, core: &Arc<Core>, account_id: &str, pending: bool) -> i32 {
        self.started.get_or_init(|| Self::start(core.clone()));
        let client_id = tdlib_rs::create_client();
        self.accs.lock().unwrap().insert(
            client_id,
            Acc { account_id: account_id.into(), pending, ..Default::default() },
        );
        tauri::async_runtime::spawn(async move {
            // any request starts the update stream; also quiets TDLib's stderr logging
            let _ = f::set_log_verbosity_level(1, client_id).await;
        });
        client_id
    }

    /// Re-login of a saved account whose session expired.
    pub fn set_pending(&self, account_id: &str) {
        let mut accs = self.accs.lock().unwrap();
        if let Some(a) = accs.values_mut().find(|a| a.account_id == account_id) {
            a.pending = true;
        }
    }

    fn client(&self, account_id: &str) -> R<i32> {
        self.accs
            .lock()
            .unwrap()
            .iter()
            .find(|(_, a)| a.account_id == account_id)
            .map(|(id, _)| *id)
            .ok_or_else(|| "Telegram account chưa kết nối".to_string())
    }

    /// Drops cached files past `size` bytes / `ttl` seconds since last use (TDLib keeps
    /// what is in use or was touched in the last hour). Returns bytes freed.
    pub async fn optimize(&self, size: i64, ttl: i32) -> i64 {
        let clients: Vec<i32> = self.accs.lock().unwrap().iter().filter(|(_, a)| !a.pending).map(|(c, _)| *c).collect();
        let mut freed = 0;
        for c in clients {
            let before = f::get_storage_statistics_fast(c).await.map(|enums::StorageStatisticsFast::StorageStatisticsFast(s)| s.files_size).unwrap_or(0);
            let _ = f::optimize_storage(size, ttl, i32::MAX, -1, vec![], vec![], vec![], false, 0, c).await;
            let after = f::get_storage_statistics_fast(c).await.map(|enums::StorageStatisticsFast::StorageStatisticsFast(s)| s.files_size).unwrap_or(before);
            freed += (before - after).max(0);
        }
        freed
    }

    /// Bytes of downloaded files across Telegram accounts.
    pub async fn files_size(&self) -> i64 {
        let clients: Vec<i32> = self.accs.lock().unwrap().iter().filter(|(_, a)| !a.pending).map(|(c, _)| *c).collect();
        let mut n = 0;
        for c in clients {
            n += f::get_storage_statistics_fast(c).await.map(|enums::StorageStatisticsFast::StorageStatisticsFast(s)| s.files_size).unwrap_or(0);
        }
        n
    }

    fn with<T>(&self, client_id: i32, fun: impl FnOnce(&mut Acc) -> T) -> Option<T> {
        self.accs.lock().unwrap().get_mut(&client_id).map(fun)
    }

    // ── auth ────────────────────────────────────────────────────────────────
    pub async fn submit_phone(&self, account_id: &str, phone: String) -> R<()> {
        let c = self.client(account_id)?;
        f::set_authentication_phone_number(phone, None, c).await.map_err(err)
    }
    pub async fn submit_code(&self, account_id: &str, code: String) -> R<()> {
        let c = self.client(account_id)?;
        f::check_authentication_code(code, c).await.map_err(err)
    }
    pub async fn submit_password(&self, account_id: &str, password: String) -> R<()> {
        let c = self.client(account_id)?;
        f::check_authentication_password(password, c).await.map_err(err)
    }
    pub async fn resend_code(&self, account_id: &str) -> R<()> {
        let c = self.client(account_id)?;
        f::resend_authentication_code(None, c).await.map_err(err)
    }
    pub async fn request_qr(&self, account_id: &str) -> R<()> {
        let c = self.client(account_id)?;
        f::request_qr_code_authentication(vec![], c).await.map_err(err)
    }

    /// Log out (remove account) or just close the client (cancelled wizard).
    pub async fn close(&self, account_id: &str, log_out: bool) {
        let Ok(c) = self.client(account_id) else { return };
        self.with(c, |a| a.closing = true);
        let _ = if log_out { f::log_out(c).await } else { f::close(c).await };
    }

    /// Quitting: closes every client so TDLib flushes its databases. Capped, so a stuck
    /// network never holds up quit.
    pub async fn shutdown(&self) {
        let ids: Vec<i32> = self.accs.lock().unwrap().iter_mut().map(|(id, a)| (a.closing = true, *id).1).collect();
        let _ = tokio::time::timeout(std::time::Duration::from_secs(2), async {
            futures::future::join_all(ids.into_iter().map(f::close)).await;
            while !self.accs.lock().unwrap().is_empty() {
                tokio::time::sleep(std::time::Duration::from_millis(20)).await;
            }
        })
        .await;
    }

    // ── presence ────────────────────────────────────────────────────────────
    fn presence(&self, core: &Arc<Core>, c: i32, account_id: &str, user_id: i64, status: &enums::UserStatus) {
        let online = matches!(status, enums::UserStatus::Online(_));
        let changed = self.with(c, |a| if online { a.online.insert(user_id) } else { a.online.remove(&user_id) }).unwrap_or(false);
        if changed {
            core.emit(crate::model::Event::Presence { account_id: account_id.into(), user_id: user_id.to_string(), online });
        }
    }

    /// "account|user" of everyone online, for a webview that (re)loads after the updates went by.
    pub fn online(&self) -> Vec<String> {
        let accs = self.accs.lock().unwrap();
        accs.values().flat_map(|a| a.online.iter().map(move |u| format!("{}|{u}", a.account_id))).collect()
    }

    // ── update routing ──────────────────────────────────────────────────────
    fn handle(&self, core: &Arc<Core>, c: i32, update: Update) {
        let Some(account_id) = self.with(c, |a| a.account_id.clone()) else { return };
        match update {
            Update::AuthorizationState(u) => self.on_auth(core, c, &account_id, u.authorization_state),
            Update::User(u) => {
                let u = u.user;
                self.with(c, |a| {
                    a.users.insert(u.id, user_name(&u));
                    if let Some(p) = &u.profile_photo {
                        a.photos.insert(u.id, file_ref(&p.small));
                    }
                });
                self.presence(core, c, &account_id, u.id, &u.status);
            }
            Update::UserStatus(u) => self.presence(core, c, &account_id, u.user_id, &u.status),
            Update::ChatPhoto(u) => {
                let (photo, photo_ref) = chat_photo(u.photo.as_ref());
                self.patch_chat(core, c, u.chat_id, |ch| {
                    ch.photo = photo;
                    ch.photo_ref = photo_ref;
                })
            }
            Update::Supergroup(u) => {
                let sg = u.supergroup;
                let (id, forum) = (sg.id, sg.is_forum);
                let changed = self.with(c, |a| {
                    a.supergroups.insert(sg.id, sg.member_count as i64);
                    if forum { a.forums.insert(id) } else { a.forums.remove(&id) }
                });
                // supergroup chat ids are -100<supergroup id>
                if changed == Some(true) {
                    self.patch_chat(core, c, -1_000_000_000_000 - id, |ch| ch.forum = forum);
                }
            }
            Update::NewChat(u) => {
                let chat = self.with(c, |a| {
                    let mut chat = to_chat(a, &account_id, &u.chat);
                    if let ChatType::Supergroup(sg) = &u.chat.r#type {
                        chat.member_count = *a.supergroups.get(&sg.supergroup_id).unwrap_or(&0) as i32;
                        chat.forum = a.forums.contains(&sg.supergroup_id);
                    }
                    a.read_outbox.insert(u.chat.id, u.chat.last_read_outbox_message_id);
                    if u.chat.notification_settings.use_default_mute_for {
                        a.default_mute.insert(u.chat.id);
                    }
                    a.chats.insert(u.chat.id, chat.clone());
                    chat
                });
                if let Some(chat) = chat {
                    if chat.order > 0 {
                        core.put_chat(chat);
                    }
                }
            }
            Update::ChatTitle(u) => self.patch_chat(core, c, u.chat_id, |ch| ch.title = u.title),
            Update::ChatPosition(u) => {
                if matches!(u.position.list, enums::ChatList::Main) {
                    let (order, pinned) = (u.position.order, u.position.is_pinned);
                    self.patch_chat(core, c, u.chat_id, |ch| {
                        ch.order = order;
                        ch.pinned = pinned;
                    });
                }
            }
            Update::ChatLastMessage(u) => {
                let main = u.positions.iter().find(|p| matches!(p.list, enums::ChatList::Main)).map(|p| (p.order, p.is_pinned));
                let preview = u.last_message.as_ref().map(|m| self.with(c, |a| preview_of(a, m)).unwrap_or_default());
                let ts = u.last_message.as_ref().map(|m| m.date as i64 * 1000).unwrap_or(0);
                self.patch_chat(core, c, u.chat_id, |ch| {
                    if let Some((order, pinned)) = main {
                        ch.order = order;
                        ch.pinned = pinned;
                    }
                    if let Some((from, text)) = preview {
                        ch.preview_from = from;
                        ch.preview = text;
                        ch.last_ts = ts;
                    }
                });
            }
            Update::ChatReadInbox(u) => self.patch_chat(core, c, u.chat_id, |ch| ch.unread = u.unread_count),
            Update::ChatUnreadMentionCount(u) => {
                self.patch_chat(core, c, u.chat_id, |ch| ch.mention = u.unread_mention_count > 0)
            }
            Update::ChatNotificationSettings(u) => {
                let muted = self
                    .with(c, |a| {
                        let s = &u.notification_settings;
                        if s.use_default_mute_for {
                            a.default_mute.insert(u.chat_id);
                        } else {
                            a.default_mute.remove(&u.chat_id);
                        }
                        let kind = a.chats.get(&u.chat_id).map(|ch| ch.kind.clone()).unwrap_or_default();
                        is_muted(a, &kind, s)
                    })
                    .unwrap_or(false);
                self.patch_chat(core, c, u.chat_id, |ch| ch.muted = muted)
            }
            // "mute all channels / groups / private chats": every chat on the defaults follows
            Update::ScopeNotificationSettings(u) => {
                let kind = match u.scope {
                    enums::NotificationSettingsScope::PrivateChats => "dm",
                    enums::NotificationSettingsScope::GroupChats => "group",
                    enums::NotificationSettingsScope::ChannelChats => "channel",
                };
                let on = u.notification_settings.mute_for > 0;
                let ids: Vec<i64> = self
                    .with(c, |a| {
                        a.scope_muted.insert(kind.into(), on);
                        a.default_mute.iter().copied().filter(|id| a.chats.get(id).is_some_and(|ch| ch.kind == kind && ch.muted != on)).collect()
                    })
                    .unwrap_or_default();
                for id in ids {
                    self.patch_chat(core, c, id, |ch| ch.muted = on);
                }
            }
            // progress of big downloads (videos, files); small ones finish before anyone looks
            Update::File(u) => {
                let f = &u.file;
                let total = if f.size > 0 { f.size } else { f.expected_size };
                if f.local.is_downloading_active && total > 4_000_000 {
                    let pct = f.local.downloaded_size * 100 / total;
                    if self.with(c, |a| a.progress.insert(f.id, pct) != Some(pct)).unwrap_or(false) {
                        core.emit(crate::model::Event::FileProgress { account_id, file_ref: f.id.to_string(), pct });
                    }
                }
            }
            Update::ChatReadOutbox(u) => {
                self.with(c, |a| a.read_outbox.insert(u.chat_id, u.last_read_outbox_message_id));
                core.emit(crate::model::Event::ReadOutbox {
                    account_id,
                    chat_id: u.chat_id.to_string(),
                    up_to: u.last_read_outbox_message_id,
                });
            }
            Update::NewMessage(u) => {
                let m = self.msg(core, c, &u.message);
                let is_new = !u.message.is_outgoing;
                core.put_msg(m, is_new);
            }
            Update::MessageSendSucceeded(u) => {
                let m = self.msg(core, c, &u.message);
                core.replace_msg(&u.old_message_id.to_string(), m);
            }
            Update::MessageSendFailed(u) => {
                let mut m = self.msg(core, c, &u.message);
                m.status = "failed".into();
                m.error = u.error.message;
                core.replace_msg(&u.old_message_id.to_string(), m);
            }
            Update::MessageContent(u) => {
                self.refetch(core, c, u.chat_id, u.message_id);
            }
            Update::MessageEdited(u) => self.refetch(core, c, u.chat_id, u.message_id),
            Update::MessageInteractionInfo(u) => self.refetch(core, c, u.chat_id, u.message_id),
            Update::MessageIsPinned(u) => self.refetch(core, c, u.chat_id, u.message_id),
            Update::DeleteMessages(u) => {
                if u.is_permanent {
                    core.delete_msgs(&account_id, &u.chat_id.to_string(), u.message_ids.iter().map(|i| i.to_string()).collect());
                }
            }
            Update::ChatAction(u) => {
                let who = match &u.sender_id {
                    MessageSender::User(s) => self.with(c, |a| a.users.get(&s.user_id).cloned().unwrap_or_default()).unwrap_or_default(),
                    MessageSender::Chat(_) => String::new(),
                };
                let on = !matches!(u.action, enums::ChatAction::Cancel);
                core.emit(crate::model::Event::Typing { account_id, chat_id: u.chat_id.to_string(), who, on });
            }
            Update::ConnectionState(u) => {
                let (health, text) = match u.state {
                    enums::ConnectionState::WaitingForNetwork => ("offline", "Mất mạng"),
                    enums::ConnectionState::Connecting | enums::ConnectionState::ConnectingToProxy => ("reconnecting", "Đang kết nối"),
                    enums::ConnectionState::Updating => ("syncing", "Đang đồng bộ"),
                    enums::ConnectionState::Ready => ("ok", "Đã đồng bộ"),
                };
                core.set_health(&account_id, health, text, 0);
            }
            _ => {}
        }
    }

    fn patch_chat(&self, core: &Arc<Core>, c: i32, chat_id: i64, fun: impl FnOnce(&mut Chat)) {
        let chat = self.with(c, |a| {
            a.chats.get_mut(&chat_id).map(|ch| {
                fun(ch);
                ch.clone()
            })
        });
        if let Some(Some(chat)) = chat {
            if chat.order > 0 {
                core.put_chat(chat);
            } else {
                core.remove_chat(&chat.account_id, &chat.id);
            }
        }
    }

    /// Edits, reactions and pins arrive as partial updates; re-reading the message from
    /// TDLib's local cache is cheaper than patching every field by hand.
    fn refetch(&self, core: &Arc<Core>, c: i32, chat_id: i64, message_id: i64) {
        let core = core.clone();
        tauri::async_runtime::spawn(async move {
            if let Ok(enums::Message::Message(m)) = f::get_message(chat_id, message_id, c).await {
                let msg = core.tg.msg(&core, c, &m);
                core.put_msg(msg, false);
            }
        });
    }

    fn on_auth(&self, core: &Arc<Core>, c: i32, account_id: &str, state: AuthorizationState) {
        let pending = self.with(c, |a| a.pending).unwrap_or(false);
        let auth = |step: &str, info: String| {
            core.emit(crate::model::Event::Auth { account_id: account_id.into(), step: step.into(), info, error: String::new() })
        };
        match state {
            AuthorizationState::WaitTdlibParameters => {
                let core = core.clone();
                let dir = core.data_dir.join("tg").join(account_id);
                let account_id = account_id.to_string();
                tauri::async_runtime::spawn(async move {
                    let (api_id, api_hash) = core.tg_api();
                    let res = f::set_tdlib_parameters(
                        false,
                        dir.join("db").to_string_lossy().into(),
                        dir.join("files").to_string_lossy().into(),
                        String::new(),
                        true,
                        true,
                        true,
                        false,
                        api_id,
                        api_hash,
                        "vi".into(),
                        "ChatMin (macOS)".into(),
                        String::new(),
                        env!("CARGO_PKG_VERSION").into(),
                        c,
                    )
                    .await;
                    if let Err(e) = res {
                        core.emit(crate::model::Event::Auth { account_id, step: "error".into(), info: String::new(), error: e.message });
                    }
                });
            }
            AuthorizationState::WaitPhoneNumber => {
                if pending {
                    auth("phone", String::new())
                } else {
                    core.set_health(account_id, "expired", "Phiên hết hạn", 0)
                }
            }
            AuthorizationState::WaitCode(w) => {
                let via = match w.code_info.r#type {
                    enums::AuthenticationCodeType::TelegramMessage(_) => "app",
                    enums::AuthenticationCodeType::Sms(_) => "sms",
                    _ => "other",
                };
                auth("code", format!("{}|{via}", w.code_info.phone_number))
            }
            AuthorizationState::WaitPassword(w) => auth("password", w.password_hint),
            AuthorizationState::WaitOtherDeviceConfirmation(w) => auth("qr", qr_svg(&w.link)),
            AuthorizationState::WaitEmailAddress(_) | AuthorizationState::WaitEmailCode(_) | AuthorizationState::WaitRegistration(_) => {
                core.emit(crate::model::Event::Auth {
                    account_id: account_id.into(),
                    step: "error".into(),
                    info: String::new(),
                    error: "Telegram yêu cầu email/đăng ký — hãy đăng nhập bằng app Telegram trước".into(),
                })
            }
            AuthorizationState::Ready => {
                let core = core.clone();
                let account_id = account_id.to_string();
                tauri::async_runtime::spawn(async move { core.tg.on_ready(&core, c, &account_id, pending).await });
            }
            AuthorizationState::Closed => {
                let closing = self.with(c, |a| a.closing).unwrap_or(true);
                self.accs.lock().unwrap().remove(&c);
                if !closing {
                    // revoked from another device: reopen so the user can log in again
                    core.set_health(account_id, "expired", "Phiên hết hạn", 0);
                    self.open(core, account_id, false);
                }
            }
            _ => {}
        }
    }

    async fn on_ready(&self, core: &Arc<Core>, c: i32, account_id: &str, pending: bool) {
        let Ok(enums::User::User(me)) = f::get_me(c).await else { return };
        let username = me.usernames.as_ref().and_then(|u| u.active_usernames.first().cloned()).unwrap_or_default();
        self.with(c, |a| {
            a.me = me.id;
            a.username = username.clone();
            a.pending = false;
            a.users.insert(me.id, user_name(&me));
        });
        if pending {
            let handle = if !me.phone_number.is_empty() { format!("+{}", me.phone_number) } else { format!("@{username}") };
            let account = Account {
                id: account_id.into(),
                platform: "telegram".into(),
                name: "Telegram".into(),
                color: "blue".into(),
                handle,
                self_id: me.id.to_string(),
            };
            if let Err(e) = core.add_account(account) {
                core.emit(crate::model::Event::Auth { account_id: account_id.into(), step: "error".into(), info: String::new(), error: e });
                self.close(account_id, true).await;
                return;
            }
            core.emit(crate::model::Event::Auth { account_id: account_id.into(), step: "ready".into(), info: String::new(), error: String::new() });
        }
        core.set_health(account_id, "ok", "Đã đồng bộ", 0);
        let step = |i: usize, state: &str, log: &str| {
            if pending {
                core.emit(crate::model::Event::Sync { account_id: account_id.into(), step: i, state: state.into(), log: log.into() })
            }
        };
        step(0, "ok", "[auth] session accepted");
        step(1, "run", "[chats] loading chat list");
        // Main list chats arrive as updateNewChat/updateChatPosition while this pages through.
        for _ in 0..5 {
            if f::load_chats(Some(enums::ChatList::Main), 100, c).await.is_err() {
                break; // 404 = everything loaded
            }
        }
        let n = self.with(c, |a| a.chats.values().filter(|ch| ch.order > 0).count()).unwrap_or(0);
        step(1, "ok", &format!("[chats] {n} chats"));
        if self.with(c, |a| !std::mem::replace(&mut a.watching, true)).unwrap_or(false) {
            let core = core.clone();
            tauri::async_runtime::spawn(async move { core.tg.watch(c).await });
        }
        if pending {
            // warm the search index with recent messages of the busiest chats
            step(2, "run", "[sync] recent messages");
            let mut top: Vec<(i64, i64)> = self
                .with(c, |a| a.chats.iter().filter(|(_, ch)| ch.order > 0).map(|(id, ch)| (*id, ch.order)).collect())
                .unwrap_or_default();
            top.sort_by(|a, b| b.1.cmp(&a.1));
            for (chat_id, _) in top.into_iter().take(20) {
                let _ = self.history(core, account_id, &chat_id.to_string(), 0, 30).await;
            }
            step(2, "ok", "[sync] recent messages synchronized");
        }
    }

    // ── reads ───────────────────────────────────────────────────────────────
    fn msg(&self, core: &Core, c: i32, m: &t::Message) -> Msg {
        let mut msg = self.with(c, |a| to_msg(a, m)).unwrap_or_default();
        if !msg.reply_to.is_empty() {
            let replied = core.store().msg(&msg.account_id, &msg.chat_id, &msg.reply_to);
            if let Ok(Some(r)) = replied {
                msg.reply_name = if r.outgoing { "Bạn".into() } else { r.sender_name };
                msg.reply_text = plain(&r.text, r.media.as_ref());
            }
        }
        msg
    }

    /// Up to `limit` messages older than `before` (0 = newest), oldest first. TDLib may
    /// answer from its local DB with fewer messages, so keep asking until full or empty.
    pub async fn history(&self, core: &Core, account_id: &str, chat_id: &str, before: i64, limit: i32) -> R<Vec<Msg>> {
        let c = self.client(account_id)?;
        let chat: i64 = chat_id.parse().map_err(|_| "bad chat id")?;
        let mut from = before;
        let mut out: Vec<t::Message> = vec![];
        for _ in 0..4 {
            let enums::Messages::Messages(page) =
                f::get_chat_history(chat, from, 0, limit - out.len() as i32, false, c).await.map_err(err)?;
            let got: Vec<t::Message> = page.messages.into_iter().flatten().filter(|m| m.id != from).collect();
            if got.is_empty() {
                break;
            }
            from = got.last().unwrap().id;
            out.extend(got);
            if out.len() as i32 >= limit {
                break;
            }
        }
        out.reverse();
        let msgs: Vec<Msg> = out.iter().map(|m| self.msg(core, c, m)).collect();
        core.store_mut().put_msgs(&msgs)?;
        Ok(msgs)
    }

    /// Topics of a forum supergroup, as the server orders them (pinned first, then by activity).
    pub async fn topics(&self, account_id: &str, chat_id: &str) -> R<Vec<Topic>> {
        let c = self.client(account_id)?;
        let chat: i64 = chat_id.parse().map_err(|_| "bad chat id")?;
        let enums::ForumTopics::ForumTopics(found) = f::get_forum_topics(chat, String::new(), 0, 0, 0, 100, c).await.map_err(err)?;
        let out = self
            .with(c, |a| {
                found
                    .topics
                    .iter()
                    .filter(|t| !t.info.is_hidden)
                    .map(|t| {
                        let (preview_from, preview) = t.last_message.as_ref().map(|m| preview_of(a, m)).unwrap_or_default();
                        Topic {
                            account_id: account_id.into(),
                            chat_id: chat_id.into(),
                            id: t.info.forum_topic_id.to_string(),
                            name: t.info.name.clone(),
                            color: t.info.icon.color,
                            unread: t.unread_count,
                            mention: t.unread_mention_count > 0,
                            last_ts: t.last_message.as_ref().map(|m| m.date as i64 * 1000).unwrap_or(0),
                            preview,
                            preview_from,
                            pinned: t.is_pinned,
                            closed: t.info.is_closed,
                            general: t.info.is_general,
                        }
                    })
                    .collect()
            })
            .unwrap_or_default();
        Ok(out)
    }

    /// One topic's messages older than `before` (0 = newest), oldest first.
    pub async fn topic_history(&self, core: &Core, account_id: &str, chat_id: &str, topic: &str, before: i64, limit: i32) -> R<Vec<Msg>> {
        let c = self.client(account_id)?;
        let chat: i64 = chat_id.parse().map_err(|_| "bad chat id")?;
        let topic: i32 = topic.parse().map_err(|_| "bad topic id")?;
        let mut from = before;
        let mut out: Vec<t::Message> = vec![];
        for _ in 0..4 {
            let enums::Messages::Messages(page) =
                f::get_forum_topic_history(chat, topic, from, 0, limit - out.len() as i32, c).await.map_err(err)?;
            let got: Vec<t::Message> = page.messages.into_iter().flatten().filter(|m| m.id != from).collect();
            if got.is_empty() {
                break;
            }
            from = got.last().unwrap().id;
            out.extend(got);
            if out.len() as i32 >= limit {
                break;
            }
        }
        out.reverse();
        let msgs: Vec<Msg> = out.iter().map(|m| self.msg(core, c, m)).collect();
        core.store_mut().put_msgs(&msgs)?;
        Ok(msgs)
    }

    pub async fn pinned(&self, core: &Core, account_id: &str, chat_id: &str) -> R<Vec<Msg>> {
        let c = self.client(account_id)?;
        let chat: i64 = chat_id.parse().map_err(|_| "bad chat id")?;
        let enums::FoundChatMessages::FoundChatMessages(found) =
            f::search_chat_messages(chat, None, String::new(), None, 0, 0, 30, Some(enums::SearchMessagesFilter::Pinned), c)
                .await
                .map_err(err)?;
        Ok(found.messages.iter().map(|m| self.msg(core, c, m)).collect())
    }

    pub async fn members(&self, account_id: &str, chat_id: &str) -> R<Vec<Member>> {
        let c = self.client(account_id)?;
        let chat: i64 = chat_id.parse().map_err(|_| "bad chat id")?;
        let enums::ChatMembers::ChatMembers(found) = f::search_chat_members(chat, String::new(), 50, None, c).await.map_err(err)?;
        let mut out = vec![];
        for m in found.members {
            let MessageSender::User(u) = &m.member_id else { continue };
            let (name, status) = match f::get_user(u.user_id, c).await {
                Ok(enums::User::User(u)) => (user_name(&u), status_text(&u.status)),
                Err(_) => (u.user_id.to_string(), String::new()),
            };
            let role = match m.status {
                enums::ChatMemberStatus::Creator(_) => "Owner",
                enums::ChatMemberStatus::Administrator(_) => "Admin",
                _ => "",
            };
            out.push(Member { id: u.user_id.to_string(), name, status, role: role.into() });
        }
        Ok(out)
    }

    pub async fn download(&self, account_id: &str, file_ref: &str) -> R<String> {
        let c = self.client(account_id)?;
        let id: i32 = file_ref.parse().map_err(|_| "bad file id")?;
        // a synchronous download returns early when another request (a video streaming
        // from another offset) moves the download: pick it up again until it is whole
        for _ in 0..1000 {
            let enums::File::File(file) = f::download_file(id, 16, 0, 0, true, c).await.map_err(err)?;
            if file.local.is_downloading_completed {
                return Ok(file.local.path);
            }
            if !file.local.can_be_downloaded {
                break;
            }
        }
        Err("Tải file chưa xong".into())
    }

    /// Up to `max` bytes of a file from `start`, for streaming playback. Points TDLib's
    /// download at `start` with no limit (so it keeps reading ahead), waits until enough of
    /// that stretch is on disk, then reads it straight from TDLib's partial file.
    /// Returns the bytes and the file's total size.
    pub async fn stream_part(&self, account_id: &str, file_id: i32, start: i64, max: i64) -> R<(Vec<u8>, i64)> {
        use std::io::{Read, Seek, SeekFrom};
        let c = self.client(account_id)?;
        let enums::File::File(mut file) = f::download_file(file_id, 32, start, 0, false, c).await.map_err(err)?;
        let total = if file.size > 0 { file.size } else { file.expected_size };
        let want = max.min(total - start).max(0);
        let mut got = 0;
        // ~60s at the slowest; the player gives up long before that anyway
        for _ in 0..600 {
            let enums::FileDownloadedPrefixSize::FileDownloadedPrefixSize(p) = f::get_file_downloaded_prefix_size(file_id, start, c).await.map_err(err)?;
            got = p.size;
            if got >= want {
                break;
            }
            // another range (a seek, the moov atom at the end) took the download elsewhere
            let enums::File::File(now) = f::download_file(file_id, 32, start + p.size, 0, false, c).await.map_err(err)?;
            file = now;
            tokio::time::sleep(std::time::Duration::from_millis(100)).await;
        }
        let len = got.min(want);
        if len <= 0 && want > 0 {
            return Err("Telegram chưa tải được đoạn video này".into());
        }
        // the File from before the first bytes landed has no local path yet: ask again
        if file.local.path.is_empty() {
            let enums::File::File(now) = f::get_file(file_id, c).await.map_err(err)?;
            file = now;
        }
        let mut buf = vec![0u8; len as usize];
        let mut fd = std::fs::File::open(&file.local.path).map_err(|e| e.to_string())?;
        fd.seek(SeekFrom::Start(start as u64)).map_err(|e| e.to_string())?;
        fd.read_exact(&mut buf).map_err(|e| e.to_string())?;
        Ok((buf, total))
    }

    // ── writes ──────────────────────────────────────────────────────────────
    pub async fn send(&self, core: &Core, account_id: &str, chat_id: &str, text: String, reply_to: Option<String>, topic: Option<String>, file: Option<String>, voice: Option<i32>) -> R<Msg> {
        let c = self.client(account_id)?;
        let chat: i64 = chat_id.parse().map_err(|_| "bad chat id")?;
        let reply = reply_to.and_then(|r| r.parse::<i64>().ok()).map(|id| {
            enums::InputMessageReplyTo::Message(t::InputMessageReplyToMessage { message_id: id, quote: None, checklist_task_id: 0 })
        });
        let caption = with_mentions(&text);
        let content = match file {
            Some(path) if voice.is_some() => enums::InputMessageContent::InputMessageVoiceNote(t::InputMessageVoiceNote {
                voice_note: enums::InputFile::Local(t::InputFileLocal { path }),
                duration: voice.unwrap_or(0),
                waveform: String::new(),
                caption: Some(caption),
                self_destruct_type: None,
            }),
            Some(path) => {
                let input = enums::InputFile::Local(t::InputFileLocal { path: path.clone() });
                if is_image(&path) {
                    enums::InputMessageContent::InputMessagePhoto(t::InputMessagePhoto {
                        photo: input,
                        thumbnail: None,
                        added_sticker_file_ids: vec![],
                        width: 0,
                        height: 0,
                        caption: Some(caption),
                        show_caption_above_media: false,
                        self_destruct_type: None,
                        has_spoiler: false,
                    })
                } else if is_video(&path) {
                    // duration/size 0: TDLib and the clients read them from the file
                    enums::InputMessageContent::InputMessageVideo(t::InputMessageVideo {
                        video: input,
                        thumbnail: None,
                        cover: None,
                        start_timestamp: 0,
                        added_sticker_file_ids: vec![],
                        duration: 0,
                        width: 0,
                        height: 0,
                        supports_streaming: true,
                        caption: Some(caption),
                        show_caption_above_media: false,
                        self_destruct_type: None,
                        has_spoiler: false,
                    })
                } else {
                    enums::InputMessageContent::InputMessageDocument(t::InputMessageDocument {
                        document: input,
                        thumbnail: None,
                        disable_content_type_detection: false,
                        caption: Some(caption),
                    })
                }
            }
            None => enums::InputMessageContent::InputMessageText(t::InputMessageText { text: caption, link_preview_options: None, clear_draft: true }),
        };
        let topic = topic.and_then(|t| t.parse::<i32>().ok()).map(|id| enums::MessageTopic::Forum(t::MessageTopicForum { forum_topic_id: id }));
        let enums::Message::Message(m) = f::send_message(chat, topic, reply, None, content, c).await.map_err(err)?;
        let msg = self.msg(core, c, &m);
        core.store().put_msg(&msg)?;
        Ok(msg)
    }

    /// Recent stickers plus the installed packs (first 15), for the picker.
    pub async fn stickers(&self, account_id: &str) -> R<Vec<StickerPack>> {
        let c = self.client(account_id)?;
        let mut out = vec![];
        if let Ok(enums::Stickers::Stickers(r)) = f::get_recent_stickers(false, c).await {
            if !r.stickers.is_empty() {
                out.push(StickerPack { id: "recent".into(), title: "Gần đây".into(), stickers: r.stickers.iter().map(sticker_view).collect() });
            }
        }
        let enums::StickerSets::StickerSets(sets) = f::get_installed_sticker_sets(enums::StickerType::Regular, c).await.map_err(err)?;
        let packs = futures::future::join_all(sets.sets.iter().take(15).map(|s| f::get_sticker_set(s.id, c))).await;
        for p in packs.into_iter().flatten() {
            let enums::StickerSet::StickerSet(p) = p;
            out.push(StickerPack { id: p.id.to_string(), title: p.title, stickers: p.stickers.iter().map(sticker_view).collect() });
        }
        Ok(out)
    }

    pub async fn send_sticker(&self, core: &Core, account_id: &str, chat_id: &str, topic: Option<String>, file_id: i32, width: i32, height: i32, emoji: String) -> R<Msg> {
        let c = self.client(account_id)?;
        let chat: i64 = chat_id.parse().map_err(|_| "bad chat id")?;
        let topic = topic.and_then(|t| t.parse::<i32>().ok()).map(|id| enums::MessageTopic::Forum(t::MessageTopicForum { forum_topic_id: id }));
        let content = enums::InputMessageContent::InputMessageSticker(t::InputMessageSticker {
            sticker: enums::InputFile::Id(t::InputFileId { id: file_id }),
            thumbnail: None,
            width,
            height,
            emoji,
        });
        let enums::Message::Message(m) = f::send_message(chat, topic, None, None, content, c).await.map_err(err)?;
        let msg = self.msg(core, c, &m);
        core.store().put_msg(&msg)?;
        Ok(msg)
    }

    /// Native forward inside one Telegram account (keeps the "Forwarded from" header).
    pub async fn forward(&self, account_id: &str, chat_id: &str, from_chat_id: &str, msg_id: &str) -> R<()> {
        let c = self.client(account_id)?;
        let (chat, from, id) = (chat_id.parse().unwrap_or(0), from_chat_id.parse().unwrap_or(0), msg_id.parse().unwrap_or(0));
        f::forward_messages(chat, None, from, vec![id], None, false, false, c).await.map_err(err)?;
        Ok(())
    }

    pub async fn edit(&self, account_id: &str, chat_id: &str, msg_id: &str, text: String) -> R<()> {
        let c = self.client(account_id)?;
        let content = enums::InputMessageContent::InputMessageText(t::InputMessageText {
            text: t::FormattedText { text, entities: vec![] },
            link_preview_options: None,
            clear_draft: false,
        });
        f::edit_message_text(chat_id.parse().unwrap_or(0), msg_id.parse().unwrap_or(0), content, c).await.map_err(err)?;
        Ok(())
    }

    pub async fn delete(&self, account_id: &str, chat_id: &str, msg_id: &str) -> R<()> {
        let c = self.client(account_id)?;
        f::delete_messages(chat_id.parse().unwrap_or(0), vec![msg_id.parse().unwrap_or(0)], true, c).await.map_err(err)
    }

    pub async fn react(&self, account_id: &str, chat_id: &str, msg_id: &str, emoji: String, add: bool) -> R<()> {
        let c = self.client(account_id)?;
        let (chat, id) = (chat_id.parse().unwrap_or(0), msg_id.parse().unwrap_or(0));
        let r = enums::ReactionType::Emoji(t::ReactionTypeEmoji { emoji });
        if add {
            f::add_message_reaction(chat, id, r, false, true, c).await.map_err(err)
        } else {
            f::remove_message_reaction(chat, id, r, c).await.map_err(err)
        }
    }

    /// Emoji this message accepts: chats can limit reactions and some need Premium.
    pub async fn reactions(&self, account_id: &str, chat_id: &str, msg_id: &str) -> R<Vec<String>> {
        let c = self.client(account_id)?;
        let enums::AvailableReactions::AvailableReactions(a) =
            f::get_message_available_reactions(chat_id.parse().unwrap_or(0), msg_id.parse().unwrap_or(0), 8, c).await.map_err(err)?;
        let mut out: Vec<String> = vec![];
        for r in a.top_reactions.iter().chain(&a.recent_reactions).chain(&a.popular_reactions) {
            if let (false, enums::ReactionType::Emoji(e)) = (r.needs_premium, &r.r#type) {
                if !out.contains(&e.emoji) {
                    out.push(e.emoji.clone());
                }
            }
        }
        Ok(out)
    }

    pub async fn pin(&self, account_id: &str, chat_id: &str, msg_id: &str, on: bool) -> R<()> {
        let c = self.client(account_id)?;
        let (chat, id) = (chat_id.parse().unwrap_or(0), msg_id.parse().unwrap_or(0));
        if on {
            f::pin_chat_message(chat, id, true, false, c).await.map_err(err)
        } else {
            f::unpin_chat_message(chat, id, c).await.map_err(err)
        }
    }

    pub async fn mark_read(&self, account_id: &str, chat_id: &str, msg_ids: Vec<String>) -> R<()> {
        let c = self.client(account_id)?;
        let ids = msg_ids.iter().filter_map(|i| i.parse().ok()).collect();
        f::view_messages(chat_id.parse().unwrap_or(0), ids, None, true, c).await.map_err(err)
    }

    pub async fn set_open(&self, account_id: &str, chat_id: &str, open: bool) -> R<()> {
        let c = self.client(account_id)?;
        let chat = chat_id.parse().unwrap_or(0);
        let watched = self
            .with(c, |a| {
                if open {
                    a.ui_open.insert(chat);
                } else {
                    a.ui_open.remove(&chat);
                }
                a.watched.contains(&chat)
            })
            .unwrap_or(false);
        if open {
            f::open_chat(chat, c).await.map_err(err)
        } else if watched {
            Ok(()) // stays open in the background for live updates
        } else {
            f::close_chat(chat, c).await.map_err(err)
        }
    }

    /// TDLib: "in supergroups and channels all updates are received only for opened chats" —
    /// otherwise they trickle in by polling, up to a minute late. Unmuted groups and channels
    /// are the ones that ring, so the busiest of them stay open in the background; the set
    /// follows mutes and activity every few minutes. Opening doesn't mark anything read.
    async fn watch(&self, c: i32) {
        // ponytail: 30 chats, every 5 min; raise WATCH if an unmuted group still lags
        const WATCH: usize = 30;
        loop {
            let Some((open, close)) = self.with(c, |a| {
                let mut busy: Vec<(i64, i64)> = a
                    .chats
                    .iter()
                    .filter(|(_, ch)| ch.order > 0 && !ch.muted && (ch.kind == "group" || ch.kind == "channel"))
                    .map(|(id, ch)| (*id, ch.order))
                    .collect();
                busy.sort_by(|x, y| y.1.cmp(&x.1));
                let want: HashSet<i64> = busy.into_iter().take(WATCH).map(|x| x.0).collect();
                let open: Vec<i64> = want.difference(&a.watched).copied().collect();
                let close: Vec<i64> = a.watched.difference(&want).filter(|id| !a.ui_open.contains(id)).copied().collect();
                a.watched = want;
                (open, close)
            }) else {
                return; // client closed
            };
            for id in open {
                let _ = f::open_chat(id, c).await;
            }
            for id in close {
                let _ = f::close_chat(id, c).await;
            }
            tokio::time::sleep(std::time::Duration::from_secs(300)).await;
        }
    }

    /// Telegram's "delete chat": private chats are cleared and dropped from the list
    /// (`revoke` clears the other side too), basic groups are left then cleared,
    /// supergroups and channels are left.
    pub async fn delete_chat(&self, core: &Arc<Core>, account_id: &str, chat_id: &str, revoke: bool) -> R<()> {
        let c = self.client(account_id)?;
        let chat: i64 = chat_id.parse().unwrap_or(0);
        let enums::Chat::Chat(ch) = f::get_chat(chat, c).await.map_err(err)?;
        match ch.r#type {
            ChatType::Private(_) | ChatType::Secret(_) => f::delete_chat_history(chat, true, revoke, c).await.map_err(err)?,
            ChatType::BasicGroup(_) => {
                f::leave_chat(chat, c).await.map_err(err)?;
                f::delete_chat_history(chat, true, false, c).await.map_err(err)?;
            }
            ChatType::Supergroup(_) => {
                f::leave_chat(chat, c).await.map_err(err)?;
                // public supergroups refuse this; leaving already took it off the list
                let _ = f::delete_chat_history(chat, true, false, c).await;
            }
        }
        self.with(c, |a| {
            if let Some(ch) = a.chats.get_mut(&chat) {
                ch.order = 0;
            }
        });
        core.remove_chat(account_id, chat_id);
        Ok(())
    }

    pub async fn set_muted(&self, account_id: &str, chat_id: &str, muted: bool) -> R<()> {
        let c = self.client(account_id)?;
        let chat: i64 = chat_id.parse().unwrap_or(0);
        let enums::Chat::Chat(ch) = f::get_chat(chat, c).await.map_err(err)?;
        let mut s = ch.notification_settings;
        s.use_default_mute_for = false;
        s.mute_for = if muted { i32::MAX } else { 0 };
        f::set_chat_notification_settings(chat, s, c).await.map_err(err)
    }
}

// ── translation ─────────────────────────────────────────────────────────────
fn user_name(u: &t::User) -> String {
    format!("{} {}", u.first_name, u.last_name).trim().to_string()
}

/// The composer writes a picked @mention as "@[Name](user id)": send it as "Name" carrying a
/// mention-by-id entity, which works for people without a username too.
fn with_mentions(text: &str) -> t::FormattedText {
    let (mut out, mut entities, mut rest) = (String::new(), vec![], text);
    while let Some(i) = rest.find("@[") {
        let after = &rest[i + 2..];
        let parsed = after.find("](").and_then(|j| {
            let tail = &after[j + 2..];
            let k = tail.find(')')?;
            Some((&after[..j], tail[..k].parse::<i64>().ok()?, &tail[k + 1..]))
        });
        let Some((name, user_id, tail)) = parsed else {
            out.push_str(&rest[..i + 2]);
            rest = after;
            continue;
        };
        out.push_str(&rest[..i]);
        let offset = out.encode_utf16().count() as i32;
        out.push_str(name);
        let length = name.encode_utf16().count() as i32;
        entities.push(t::TextEntity { offset, length, r#type: enums::TextEntityType::MentionName(t::TextEntityTypeMentionName { user_id }) });
        rest = tail;
    }
    out.push_str(rest);
    t::FormattedText { text: out, entities }
}

fn status_text(s: &enums::UserStatus) -> String {
    match s {
        enums::UserStatus::Online(_) => "online",
        enums::UserStatus::Recently(_) => "last seen recently",
        enums::UserStatus::Offline(_) => "offline",
        _ => "",
    }
    .into()
}

/// A chat's own mute, or its kind's default when it follows the defaults.
fn is_muted(a: &Acc, kind: &str, s: &t::ChatNotificationSettings) -> bool {
    if s.use_default_mute_for {
        a.scope_muted.get(kind).copied().unwrap_or(false)
    } else {
        s.mute_for > 0
    }
}

fn to_chat(a: &Acc, account_id: &str, c: &t::Chat) -> Chat {
    let kind = match &c.r#type {
        ChatType::Private(_) | ChatType::Secret(_) => "dm",
        ChatType::BasicGroup(_) => "group",
        ChatType::Supergroup(s) if s.is_channel => "channel",
        ChatType::Supergroup(_) => "group",
    };
    let main = c.positions.iter().find(|p| matches!(p.list, enums::ChatList::Main));
    let (preview_from, preview) = c.last_message.as_ref().map(|m| preview_of(a, m)).unwrap_or_default();
    Chat {
        account_id: account_id.into(),
        id: c.id.to_string(),
        kind: kind.into(),
        title: if c.id == a.me { "Saved Messages".into() } else { c.title.clone() },
        last_ts: c.last_message.as_ref().map(|m| m.date as i64 * 1000).unwrap_or(0),
        preview,
        preview_from,
        unread: c.unread_count,
        mention: c.unread_mention_count > 0,
        muted: is_muted(a, kind, &c.notification_settings),
        order: main.map(|p| p.order).unwrap_or(0),
        pinned: main.map(|p| p.is_pinned).unwrap_or(false),
        can_send: c.permissions.can_send_basic_messages || kind == "dm",
        photo: chat_photo(c.photo.as_ref()).0,
        photo_ref: chat_photo(c.photo.as_ref()).1,
        ..Default::default()
    }
}

/// Downloaded avatars are local paths; anything else is a file id the UI asks to download.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StickerView {
    /// TDLib file id of the sticker itself (what send_sticker needs)
    id: i32,
    /// preview: local path or TDLib file id; empty when only an animated format exists
    thumb: String,
    /// "img" | "video" — how the preview renders
    thumb_kind: String,
    emoji: String,
    width: i32,
    height: i32,
}

#[derive(serde::Serialize)]
pub struct StickerPack {
    id: String,
    title: String,
    stickers: Vec<StickerView>,
}

fn sticker_view(s: &t::Sticker) -> StickerView {
    // static WebP renders as-is; animated packs ship a WebP/WebM thumbnail (TGS can't render here)
    let (thumb, thumb_kind) = match (&s.format, &s.thumbnail) {
        (enums::StickerFormat::Webp, _) => (file_ref(&s.sticker), "img"),
        (enums::StickerFormat::Webm, _) => (file_ref(&s.sticker), "video"),
        (_, Some(th)) if matches!(th.format, enums::ThumbnailFormat::Webp | enums::ThumbnailFormat::Png | enums::ThumbnailFormat::Jpeg) => (file_ref(&th.file), "img"),
        (_, Some(th)) if matches!(th.format, enums::ThumbnailFormat::Webm) => (file_ref(&th.file), "video"),
        _ => (String::new(), "img"),
    };
    StickerView { id: s.sticker.id, thumb, thumb_kind: thumb_kind.into(), emoji: s.emoji.clone(), width: s.width, height: s.height }
}

fn file_ref(f: &t::File) -> String {
    if f.local.is_downloading_completed { f.local.path.clone() } else { f.id.to_string() }
}

fn chat_photo(p: Option<&t::ChatPhotoInfo>) -> (String, String) {
    match p {
        Some(p) if p.small.local.is_downloading_completed => (p.small.local.path.clone(), String::new()),
        Some(p) => (String::new(), p.small.id.to_string()),
        None => (String::new(), String::new()),
    }
}

fn sender(a: &Acc, s: &MessageSender) -> (String, String, String) {
    match s {
        MessageSender::User(u) => (
            u.user_id.to_string(),
            a.users.get(&u.user_id).cloned().unwrap_or_default(),
            a.photos.get(&u.user_id).cloned().unwrap_or_default(),
        ),
        MessageSender::Chat(ch) => {
            let chat = a.chats.get(&ch.chat_id);
            let photo = chat.map(|c| if c.photo.is_empty() { c.photo_ref.clone() } else { c.photo.clone() }).unwrap_or_default();
            (ch.chat_id.to_string(), chat.map(|c| c.title.clone()).unwrap_or_default(), photo)
        }
    }
}

fn preview_of(a: &Acc, m: &t::Message) -> (String, String) {
    let msg = to_msg(a, m);
    let from = if m.is_outgoing { "Bạn".to_string() } else { msg.sender_name.split_whitespace().next().unwrap_or("").to_string() };
    (from, plain(&msg.text, msg.media.as_ref()))
}

/// One-line text for previews, quotes and notifications.
pub fn plain(text: &str, media: Option<&Media>) -> String {
    let t = text.replace("@{", "@").replace('}', "").replace('`', "");
    let t = t.split_whitespace().collect::<Vec<_>>().join(" ");
    if !t.is_empty() {
        return t;
    }
    match media.map(|m| m.kind.as_str()) {
        Some("image") => "Ảnh".into(),
        Some("video") => "Video".into(),
        Some("voice") => "Tin nhắn thoại".into(),
        Some("sticker") => "Sticker".into(),
        Some(_) => media.unwrap().name.clone(),
        None => String::new(),
    }
}

fn file_media(kind: &str, name: &str, mime: &str, file: &t::File, w: i32, h: i32, mini: Option<&t::Minithumbnail>) -> Media {
    Media {
        thumb_file: String::new(),
        kind: kind.into(),
        name: name.into(),
        size: if file.size > 0 { file.size } else { file.expected_size },
        mime: mime.into(),
        width: w,
        height: h,
        file_ref: file.id.to_string(),
        local_path: if file.local.is_downloading_completed { file.local.path.clone() } else { String::new() },
        thumb: mini.map(|m| format!("data:image/jpeg;base64,{}", m.data)).unwrap_or_default(),
        url: String::new(),
    }
}

/// The ~320px JPEG/PNG/WebP thumbnail Telegram ships with videos and documents (the
/// minithumbnail is a 40px blur). Animated formats can't be shown as an <img>.
fn with_thumb(mut m: Media, th: Option<&t::Thumbnail>) -> Media {
    if let Some(th) = th.filter(|th| matches!(th.format, enums::ThumbnailFormat::Jpeg | enums::ThumbnailFormat::Png | enums::ThumbnailFormat::Webp)) {
        m.thumb_file = if th.file.local.is_downloading_completed { th.file.local.path.clone() } else { th.file.id.to_string() };
        if m.width == 0 {
            (m.width, m.height) = (th.width, th.height);
        }
    }
    m
}

/// Photos and videos sent "as file" (no compression): previewed like media when WebKit can render them.
fn document_kind(mime: &str) -> &'static str {
    match mime {
        "image/jpeg" | "image/png" | "image/gif" | "image/webp" | "image/heic" => "image",
        "video/mp4" | "video/quicktime" | "video/webm" | "video/x-m4v" => "video",
        _ => "file",
    }
}

fn to_msg(a: &Acc, m: &t::Message) -> Msg {
    let (sender_id, sender_name, sender_photo) = sender(a, &m.sender_id);
    let mut out = Msg {
        account_id: a.account_id.clone(),
        chat_id: m.chat_id.to_string(),
        id: m.id.to_string(),
        sort: m.id,
        sender_id,
        sender_name,
        sender_photo,
        outgoing: m.is_outgoing,
        ts: m.date as i64 * 1000,
        edited: m.edit_date > 0,
        kind: "text".into(),
        pinned: m.is_pinned,
        mentions_me: m.contains_unread_mention,
        ..Default::default()
    };
    if let Some(enums::MessageTopic::Forum(t)) = &m.topic_id {
        out.thread_id = t.forum_topic_id.to_string();
    }
    if let Some(enums::MessageReplyTo::Message(r)) = &m.reply_to {
        if r.chat_id == m.chat_id || r.chat_id == 0 {
            out.reply_to = r.message_id.to_string();
        }
    }
    if let Some(info) = &m.interaction_info {
        if let Some(rs) = &info.reactions {
            out.reactions = rs
                .reactions
                .iter()
                .filter_map(|r| match &r.r#type {
                    enums::ReactionType::Emoji(e) => Some(Reaction { emoji: e.emoji.clone(), count: r.total_count, mine: r.is_chosen }),
                    _ => None,
                })
                .collect();
        }
    }
    if m.is_outgoing {
        out.status = match &m.sending_state {
            Some(enums::MessageSendingState::Pending(_)) => "sending".into(),
            Some(enums::MessageSendingState::Failed(f)) => {
                out.error = f.error.message.clone();
                "failed".into()
            }
            None if a.read_outbox.get(&m.chat_id).copied().unwrap_or(0) >= m.id => "seen".into(),
            None => "sent".into(),
        };
    }
    match &m.content {
        MessageContent::MessageText(x) => {
            out.text = render(&x.text);
            if let Some(p) = &x.link_preview {
                out.link = Some(LinkCard {
                    url: p.url.clone(),
                    site: if p.site_name.is_empty() { p.display_url.clone() } else { p.site_name.clone() },
                    title: p.title.clone(),
                    desc: p.description.text.chars().take(240).collect(),
                });
            }
        }
        MessageContent::MessagePhoto(x) => {
            out.kind = "media".into();
            out.text = render(&x.caption);
            // largest size that still fits a bubble, falling back to the biggest one
            let size = x.photo.sizes.iter().filter(|s| s.width <= 1280).last().or(x.photo.sizes.last());
            if let Some(s) = size {
                out.media = Some(file_media("image", "photo.jpg", "image/jpeg", &s.photo, s.width, s.height, x.photo.minithumbnail.as_ref()));
            }
        }
        MessageContent::MessageDocument(x) => {
            out.kind = "media".into();
            out.text = render(&x.caption);
            let d = &x.document;
            out.media = Some(with_thumb(file_media(document_kind(&d.mime_type), &d.file_name, &d.mime_type, &d.document, 0, 0, d.minithumbnail.as_ref()), d.thumbnail.as_ref()));
        }
        MessageContent::MessageVideo(x) => {
            out.kind = "media".into();
            out.text = render(&x.caption);
            let v = &x.video;
            let name = if v.file_name.is_empty() { "video.mp4" } else { &v.file_name };
            out.media = Some(with_thumb(file_media("video", name, &v.mime_type, &v.video, v.width, v.height, v.minithumbnail.as_ref()), v.thumbnail.as_ref()));
        }
        MessageContent::MessageAnimation(x) => {
            out.kind = "media".into();
            out.text = render(&x.caption);
            let v = &x.animation;
            out.media = Some(with_thumb(file_media("video", "GIF", &v.mime_type, &v.animation, v.width, v.height, v.minithumbnail.as_ref()), v.thumbnail.as_ref()));
        }
        MessageContent::MessageAudio(x) => {
            out.kind = "media".into();
            out.text = render(&x.caption);
            let v = &x.audio;
            let name = if v.title.is_empty() { v.file_name.clone() } else { format!("{} — {}", v.performer, v.title) };
            out.media = Some(file_media("file", &name, &v.mime_type, &v.audio, 0, 0, None));
        }
        MessageContent::MessageVoiceNote(x) => {
            out.kind = "media".into();
            out.text = render(&x.caption);
            let v = &x.voice_note;
            let name = format!("Tin nhắn thoại · {}:{:02}", v.duration / 60, v.duration % 60);
            out.media = Some(file_media("voice", &name, &v.mime_type, &v.voice, 0, 0, None));
        }
        MessageContent::MessageSticker(x) => {
            out.kind = "media".into();
            out.text = x.sticker.emoji.clone();
            let mut media = file_media("sticker", "sticker", "", &x.sticker.sticker, x.sticker.width, x.sticker.height, None);
            // only static WebP stickers render as images; animated ones fall back to the emoji
            if !matches!(x.sticker.format, enums::StickerFormat::Webp) {
                media.file_ref.clear();
            }
            out.media = Some(media);
        }
        MessageContent::MessageChatAddMembers(x) => {
            out.kind = "service".into();
            let names: Vec<String> = x.member_user_ids.iter().map(|id| a.users.get(id).cloned().unwrap_or_default()).collect();
            out.text = format!("{} đã thêm {}", out.sender_name, names.join(", "));
        }
        MessageContent::MessageChatJoinByLink => {
            out.kind = "service".into();
            out.text = format!("{} đã tham gia qua link mời", out.sender_name);
        }
        MessageContent::MessageChatDeleteMember(x) => {
            out.kind = "service".into();
            out.text = format!("{} đã rời nhóm", a.users.get(&x.user_id).cloned().unwrap_or_else(|| out.sender_name.clone()));
        }
        MessageContent::MessageChatChangeTitle(x) => {
            out.kind = "service".into();
            out.text = format!("{} đã đổi tên nhóm thành “{}”", out.sender_name, x.title);
        }
        MessageContent::MessagePinMessage(_) => {
            out.kind = "service".into();
            out.text = format!("{} đã ghim một tin nhắn", out.sender_name);
        }
        MessageContent::MessageBasicGroupChatCreate(x) => {
            out.kind = "service".into();
            out.text = format!("{} đã tạo nhóm “{}”", out.sender_name, x.title);
        }
        MessageContent::MessageSupergroupChatCreate(x) => {
            out.kind = "service".into();
            out.text = format!("Đã tạo “{}”", x.title);
        }
        MessageContent::MessageContact(x) => {
            out.text = format!("📇 {} {} · {}", x.contact.first_name, x.contact.last_name, x.contact.phone_number);
        }
        MessageContent::MessageLocation(_) | MessageContent::MessageVenue(_) => out.text = "📍 Vị trí".into(),
        MessageContent::MessagePoll(x) => out.text = format!("📊 {}", x.poll.question.text),
        MessageContent::MessageCall(x) => {
            out.kind = "service".into();
            out.text = format!("{} · {}:{:02}", if x.is_video { "Cuộc gọi video" } else { "Cuộc gọi" }, x.duration / 60, x.duration % 60);
        }
        MessageContent::MessageVideoNote(x) => {
            out.kind = "media".into();
            let v = &x.video_note;
            out.media = Some(with_thumb(file_media("video", "Video tròn", "video/mp4", &v.video, v.length, v.length, v.minithumbnail.as_ref()), v.thumbnail.as_ref()));
        }
        // a lone emoji is sent as an animated one; dice/darts carry their emoji too
        MessageContent::MessageAnimatedEmoji(x) => out.text = x.emoji.clone(),
        MessageContent::MessageDice(x) => out.text = format!("{} {}", x.emoji, x.value),
        other => {
            let name = format!("{other:?}");
            eprintln!("[tg] unsupported content {}", name.split(['(', ' ']).next().unwrap_or(""));
            out.kind = "service".into();
            out.text = "Tin nhắn ChatMin chưa hỗ trợ hiển thị".into();
        }
    }
    if !out.mentions_me && !a.username.is_empty() && out.text.contains(&format!("@{{{}}}", a.username)) {
        out.mentions_me = true;
    }
    out
}

/// Turns TDLib entities into the light markup the frontend renders:
/// `code`, @{mention}, [text](url). Overlapping/nested entities keep only the outer one.
fn render(ft: &t::FormattedText) -> String {
    let units: Vec<u16> = ft.text.encode_utf16().collect();
    let slice = |s: usize, e: usize| String::from_utf16_lossy(&units[s.min(units.len())..e.min(units.len())]);
    let mut ents: Vec<&t::TextEntity> = ft.entities.iter().collect();
    ents.sort_by_key(|e| e.offset);
    let mut out = String::new();
    let mut pos = 0usize;
    for e in ents {
        let (s, end) = (e.offset as usize, (e.offset + e.length) as usize);
        if s < pos {
            continue;
        }
        let inner = slice(s, end);
        let rendered = match &e.r#type {
            enums::TextEntityType::Code => format!("`{}`", inner.replace('`', "ʼ")),
            enums::TextEntityType::Pre | enums::TextEntityType::PreCode(_) => format!("```\n{}\n```", inner.trim_matches('\n').replace("```", "ʼʼʼ")),
            enums::TextEntityType::Bold => wrap(&inner, '*'),
            enums::TextEntityType::Italic => wrap(&inner, '_'),
            enums::TextEntityType::Strikethrough => wrap(&inner, '~'),
            enums::TextEntityType::Mention | enums::TextEntityType::MentionName(_) => {
                format!("@{{{}}}", inner.trim_start_matches('@'))
            }
            enums::TextEntityType::TextUrl(u) => format!("[{}]({})", inner.replace(['[', ']'], ""), u.url),
            _ => continue,
        };
        out.push_str(&slice(pos, s));
        out.push_str(&rendered);
        pos = end;
    }
    out.push_str(&slice(pos, units.len()));
    out
}

/// *bold* / _italic_ / ~strike~ hug their words: markers go inside surrounding spaces and
/// on every line, since the frontend only matches them within one line (format.ts).
pub fn wrap(inner: &str, mark: char) -> String {
    inner
        .split('\n')
        .map(|l| {
            let t = l.trim();
            if t.is_empty() {
                return l.to_string();
            }
            let (lead, trail) = (&l[..l.len() - l.trim_start().len()], &l[l.trim_end().len()..]);
            format!("{lead}{mark}{t}{mark}{trail}")
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn is_image(path: &str) -> bool {
    let p = path.to_lowercase();
    [".jpg", ".jpeg", ".png", ".webp", ".heic", ".gif"].iter().any(|ext| p.ends_with(ext)) && !p.ends_with(".gif")
}

fn is_video(path: &str) -> bool {
    let p = path.to_lowercase();
    [".mp4", ".mov", ".m4v"].iter().any(|ext| p.ends_with(ext))
}

fn qr_svg(link: &str) -> String {
    let code = qrcode::QrCode::new(link.as_bytes()).unwrap();
    let svg = code.render::<qrcode::render::svg::Color>().min_dimensions(200, 200).quiet_zone(true).build();
    format!("data:image/svg+xml;base64,{}", base64::engine::general_purpose::STANDARD.encode(svg))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mentions_become_entities() {
        let f = with_mentions("Hi @[Lan Phạm](42), xem @[x](no) và 😀@[B](7)!");
        assert_eq!(f.text, "Hi Lan Phạm, xem @[x](no) và 😀B!");
        let e: Vec<(i32, i32)> = f.entities.iter().map(|e| (e.offset, e.length)).collect();
        assert_eq!(e, vec![(3, 8), (31, 1)]); // UTF-16: 😀 counts 2
    }

    #[test]
    fn markers_hug_words() {
        assert_eq!(wrap(" bold words ", '*'), " *bold words* ");
        assert_eq!(wrap("line one\n\nline two", '_'), "_line one_\n\n_line two_");
        assert_eq!(wrap("   ", '~'), "   ");
    }

    #[test]
    fn render_marks_code_links_and_my_mentions_with_utf16_offsets() {
        // "Đã" is 2 UTF-16 units; offsets below are in UTF-16 like TDLib's
        let text = "Đã xong @tri xem go tại đây";
        let ft = t::FormattedText {
            text: text.into(),
            entities: vec![
                t::TextEntity { offset: 8, length: 4, r#type: enums::TextEntityType::Mention },
                t::TextEntity { offset: 17, length: 2, r#type: enums::TextEntityType::Code },
                t::TextEntity {
                    offset: 24,
                    length: 3,
                    r#type: enums::TextEntityType::TextUrl(t::TextEntityTypeTextUrl { url: "https://x.io".into() }),
                },
            ],
        };
        assert_eq!(render(&ft), "Đã xong @{tri} xem `go` tại [đây](https://x.io)");
    }
}
