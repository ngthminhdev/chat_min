mod ai;
#[cfg(target_os = "android")]
mod files_android;
mod gchat;
#[cfg(any(target_os = "android", test))]
mod google_android;
#[cfg(target_os = "macos")]
mod island;
#[cfg(target_os = "macos")]
mod island_media;
#[cfg(any(target_os = "macos", test))]
mod island_queue;
mod island_style;
#[cfg(target_os = "macos")]
mod island_view;
mod model;
mod notify;
mod store;
mod tg;

/// Native UI QA without loading credentials, opening accounts, or starting provider listeners.
#[cfg(all(target_os = "macos", debug_assertions))]
pub fn preview_notification_island() {
    island::preview();
}
mod storage;
mod web;
mod zalo;
mod zalo_import;
mod zalo_profiles;

/// Maintenance command: migrate owned cache without starting any provider listener.
pub fn import_zalo_cache(
    database: &std::path::Path,
    input: &std::path::Path,
    account: &str,
) -> Result<String, String> {
    zalo_import::import_file(database, input, account)
}

use gchat::GChat;
use model::{Account, Chat, Event, Member, Msg, Topic};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex, MutexGuard};
use store::Store;
use tauri::{Emitter, Manager, State};
use tg::Tg;

pub fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// Developer credentials: Telegram api_id/api_hash and the Google OAuth "Desktop app"
/// client. Lives in `<appdata>/config.json`; the wizard asks when something is missing.
#[derive(Default, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase", default)]
struct Config {
    tg_api_id: i32,
    tg_api_hash: String,
    gchat_client_id: String,
    gchat_client_secret: String,
    ai: ai::AiConfig,
    /// where "Lưu vào…" puts files; "" = ~/Downloads/ChatMin
    download_dir: String,
    /// app that opens outside links, e.g. "Microsoft Edge"; "" = the system default
    browser: String,
    /// media cache limit in MB; None = 2048, Some(0) = no limit
    cache_mb: Option<u64>,
    /// keep cached media this many days since last use; None = 30, Some(0) = forever
    keep_days: Option<u32>,
    /// threads/topics that never ring nor reach the bell: "account|chat|thread"
    muted_threads: Vec<String>,
    /// None preserves the default: native notch island on macOS.
    notification_island: Option<bool>,
    notification_appearance: Option<island_style::Appearance>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Health {
    pub health: String,
    pub text: String,
    pub until: i64,
}

pub struct Core {
    app: tauri::AppHandle,
    pub data_dir: PathBuf,
    pub cache_dir: PathBuf,
    store: Mutex<Store>,
    config: Mutex<Config>,
    pub health: Mutex<HashMap<String, Health>>,
    pub tg: Tg,
    pub gchat: GChat,
    pub zalo: zalo::Zalo,
    pub notifier: notify::Notifier,
    /// Messenger: the thread each account's webview should be showing (None = site default)
    pub web_open: Mutex<HashMap<String, Option<String>>>,
}

impl Core {
    pub fn emit(&self, e: Event) {
        let _ = self.app.emit("chatmin", e);
    }
    pub fn store(&self) -> MutexGuard<'_, Store> {
        self.store.lock().unwrap()
    }
    /// Opens a link in the browser picked in settings, else the system default.
    pub fn open_url(&self, url: &str) {
        let b = self.config.lock().unwrap().browser.clone();
        if b.is_empty() || tauri_plugin_opener::open_url(url, Some(b.as_str())).is_err() {
            let _ = tauri_plugin_opener::open_url(url, None::<&str>);
        }
    }
    pub fn store_mut(&self) -> MutexGuard<'_, Store> {
        self.store.lock().unwrap()
    }
    pub fn tg_api(&self) -> (i32, String) {
        let c = self.config.lock().unwrap();
        (c.tg_api_id, c.tg_api_hash.clone())
    }
    pub fn gchat_client(&self) -> Option<(String, String)> {
        let c = self.config.lock().unwrap();
        (!c.gchat_client_id.is_empty())
            .then(|| (c.gchat_client_id.clone(), c.gchat_client_secret.clone()))
    }

    pub fn put_chat(&self, chat: Chat) {
        // Preserve a local mute and write the provider snapshot under one lock.
        let mut chat = chat;
        let local_mute = matches!(
            self.platform(&chat.account_id),
            "gchat" | "messenger" | "zalo"
        );
        let store = self.store();
        if local_mute {
            if let Ok(Some(old)) = store.chat(&chat.account_id, &chat.id) {
                chat.muted = old.muted;
                if old == chat {
                    return;
                }
            }
        }
        let _ = store.put_chat(&chat);
        drop(store);
        self.notifier.track(&self.app, &chat, false);
        let mut shown = vec![chat];
        self.zalo.profiles.chats(&self.cache_dir, &mut shown);
        self.emit(Event::Chat {
            chat: shown.remove(0),
        });
    }
    pub fn remove_chat(&self, account_id: &str, chat_id: &str) {
        let _ = self.store().remove_chat(account_id, chat_id);
        self.notifier.track(
            &self.app,
            &Chat {
                account_id: account_id.into(),
                id: chat_id.into(),
                ..Default::default()
            },
            true,
        );
        self.emit(Event::ChatRemoved {
            account_id: account_id.into(),
            chat_id: chat_id.into(),
        });
    }
    fn download_dir(&self) -> PathBuf {
        let d = self.config.lock().unwrap().download_dir.clone();
        if d.is_empty() {
            self.app
                .path()
                .download_dir()
                .unwrap_or_else(|_| self.data_dir.clone())
                .join("ChatMin")
        } else {
            d.into()
        }
    }

    /// Trims the media caches to the configured size / age (`all`: empties them).
    /// Returns bytes freed.
    async fn clean_storage(&self, all: bool) -> u64 {
        let (mb, days) = {
            let c = self.config.lock().unwrap();
            (c.cache_mb.unwrap_or(2048), c.keep_days.unwrap_or(30))
        };
        let (limit, ttl) = if all {
            (Some(0), Some(0))
        } else {
            (
                (mb > 0).then_some(mb << 20),
                (days > 0).then_some(days as u64 * 86400),
            )
        };
        // ponytail: the limit applies to each store (Telegram, ChatMin's own cache), not to their sum
        let tg = self
            .tg
            .optimize(
                limit.map_or(i64::MAX >> 2, |l| l as i64),
                ttl.map_or(i32::MAX, |t| t.min(i32::MAX as u64) as i32),
            )
            .await;
        let dirs = [
            self.cache_dir.join("gchat"),
            self.cache_dir.join("zalo"),
            self.cache_dir.join("outbox"),
        ];
        let ttl = ttl.map(std::time::Duration::from_secs);
        let local: u64 = dirs.iter().map(|d| storage::prune(d, limit, ttl)).sum();
        tg as u64 + local
    }

    /// A muted thread/topic: nothing from it rings or lands in the bell.
    fn thread_muted(&self, m: &Msg) -> bool {
        !m.thread_id.is_empty()
            && self
                .config
                .lock()
                .unwrap()
                .muted_threads
                .contains(&format!("{}|{}|{}", m.account_id, m.chat_id, m.thread_id))
    }

    pub fn put_msg(&self, msg: Msg, is_new: bool) {
        if msg.account_id.starts_with("zalo-")
            && self
                .store()
                .zalo_recalled(&msg.account_id, &msg.chat_id, &msg.id)
                .unwrap_or(true)
        {
            return;
        }
        // Google Chat lists deleted messages (showDeleted) as a bare id + time: no sender, no
        // thread. Google's own client hides them, so do we — drop the stored copy instead of
        // showing a "?" tombstone at the top level (Telegram deletions already arrive as deletes).
        if msg.deleted {
            self.delete_msgs(&msg.account_id, &msg.chat_id, vec![msg.id]);
            return;
        }
        // Hold the store mutex across existence check + upsert: concurrent pollers
        // and history loads must agree on whether this ID is a first delivery.
        // reactions on my messages only show up as changed counts: diff against the stored copy
        let before = if msg.outgoing && !msg.reactions.is_empty() {
            self.store()
                .msg(&msg.account_id, &msg.chat_id, &msg.id)
                .ok()
                .flatten()
        } else {
            None
        };
        let mut msg = msg;
        gchat::hydrate_cached_media(&self.cache_dir, std::slice::from_mut(&mut msg));
        zalo::hydrate(&self.cache_dir, std::slice::from_mut(&mut msg));
        self.zalo
            .profiles
            .messages(&self.cache_dir, std::slice::from_mut(&mut msg));
        if let (Some(old), true) = (&before, msg.account_id.starts_with("gc-")) {
            // gchat never says which reactions are mine: keep what we knew unless that count fell
            for r in msg.reactions.iter_mut() {
                if let Some(o) = old.reactions.iter().find(|o| o.emoji == r.emoji) {
                    r.mine |= o.mine && r.count >= o.count;
                }
            }
        }
        let first_delivery = self.store().put_msg_if_new(&msg).unwrap_or(false);
        if let Some(old) = before {
            if let Some(emoji) = notify::new_reaction(&old, &msg) {
                let chat = self
                    .store()
                    .chat(&msg.account_id, &msg.chat_id)
                    .ok()
                    .flatten();
                self.notifier
                    .reaction(&self.app, chat.as_ref(), &msg, &emoji);
                self.emit(Event::Reacted {
                    msg: msg.clone(),
                    emoji,
                });
            }
        }
        let is_new = is_new && first_delivery && !msg.deleted;
        let mut inbox = false;
        if is_new {
            let muted = self.thread_muted(&msg);
            let (chat, followed) = {
                let s = self.store();
                let chat = s.chat(&msg.account_id, &msg.chat_id).ok().flatten();
                let followed = !muted
                    && msg.thread_reply
                    && !msg.thread_id.is_empty()
                    && s.thread_msgs(&msg.account_id, &msg.chat_id, &msg.thread_id)
                        .is_ok_and(|t| t.iter().any(|m| m.outgoing));
                (chat, followed)
            };
            inbox = !muted
                && !msg.outgoing
                && (msg.mentions_me
                    || followed
                    || chat.as_ref().is_some_and(|c| c.kind == "dm" && !c.muted));
            let rang = if muted {
                notify::Ring::No
            } else {
                self.notifier
                    .message(&self.app, chat.as_ref(), &msg, followed)
            };
            // how long a message took to reach us (what the polling cadence is tuned by), and
            // why it did or didn't ring — no names or content
            let c = chat.as_ref();
            eprintln!(
                "[recv] {} +{}ms {}{}{} rang={rang:?}",
                msg.account_id.split('-').next().unwrap_or(""),
                now_ms() - msg.ts,
                c.map_or("?", |c| c.kind.as_str()),
                if c.is_some_and(|c| c.muted) {
                    " muted"
                } else {
                    ""
                },
                if msg.thread_reply { " reply" } else { "" },
            );
        }
        self.emit(Event::Message { msg, is_new, inbox });
    }
    pub fn replace_msg(&self, old_id: &str, msg: Msg) {
        {
            let s = self.store();
            let _ = s.remove_msg(&msg.account_id, &msg.chat_id, old_id);
            let _ = s.put_msg(&msg);
        }
        self.emit(Event::MessageIdChanged {
            old_id: old_id.into(),
            msg,
        });
    }
    pub fn delete_msgs(&self, account_id: &str, chat_id: &str, ids: Vec<String>) {
        {
            let s = self.store();
            for id in &ids {
                let _ = s.remove_msg(account_id, chat_id, id);
            }
        }
        self.emit(Event::MessagesDeleted {
            account_id: account_id.into(),
            chat_id: chat_id.into(),
            ids,
        });
    }
    pub fn set_health(&self, account_id: &str, health: &str, text: &str, until: i64) {
        eprintln!("[health] {account_id} {health} {text}");
        let h = Health {
            health: health.into(),
            text: text.into(),
            until,
        };
        let was = self
            .health
            .lock()
            .unwrap()
            .insert(account_id.into(), h)
            .map(|h| h.health);
        // with the official apps' alerts turned off, a dead session must not go unnoticed
        if health == "expired" && was.as_deref() != Some("expired") {
            let name = self
                .store()
                .accounts()
                .ok()
                .and_then(|v| v.into_iter().find(|a| a.id == account_id))
                .map(|a| a.name);
            notify::alert(
                &self.app,
                &format!(
                    "{} cần đăng nhập lại",
                    name.as_deref().unwrap_or("Tài khoản")
                ),
                "ChatMin đã ngừng nhận tin của tài khoản này. Mở Settings → Đăng nhập lại.",
            );
        }
        self.emit(Event::Health {
            account_id: account_id.into(),
            health: health.into(),
            text: text.into(),
            until,
        });
    }

    /// Saves a freshly logged-in account. Logging in again to an existing account keeps
    /// its name and color; the same user under a different id is a duplicate.
    pub fn add_account(&self, mut a: Account) -> Result<(), String> {
        let existing = self.store().accounts()?;
        if let Some(dup) = existing
            .iter()
            .find(|x| x.id != a.id && x.platform == a.platform && x.self_id == a.self_id)
        {
            return Err(format!("Account này đã có trong ChatMin (“{}”)", dup.name));
        }
        if let Some(same) = existing.iter().find(|x| {
            x.id == a.id
                && x.platform == a.platform
                && (x.self_id == a.self_id || (a.platform == "zalo" && x.self_id == x.id))
        }) {
            a.name = same.name.clone();
            a.color = same.color.clone();
        } else if let Some(dup) = existing
            .iter()
            .find(|x| x.platform == a.platform && x.self_id == a.self_id)
        {
            if dup.id != a.id {
                return Err(format!("Account này đã có trong ChatMin (“{}”)", dup.name));
            }
            a.name = dup.name.clone();
            a.color = dup.color.clone();
        } else {
            a.name = default_name(&a, &existing);
            a.color = next_color(&existing, &a.color);
        }
        self.store().put_account(&a)?;
        self.emit_accounts();
        Ok(())
    }
    fn emit_accounts(&self) {
        let accounts = self.store().accounts();
        if let Ok(accounts) = accounts {
            self.emit(Event::Accounts { accounts });
        }
    }
    fn platform(&self, account_id: &str) -> &'static str {
        if account_id.starts_with("gc-") {
            "gchat"
        } else if account_id.starts_with("messenger-") {
            "messenger"
        } else if account_id.starts_with("zalo-") {
            "zalo"
        } else {
            "telegram"
        }
    }
    /// A web app's page title changed: its unread count goes onto its sidebar row.
    pub fn web_unread(&self, account_id: &str, n: i32) {
        let chat = self.store().chat(account_id, "web");
        if let Ok(Some(mut chat)) = chat {
            if chat.unread == n {
                return;
            }
            if n > chat.unread {
                chat.last_ts = now_ms();
                chat.preview = format!("{n} tin chưa đọc");
            } else if n == 0 {
                chat.preview = String::new();
            }
            let grew = n > chat.unread;
            chat.unread = n;
            if grew {
                self.notifier
                    .web(&self.app, &chat, &format!("{n} tin nhắn chưa đọc"));
            }
            self.put_chat(chat);
        }
    }
}

fn default_name(a: &Account, existing: &[Account]) -> String {
    let base = if a.platform == "gchat" {
        a.handle
            .split('@')
            .nth(1)
            .and_then(|d| d.split('.').next())
            .map(|d| {
                let mut c = d.chars();
                c.next()
                    .map(|f| f.to_uppercase().collect::<String>() + c.as_str())
                    .unwrap_or_default()
            })
    } else {
        None
    }
    .unwrap_or_else(|| match a.platform.as_str() {
        "gchat" => "Google Chat".into(),
        p => web::site(p).map(|s| s.0).unwrap_or("Telegram").into(),
    });
    let taken = |n: &str| existing.iter().any(|x| x.name == n);
    if !taken(&base) {
        return base;
    }
    (2..)
        .map(|i| format!("{base} {i}"))
        .find(|n| !taken(n))
        .unwrap()
}

fn next_color(existing: &[Account], preferred: &str) -> String {
    const COLORS: [&str; 8] = [
        "blue", "purple", "green", "orange", "pink", "amber", "red", "slate",
    ];
    if !existing.iter().any(|a| a.color == preferred) {
        return preferred.into();
    }
    COLORS
        .iter()
        .find(|c| !existing.iter().any(|a| a.color == **c))
        .unwrap_or(&"slate")
        .to_string()
}

type Res<T> = Result<T, String>;
type C<'a> = State<'a, Arc<Core>>;

// ── app state & config ──────────────────────────────────────────────────────
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AppState {
    accounts: Vec<Account>,
    health: HashMap<String, Health>,
    chats: Vec<Chat>,
    tg_configured: bool,
    gchat_configured: bool,
    muted_threads: Vec<String>,
}

#[tauri::command]
fn app_state(core: C) -> Res<AppState> {
    let c = core.config.lock().unwrap().clone();
    // one guard at a time: temporaries in a struct literal live to the end of the statement
    let accounts = core.store().accounts()?;
    let mut chats = core.store().chats()?;
    core.zalo.profiles.chats(&core.cache_dir, &mut chats);
    let health = core.health.lock().unwrap().clone();
    Ok(AppState {
        accounts,
        health,
        chats,
        tg_configured: c.tg_api_id != 0 && !c.tg_api_hash.is_empty(),
        gchat_configured: cfg!(target_os = "android") || !c.gchat_client_id.is_empty(),
        muted_threads: c.muted_threads,
    })
}

/// UI preferences live beside the account database, independently of WebView data.
#[tauri::command]
fn ui_state(core: C) -> Res<Option<Value>> {
    core.store().ui_state()
}
#[tauri::command]
fn ui_state_set(core: C, value: Value) -> Res<()> {
    core.store().set_ui_state(&value)
}

/// Mute/unmute one thread or topic: no banner, no bell entry, no "followed" status.
#[tauri::command]
fn thread_mute(
    core: C,
    account_id: String,
    chat_id: String,
    thread_id: String,
    muted: bool,
) -> Res<()> {
    let key = format!("{account_id}|{chat_id}|{thread_id}");
    let mut c = core.config.lock().unwrap();
    c.muted_threads.retain(|k| k != &key);
    if muted {
        c.muted_threads.push(key);
    }
    write_private(
        &core.data_dir.join("config.json"),
        &serde_json::to_string_pretty(&*c).unwrap(),
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
fn config_set(
    core: C,
    tg_api_id: Option<String>,
    tg_api_hash: Option<String>,
    gchat_json: Option<String>,
) -> Res<()> {
    let mut c = core.config.lock().unwrap();
    if let Some(id) = tg_api_id {
        c.tg_api_id = id.trim().parse().map_err(|_| "api_id phải là số")?;
    }
    if let Some(h) = tg_api_hash {
        c.tg_api_hash = h.trim().into();
    }
    if let Some(j) = gchat_json {
        // accept the JSON downloaded from Cloud Console, or a path to it
        let raw = if j.trim_start().starts_with('{') {
            j
        } else {
            std::fs::read_to_string(j.trim()).map_err(|e| e.to_string())?
        };
        let v: Value = serde_json::from_str(&raw).map_err(|_| "JSON OAuth client không hợp lệ")?;
        let inner = if v["installed"].is_object() {
            &v["installed"]
        } else {
            &v["web"]
        };
        c.gchat_client_id = inner["client_id"].as_str().ok_or("Thiếu client_id")?.into();
        c.gchat_client_secret = inner["client_secret"]
            .as_str()
            .ok_or("Thiếu client_secret — tạo secret mới trong Cloud Console")?
            .into();
    }
    write_private(
        &core.data_dir.join("config.json"),
        &serde_json::to_string_pretty(&*c).unwrap(),
    )
    .map_err(|e| e.to_string())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct StorageView {
    download_dir: String,
    cache_mb: u64,
    keep_days: u32,
    tg_bytes: i64,
    local_bytes: u64,
}
#[tauri::command]
async fn storage(core: C<'_>) -> Res<StorageView> {
    let core = core.inner().clone();
    let dirs = [
        core.cache_dir.join("gchat"),
        core.cache_dir.join("zalo"),
        core.cache_dir.join("outbox"),
    ];
    let local_bytes = tauri::async_runtime::spawn_blocking(move || {
        dirs.iter().map(|d| storage::dir_size(d)).sum()
    })
    .await
    .unwrap_or(0);
    let tg_bytes = core.tg.files_size().await;
    let (cache_mb, keep_days) = {
        let c = core.config.lock().unwrap();
        (c.cache_mb.unwrap_or(2048), c.keep_days.unwrap_or(30))
    };
    let dir = core.download_dir();
    let _ = std::fs::create_dir_all(&dir); // so "Mở" has something to open
    Ok(StorageView {
        download_dir: dir.to_string_lossy().into(),
        cache_mb,
        keep_days,
        tg_bytes,
        local_bytes,
    })
}
#[tauri::command]
fn storage_set(
    core: C,
    download_dir: Option<String>,
    cache_mb: Option<u64>,
    keep_days: Option<u32>,
) -> Res<()> {
    {
        let mut c = core.config.lock().unwrap();
        if let Some(d) = download_dir {
            c.download_dir = d;
        }
        c.cache_mb = cache_mb.or(c.cache_mb);
        c.keep_days = keep_days.or(c.keep_days);
        write_private(
            &core.data_dir.join("config.json"),
            &serde_json::to_string_pretty(&*c).unwrap(),
        )
        .map_err(|e| e.to_string())?;
    }
    let core = core.inner().clone();
    tauri::async_runtime::spawn(async move { core.clean_storage(false).await });
    Ok(())
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BrowserView {
    current: String,
    installed: Vec<String>,
}
/// The chosen browser plus the known ones found in /Applications.
#[tauri::command]
fn browser(core: C) -> BrowserView {
    let installed = [
        "Microsoft Edge",
        "Google Chrome",
        "Safari",
        "Firefox",
        "Brave Browser",
        "Arc",
    ]
    .into_iter()
    .filter(|n| std::path::Path::new(&format!("/Applications/{n}.app")).exists())
    .map(String::from)
    .collect();
    BrowserView {
        current: core.config.lock().unwrap().browser.clone(),
        installed,
    }
}
#[tauri::command]
fn browser_set(core: C, name: String) -> Res<()> {
    let mut c = core.config.lock().unwrap();
    c.browser = name;
    write_private(
        &core.data_dir.join("config.json"),
        &serde_json::to_string_pretty(&*c).unwrap(),
    )
    .map_err(|e| e.to_string())
}
#[tauri::command]
fn open_url(core: C, url: String) {
    core.open_url(&url);
}
/// Trim now (`all`: empty the media cache). Returns bytes freed.
#[tauri::command]
async fn storage_clean(core: C<'_>, all: bool) -> Res<u64> {
    Ok(core.inner().clone().clean_storage(all).await)
}
#[tauri::command]
fn ai_config(core: C) -> ai::AiView {
    core.config.lock().unwrap().ai.view()
}
/// `key: None` keeps the stored key; `Some("")` clears it.
#[tauri::command]
fn ai_config_set(
    core: C,
    format: String,
    endpoint: String,
    model: String,
    guide: String,
    key: Option<String>,
) -> Res<()> {
    let mut c = core.config.lock().unwrap();
    let a = &mut c.ai;
    a.format = format;
    a.endpoint = endpoint.trim().into();
    a.model = model.trim().into();
    a.guide = guide;
    if let Some(k) = key {
        a.key = k.trim().into();
    }
    write_private(
        &core.data_dir.join("config.json"),
        &serde_json::to_string_pretty(&*c).unwrap(),
    )
    .map_err(|e| e.to_string())
}
#[tauri::command]
async fn ai_run(
    core: C<'_>,
    task: String,
    texts: Vec<String>,
    me: String,
    to: String,
) -> Res<Value> {
    let cfg = core.config.lock().unwrap().ai.clone();
    ai::run(&cfg, &task, &texts, &me, &to).await
}

fn write_private(path: &std::path::Path, data: &str) -> std::io::Result<()> {
    use std::os::unix::fs::OpenOptionsExt;
    let mut f = std::fs::OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(true)
        .mode(0o600)
        .open(path)?;
    std::io::Write::write_all(&mut f, data.as_bytes())
}

// ── accounts ────────────────────────────────────────────────────────────────
#[tauri::command]
async fn zalo_login_start(core: C<'_>, account_id: Option<String>) -> Res<String> {
    let id = account_id.unwrap_or_else(|| format!("zalo-{}", now_ms()));
    if !id.starts_with("zalo-") {
        return Err("ID Zalo không hợp lệ".into());
    }
    web::close(&core, &id);
    core.set_health(&id, "reconnecting", "Đang chờ đăng nhập Zalo", 0);
    core.emit(Event::Auth {
        account_id: id.clone(),
        step: "qr".into(),
        info: String::new(),
        error: String::new(),
    });
    zalo::Zalo::start(core.inner(), &id, true)?;
    Ok(id)
}
#[tauri::command]
async fn zalo_contacts(core: C<'_>, account_id: String) -> Res<Value> {
    core.zalo
        .request(&account_id, "contacts", serde_json::json!({}))
        .await
}
#[tauri::command]
async fn zalo_open_chat(core: C<'_>, account_id: String, chat_id: String) -> Res<Chat> {
    let value = core
        .zalo
        .request(&account_id, "chat", serde_json::json!({"chatId":chat_id}))
        .await?;
    let chat: Chat = serde_json::from_value(value).map_err(|e| e.to_string())?;
    core.put_chat(chat.clone());
    Ok(chat)
}
#[tauri::command]
fn tg_login_start(core: C, account_id: Option<String>) -> Res<String> {
    let core = core.inner();
    let (id, _) = core.tg_api();
    if id == 0 {
        return Err("Chưa cấu hình Telegram api_id/api_hash".into());
    }
    match account_id {
        // re-login: the expired account's client is open and waiting for a phone number
        Some(id) => {
            core.tg.set_pending(&id);
            Ok(id)
        }
        None => {
            let id = format!("tg-{}", now_ms());
            core.tg.open(core, &id, true);
            Ok(id)
        }
    }
}
#[tauri::command]
async fn tg_phone(core: C<'_>, account_id: String, phone: String) -> Res<()> {
    core.tg.submit_phone(&account_id, phone).await
}
#[tauri::command]
async fn tg_code(core: C<'_>, account_id: String, code: String) -> Res<()> {
    core.tg.submit_code(&account_id, code).await
}
#[tauri::command]
async fn tg_password(core: C<'_>, account_id: String, password: String) -> Res<()> {
    core.tg.submit_password(&account_id, password).await
}
#[tauri::command]
async fn tg_qr(core: C<'_>, account_id: String) -> Res<()> {
    core.tg.request_qr(&account_id).await
}
#[tauri::command]
async fn tg_resend(core: C<'_>, account_id: String) -> Res<()> {
    core.tg.resend_code(&account_id).await
}
#[tauri::command]
async fn gchat_login(core: C<'_>) -> Res<Account> {
    let core = core.inner().clone();
    let account = core.gchat.login(&core).await?;
    GChat::start(core.clone(), account.clone(), true);
    Ok(account)
}
/// Wizard cancelled before the account was saved.
#[tauri::command]
async fn login_cancel(core: C<'_>, account_id: Option<String>) -> Res<()> {
    core.gchat.cancel_login();
    if let Some(id) = account_id {
        if id.starts_with("zalo-") {
            if core.zalo.cancel_login(&id) {
                let saved = core.store().accounts()?.iter().any(|a| a.id == id);
                if saved {
                    zalo::Zalo::start(core.inner(), &id, false)?;
                } else {
                    let _ = std::fs::remove_dir_all(core.data_dir.join("zalo").join(&id));
                }
            }
            return Ok(());
        }
        let saved = core.store().accounts()?.iter().any(|a| a.id == id);
        if !saved {
            core.tg.close(&id, false).await;
            let _ = std::fs::remove_dir_all(core.data_dir.join("tg").join(&id));
        }
    }
    Ok(())
}
#[tauri::command]
fn account_update(core: C, id: String, name: Option<String>, color: Option<String>) -> Res<()> {
    let mut a = core
        .store()
        .accounts()?
        .into_iter()
        .find(|a| a.id == id)
        .ok_or("Không thấy account")?;
    if let Some(n) = name {
        a.name = n;
    }
    if let Some(c) = color {
        a.color = c;
    }
    core.store().put_account(&a)?;
    core.emit_accounts();
    Ok(())
}
#[tauri::command]
async fn account_remove(core: C<'_>, id: String) -> Res<()> {
    match core.platform(&id) {
        "telegram" => {
            core.tg.close(&id, true).await;
            let _ = std::fs::remove_dir_all(core.data_dir.join("tg").join(&id));
        }
        "zalo" => {
            core.zalo.stop(&id);
            core.zalo.profiles.remove(&id);
            web::close(&core, &id);
            let _ = std::fs::remove_dir_all(core.data_dir.join("zalo").join(&id));
        }
        "gchat" => core.gchat.stop(&core, &id),
        _ => web::close(&core, &id),
    }
    core.store().remove_account(&id)?;
    core.health.lock().unwrap().remove(&id);
    core.emit_accounts();
    Ok(())
}

// ── chats & messages ────────────────────────────────────────────────────────
#[tauri::command]
async fn messages(
    core: C<'_>,
    account_id: String,
    chat_id: String,
    before: i64,
    limit: i32,
) -> Res<Vec<Msg>> {
    let core = core.inner().clone();
    let live = if core.platform(&account_id) == "zalo" {
        core.zalo
            .history(&core, &account_id, &chat_id, before, limit)
            .await
    } else if core.platform(&account_id) == "telegram" {
        core.tg
            .history(&core, &account_id, &chat_id, before, limit)
            .await
    } else {
        core.gchat
            .history(&core, &account_id, &chat_id, before, limit)
            .await
    };
    // offline: fall back to whatever the cache has
    live.or_else(|e| {
        let cached = core
            .store()
            .msgs(&account_id, &chat_id, before, limit as i64)?;
        if cached.is_empty() {
            Err(e)
        } else {
            Ok(cached)
        }
    })
}
/// Main timeline pagination has no relationship to any opened thread's cursor.
#[tauri::command]
async fn primary_messages(
    core: C<'_>,
    account_id: String,
    chat_id: String,
    before: i64,
    limit: i32,
) -> Res<gchat::PrimaryPage> {
    let core = core.inner().clone();
    let mut cached = core
        .store()
        .primary_msgs(&account_id, &chat_id, before, limit as i64)?;
    if !cached.is_empty() {
        gchat::hydrate_cached_media(&core.cache_dir, &mut cached);
        return Ok(gchat::PrimaryPage {
            before: cached[0].sort,
            messages: cached,
            has_more: true,
        });
    }
    core.gchat
        .primary_history(
            &core,
            &account_id,
            &chat_id,
            before,
            limit.clamp(1, 100) as usize,
        )
        .await
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct ThreadListPage {
    threads: Vec<store::ThreadSummary>,
    has_more: bool,
}

/// A threaded space's thread list, its own flow: cached threads by latest reply, never
/// derived from the timeline's page (whose newest 100 rows can all be one busy thread).
/// When the cache runs short and `remote` allows, three older pages are walked first.
#[tauri::command]
async fn thread_list(
    core: C<'_>,
    account_id: String,
    chat_id: String,
    before: i64,
    limit: i64,
    remote: bool,
) -> Res<ThreadListPage> {
    let core = core.inner().clone();
    let read = |core: Arc<Core>, account_id: String, chat_id: String| async move {
        tauri::async_runtime::spawn_blocking(move || {
            core.store()
                .thread_summaries(&account_id, &chat_id, before, limit)
        })
        .await
        .map_err(|e| e.to_string())?
    };
    let started = std::time::Instant::now();
    let mut threads = read(core.clone(), account_id.clone(), chat_id.clone()).await?;
    let full = threads.len() as i64 >= limit;
    let mut has_more = full || core.platform(&account_id) == "gchat";
    if !full && remote && core.platform(&account_id) == "gchat" {
        let oldest = core
            .store()
            .oldest_sort(&account_id, &chat_id)?
            .unwrap_or(0);
        has_more = match core
            .gchat
            .scan_older(&core, &account_id, &chat_id, oldest, 3)
            .await
        {
            Ok(more) => more,
            Err(e) => {
                eprintln!("[threads] older scan failed chat={chat_id}: {e}");
                false
            }
        };
        threads = read(core.clone(), account_id.clone(), chat_id.clone()).await?;
        has_more |= threads.len() as i64 >= limit;
    }
    eprintln!(
        "[threads] list chat={chat_id} threads={} remote={remote} elapsedMs={}",
        threads.len(),
        started.elapsed().as_millis()
    );
    Ok(ThreadListPage { threads, has_more })
}

/// Reply total of one thread, asked of Google only for threads on screen.
#[tauri::command]
async fn thread_count(
    core: C<'_>,
    account_id: String,
    chat_id: String,
    thread_id: String,
) -> Res<gchat::ThreadCount> {
    let core = core.inner().clone();
    core.gchat
        .thread_count(&core, &account_id, &chat_id, &thread_id)
        .await
}

/// macOS's own emoji picker (full set, search, recents); it types into the focused field.
#[tauri::command]
fn emoji_palette(app: tauri::AppHandle) {
    #[cfg(target_os = "macos")]
    let _ = app.run_on_main_thread(|| {
        if let Some(mtm) = objc2::MainThreadMarker::new() {
            objc2_app_kit::NSApplication::sharedApplication(mtm).orderFrontCharacterPalette(None);
        }
    });
}
/// Webview errors (no console in release builds) land in the app's stderr log.
#[tauri::command]
fn log_js(core: C, msg: String) {
    core.log_line("js.log", &msg);
}
impl Core {
    /// Release builds have no console: keep the last ~1 MB of `file` in the cache dir.
    pub fn log_line(&self, file: &str, msg: &str) {
        eprintln!("[{file}] {msg}");
        let path = self.cache_dir.join(file);
        if std::fs::metadata(&path)
            .map(|m| m.len() > 1 << 20)
            .unwrap_or(false)
        {
            let _ = std::fs::remove_file(&path);
        }
        if let Ok(mut f) = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&path)
        {
            let _ = std::io::Write::write_all(
                &mut f,
                format!("{} {msg}\n", chrono::Local::now().format("%m-%d %H:%M:%S")).as_bytes(),
            );
        }
    }
}
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct Staged {
    path: String,
    name: String,
    size: u64,
}
/// Files about to be sent (dropped, pasted, picked): their size for the chip, folders
/// dropped (can't be sent), and the asset protocol opened so images can preview.
#[tauri::command]
async fn stage_files(app: tauri::AppHandle, paths: Vec<String>) -> Result<Vec<Staged>, String> {
    // The picker gives Android URI grants, not filesystem paths. Native streaming runs on
    // a worker before metadata/asset access so media is never silently discarded.
    #[cfg(target_os = "android")]
    let paths = if paths.iter().any(|path| path.starts_with("content://")) {
        app.state::<files_android::AndroidFiles>()
            .import(paths)
            .await?
    } else {
        paths
    };
    tauri::async_runtime::spawn_blocking(move || {
        paths
            .into_iter()
            .filter_map(|path| {
                let md = std::fs::metadata(&path).ok().filter(|m| m.is_file())?;
                let _ = app.asset_protocol_scope().allow_file(&path);
                let name = std::path::Path::new(&path)
                    .file_name()?
                    .to_string_lossy()
                    .into();
                Some(Staged {
                    name,
                    size: md.len(),
                    path,
                })
            })
            .collect()
    })
    .await
    .map_err(|error| error.to_string())
}
/// Files copied in Finder: the webview's paste event only sees their names, the paths
/// live on the native pasteboard (as file reference URLs, resolved here).
#[tauri::command]
fn clipboard_files() -> Vec<String> {
    #[cfg(target_os = "macos")]
    {
        use objc2_app_kit::{NSPasteboard, NSPasteboardTypeFileURL};
        use objc2_foundation::NSURL;
        let Some(items) = NSPasteboard::generalPasteboard().pasteboardItems() else {
            return vec![];
        };
        items
            .iter()
            .filter_map(|i| {
                let s = i.stringForType(unsafe { NSPasteboardTypeFileURL })?;
                Some(NSURL::URLWithString(&s)?.filePathURL()?.path()?.to_string())
            })
            .collect()
    }
    #[cfg(not(target_os = "macos"))]
    vec![]
}
/// Clicking a notification (or ⌘Tab / the Dock) activates the app, but the window may be
/// hidden after a close: bring it back whenever the app becomes active, like Slack does.
#[cfg(target_os = "macos")]
fn show_on_activate(app: tauri::AppHandle) {
    use objc2_foundation::{NSNotification, NSNotificationCenter};
    let block = block2::RcBlock::new(move |_: std::ptr::NonNull<NSNotification>| {
        if let Some(w) = app.get_window("main") {
            if !w.is_visible().unwrap_or(true) {
                let _ = w.show();
                let _ = w.set_focus();
            }
        }
    });
    // the observer lives as long as the app: keep it registered by never dropping it
    let observer = unsafe {
        NSNotificationCenter::defaultCenter().addObserverForName_object_queue_usingBlock(
            Some(objc2_app_kit::NSApplicationDidBecomeActiveNotification),
            None,
            None,
            &block,
        )
    };
    std::mem::forget(observer);
}

/// The newest cached page, instantly: shown while `messages` fetches the live one. Second:
/// cached starters of the page's threads that begin before it, so the threaded timeline
/// paints with its final rows instead of reshuffling when the starters arrive.
/// Telegram users online now ("account|user"); changes follow as `presence` events.
#[tauri::command]
fn presence(core: C<'_>) -> Vec<String> {
    core.tg.online()
}
/// Mentions + DMs for the notification inbox (titlebar bell).
#[tauri::command]
fn inbox(core: C<'_>, limit: i64) -> Res<Vec<Msg>> {
    let mut v = core.store().inbox(limit)?;
    v.retain(|m| !core.thread_muted(m));
    Ok(v)
}
#[tauri::command]
async fn cached_messages(
    core: C<'_>,
    account_id: String,
    chat_id: String,
    limit: i64,
    primary: Option<bool>,
) -> Res<(Vec<Msg>, Vec<Msg>)> {
    let core = core.inner().clone();
    tauri::async_runtime::spawn_blocking(move || -> Res<(Vec<Msg>, Vec<Msg>)> {
        let started = std::time::Instant::now();
        let (mut page, mut roots) =
            core.store()
                .cached_msgs(&account_id, &chat_id, limit, primary.unwrap_or(false))?;
        gchat::hydrate_cached_media(&core.cache_dir, &mut page);
        zalo::hydrate(&core.cache_dir, &mut page);
        core.zalo.profiles.messages(&core.cache_dir, &mut page);
        gchat::hydrate_cached_media(&core.cache_dir, &mut roots);
        eprintln!(
            "[history] cached chat={chat_id} messages={} roots={} elapsedMs={}",
            page.len(),
            roots.len(),
            started.elapsed().as_millis()
        );
        Ok((stale_refs(page), stale_refs(roots)))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// TDLib file ids only live for one session: a cached message rendered with last run's ids
/// downloads whatever file carries that id now (someone's avatar in a photo's slot). Keep the
/// inline blur and local paths; the fresh ids arrive with the reload that follows.
fn stale_refs(mut msgs: Vec<Msg>) -> Vec<Msg> {
    let drop = |s: &mut String| {
        if !s.is_empty() && s.bytes().all(|b| b.is_ascii_digit()) {
            s.clear()
        }
    };
    for m in &mut msgs {
        drop(&mut m.sender_photo);
        if let Some(media) = &mut m.media {
            drop(&mut media.file_ref);
            drop(&mut media.thumb_file);
        }
    }
    msgs
}
#[tauri::command]
async fn thread(
    core: C<'_>,
    account_id: String,
    chat_id: String,
    thread_id: String,
    page_token: Option<String>,
    limit: Option<i32>,
) -> Res<gchat::ThreadPage> {
    let core = core.inner().clone();
    let token = page_token.unwrap_or_default();
    let limit = limit.unwrap_or(20).clamp(1, 20);
    core.gchat
        .thread(&core, &account_id, &chat_id, &thread_id, &token, limit)
        .await
        .or_else(|e| {
            // A continuation token belongs to the live query; never replay the cached tail as an older page.
            if !token.is_empty() {
                return Err(e);
            }
            let cached =
                core.store()
                    .thread_page(&account_id, &chat_id, &thread_id, limit as i64, false)?;
            if cached.is_empty() {
                Err(e)
            } else {
                Ok(gchat::ThreadPage {
                    messages: cached,
                    next_page_token: String::new(),
                })
            }
        })
}
#[tauri::command]
async fn thread_root(
    core: C<'_>,
    account_id: String,
    chat_id: String,
    thread_id: String,
) -> Res<Vec<Msg>> {
    let core = core.inner().clone();
    core.gchat
        .thread_root(&core, &account_id, &chat_id, &thread_id)
        .await
        .or_else(|e| {
            let cached = core
                .store()
                .thread_page(&account_id, &chat_id, &thread_id, 1, true)?;
            if cached.is_empty() {
                Err(e)
            } else {
                Ok(cached)
            }
        })
}
#[tauri::command]
async fn pinned(core: C<'_>, account_id: String, chat_id: String) -> Res<Vec<Msg>> {
    if core.platform(&account_id) == "telegram" {
        core.tg.pinned(&core, &account_id, &chat_id).await
    } else {
        Ok(vec![])
    }
}
#[tauri::command]
async fn members(core: C<'_>, account_id: String, chat_id: String) -> Res<Vec<Member>> {
    let core = core.inner().clone();
    if core.platform(&account_id) == "telegram" {
        core.tg.members(&account_id, &chat_id).await
    } else if core.platform(&account_id) == "zalo" {
        let v = core
            .zalo
            .request(
                &account_id,
                "members",
                serde_json::json!({"chatId":chat_id}),
            )
            .await?;
        serde_json::from_value(v).map_err(|e| e.to_string())
    } else {
        core.gchat.members(&core, &account_id, &chat_id).await
    }
}
#[tauri::command]
#[allow(clippy::too_many_arguments)]
async fn send(
    core: C<'_>,
    account_id: String,
    chat_id: String,
    text: String,
    reply_to: Option<String>,
    thread_id: Option<String>,
    file: Option<String>,
    voice: Option<i32>,
    // composer "plain text" toggle: *abc* stays *abc*, no bold/italic/code
    plain: Option<bool>,
    // Telegram: photos/videos as an uncompressed document instead of a photo/video message
    as_file: Option<bool>,
) -> Res<Msg> {
    let core = core.inner().clone();
    let plain = plain.unwrap_or(false);
    if core.platform(&account_id) == "zalo" {
        if voice.is_some() {
            return Err("Gửi ghi âm Zalo chưa hỗ trợ".into());
        }
        core.zalo
            .send(&core, &account_id, &chat_id, text, reply_to, file)
            .await
    } else if core.platform(&account_id) == "telegram" {
        core.tg
            .send(
                &core,
                &account_id,
                &chat_id,
                text,
                reply_to,
                thread_id,
                file,
                voice,
                plain,
                as_file.unwrap_or(false),
            )
            .await
    } else {
        // Google Chat formats on its side: break the markers with zero-width spaces
        let text = if plain { tg::soft_markup(&text) } else { text };
        core.gchat
            .send(
                &core,
                &account_id,
                &chat_id,
                text,
                reply_to,
                thread_id,
                file,
            )
            .await
    }
}
#[tauri::command]
async fn edit(
    core: C<'_>,
    account_id: String,
    chat_id: String,
    msg_id: String,
    text: String,
    plain: Option<bool>,
) -> Res<()> {
    let core = core.inner().clone();
    let plain = plain.unwrap_or(false);
    if core.platform(&account_id) == "telegram" {
        core.tg
            .edit(&account_id, &chat_id, &msg_id, text, plain)
            .await
    } else if core.platform(&account_id) == "zalo" {
        Err("Zalo chưa hỗ trợ sửa tin".into())
    } else {
        let text = if plain { tg::soft_markup(&text) } else { text };
        core.gchat
            .edit(&core, &account_id, &chat_id, &msg_id, text)
            .await
    }
}
#[tauri::command]
async fn delete_msg(core: C<'_>, account_id: String, chat_id: String, msg_id: String) -> Res<()> {
    let core = core.inner().clone();
    if core.platform(&account_id) == "telegram" {
        core.tg.delete(&account_id, &chat_id, &msg_id).await
    } else if core.platform(&account_id) == "zalo" {
        let source = zalo::source(&core, &account_id, &chat_id, &msg_id)?;
        core.zalo
            .request(
                &account_id,
                "recall",
                serde_json::json!({"chatId":chat_id,"source":source}),
            )
            .await?;
        Ok(())
    } else {
        core.gchat
            .delete(&core, &account_id, &chat_id, &msg_id)
            .await
    }
}
/// Who reacted / read one message, for reaction tooltips and the "seen by" list.
#[tauri::command]
async fn msg_people(
    core: C<'_>,
    account_id: String,
    chat_id: String,
    msg_id: String,
) -> Res<model::MsgPeople> {
    let core = core.inner().clone();
    if core.platform(&account_id) == "telegram" {
        core.tg.people(&account_id, &chat_id, &msg_id).await
    } else if core.platform(&account_id) == "zalo" {
        Ok(model::MsgPeople::default())
    } else {
        core.gchat
            .people(&core, &account_id, &chat_id, &msg_id)
            .await
    }
}
/// Telegram: the emoji this message accepts. None = any emoji (Google Chat).
#[tauri::command]
async fn reactions(
    core: C<'_>,
    account_id: String,
    chat_id: String,
    msg_id: String,
) -> Res<Option<Vec<String>>> {
    if core.platform(&account_id) == "telegram" {
        core.tg
            .reactions(&account_id, &chat_id, &msg_id)
            .await
            .map(Some)
    } else if core.platform(&account_id) == "zalo" {
        Ok(Some(
            ["❤️", "👍", "😂", "😮", "😢", "😡"]
                .into_iter()
                .map(String::from)
                .collect(),
        ))
    } else {
        Ok(None)
    }
}
#[tauri::command]
async fn react(
    core: C<'_>,
    account_id: String,
    chat_id: String,
    msg_id: String,
    emoji: String,
    add: bool,
) -> Res<()> {
    let core = core.inner().clone();
    if core.platform(&account_id) == "telegram" {
        core.tg
            .react(&account_id, &chat_id, &msg_id, emoji, add)
            .await
    } else if core.platform(&account_id) == "zalo" {
        let source = zalo::source(&core, &account_id, &chat_id, &msg_id)?;
        core.zalo
            .request(
                &account_id,
                "react",
                serde_json::json!({"chatId":chat_id,"source":source,"emoji":emoji,"add":add}),
            )
            .await?;
        Ok(())
    } else {
        core.gchat
            .react(&core, &account_id, &msg_id, &emoji, add)
            .await?;
        // gchat has no reaction push; re-read the message so counts update right away
        if let Ok(v) = core
            .gchat
            .history(&core, &account_id, &chat_id, 0, 20)
            .await
        {
            for mut m in v.into_iter().filter(|m| m.id == msg_id) {
                // gchat summaries don't say whose reaction it is: don't let mine look like someone else's
                if let Some(r) = m.reactions.iter_mut().find(|r| r.emoji == emoji) {
                    r.mine = add;
                }
                core.put_msg(m, false);
            }
        }
        Ok(())
    }
}
#[tauri::command]
async fn pin(
    core: C<'_>,
    account_id: String,
    chat_id: String,
    msg_id: String,
    on: bool,
) -> Res<()> {
    core.tg.pin(&account_id, &chat_id, &msg_id, on).await
}
#[tauri::command]
async fn mark_read(
    core: C<'_>,
    account_id: String,
    chat_id: String,
    msg_ids: Vec<String>,
) -> Res<()> {
    let core = core.inner().clone();
    if core.platform(&account_id) == "telegram" {
        core.tg.mark_read(&account_id, &chat_id, msg_ids).await
    } else if core.platform(&account_id) == "zalo" {
        let sources: Vec<Value> = msg_ids
            .iter()
            .filter_map(|m| zalo::source(&core, &account_id, &chat_id, m).ok())
            .collect();
        core.zalo
            .request(
                &account_id,
                "read",
                serde_json::json!({"chatId":chat_id,"sources":sources}),
            )
            .await?;
        let chat = core.store().chat(&account_id, &chat_id)?;
        if let Some(mut chat) = chat {
            chat.unread = 0;
            chat.mention = false;
            core.put_chat(chat);
        }
        Ok(())
    } else {
        core.gchat.mark_read(&core, &account_id, &chat_id).await
    }
}
#[tauri::command]
async fn set_open(core: C<'_>, account_id: String, chat_id: String, open: bool) -> Res<()> {
    core.notifier.set_open(&account_id, &chat_id, open);
    if open && matches!(core.platform(&account_id), "telegram" | "gchat" | "zalo") {
        web::hide_all(&core);
    }
    if core.platform(&account_id) == "telegram" {
        core.tg.set_open(&account_id, &chat_id, open).await
    } else {
        if core.platform(&account_id) == "gchat" {
            core.gchat.focus(&account_id, open.then_some(chat_id));
        }
        Ok(())
    }
}
#[tauri::command]
async fn set_muted(core: C<'_>, account_id: String, chat_id: String, muted: bool) -> Res<()> {
    if core.platform(&account_id) == "telegram" {
        core.tg.set_muted(&account_id, &chat_id, muted).await
    } else {
        let chat = core.store().set_chat_muted(&account_id, &chat_id, muted)?;
        core.notifier.track(&core.app, &chat, false);
        core.emit(Event::Chat { chat });
        Ok(())
    }
}
#[tauri::command]
fn web_add(core: C, platform: String) -> Res<Account> {
    if platform == "zalo" {
        return Err("Zalo dùng đăng nhập QR trong ChatMin".into());
    }
    let account = web::add(&core, &platform)?;
    let (c, a) = (core.inner().clone(), account.clone());
    core.app
        .run_on_main_thread(move || web::start_background(&c, &a))
        .map_err(|e| e.to_string())?;
    Ok(account)
}
#[tauri::command]
fn web_show(
    core: C,
    account_id: String,
    chat_id: String,
    x: f64,
    y: f64,
    w: f64,
    h: f64,
    navigate: Option<bool>,
) -> Res<()> {
    let a = core
        .store()
        .accounts()?
        .into_iter()
        .find(|a| a.id == account_id)
        .ok_or("Không thấy account")?;
    if a.platform == "zalo" {
        return Err("Zalo không dùng WebView".into());
    }
    web::show(
        core.inner(),
        &a,
        &chat_id,
        x,
        y,
        w,
        h,
        navigate.unwrap_or(false),
    )
}
#[tauri::command]
fn web_hide(core: C, account_id: String) {
    web::hide(&core, &account_id);
}
#[tauri::command]
fn web_reload(core: C, account_id: String) {
    web::reload(&core, &account_id);
}
#[tauri::command]
fn web_devtools(core: C, account_id: String) {
    web::devtools(&core, &account_id);
}
#[tauri::command]
async fn stickers(core: C<'_>, account_id: String) -> Res<Value> {
    if core.platform(&account_id) == "zalo" {
        core.zalo
            .request(&account_id, "stickers", serde_json::json!({}))
            .await
    } else {
        serde_json::to_value(core.tg.stickers(&account_id).await?).map_err(|e| e.to_string())
    }
}
#[tauri::command]
#[allow(clippy::too_many_arguments)]
async fn send_sticker(
    core: C<'_>,
    account_id: String,
    chat_id: String,
    thread_id: Option<String>,
    file_id: i32,
    width: i32,
    height: i32,
    emoji: String,
) -> Res<Msg> {
    let core = core.inner().clone();
    if core.platform(&account_id) == "zalo" {
        return core
            .zalo
            .send_sticker(&core, &account_id, &chat_id, file_id)
            .await;
    }
    core.tg
        .send_sticker(
            &core,
            &account_id,
            &chat_id,
            thread_id,
            file_id,
            width,
            height,
            emoji,
        )
        .await
}
/// A recording from the webview → a file in the cache that `send` can upload.
#[tauri::command]
fn save_temp(core: C, name: String, data: String) -> Res<String> {
    use base64::Engine;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(data)
        .map_err(|e| e.to_string())?;
    let dir = core.cache_dir.join("outbox");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = unique_path(&dir, &save_name(&name, std::path::Path::new("")));
    std::fs::write(&path, bytes).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().into())
}
#[tauri::command]
async fn topics(core: C<'_>, account_id: String, chat_id: String) -> Res<Vec<Topic>> {
    core.tg.topics(&account_id, &chat_id).await
}
#[tauri::command]
async fn topic_history(
    core: C<'_>,
    account_id: String,
    chat_id: String,
    topic: String,
    before: i64,
    limit: i32,
) -> Res<Vec<Msg>> {
    let core = core.inner().clone();
    core.tg
        .topic_history(&core, &account_id, &chat_id, &topic, before, limit)
        .await
}
#[tauri::command]
async fn forward(
    core: C<'_>,
    account_id: String,
    chat_id: String,
    from_chat_id: String,
    msg_id: String,
    topic: Option<String>,
) -> Res<()> {
    if core.platform(&account_id) != "telegram" {
        return Err("Chỉ Telegram có chuyển tiếp gốc".into());
    }
    core.tg
        .forward(&account_id, &chat_id, &from_chat_id, &msg_id, topic)
        .await
}
#[tauri::command]
async fn delete_chat(core: C<'_>, account_id: String, chat_id: String, revoke: bool) -> Res<()> {
    let core = core.inner().clone();
    if core.platform(&account_id) != "telegram" {
        return Err("Google Chat không cho xoá cuộc trò chuyện qua API".into());
    }
    core.tg
        .delete_chat(&core, &account_id, &chat_id, revoke)
        .await
}
/// Copies a downloaded file out of ChatMin's folders: to `dest` (from a save dialog) or,
/// when empty, into ~/Downloads without overwriting anything. Returns where it landed.
/// Open a file with its app, or reveal it in Finder: files the app downloaded, and files one
/// of my messages was sent from (their local copy stays at the original path, outside the
/// opener plugin's scope). Nothing else: the webview must not open arbitrary paths.
#[tauri::command]
fn open_local(core: C, path: String, reveal: bool) -> Res<()> {
    let real = std::fs::canonicalize(&path).map_err(|e| e.to_string())?;
    let inside = |d: &PathBuf| {
        std::fs::canonicalize(d)
            .map(|d| real.starts_with(d))
            .unwrap_or(false)
    };
    let known =
        inside(&core.data_dir) || inside(&core.cache_dir) || core.store().knows_local_path(&path);
    if !known {
        return Err("File không thuộc ChatMin".into());
    }
    if reveal {
        tauri_plugin_opener::reveal_item_in_dir(&real).map_err(|e| e.to_string())
    } else {
        tauri_plugin_opener::open_path(&real, None::<&str>).map_err(|e| e.to_string())
    }
}
#[tauri::command]
fn save_file(core: C, src: String, name: String, dest: Option<String>) -> Res<String> {
    let src = std::fs::canonicalize(&src).map_err(|e| e.to_string())?;
    // only files the app itself downloaded: the webview must not copy arbitrary paths
    let inside = |d: &PathBuf| {
        std::fs::canonicalize(d)
            .map(|d| src.starts_with(d))
            .unwrap_or(false)
    };
    if !inside(&core.data_dir) && !inside(&core.cache_dir) {
        return Err("File nằm ngoài thư mục của ChatMin".into());
    }
    let dest = match dest.filter(|d| !d.is_empty()) {
        Some(d) => PathBuf::from(d),
        None => {
            let dir = core.download_dir();
            std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
            unique_path(&dir, &save_name(&name, &src))
        }
    };
    std::fs::copy(&src, &dest).map_err(|e| e.to_string())?;
    Ok(dest.to_string_lossy().into())
}

/// Display name → a safe file name, borrowing the source's extension when it has none
/// ("GIF", "Video tròn").
fn save_name(name: &str, src: &std::path::Path) -> String {
    let base = std::path::Path::new(name)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("file")
        .replace(['/', ':'], "-");
    match (
        std::path::Path::new(&base).extension(),
        src.extension().and_then(|e| e.to_str()),
    ) {
        (None, Some(ext)) => format!("{base}.{ext}"),
        _ => base,
    }
}

fn unique_path(dir: &std::path::Path, name: &str) -> PathBuf {
    let p = std::path::Path::new(name);
    let stem = p.file_stem().and_then(|s| s.to_str()).unwrap_or("file");
    let ext = p
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| format!(".{e}"))
        .unwrap_or_default();
    std::iter::once(dir.join(name))
        .chain((1..).map(|i| dir.join(format!("{stem} ({i}){ext}"))))
        .find(|c| !c.exists())
        .unwrap()
}

#[tauri::command]
async fn download(
    app: tauri::AppHandle,
    core: C<'_>,
    account_id: String,
    file_ref: String,
    name: String,
    refresh: Option<bool>,
) -> Res<String> {
    let core = core.inner().clone();
    let path = if core.platform(&account_id) == "telegram" {
        core.tg.download(&account_id, &file_ref).await?
    } else if core.platform(&account_id) == "zalo" {
        zalo::download(
            &core,
            &account_id,
            &file_ref,
            &name,
            refresh.unwrap_or(false),
        )
        .await?
    } else {
        core.gchat
            .download(&core, &account_id, &file_ref, &name)
            .await?
    };
    // a file I sent stays at its original path (Desktop, Downloads…), outside the asset scope
    let _ = app.asset_protocol_scope().allow_file(&path);
    Ok(path)
}
#[tauri::command]
async fn search(
    core: C<'_>,
    query: String,
    account_id: Option<String>,
    chat_id: Option<String>,
    limit: i64,
) -> Res<Vec<Msg>> {
    let core = core.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let scope = account_id
            .as_deref()
            .map(|a| (a, chat_id.as_deref().unwrap_or("")));
        core.store().search(&query, scope, limit.clamp(1, 200))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
fn notify_test(app: tauri::AppHandle) {
    notify::test(&app);
}

#[tauri::command]
fn notify_island(core: C<'_>, enabled: Option<bool>) -> Res<bool> {
    let mut config = core.config.lock().unwrap();
    if let Some(enabled) = enabled {
        let mut next = config.clone();
        next.notification_island = Some(enabled);
        write_private(
            &core.data_dir.join("config.json"),
            &serde_json::to_string_pretty(&next).unwrap(),
        )
        .map_err(|e| e.to_string())?;
        *config = next;
        core.notifier.set_island(&core.app, enabled);
    }
    Ok(config.notification_island.unwrap_or(true))
}

#[tauri::command]
fn notify_appearance(core: C<'_>, appearance: island_style::Appearance) -> Res<()> {
    if !appearance.valid() {
        return Err("Màu thông báo không hợp lệ".into());
    }
    let mut config = core.config.lock().unwrap();
    if config.notification_appearance == Some(appearance) {
        return Ok(());
    }
    let mut next = config.clone();
    next.notification_appearance = Some(appearance);
    write_private(
        &core.data_dir.join("config.json"),
        &serde_json::to_string_pretty(&next).unwrap(),
    )
    .map_err(|e| e.to_string())?;
    *config = next;
    #[cfg(target_os = "macos")]
    core.app
        .run_on_main_thread(move || island::configure(appearance))
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Android: current notification permission, asking the system when `ask` and not yet decided.
#[tauri::command]
fn notify_permission(app: tauri::AppHandle, ask: bool) -> String {
    notify::permission(&app, ask)
}

/// Phone: the webview went to / came back from the background (notification rules).
#[tauri::command]
fn set_foreground(core: C<'_>, fg: bool) {
    core.notifier.set_foreground(fg);
}
#[tauri::command]
fn notify_prefs(core: C<'_>, prefs: HashMap<String, notify::Prefs>) {
    core.notifier.set_prefs(prefs);
}

/// `tgstream://localhost/<account>/<file id>?<mime>`: Telegram videos play while they
/// download. WebKit asks for byte ranges; each answer is one chunk (206), the player
/// comes back for the next, and seeking just asks from another offset.
async fn tg_stream(
    core: &Core,
    req: &tauri::http::Request<Vec<u8>>,
) -> Result<tauri::http::Response<Vec<u8>>, String> {
    use tauri::http::header::{
        ACCEPT_RANGES, ACCESS_CONTROL_ALLOW_ORIGIN, CONTENT_LENGTH, CONTENT_RANGE, CONTENT_TYPE,
        RANGE,
    };
    const CHUNK: i64 = 2 << 20;
    let (account, file) = req
        .uri()
        .path()
        .trim_start_matches('/')
        .rsplit_once('/')
        .ok_or("bad stream url")?;
    let file_id: i32 = file.parse().map_err(|_| "bad file id")?;
    let mime = req
        .uri()
        .query()
        .filter(|q| !q.is_empty())
        .unwrap_or("video/mp4");
    // "bytes=START-" or "bytes=START-END" (END inclusive)
    let range = req
        .headers()
        .get(RANGE)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("bytes="))
        .unwrap_or("0-");
    let (a, b) = range.split_once('-').unwrap_or((range, ""));
    let start: i64 = a.trim().parse().unwrap_or(0);
    let want = b
        .trim()
        .parse::<i64>()
        .map(|end| end - start + 1)
        .unwrap_or(CHUNK)
        .clamp(1, CHUNK);
    let (bytes, total) = core.tg.stream_part(account, file_id, start, want).await?;
    let end = start + bytes.len() as i64 - 1;
    tauri::http::Response::builder()
        .status(206)
        .header(CONTENT_TYPE, mime)
        .header(ACCEPT_RANGES, "bytes")
        .header(CONTENT_RANGE, format!("bytes {start}-{end}/{total}"))
        .header(CONTENT_LENGTH, bytes.len())
        .header(ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .body(bytes)
        .map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .register_asynchronous_uri_scheme_protocol("tgstream", |ctx, req, responder| {
            let core = ctx
                .app_handle()
                .try_state::<Arc<Core>>()
                .map(|c| c.inner().clone());
            tauri::async_runtime::spawn(async move {
                let res = match core {
                    Some(core) => tg_stream(&core, &req).await.inspect_err(|e| {
                        eprintln!(
                            "[tgstream] {} {:?}: {e}",
                            req.uri(),
                            req.headers().get("range")
                        )
                    }),
                    None => Err("starting".into()),
                };
                responder.respond(res.unwrap_or_else(|e| {
                    tauri::http::Response::builder()
                        .status(500)
                        .body(e.into_bytes())
                        .unwrap()
                }));
            });
        })
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init());
    #[cfg(target_os = "android")]
    let builder = builder
        .plugin(google_android::init())
        .plugin(files_android::init());
    // remember window size/position across launches, like the other _min apps
    // (not visibility: quitting with the window hidden must not launch hidden)
    #[cfg(desktop)]
    let builder = builder.plugin(
        tauri_plugin_window_state::Builder::default()
            .with_state_flags(
                tauri_plugin_window_state::StateFlags::all()
                    & !tauri_plugin_window_state::StateFlags::VISIBLE,
            )
            .build(),
    );
    builder
        // a messenger keeps running when its window closes (notifications, Dock badge);
        // ⌘Q quits, clicking the Dock icon brings the window back
        .on_window_event(|w, e| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = e {
                if w.label() == "main" {
                    api.prevent_close();
                    let _ = w.hide();
                }
            }
        })
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            let cache_dir = app.path().app_cache_dir()?;
            std::fs::create_dir_all(&data_dir)?;
            std::fs::create_dir_all(&cache_dir)?;
            // a release build launched from Finder has no stderr, so every eprintln
            // ([recv], [notify], [gchat], a panic that silently ends a poller) was lost:
            // point fd 2 at <cache>/app.log, started over past 4 MB
            #[cfg(unix)]
            {
                let path = cache_dir.join("app.log");
                if std::fs::metadata(&path)
                    .map(|m| m.len() > 4 << 20)
                    .unwrap_or(false)
                {
                    let _ = std::fs::remove_file(&path);
                }
                if let Ok(f) = std::fs::OpenOptions::new()
                    .create(true)
                    .append(true)
                    .open(&path)
                {
                    use std::os::fd::AsRawFd;
                    unsafe { libc::dup2(f.as_raw_fd(), 2) };
                    eprintln!(
                        "── ChatMin {} started {}",
                        env!("CARGO_PKG_VERSION"),
                        chrono::Local::now().format("%m-%d %H:%M:%S")
                    );
                }
            }
            let config: Config = std::fs::read_to_string(data_dir.join("config.json"))
                .ok()
                .and_then(|s| serde_json::from_str(&s).ok())
                .unwrap_or_default();
            let core = Arc::new(Core {
                app: app.handle().clone(),
                store: Mutex::new(Store::open(&data_dir.join("chatmin.db"))?),
                data_dir,
                cache_dir,
                config: Mutex::new(config),
                health: Mutex::new(HashMap::new()),
                tg: Tg::default(),
                gchat: GChat::default(),
                zalo: Default::default(),
                notifier: Default::default(),
                web_open: Default::default(),
            });
            app.manage(core.clone());
            // WKWebView caps rendering updates near 60 Hz by default, so on a 120 Hz
            // display scrolling moves only every other frame. Opt out via the WebKit
            // feature flag (private API; measured 60.6 → 120.3 rAF/s on macOS 26).
            #[cfg(target_os = "macos")]
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.with_webview(|webview| unsafe {
                    use objc2::rc::Retained;
                    use objc2::runtime::AnyObject;
                    use objc2::{class, msg_send};
                    use objc2_foundation::{NSArray, NSString};
                    let wk = &*(webview.inner() as *mut AnyObject);
                    let config: Retained<AnyObject> = msg_send![wk, configuration];
                    let config: &AnyObject = &config;
                    let prefs: Retained<AnyObject> = msg_send![config, preferences];
                    let prefs: &AnyObject = &prefs;
                    let features: Retained<NSArray<AnyObject>> =
                        msg_send![class!(WKPreferences), _features];
                    for feature in features.iter() {
                        let feature: &AnyObject = &feature;
                        let key: Retained<NSString> = msg_send![feature, key];
                        if key.to_string() == "PreferPageRenderingUpdatesNear60FPSEnabled" {
                            let _: () = msg_send![prefs, _setEnabled: false, forFeature: feature];
                            eprintln!("[webview] rendering updates no longer capped near 60 Hz");
                        }
                    }
                });
            }
            core.notifier.set_island(
                &core.app,
                core.config
                    .lock()
                    .unwrap()
                    .notification_island
                    .unwrap_or(true),
            );
            #[cfg(target_os = "macos")]
            if let Some(appearance) = core.config.lock().unwrap().notification_appearance {
                island::configure(appearance);
            }
            // keep the media cache inside its limits: shortly after launch, then every 6 hours
            let c = core.clone();
            tauri::async_runtime::spawn(async move {
                tokio::time::sleep(std::time::Duration::from_secs(120)).await;
                loop {
                    let freed = c.clean_storage(false).await;
                    eprintln!("[storage] freed {} MB", freed >> 20);
                    tokio::time::sleep(std::time::Duration::from_secs(6 * 3600)).await;
                }
            });
            for c in core.store().chats()? {
                core.notifier.track(&core.app, &c, false);
            }
            #[cfg(target_os = "macos")]
            show_on_activate(app.handle().clone());
            #[cfg(mobile)]
            notify::setup_channel(app.handle());
            notify::on_click(app.handle());
            let accounts = core.store().accounts()?;
            for a in accounts {
                core.health.lock().unwrap().insert(
                    a.id.clone(),
                    Health {
                        health: "reconnecting".into(),
                        text: "Đang kết nối".into(),
                        until: 0,
                    },
                );
                match a.platform.as_str() {
                    "telegram" => {
                        core.tg.open(&core, &a.id, false);
                    }
                    "zalo" => {
                        if let Err(e) = zalo::Zalo::start(&core, &a.id, false) {
                            eprintln!("[zalo] worker start failed: {e}");
                            core.set_health(
                                &a.id,
                                "offline",
                                "Chưa khởi động được Zalo. Hãy đăng nhập lại.",
                                0,
                            );
                        }
                    }
                    "gchat" => GChat::start(core.clone(), a, false),
                    _ => {
                        // Preserve cached rows/badges, and start receiving before a tab is opened.
                        let empty = core.store().account_chats(&a.id)?.is_empty();
                        if empty {
                            core.put_chat(web::chat_of(&a));
                        }
                        core.set_health(&a.id, "ok", "Web", 0);
                        web::start_background(&core, &a);
                    }
                }
            }
            // Custom menu without File > Close Window so ⌘W reaches the webview
            // (closes the active tab). Edit menu kept for copy/paste.
            #[cfg(target_os = "macos")]
            {
                use tauri::menu::{Menu, PredefinedMenuItem, Submenu};
                let handle = app.handle();
                let app_menu = Submenu::with_items(
                    handle,
                    "ChatMin",
                    true,
                    &[
                        &PredefinedMenuItem::about(handle, None, None)?,
                        &PredefinedMenuItem::separator(handle)?,
                        &PredefinedMenuItem::hide(handle, None)?,
                        &PredefinedMenuItem::hide_others(handle, None)?,
                        &PredefinedMenuItem::show_all(handle, None)?,
                        &PredefinedMenuItem::separator(handle)?,
                        &PredefinedMenuItem::quit(handle, None)?,
                    ],
                )?;
                let edit = Submenu::with_items(
                    handle,
                    "Edit",
                    true,
                    &[
                        &PredefinedMenuItem::undo(handle, None)?,
                        &PredefinedMenuItem::redo(handle, None)?,
                        &PredefinedMenuItem::separator(handle)?,
                        &PredefinedMenuItem::cut(handle, None)?,
                        &PredefinedMenuItem::copy(handle, None)?,
                        &PredefinedMenuItem::paste(handle, None)?,
                        &PredefinedMenuItem::select_all(handle, None)?,
                    ],
                )?;
                let window = Submenu::with_items(
                    handle,
                    "Window",
                    true,
                    &[
                        &PredefinedMenuItem::minimize(handle, None)?,
                        &PredefinedMenuItem::maximize(handle, None)?,
                        &PredefinedMenuItem::fullscreen(handle, None)?,
                    ],
                )?;
                app.set_menu(Menu::with_items(handle, &[&app_menu, &edit, &window])?)?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            app_state,
            ui_state,
            ui_state_set,
            config_set,
            ai_config,
            ai_config_set,
            ai_run,
            delete_chat,
            forward,
            topics,
            stickers,
            send_sticker,
            save_temp,
            clipboard_files,
            stage_files,
            log_js,
            web_add,
            web_show,
            web_hide,
            web_reload,
            topic_history,
            save_file,
            open_local,
            tg_login_start,
            tg_phone,
            tg_code,
            tg_password,
            tg_qr,
            tg_resend,
            gchat_login,
            zalo_login_start,
            zalo_contacts,
            zalo_open_chat,
            login_cancel,
            account_update,
            account_remove,
            messages,
            cached_messages,
            primary_messages,
            thread_list,
            thread_count,
            emoji_palette,
            thread,
            thread_root,
            pinned,
            members,
            send,
            edit,
            delete_msg,
            react,
            reactions,
            msg_people,
            inbox,
            storage,
            storage_set,
            storage_clean,
            browser,
            browser_set,
            open_url,
            web_devtools,
            presence,
            pin,
            mark_read,
            set_open,
            set_muted,
            thread_mute,
            download,
            search,
            notify_prefs,
            notify_test,
            notify_island,
            notify_appearance,
            notify_permission,
            set_foreground,
        ])
        .build(tauri::generate_context!())
        .expect("error while building ChatMin")
        .run(|app, event| match event {
            #[cfg(target_os = "macos")]
            tauri::RunEvent::Reopen { .. } => {
                if let Some(w) = app.get_window("main") {
                    let _ = w.show();
                    let _ = w.set_focus();
                }
            }
            // exit() runs TDLib's C++ static destructors while its receive thread is still
            // blocked in td_receive → SIGSEGV on ⌘Q. Close the clients, then leave without
            // running destructors (plugins, window-state included, already saved by now).
            tauri::RunEvent::Exit => {
                if let Some(core) = app.try_state::<Arc<Core>>() {
                    core.zalo.shutdown();
                    tauri::async_runtime::block_on(core.tg.shutdown());
                }
                extern "C" {
                    fn _exit(code: i32) -> !;
                }
                unsafe { _exit(0) }
            }
            _ => {}
        });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn save_names() {
        let src = std::path::Path::new("/x/files/animation_12.mp4");
        assert_eq!(save_name("GIF", src), "GIF.mp4");
        assert_eq!(save_name("report.pdf", src), "report.pdf");
        assert_eq!(save_name("../../etc/passwd", src), "passwd.mp4");
        let dir = std::env::temp_dir().join(format!("chatmin-save-{}", now_ms()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("photo.jpg"), b"").unwrap();
        assert_eq!(unique_path(&dir, "photo.jpg"), dir.join("photo (1).jpg"));
        assert_eq!(unique_path(&dir, "new.jpg"), dir.join("new.jpg"));
        let _ = std::fs::remove_dir_all(&dir);
    }
}
