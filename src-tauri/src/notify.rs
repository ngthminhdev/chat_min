//! Desktop notifications and the Dock badge, decided in Rust where messages arrive. When
//! the window is hidden (close only hides it) WebKit throttles or suspends its webview, so
//! deciding this in JS made alerts late or missing exactly when they matter most.
use crate::model::{Chat, Msg};
use serde::Deserialize;
use std::collections::HashMap;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager};
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
        show(app, &title, &body, &format!("{}|{}\n{}\n{thread}", m.account_id, m.chat_id, m.id));
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

    /// Messenger / Zalo only report a count (from the page title).
    pub fn web(&self, app: &AppHandle, chat: &Chat, grew_to: i32) {
        if chat.muted || self.watching(app, &chat.account_id, &chat.id) {
            return;
        }
        let p = self.prefs.lock().unwrap().get(&chat.account_id).cloned().unwrap_or_default();
        let now_hm = chrono::Local::now().format("%H:%M").to_string();
        if p.enabled && !p.mentions && !p.quiet_at(&now_hm) {
            show(app, &chat.title, &format!("{grew_to} tin nhắn chưa đọc"), &format!("{}|{}", chat.account_id, chat.id));
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
/// it can't (notify-rust sends without wait_for_click), so `show` handles macOS itself.
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
    let _ = mac_notification_sys::set_application(&app.config().identifier);
}

/// Notifications still waiting for a click on macOS, one small thread each. An ignored
/// notification keeps its thread until it leaves Notification Center, so past this many
/// they're sent without waiting (a click then only brings ChatMin forward).
#[cfg(target_os = "macos")]
static WAITING: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
#[cfg(target_os = "macos")]
const MAX_WAITING: usize = 200;

/// `chat`: "account|chat", the key the frontend opens when the notification is clicked.
fn show(app: &AppHandle, title: &str, body: &str, chat: &str) {
    #[cfg(target_os = "macos")]
    {
        use std::sync::atomic::Ordering::SeqCst;
        let (app, title, body, chat) = (app.clone(), title.to_string(), body.to_string(), chat.to_string());
        let wait = WAITING.fetch_add(1, SeqCst) < MAX_WAITING;
        let spawned = std::thread::Builder::new().name("notify".into()).stack_size(128 * 1024).spawn(move || {
            let mut n = mac_notification_sys::Notification::new();
            n.sound(mac_notification_sys::Sound::Default).wait_for_click(wait);
            let res = mac_notification_sys::send_notification(&title, None, &body, Some(&n));
            WAITING.fetch_sub(1, SeqCst);
            match res {
                Ok(mac_notification_sys::NotificationResponse::Click) => {
                    eprintln!("[notify] clicked");
                    let h = app.clone();
                    let _ = app.run_on_main_thread(move || open(&h, &chat));
                }
                Ok(_) => {}
                Err(e) => eprintln!("[notify] {e}"),
            }
        });
        match spawned {
            Ok(_) => eprintln!("[notify] shown"),
            Err(e) => {
                WAITING.fetch_sub(1, SeqCst);
                eprintln!("[notify] {e}");
            }
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        let n = app.notification().builder().title(title).body(body).sound("default").extra("chat", chat);
        #[cfg(mobile)]
        let n = n.channel_id(CHANNEL);
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
    let _ = app.run_on_main_thread(move || {
        #[allow(deprecated)] // NSUserNotification: what mac-notification-sys delivers through
        {
            let center = objc2_foundation::NSUserNotificationCenter::defaultUserNotificationCenter();
            let Some(title) = title else { return center.removeAllDeliveredNotifications() };
            let tail = format!(" · {title}");
            for n in center.deliveredNotifications().iter() {
                let t = n.title().map(|t| t.to_string()).unwrap_or_default();
                if t == title || t.ends_with(&tail) {
                    center.removeDeliveredNotification(&n);
                }
            }
        }
    });
    #[cfg(not(target_os = "macos"))]
    let _ = (app, title);
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
