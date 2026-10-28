//! Desktop notifications and the Dock badge, decided in Rust where messages arrive. When
//! the window is hidden (close only hides it) WebKit throttles or suspends its webview, so
//! deciding this in JS made alerts late or missing exactly when they matter most.
use crate::model::{Chat, Msg};
use crate::notify_state::{Digest, UnreadBadge};
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
#[serde(default, rename_all = "camelCase")]
pub struct Prefs {
    pub enabled: bool,
    pub mentions: bool,
    pub quiet: bool,
    pub from: String,
    pub to: String,
    pub preview: bool,
    pub dock_bounce: bool,
}

impl Default for Prefs {
    fn default() -> Self {
        Self { enabled: true, mentions: false, quiet: false, from: "22:00".into(), to: "08:00".into(), preview: true, dock_bounce: true }
    }
}

/// Invalid entries must not discard the other accounts' quiet/privacy settings.
pub fn saved_prefs(snapshot: &serde_json::Value) -> HashMap<String, Prefs> {
    snapshot.get("notif").and_then(|v| v.as_object()).into_iter().flatten()
        .filter_map(|(id, value)| serde_json::from_value(value.clone()).ok().map(|p| (id.clone(), p))).collect()
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
    /// Conversation actually rendered by the frontend (separate from provider polling).
    active: Mutex<Option<(String, String)>>,
    /// unread per chat, muted chats as 0; their sum is the Dock badge
    unread: Mutex<UnreadBadge>,
    badge: Mutex<Option<i64>>,
    badge_scheduled: std::sync::atomic::AtomicBool,
    /// (chat title, "account|chat") waiting for the summary
    missed: Mutex<Digest>,
    missed_scheduled: std::sync::atomic::AtomicBool,
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

    pub fn set_reading(&self, key: Option<&str>) {
        *self.active.lock().unwrap() = key.and_then(|k| k.split_once('|')).map(|(account,chat)| (account.to_owned(),chat.to_owned()));
    }

    /// The chat on screen in the focused window: its messages are being read, no banner.
    /// Other chats still ring while ChatMin is in front.
    pub fn watching(&self, app: &AppHandle, account_id: &str, chat_id: &str) -> bool {
        let on_screen = self.active.lock().unwrap().as_ref().is_some_and(|(a, c)| a == account_id && c == chat_id);
        #[cfg(desktop)]
        let in_front = { let _ = app; crate::window_presence::readable() };
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
                self.later(app, &chat.title, &format!("{}|{}", m.account_id, m.chat_id), m.mentions_me);
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
        show_photo(app, &title, &body, &format!("{}|{}\n{}\n{thread}", m.account_id, m.chat_id, m.id), photo_source(chat, m), p.dock_bounce);
        Ring::Now
    }

    /// Someone reacted to one of my messages. Not while that chat is on screen, nor when
    /// notifications are off / quiet hours.
    pub fn reaction(&self, app: &AppHandle, chat: Option<&Chat>, m: &Msg, emoji: &str) {
        let Some(chat) = chat else { return };
        let p = self.prefs.lock().unwrap().get(&m.account_id).cloned().unwrap_or_default();
        let now_hm = chrono::Local::now().format("%H:%M").to_string();
        if !p.enabled || p.mentions || chat.muted || p.quiet_at(&now_hm) || self.watching(app, &m.account_id, &m.chat_id) {
            return;
        }
        let t = crate::tg::plain(&m.text, m.media.as_ref());
        let body = if p.preview && !t.is_empty() { format!("{emoji} vào tin của bạn: {t}") } else { format!("{emoji} vào tin của bạn") };
        let thread = if m.thread_reply { m.thread_id.as_str() } else { "" };
        show_photo(app, &format!("Biểu cảm mới · {}", chat.title), &body, &format!("{}|{}\n{}\n{thread}", m.account_id, m.chat_id, m.id), "", p.dock_bounce);
    }

    /// Queues a missed message; a catch-up burst settles for a few seconds, then rings once.
    fn later(&self, app: &AppHandle, title: &str, key: &str, mentioned: bool) {
        self.missed.lock().unwrap().push(title, key, mentioned);
        if !self.missed_scheduled.swap(true, std::sync::atomic::Ordering::AcqRel) {
            let app = app.clone();
            tauri::async_runtime::spawn(async move {
                tokio::time::sleep(std::time::Duration::from_secs(5)).await;
                if let Some(core) = app.try_state::<std::sync::Arc<crate::Core>>() {
                    let mut q = {
                        let mut pending = core.notifier.missed.lock().unwrap();
                        core.notifier.missed_scheduled.store(false, std::sync::atomic::Ordering::Release);
                        std::mem::take(&mut *pending)
                    };
                    let now_hm = chrono::Local::now().format("%H:%M").to_string();
                    let prefs = core.notifier.prefs.lock().unwrap().clone();
                    for (account, p) in &prefs { if p.mentions { q.only_mentions(account); } }
                    q.groups.retain_mut(|group| {
                        let Some((account, chat)) = group.key.split_once('|') else { return false };
                        let p = prefs.get(account).cloned().unwrap_or_default();
                        let current = core.store().chat(account, chat).ok().flatten();
                        let Some(current) = current else { return false };
                        if current.muted {
                            if !account.starts_with("tg-") { return false; }
                            group.count = group.mentions;
                        }
                        group.count > 0 && current.unread > 0 && p.enabled && !p.quiet_at(&now_hm) && !core.notifier.watching(&app, account, chat)
                    });
                    if let Some((title, body, key)) = q.summary() {
                        let bounce = q.groups.iter().any(|g| prefs.get(g.key.split('|').next().unwrap_or("")).cloned().unwrap_or_default().dock_bounce);
                        show_photo(&app, &title, &body, &key, "", bounce);
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
            show_photo(app, &chat.title, web_body(&p, body), &format!("{}|{}", chat.account_id, chat.id), "", p.dock_bounce);
        }
    }

    /// Keeps the Dock badge equal to the unread total of unmuted chats.
    pub fn track(&self, app: &AppHandle, chat: &Chat, removed: bool) {
        let n = if removed { 0 } else { chat.unread.max(0) };
        let (was, total) = {
            let mut unread = self.unread.lock().unwrap();
            if chat.muted { unread.update_muted(&chat.account_id, &chat.id, n, true) }
            else { unread.update(&chat.account_id, &chat.id, n) }
        };
        // read (here, on the phone, on the web): its banners in Notification Center go too
        if (was > 0 || removed) && n == 0 {
            let chat_key = format!("{}|{}", chat.account_id, chat.id);
            self.missed.lock().unwrap().remove_chat(&chat_key);
            clear_delivered(app, Some(chat_key.clone()));
            #[cfg(target_os = "macos")]
            {
                let _ = app.run_on_main_thread(move || {
                    crate::island::clear(Some(&chat_key));
                    if total == 0 { mac::cancel_attention(); }
                });
            }
        }
        if was != n || *self.badge.lock().unwrap() != Some(total) { self.schedule_badge(app); }
    }

    fn schedule_badge(&self, app: &AppHandle) {
        #[cfg(desktop)]
        if !self.badge_scheduled.swap(true, std::sync::atomic::Ordering::AcqRel) {
            let app = app.clone();
            tauri::async_runtime::spawn(async move {
                tokio::time::sleep(std::time::Duration::from_millis(40)).await;
                let handle = app.clone();
                if let Err(error) = app.run_on_main_thread(move || {
                    let Some(core) = handle.try_state::<std::sync::Arc<crate::Core>>() else { return };
                    core.notifier.badge_scheduled.store(false, std::sync::atomic::Ordering::Release);
                    let total = core.notifier.unread.lock().unwrap().total;
                    let mut applied = core.notifier.badge.lock().unwrap();
                    if *applied != Some(total) {
                        if let Some(w) = handle.get_window("main") {
                            match w.set_badge_count(if total > 0 { Some(total) } else { None }) {
                                Ok(()) => *applied = Some(total),
                                Err(error) => eprintln!("[notify] badge update failed: {error}"),
                            }
                        }
                    }
                }) {
                    if let Some(core) = app.try_state::<std::sync::Arc<crate::Core>>() {
                        core.notifier.badge_scheduled.store(false, std::sync::atomic::Ordering::Release);
                    }
                    eprintln!("[notify] badge dispatch failed: {error}");
                }
            });
        }
        #[cfg(mobile)]
        let _ = app;
    }

    pub fn remove_account(&self, app: &AppHandle, account: &str) {
        self.unread.lock().unwrap().remove_account(account);
        self.missed.lock().unwrap().remove_account(account);
        self.prefs.lock().unwrap().remove(account);
        #[cfg(target_os = "macos")]
        {
            let account = account.to_owned();
            let _ = app.run_on_main_thread(move || {
                mac::clear_account(account.clone());
                crate::island::clear_account(&account);
            });
        }
        self.schedule_badge(app);
    }
}

/// Account-level problems (session expired): always shown, whatever the message settings.
pub fn alert(app: &AppHandle, title: &str, body: &str) {
    show(app, title, body, "");
}

/// Settings → "Gửi thông báo thử": the same path a message takes, minus the rules.
pub fn test(app: &AppHandle) {
    // Repeat tests are separate deliveries; an empty first line still only opens the app.
    static NEXT_TEST: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let target = format!("\npreview-{}", NEXT_TEST.fetch_add(1, std::sync::atomic::Ordering::Relaxed));
    show(app, "ChatMin", "Thông báo đang hoạt động. Bấm vào để mở ChatMin.", &target);
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
    if let Some(w) = app.get_window("main") {
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

#[cfg(target_os = "macos")]
pub fn cancel_attention() { mac::cancel_attention(); }

/// `chat`: "account|chat", the key the frontend opens when the notification is clicked.
fn show(app: &AppHandle, title: &str, body: &str, chat: &str) {
    show_photo(app, title, body, chat, "", true);
}
fn show_photo(app: &AppHandle, title: &str, body: &str, chat: &str, photo: &str, dock_bounce: bool) {
    #[cfg(target_os = "macos")]
    {
        // Serialize native delivery and mode-switch cleanup on the same main thread.
        let (title, body, target) = (title.to_owned(), body.to_owned(), chat.to_owned());
        let handle = app.clone();
        let photo = photo.to_owned();
        let queued = std::time::Instant::now();
        if let Err(error) = app.run_on_main_thread(move || {
            if crate::island::session_active() { mac::attention(&handle, dock_bounce); }
            eprintln!("[notify] dispatch queue_us={} mode={}", queued.elapsed().as_micros(), if SYSTEM_MODE.load(std::sync::atomic::Ordering::Relaxed) { "system" } else { "island" });
            if SYSTEM_MODE.load(std::sync::atomic::Ordering::Relaxed) {
                mac::show(&title, &body, &target);
            } else {
                if !crate::island::session_active() { return; }
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
        let _ = (photo, dock_bounce);
        let n = app.notification().builder().title(title).body(body).sound("default").extra("chat", chat);
        #[cfg(mobile)]
        let n = n.channel_id(CHANNEL).icon("ic_stat_chatmin");
        match n.show() {
            Ok(()) => eprintln!("[notify] shown"),
            Err(e) => eprintln!("[notify] {e}"),
        }
    }
}

/// Remove exactly this account/chat, even when other chats share its display name.
fn clear_delivered(app: &AppHandle, key: Option<String>) {
    #[cfg(target_os = "macos")]
    {
        let _ = app;
        mac::clear(key);
    }
    #[cfg(not(target_os = "macos"))]
    let _ = (app, key);
}

/// macOS notifications through the UserNotifications framework. The old
/// `NSUserNotificationCenter` (what mac-notification-sys / notify-rust use) is silently
/// ignored on macOS 26: the app never even appeared in System Settings → Notifications.
/// Needs a signed .app bundle (`bundle.macOS.signingIdentity` in tauri.conf.json).
#[cfg(target_os = "macos")]
mod mac {
    use crate::notify_state::{AttentionRequest, BounceGate, DOCK_BOUNCE_MS};
    use objc2::MainThreadMarker;
    use objc2_app_kit::{NSApplication, NSRequestUserAttentionType, NSWorkspace};
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

    thread_local! {
        static ATTENTION: std::cell::RefCell<(BounceGate, AttentionRequest)> = std::cell::RefCell::new((BounceGate::default(), AttentionRequest::default()));
    }
    pub fn attention(handle: &AppHandle, enabled: bool) {
        let Some(mtm) = MainThreadMarker::new() else { return };
        let app = NSApplication::sharedApplication(mtm);
        let reduced = NSWorkspace::sharedWorkspace().accessibilityDisplayShouldReduceMotion();
        ATTENTION.with(|state| {
            let mut state = state.borrow_mut();
            // A burst shares one bounded attention window; new messages don't restart it.
            if state.1.is_active() { return; }
            if state.0.allow(std::time::Instant::now(), enabled, app.isActive(), reduced) {
                if let Some(request) = state.1.finish(None) { app.cancelUserAttentionRequest(request); }
                let request = app.requestUserAttention(NSRequestUserAttentionType::CriticalRequest);
                state.1.begin(request);
                let handle = handle.clone();
                tauri::async_runtime::spawn(async move {
                    tokio::time::sleep(std::time::Duration::from_millis(DOCK_BOUNCE_MS)).await;
                    if let Err(error) = handle.run_on_main_thread(move || finish_attention(Some(request), "timeout")) {
                        eprintln!("[notify] dock attention stop dispatch failed: {error}");
                    }
                });
                eprintln!("[notify] dock attention requested style=repeating duration_ms={DOCK_BOUNCE_MS}");
            }
        });
    }
    pub fn cancel_attention() {
        finish_attention(None, "cleared");
    }
    fn finish_attention(expected: Option<isize>, reason: &str) {
        let Some(mtm) = MainThreadMarker::new() else { return };
        ATTENTION.with(|state| {
            if let Some(request) = state.borrow_mut().1.finish(expected) {
                NSApplication::sharedApplication(mtm).cancelUserAttentionRequest(request);
                eprintln!("[notify] dock attention stopped reason={reason}");
            }
        });
    }

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
        content.setThreadIdentifier(&NSString::from_str(chat.split('\n').next().unwrap_or("")));
        let info = NSDictionary::from_slices(&[&*NSString::from_str("chat")], &[&*NSString::from_str(chat)]);
        unsafe { content.setUserInfo(&Retained::cast_unchecked::<NSDictionary>(info)) };
        static NEXT_ID: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
        let id = NSString::from_str(&format!("chatmin-{}-{}", crate::now_ms(), NEXT_ID.fetch_add(1, std::sync::atomic::Ordering::Relaxed)));
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

    pub fn clear(key: Option<String>) {
        clear_matching(key, None);
    }
    pub fn clear_account(account: String) {
        clear_matching(None, Some(account));
    }
    fn clear_matching(key: Option<String>, account: Option<String>) {
        if !bundled() {
            return;
        }
        let center = UNUserNotificationCenter::currentNotificationCenter();
        if key.is_none() && account.is_none() { return center.removeAllDeliveredNotifications(); }
        let done = block2::RcBlock::new(move |delivered: NonNull<NSArray<UNNotification>>| {
            let delivered = unsafe { delivered.as_ref() };
            let ids: Vec<Retained<NSString>> = delivered
                .iter()
                .filter(|n| {
                    let content = n.request().content();
                    let info = content.userInfo();
                    info.objectForKey(&*NSString::from_str("chat"))
                        .and_then(|v| v.downcast::<NSString>().ok())
                        .is_some_and(|target| {
                            let target = target.to_string();
                            if let Some(key) = &key { target.split('\n').next() == Some(key.as_str()) }
                            else { target.split('|').next() == account.as_deref() }
                        })
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
    fn saved_prefs_restore_before_webview_and_tolerate_one_invalid_account() {
        let prefs = saved_prefs(&serde_json::json!({"notif": {
            "tg-a": {"enabled": false}, "gc-b": {"quiet": true, "dockBounce": false},
            "broken": {"enabled": "invalid"}
        }}));
        assert!(!prefs["tg-a"].enabled);
        assert!(prefs["tg-a"].dock_bounce);
        assert!(prefs["gc-b"].quiet);
        assert!(!prefs["gc-b"].dock_bounce);
        assert!(!prefs.contains_key("broken"));
    }

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
