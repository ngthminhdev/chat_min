//! Desktop notifications and the Dock badge, decided in Rust where messages arrive. When
//! the window is hidden (close only hides it) WebKit throttles or suspends its webview, so
//! deciding this in JS made alerts late or missing exactly when they matter most.
use crate::model::{Chat, Msg};
use serde::Deserialize;
use std::collections::HashMap;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager};
#[cfg(target_os = "macos")]
static SYSTEM_MODE: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
#[cfg(not(target_os = "macos"))]
use tauri_plugin_notification::NotificationExt;

/// Per-account settings, mirrored from the Settings screen (store.ts `NotifyPrefs`).
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Prefs {
    pub enabled: bool,
    pub mentions: bool,
    pub quiet: bool,
    pub from: String,
    pub to: String,
    pub preview: bool,
}

impl Default for Prefs {
    fn default() -> Self {
        Self { enabled: true, mentions: false, quiet: false, from: "22:00".into(), to: "08:00".into(), preview: true }
    }
}

impl Prefs {
    /// "HH:MM" strings compare correctly as text; a window like 22:00–08:00 wraps midnight.
    fn quiet_at(&self, now: &str) -> bool {
        self.quiet && if self.from <= self.to { now >= self.from.as_str() && now < self.to.as_str() } else { now >= self.from.as_str() || now < self.to.as_str() }
    }
}

/// Match the person named in a message notification; a group photo is not its sender.
fn photo_source<'a>(chat: &'a Chat, msg: &'a Msg) -> &'a str {
    if !msg.sender_photo.is_empty() { &msg.sender_photo }
    else if chat.kind == "dm" { if chat.photo.is_empty() { &chat.photo_ref } else { &chat.photo } }
    else { "" }
}

fn web_body<'a>(prefs: &Prefs, body: &'a str) -> &'a str {
    if prefs.preview && !body.trim().is_empty() { body } else { "Bạn có tin nhắn mới" }
}

/// Messages older than this when they reach us (catch-up after the Mac slept or the app
/// was closed) don't ring one by one: they go into one "while you were away" summary.
const STALE_MS: i64 = 10 * 60 * 1000;
/// Older than this they only update the chat.
const DIGEST_MS: i64 = 12 * 60 * 60 * 1000;

/// What a message that just arrived gets.
#[derive(Debug, PartialEq)]
pub enum Ring {
    No,
    /// its own notification
    Now,
    /// a line in the "while you were away" summary
    Later,
}

#[derive(Default)]
pub struct Notifier {
    prefs: Mutex<HashMap<String, Prefs>>,
    /// (account id, chat id) open on screen
    active: Mutex<Option<(String, String)>>,
    /// unread per chat, muted chats as 0; their sum is the Dock badge
    unread: Mutex<HashMap<(String, String), i32>>,
    badge: Mutex<i64>,
    /// (chat title, "account|chat") waiting for the summary
    missed: Mutex<Vec<(String, String)>>,
    /// phone: the app left the screen (the webview reports `visibilitychange`, mobile.ts)
    background: std::sync::atomic::AtomicBool,
}

impl Notifier {
    pub fn set_island(&self, app: &AppHandle, enabled: bool) {
        #[cfg(target_os = "macos")]
        {
            SYSTEM_MODE.store(!enabled, std::sync::atomic::Ordering::Relaxed);
            let _ = app.run_on_main_thread(move || {
                if enabled { mac::silence(); } else { crate::island::clear(None); }
            });
        }
        #[cfg(not(target_os = "macos"))]
        let _ = app;
    }
    pub fn set_foreground(&self, fg: bool) {
        self.background.store(!fg, std::sync::atomic::Ordering::Relaxed);
    }

    pub fn set_prefs(&self, prefs: HashMap<String, Prefs>) {
        *self.prefs.lock().unwrap() = prefs;
    }

    pub fn set_open(&self, account_id: &str, chat_id: &str, open: bool) {
        let mut a = self.active.lock().unwrap();
        if open {
            *a = Some((account_id.into(), chat_id.into()));
        } else if a.as_ref().is_some_and(|(x, y)| x == account_id && y == chat_id) {
            *a = None;
        }
    }

    /// The chat on screen in the focused window: its messages are being read, no banner.
    /// Other chats still ring while ChatMin is in front.
    fn watching(&self, app: &AppHandle, account_id: &str, chat_id: &str) -> bool {
        let on_screen = self.active.lock().unwrap().as_ref().is_some_and(|(a, c)| a == account_id && c == chat_id);
        #[cfg(desktop)]
        let in_front = app.get_webview_window("main").is_some_and(|w| w.is_visible().unwrap_or(false) && w.is_focused().unwrap_or(false));
        // the Android window has no focus/visibility answer: trust the webview's own report
        #[cfg(mobile)]
        let in_front = { let _ = app; !self.background.load(std::sync::atomic::Ordering::Relaxed) };
        on_screen && in_front
    }

    /// Whether a just-arrived message should ring, given its chat and the account's prefs.
    /// Google Chat spaces ring like Chat's own default ("All"): @mentions, the first message
    /// of a thread, and replies in threads you've posted in — not every reply everywhere.
    fn rings(p: &Prefs, chat: &Chat, m: &Msg, followed: bool, watching: bool, now_ms: i64, now_hm: &str) -> Ring {
        // Telegram still rings for @mentions and replies to you in a muted chat (its default)
        let muted = chat.muted && !(m.mentions_me && chat.account_id.starts_with("tg-"));
        let age = now_ms - m.ts;
        if m.outgoing || m.deleted || muted || watching || age > DIGEST_MS {
            return Ring::No;
        }
        if chat.kind == "space" && m.thread_reply && !m.mentions_me && !followed {
            return Ring::No;
        }
        if !p.enabled || p.quiet_at(now_hm) || (p.mentions && !m.mentions_me) {
            return Ring::No;
        }
        if age > STALE_MS { Ring::Later } else { Ring::Now }
    }

    /// `followed`: you have posted in this message's thread.
    pub fn message(&self, app: &AppHandle, chat: Option<&Chat>, m: &Msg, followed: bool) -> Ring {
        let Some(chat) = chat else { return Ring::No };
        let now_hm = chrono::Local::now().format("%H:%M").to_string();
        let p = self.prefs.lock().unwrap().get(&m.account_id).cloned().unwrap_or_default();
        let watching = self.watching(app, &m.account_id, &m.chat_id);
        match Self::rings(&p, chat, m, followed, watching, crate::now_ms(), &now_hm) {
            Ring::No => return Ring::No,
            Ring::Later => {
                self.later(app, &chat.title, &format!("{}|{}", m.account_id, m.chat_id));
                return Ring::Later;
            }
            Ring::Now => {}
        }
        let who = if m.sender_name.is_empty() { chat.title.clone() } else { m.sender_name.clone() };
        let title = if chat.kind == "dm" { who } else { format!("{who} · {}", chat.title) };
        let body = if p.preview {
            let t = crate::tg::plain(&m.text, m.media.as_ref());
            if t.is_empty() { "Tin nhắn mới".into() } else { t }
        } else {
            "Bạn có tin nhắn mới".into()
        };
        // a thread reply opens its thread: in the space it's folded out of sight
        let thread = if m.thread_reply { m.thread_id.as_str() } else { "" };
        show_photo(app, &title, &body, &format!("{}|{}\n{}\n{thread}", m.account_id, m.chat_id, m.id), photo_source(chat, m));
        Ring::Now
    }

    /// Someone reacted to one of my messages. Not while that chat is on screen, nor when
    /// notifications are off / quiet hours.
    pub fn reaction(&self, app: &AppHandle, chat: Option<&Chat>, m: &Msg, emoji: &str) {
        let Some(chat) = chat else { return };
        let p = self.prefs.lock().unwrap().get(&m.account_id).cloned().unwrap_or_default();
        let now_hm = chrono::Local::now().format("%H:%M").to_string();
        if !p.enabled || p.quiet_at(&now_hm) || self.watching(app, &m.account_id, &m.chat_id) {
            return;
        }
        let t = crate::tg::plain(&m.text, m.media.as_ref());
        let body = if p.preview && !t.is_empty() { format!("{emoji} vào tin của bạn: {t}") } else { format!("{emoji} vào tin của bạn") };
        let thread = if m.thread_reply { m.thread_id.as_str() } else { "" };
        show(app, &format!("Biểu cảm mới · {}", chat.title), &body, &format!("{}|{}\n{}\n{thread}", m.account_id, m.chat_id, m.id));
    }

    /// Queues a missed message; a catch-up burst settles for a few seconds, then rings once.
    fn later(&self, app: &AppHandle, title: &str, key: &str) {
        let first = {
            let mut q = self.missed.lock().unwrap();
            q.push((title.into(), key.into()));
            q.len() == 1
        };
        if first {
            let app = app.clone();
            tauri::async_runtime::spawn(async move {
                tokio::time::sleep(std::time::Duration::from_secs(5)).await;
                if let Some(core) = app.try_state::<std::sync::Arc<crate::Core>>() {
                    let q = std::mem::take(&mut *core.notifier.missed.lock().unwrap());
                    if let Some((title, body, key)) = summary(&q) {
                        show(&app, &title, &body, &key);
                    }
                }
            });
        }
    }

    /// Messenger / Zalo: a thread row changed (body = its preview, or just a count).
    pub fn web(&self, app: &AppHandle, chat: &Chat, body: &str) {
        if chat.muted || self.watching(app, &chat.account_id, &chat.id) {
            return;
        }
        let p = self.prefs.lock().unwrap().get(&chat.account_id).cloned().unwrap_or_default();
        let now_hm = chrono::Local::now().format("%H:%M").to_string();
        if p.enabled && !p.mentions && !p.quiet_at(&now_hm) {
            show(app, &chat.title, web_body(&p, body), &format!("{}|{}", chat.account_id, chat.id));
        }
    }

    /// Keeps the Dock badge equal to the unread total of unmuted chats.
    pub fn track(&self, app: &AppHandle, chat: &Chat, removed: bool) {
        let n = if removed || chat.muted { 0 } else { chat.unread.max(0) };
        let (was, total): (i32, i64) = {
            let mut u = self.unread.lock().unwrap();
            let was = u.insert((chat.account_id.clone(), chat.id.clone()), n).unwrap_or(0);
            (was, u.values().map(|&v| v as i64).sum())
        };
        // read (here, on the phone, on the web): its banners in Notification Center go too
        if was > 0 && n == 0 {
            clear_delivered(app, if total == 0 { None } else { Some(chat.title.clone()) });
            #[cfg(target_os = "macos")]
            {
                let key = if total == 0 { None } else { Some(format!("{}|{}", chat.account_id, chat.id)) };
                let _ = app.run_on_main_thread(move || crate::island::clear(key.as_deref()));
            }
        }
        let mut badge = self.badge.lock().unwrap();
        if *badge != total {
            *badge = total;
            #[cfg(desktop)]
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.set_badge_count(if total > 0 { Some(total) } else { None });
            }
        }
    }
}

/// "3 tin nhắn trong lúc vắng" / "Minh, Backend Go, Lan +2 chat"; clicking opens the first.
fn summary(q: &[(String, String)]) -> Option<(String, String, String)> {
    let (_, key) = q.first()?;
    let mut chats: Vec<&str> = vec![];
    for (t, _) in q {
        if !chats.contains(&t.as_str()) {
            chats.push(t);
        }
    }
    let more = if chats.len() > 3 { format!(" +{} chat", chats.len() - 3) } else { String::new() };
    Some((format!("{} tin nhắn trong lúc vắng", q.len()), format!("{}{more}", chats[..chats.len().min(3)].join(", ")), key.clone()))
}

/// Account-level problems (session expired): always shown, whatever the message settings.
pub fn alert(app: &AppHandle, title: &str, body: &str) {
    show(app, title, body, "");
}

/// Settings → "Gửi thông báo thử": the same path a message takes, minus the rules.
pub fn test(app: &AppHandle) {
    show(app, "ChatMin", "Thông báo đang hoạt động. Bấm vào để mở ChatMin.", "");
}

/// Android: a high-importance channel (heads-up banner, sound) for messages. Android 8+
/// ignores a notification whose channel doesn't exist; the user tunes it in system settings.
#[cfg(mobile)]
pub const CHANNEL: &str = "messages";
#[cfg(mobile)]
pub fn setup_channel(app: &AppHandle) {
    use tauri_plugin_notification::{Channel, Importance};
    let channel = Channel::builder(CHANNEL, "Tin nhắn").description("Tin nhắn mới, nhắc tên, biểu cảm").importance(Importance::High).vibration(true).build();
    if let Err(e) = app.notification().create_channel(channel) {
        eprintln!("[notify] channel: {e}");
    }
}

/// Android 13+ asks the user before the first notification; `granted` / `denied` / `prompt`.
/// Desktop reports `granted` (the OS decides at delivery).
pub fn permission(app: &AppHandle, ask: bool) -> String {
    #[cfg(mobile)]
    {
        use tauri_plugin_notification::PermissionState;
        let state = app.notification().permission_state();
        let state = match state {
            Ok(PermissionState::Granted) => PermissionState::Granted,
            Ok(_) if ask => app.notification().request_permission().unwrap_or(PermissionState::Denied),
            Ok(s) => s,
            Err(e) => {
                eprintln!("[notify] permission: {e}");
                PermissionState::Denied
            }
        };
        match state {
            PermissionState::Granted => "granted",
            PermissionState::Denied => "denied",
            _ => "prompt",
        }
        .into()
    }
    #[cfg(desktop)]
    {
        let _ = (app, ask);
        "granted".into()
    }
}

/// Brings the window up and opens `chat` ("account|chat"; empty: just the window).
/// `target`: "account|chat", optionally followed by "\nmessage id\nthread id".
fn open(app: &AppHandle, target: &str) {
    eprintln!("[notify] open {:?}", target.split('\n').next().unwrap_or(""));
    #[cfg(desktop)]
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
    let mut parts = target.split('\n').map(String::from);
    let key = parts.next().unwrap_or_default();
    if !key.is_empty() {
        let (msg, thread) = (parts.next().unwrap_or_default(), parts.next().unwrap_or_default());
        let _ = app.emit("chatmin", crate::model::Event::Open { key, msg, thread });
    }
}

/// Clicking a notification opens its chat. Elsewhere the plugin reports the click; on macOS
/// our own `UNUserNotificationCenter` delegate does (`mac`), set up here.
pub fn on_click(app: &AppHandle) {
    #[cfg(not(target_os = "macos"))]
    {
        let handle = app.clone();
        let _ = app.notification().on_action(move |a| {
            if a.action_id() == "tap" {
                let key = a.notification().and_then(|n| n.extra().get("chat")).and_then(|v| v.as_str()).unwrap_or("").to_string();
                open(&handle, &key);
            }
        });
    }
    #[cfg(target_os = "macos")]
    mac::install(app);
}

/// `chat`: "account|chat", the key the frontend opens when the notification is clicked.
fn show(app: &AppHandle, title: &str, body: &str, chat: &str) {
    show_photo(app, title, body, chat, "");
}
fn show_photo(app: &AppHandle, title: &str, body: &str, chat: &str, photo: &str) {
    #[cfg(target_os = "macos")]
    {
        // Serialize native delivery and mode-switch cleanup on the same main thread.
        let (title, body, target) = (title.to_owned(), body.to_owned(), chat.to_owned());
        let handle = app.clone();
        let photo = photo.to_owned();
        if let Err(error) = app.run_on_main_thread(move || {
            if SYSTEM_MODE.load(std::sync::atomic::Ordering::Relaxed) {
                mac::show(&title, &body, &target);
            } else {
                let callback_app = handle.clone();
                let open = std::rc::Rc::new(move |target: &str| open(&callback_app, target));
                if !crate::island::show(&title, &body, &target, &photo, open) {
                    eprintln!("[island] display unavailable; system banners remain disabled");
                } else if !photo.is_empty() {
                    tauri::async_runtime::spawn(async move {
                        let account = target.split('|').next().unwrap_or("");
                        if let Some(path) = crate::island_media::resolve(&handle, account, &photo).await {
                            let _ = handle.run_on_main_thread(move || crate::island::set_avatar(&target, &photo, &path));
                        }
                    });
                }
            }
        }) {
            eprintln!("[notify] native delivery dispatch failed: {error}");
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = photo;
        let n = app.notification().builder().title(title).body(body).sound("default").extra("chat", chat);
        #[cfg(mobile)]
        let n = n.channel_id(CHANNEL).icon("ic_stat_chatmin");
        match n.show() {
            Ok(()) => eprintln!("[notify] shown"),
            Err(e) => eprintln!("[notify] {e}"),
        }
    }
}

/// Removes delivered banners of the chat titled `title` (ours read "Who" for a DM and
/// "Who · Chat" otherwise), or all of them.
fn clear_delivered(app: &AppHandle, title: Option<String>) {
    #[cfg(target_os = "macos")]
    {
        let _ = app;
        mac::clear(title);
    }
    #[cfg(not(target_os = "macos"))]
    let _ = (app, title);
}

/// macOS notifications through the UserNotifications framework. The old
/// `NSUserNotificationCenter` (what mac-notification-sys / notify-rust use) is silently
/// ignored on macOS 26: the app never even appeared in System Settings → Notifications.
/// Needs a signed .app bundle (`bundle.macOS.signingIdentity` in tauri.conf.json).
#[cfg(target_os = "macos")]
mod mac {
    use objc2::rc::Retained;
    use objc2::runtime::{Bool, ProtocolObject};
    use objc2::{define_class, msg_send, AnyThread, DefinedClass};
    use objc2_foundation::{NSArray, NSDictionary, NSError, NSObject, NSObjectProtocol, NSString};
    use objc2_user_notifications::{
        UNAuthorizationOptions, UNMutableNotificationContent, UNNotification, UNNotificationPresentationOptions, UNNotificationRequest, UNNotificationResponse,
        UNNotificationSound, UNUserNotificationCenter, UNUserNotificationCenterDelegate,
    };
    use std::ptr::NonNull;
    use tauri::AppHandle;

    struct Ivars {
        app: AppHandle,
    }

    define_class!(
        #[unsafe(super(NSObject))]
        #[name = "ChatMinNotificationDelegate"]
        #[ivars = Ivars]
        struct Delegate;

        unsafe impl NSObjectProtocol for Delegate {}

        unsafe impl UNUserNotificationCenterDelegate for Delegate {
            // `rings` already decided this one should show, ChatMin in front or not
            #[unsafe(method(userNotificationCenter:willPresentNotification:withCompletionHandler:))]
            fn will_present(&self, _center: &UNUserNotificationCenter, _n: &UNNotification, done: &block2::DynBlock<dyn Fn(UNNotificationPresentationOptions)>) {
                let options = if super::SYSTEM_MODE.load(std::sync::atomic::Ordering::Relaxed) {
                    UNNotificationPresentationOptions::Banner | UNNotificationPresentationOptions::List | UNNotificationPresentationOptions::Sound
                } else { UNNotificationPresentationOptions::empty() };
                done.call((options,));
            }

            #[unsafe(method(userNotificationCenter:didReceiveNotificationResponse:withCompletionHandler:))]
            fn did_receive(&self, _center: &UNUserNotificationCenter, response: &UNNotificationResponse, done: &block2::DynBlock<dyn Fn()>) {
                let info = response.notification().request().content().userInfo();
                let chat = info.objectForKey(&*NSString::from_str("chat")).and_then(|v| v.downcast::<NSString>().ok()).map(|s| s.to_string()).unwrap_or_default();
                eprintln!("[notify] clicked");
                let app = self.ivars().app.clone();
                let h = app.clone();
                let _ = app.run_on_main_thread(move || super::open(&h, &chat));
                done.call(());
            }
        }
    );

    impl Delegate {
        fn new(app: AppHandle) -> Retained<Self> {
            let this = Self::alloc().set_ivars(Ivars { app });
            unsafe { msg_send![super(this), init] }
        }
    }

    /// `UNUserNotificationCenter` aborts the process outside a .app bundle (`cargo tauri dev`).
    fn bundled() -> bool {
        std::env::current_exe().map(|p| p.to_string_lossy().contains(".app/Contents/MacOS/")).unwrap_or(false)
    }

    pub fn install(app: &AppHandle) {
        if !bundled() {
            eprintln!("[notify] not a .app bundle: macOS notifications off");
            return;
        }
        let center = UNUserNotificationCenter::currentNotificationCenter();
        let delegate = Delegate::new(app.clone());
        center.setDelegate(Some(ProtocolObject::from_ref(&*delegate)));
        std::mem::forget(delegate); // the center only holds it weakly; one object for the process' life
        let done = block2::RcBlock::new(|granted: Bool, err: *mut NSError| {
            eprintln!("[notify] permission granted={}{}", granted.as_bool(), if err.is_null() { String::new() } else { format!(" ({:?})", unsafe { &*err }) });
        });
        center.requestAuthorizationWithOptions_completionHandler(UNAuthorizationOptions::Alert | UNAuthorizationOptions::Sound | UNAuthorizationOptions::Badge, &done);
    }

    pub fn show(title: &str, body: &str, chat: &str) {
        if !bundled() || !super::SYSTEM_MODE.load(std::sync::atomic::Ordering::Relaxed) {
            return;
        }
        let content = UNMutableNotificationContent::new();
        content.setTitle(&NSString::from_str(title));
        content.setBody(&NSString::from_str(body));
        content.setSound(Some(&UNNotificationSound::defaultSound()));
        let info = NSDictionary::from_slices(&[&*NSString::from_str("chat")], &[&*NSString::from_str(chat)]);
        unsafe { content.setUserInfo(&Retained::cast_unchecked::<NSDictionary>(info)) };
        let id = NSString::from_str(&format!("chatmin-{}", crate::now_ms()));
        let request = UNNotificationRequest::requestWithIdentifier_content_trigger(&id, &content, None);
        let done = block2::RcBlock::new(|err: *mut NSError| {
            // A request submitted just before switching modes may complete after cleanup.
            if !super::SYSTEM_MODE.load(std::sync::atomic::Ordering::Relaxed) {
                silence();
                return;
            }
            if err.is_null() {
                eprintln!("[notify] shown");
            } else {
                eprintln!("[notify] {:?}", unsafe { &*err });
            }
        });
        UNUserNotificationCenter::currentNotificationCenter().addNotificationRequest_withCompletionHandler(&request, Some(&done));
    }

    pub fn clear(title: Option<String>) {
        if !bundled() {
            return;
        }
        let center = UNUserNotificationCenter::currentNotificationCenter();
        let Some(title) = title else { return center.removeAllDeliveredNotifications() };
        let tail = format!(" · {title}");
        let done = block2::RcBlock::new(move |delivered: NonNull<NSArray<UNNotification>>| {
            let delivered = unsafe { delivered.as_ref() };
            let ids: Vec<Retained<NSString>> = delivered
                .iter()
                .filter(|n| {
                    let t = n.request().content().title().to_string();
                    t == title || t.ends_with(&tail)
                })
                .map(|n| n.request().identifier())
                .collect();
            if !ids.is_empty() {
                UNUserNotificationCenter::currentNotificationCenter().removeDeliveredNotificationsWithIdentifiers(&NSArray::from_retained_slice(&ids));
            }
        });
        center.getDeliveredNotificationsWithCompletionHandler(&done);
    }

    pub fn silence() {
        if !bundled() { return; }
        let center = UNUserNotificationCenter::currentNotificationCenter();
        center.removeAllPendingNotificationRequests();
        center.removeAllDeliveredNotifications();
        eprintln!("[notify] island-only mode: cleared pending/delivered system banners");
    }
}

/// An emoji someone else added to `new` since `old` (counts minus my own reaction).
pub fn new_reaction(old: &Msg, new: &Msg) -> Option<String> {
    let others = |m: &Msg, e: &str| m.reactions.iter().find(|r| r.emoji == e).map_or(0, |r| r.count - r.mine as i32);
    new.reactions.iter().find(|r| others(new, &r.emoji) > others(old, &r.emoji)).map(|r| r.emoji.clone())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn notice_uses_sender_photo_and_only_falls_back_to_the_matching_private_chat() {
        let mut chat = Chat { kind: "dm".into(), photo: "/cache/chat.jpg".into(), photo_ref: "123".into(), ..Default::default() };
        let mut msg = Msg { sender_photo: "https://example.test/person.jpg".into(), ..Default::default() };
        assert_eq!(photo_source(&chat, &msg), "https://example.test/person.jpg");
        msg.sender_photo.clear();
        assert_eq!(photo_source(&chat, &msg), "/cache/chat.jpg");
        chat.photo.clear();
        assert_eq!(photo_source(&chat, &msg), "123");
        chat.kind = "group".into();
        assert_eq!(photo_source(&chat, &msg), "");
    }

    #[test]
    fn reaction_diff() {
        use crate::model::Reaction;
        let m = |rs: &[(&str, i32, bool)]| Msg { reactions: rs.iter().map(|&(e, c, mine)| Reaction { emoji: e.into(), count: c, mine }).collect(), ..Default::default() };
        assert_eq!(new_reaction(&m(&[]), &m(&[("👍", 1, false)])).as_deref(), Some("👍"));
        assert_eq!(new_reaction(&m(&[]), &m(&[("👍", 1, true)])), None); // my own
        assert_eq!(new_reaction(&m(&[("👍", 1, true)]), &m(&[("👍", 2, true)])).as_deref(), Some("👍"));
        assert_eq!(new_reaction(&m(&[("👍", 2, false)]), &m(&[("👍", 2, false)])), None);
        assert_eq!(new_reaction(&m(&[("👍", 2, false)]), &m(&[("👍", 1, false)])), None); // removed
    }

    #[test]
    fn who_rings() {
        let now = 1_000_000_000_000;
        let p = Prefs::default();
        let space = Chat { kind: "space".into(), ..Default::default() };
        let dm = Chat { kind: "dm".into(), ..Default::default() };
        let msg = |f: fn(&mut Msg)| {
            let mut m = Msg { ts: now - 1000, ..Default::default() };
            f(&mut m);
            m
        };
        let ring = |p: &Prefs, c: &Chat, m: &Msg, followed: bool| Notifier::rings(p, c, m, followed, false, now, "12:00") == Ring::Now;
        assert!(ring(&p, &dm, &msg(|_| {}), false));
        assert!(ring(&p, &dm, &msg(|m| m.thread_reply = true), false), "DMs ring for everything");
        assert!(ring(&p, &space, &msg(|_| {}), false), "first message of a thread");
        assert!(!ring(&p, &space, &msg(|m| m.thread_reply = true), false), "reply in a thread you're not in");
        assert!(ring(&p, &space, &msg(|m| m.thread_reply = true), true), "reply in a thread you posted in");
        assert!(ring(&p, &space, &msg(|m| { m.thread_reply = true; m.mentions_me = true }), false));
        assert!(!ring(&p, &dm, &msg(|m| m.outgoing = true), false));
        let at = |ts| Notifier::rings(&p, &dm, &Msg { ts, ..Default::default() }, false, false, now, "12:00");
        assert_eq!(at(now - STALE_MS - 1), Ring::Later, "caught up after sleep: into the summary");
        assert_eq!(at(now - DIGEST_MS - 1), Ring::No, "too old to mention");
        assert_eq!(Notifier::rings(&p, &Chat { muted: true, ..dm.clone() }, &Msg { ts: now - STALE_MS - 1, ..Default::default() }, false, false, now, "12:00"), Ring::No);
        assert!(!ring(&p, &Chat { muted: true, ..dm.clone() }, &msg(|_| {}), false));
        let muted_tg = Chat { muted: true, account_id: "tg-1".into(), kind: "group".into(), ..Default::default() };
        assert!(ring(&p, &muted_tg, &msg(|m| m.mentions_me = true), false), "Telegram: mention in a muted group");
        assert!(!ring(&p, &muted_tg, &msg(|_| {}), false));
        assert!(!ring(&p, &Chat { muted: true, account_id: "gc-1".into(), ..space.clone() }, &msg(|m| m.mentions_me = true), false), "muted space stays silent");
        assert_eq!(Notifier::rings(&p, &dm, &msg(|_| {}), false, true, now, "12:00"), Ring::No, "chat on screen");
        let only = Prefs { mentions: true, ..Default::default() };
        assert!(!ring(&only, &dm, &msg(|_| {}), false) && ring(&only, &dm, &msg(|m| m.mentions_me = true), false));
        assert!(!ring(&Prefs { enabled: false, ..Default::default() }, &dm, &msg(|_| {}), false));
        assert_eq!(Notifier::rings(&Prefs { quiet: true, ..Default::default() }, &dm, &msg(|_| {}), false, false, now, "23:00"), Ring::No);
    }

    #[test]
    fn away_summary() {
        let q = |v: &[&str]| v.iter().map(|t| (t.to_string(), format!("k-{t}"))).collect::<Vec<_>>();
        assert_eq!(summary(&[]), None);
        assert_eq!(summary(&q(&["Minh", "Lan", "Minh"])).unwrap(), ("3 tin nhắn trong lúc vắng".into(), "Minh, Lan".into(), "k-Minh".into()));
        assert_eq!(summary(&q(&["A", "B", "C", "D", "E"])).unwrap().1, "A, B, C +2 chat");
    }

    #[test]
    fn quiet_hours() {
        let p = Prefs { quiet: true, ..Default::default() }; // 22:00–08:00
        assert!(p.quiet_at("23:30") && p.quiet_at("07:59") && !p.quiet_at("08:00") && !p.quiet_at("12:00"));
        let day = Prefs { quiet: true, from: "12:00".into(), to: "13:00".into(), ..Default::default() };
        assert!(day.quiet_at("12:30") && !day.quiet_at("13:00") && !day.quiet_at("11:59"));
        assert!(!Prefs::default().quiet_at("23:30"));
    }
}

#[cfg(test)]
mod web_privacy_tests {
    use super::*;
    #[test]
    fn web_previews_respect_privacy_and_empty_messages() {
        let private = Prefs { preview: false, ..Default::default() };
        assert_eq!(web_body(&private, "secret message"), "Bạn có tin nhắn mới");
        assert_eq!(web_body(&Prefs::default(), ""), "Bạn có tin nhắn mới");
        assert_eq!(web_body(&Prefs::default(), "hello"), "hello");
    }
}
