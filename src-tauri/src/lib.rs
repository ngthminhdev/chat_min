mod ai;
mod gchat;
mod model;
mod store;
mod tg;

use gchat::GChat;
use model::{Account, Chat, Event, Member, Msg};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex, MutexGuard};
use store::Store;
use tauri::{Emitter, Manager, State};
use tg::Tg;

pub fn now_ms() -> i64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0)
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
}

impl Core {
    pub fn emit(&self, e: Event) {
        let _ = self.app.emit("chatmin", e);
    }
    pub fn store(&self) -> MutexGuard<'_, Store> {
        self.store.lock().unwrap()
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
        (!c.gchat_client_id.is_empty()).then(|| (c.gchat_client_id.clone(), c.gchat_client_secret.clone()))
    }

    pub fn put_chat(&self, chat: Chat) {
        // the mute switch is local-only for gchat; keep it across server refreshes
        let mut chat = chat;
        if chat.account_id.starts_with("gc-") {
            let old = self.store().chat(&chat.account_id, &chat.id);
            if let Ok(Some(old)) = old {
                chat.muted = old.muted;
                if old == chat {
                    return;
                }
            }
        }
        let _ = self.store().put_chat(&chat);
        self.emit(Event::Chat { chat });
    }
    pub fn remove_chat(&self, account_id: &str, chat_id: &str) {
        let _ = self.store().remove_chat(account_id, chat_id);
        self.emit(Event::ChatRemoved { account_id: account_id.into(), chat_id: chat_id.into() });
    }
    pub fn put_msg(&self, msg: Msg, is_new: bool) {
        // Hold the store mutex across existence check + upsert: concurrent pollers
        // and history loads must agree on whether this ID is a first delivery.
        let first_delivery = self.store().put_msg_if_new(&msg).unwrap_or(false);
        let is_new = is_new && first_delivery && !msg.deleted;
        self.emit(Event::Message { msg, is_new });
    }
    pub fn replace_msg(&self, old_id: &str, msg: Msg) {
        {
            let s = self.store();
            let _ = s.remove_msg(&msg.account_id, &msg.chat_id, old_id);
            let _ = s.put_msg(&msg);
        }
        self.emit(Event::MessageIdChanged { old_id: old_id.into(), msg });
    }
    pub fn delete_msgs(&self, account_id: &str, chat_id: &str, ids: Vec<String>) {
        {
            let s = self.store();
            for id in &ids {
                let _ = s.remove_msg(account_id, chat_id, id);
            }
        }
        self.emit(Event::MessagesDeleted { account_id: account_id.into(), chat_id: chat_id.into(), ids });
    }
    pub fn set_health(&self, account_id: &str, health: &str, text: &str, until: i64) {
        eprintln!("[health] {account_id} {health} {text}");
        let h = Health { health: health.into(), text: text.into(), until };
        self.health.lock().unwrap().insert(account_id.into(), h);
        self.emit(Event::Health { account_id: account_id.into(), health: health.into(), text: text.into(), until });
    }

    /// Saves a freshly logged-in account. Logging in again to an existing account keeps
    /// its name and color; the same user under a different id is a duplicate.
    pub fn add_account(&self, mut a: Account) -> Result<(), String> {
        let existing = self.store().accounts()?;
        if let Some(dup) = existing.iter().find(|x| x.platform == a.platform && x.self_id == a.self_id) {
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
        if account_id.starts_with("gc-") { "gchat" } else { "telegram" }
    }
}

fn default_name(a: &Account, existing: &[Account]) -> String {
    let base = if a.platform == "gchat" {
        a.handle.split('@').nth(1).and_then(|d| d.split('.').next()).map(|d| {
            let mut c = d.chars();
            c.next().map(|f| f.to_uppercase().collect::<String>() + c.as_str()).unwrap_or_default()
        })
    } else {
        None
    }
    .unwrap_or_else(|| if a.platform == "gchat" { "Google Chat".into() } else { "Telegram".into() });
    let taken = |n: &str| existing.iter().any(|x| x.name == n);
    if !taken(&base) {
        return base;
    }
    (2..).map(|i| format!("{base} {i}")).find(|n| !taken(n)).unwrap()
}

fn next_color(existing: &[Account], preferred: &str) -> String {
    const COLORS: [&str; 8] = ["blue", "purple", "green", "orange", "pink", "amber", "red", "slate"];
    if !existing.iter().any(|a| a.color == preferred) {
        return preferred.into();
    }
    COLORS.iter().find(|c| !existing.iter().any(|a| a.color == **c)).unwrap_or(&"slate").to_string()
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
}

#[tauri::command]
fn app_state(core: C) -> Res<AppState> {
    let c = core.config.lock().unwrap().clone();
    // one guard at a time: temporaries in a struct literal live to the end of the statement
    let accounts = core.store().accounts()?;
    let chats = core.store().chats()?;
    let health = core.health.lock().unwrap().clone();
    Ok(AppState {
        accounts,
        health,
        chats,
        tg_configured: c.tg_api_id != 0 && !c.tg_api_hash.is_empty(),
        gchat_configured: !c.gchat_client_id.is_empty(),
    })
}

#[tauri::command]
fn config_set(core: C, tg_api_id: Option<String>, tg_api_hash: Option<String>, gchat_json: Option<String>) -> Res<()> {
    let mut c = core.config.lock().unwrap();
    if let Some(id) = tg_api_id {
        c.tg_api_id = id.trim().parse().map_err(|_| "api_id phải là số")?;
    }
    if let Some(h) = tg_api_hash {
        c.tg_api_hash = h.trim().into();
    }
    if let Some(j) = gchat_json {
        // accept the JSON downloaded from Cloud Console, or a path to it
        let raw = if j.trim_start().starts_with('{') { j } else { std::fs::read_to_string(j.trim()).map_err(|e| e.to_string())? };
        let v: Value = serde_json::from_str(&raw).map_err(|_| "JSON OAuth client không hợp lệ")?;
        let inner = if v["installed"].is_object() { &v["installed"] } else { &v["web"] };
        c.gchat_client_id = inner["client_id"].as_str().ok_or("Thiếu client_id")?.into();
        c.gchat_client_secret = inner["client_secret"].as_str().ok_or("Thiếu client_secret — tạo secret mới trong Cloud Console")?.into();
    }
    write_private(&core.data_dir.join("config.json"), &serde_json::to_string_pretty(&*c).unwrap()).map_err(|e| e.to_string())
}

#[tauri::command]
fn ai_config(core: C) -> ai::AiView {
    core.config.lock().unwrap().ai.view()
}
/// `key: None` keeps the stored key; `Some("")` clears it.
#[tauri::command]
fn ai_config_set(core: C, format: String, endpoint: String, model: String, guide: String, key: Option<String>) -> Res<()> {
    let mut c = core.config.lock().unwrap();
    let a = &mut c.ai;
    a.format = format;
    a.endpoint = endpoint.trim().into();
    a.model = model.trim().into();
    a.guide = guide;
    if let Some(k) = key {
        a.key = k.trim().into();
    }
    write_private(&core.data_dir.join("config.json"), &serde_json::to_string_pretty(&*c).unwrap()).map_err(|e| e.to_string())
}
#[tauri::command]
async fn ai_run(core: C<'_>, task: String, texts: Vec<String>, me: String, to: String) -> Res<Value> {
    let cfg = core.config.lock().unwrap().ai.clone();
    ai::run(&cfg, &task, &texts, &me, &to).await
}

fn write_private(path: &std::path::Path, data: &str) -> std::io::Result<()> {
    use std::os::unix::fs::OpenOptionsExt;
    let mut f = std::fs::OpenOptions::new().write(true).create(true).truncate(true).mode(0o600).open(path)?;
    std::io::Write::write_all(&mut f, data.as_bytes())
}

// ── accounts ────────────────────────────────────────────────────────────────
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
    let mut a = core.store().accounts()?.into_iter().find(|a| a.id == id).ok_or("Không thấy account")?;
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
    if core.platform(&id) == "telegram" {
        core.tg.close(&id, true).await;
        let _ = std::fs::remove_dir_all(core.data_dir.join("tg").join(&id));
    } else {
        core.gchat.stop(&core, &id);
    }
    core.store().remove_account(&id)?;
    core.health.lock().unwrap().remove(&id);
    core.emit_accounts();
    Ok(())
}

// ── chats & messages ────────────────────────────────────────────────────────
#[tauri::command]
async fn messages(core: C<'_>, account_id: String, chat_id: String, before: i64, limit: i32) -> Res<Vec<Msg>> {
    let core = core.inner().clone();
    let live = if core.platform(&account_id) == "telegram" {
        core.tg.history(&core, &account_id, &chat_id, before, limit).await
    } else {
        core.gchat.history(&core, &account_id, &chat_id, before, limit).await
    };
    // offline: fall back to whatever the cache has
    live.or_else(|e| {
        let cached = core.store().msgs(&account_id, &chat_id, before, limit as i64)?;
        if cached.is_empty() { Err(e) } else { Ok(cached) }
    })
}
#[tauri::command]
async fn thread(core: C<'_>, account_id: String, chat_id: String, thread_id: String) -> Res<Vec<Msg>> {
    let core = core.inner().clone();
    core.gchat.thread(&core, &account_id, &chat_id, &thread_id).await.or_else(|e| {
        let cached = core.store().thread_msgs(&account_id, &chat_id, &thread_id)?;
        if cached.is_empty() { Err(e) } else { Ok(cached) }
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
) -> Res<Msg> {
    let core = core.inner().clone();
    if core.platform(&account_id) == "telegram" {
        core.tg.send(&core, &account_id, &chat_id, text, reply_to, file).await
    } else {
        core.gchat.send(&core, &account_id, &chat_id, text, reply_to, thread_id, file).await
    }
}
#[tauri::command]
async fn edit(core: C<'_>, account_id: String, chat_id: String, msg_id: String, text: String) -> Res<()> {
    let core = core.inner().clone();
    if core.platform(&account_id) == "telegram" {
        core.tg.edit(&account_id, &chat_id, &msg_id, text).await
    } else {
        core.gchat.edit(&core, &account_id, &chat_id, &msg_id, text).await
    }
}
#[tauri::command]
async fn delete_msg(core: C<'_>, account_id: String, chat_id: String, msg_id: String) -> Res<()> {
    let core = core.inner().clone();
    if core.platform(&account_id) == "telegram" {
        core.tg.delete(&account_id, &chat_id, &msg_id).await
    } else {
        core.gchat.delete(&core, &account_id, &chat_id, &msg_id).await
    }
}
#[tauri::command]
async fn react(core: C<'_>, account_id: String, chat_id: String, msg_id: String, emoji: String, add: bool) -> Res<()> {
    let core = core.inner().clone();
    if core.platform(&account_id) == "telegram" {
        core.tg.react(&account_id, &chat_id, &msg_id, emoji, add).await
    } else {
        core.gchat.react(&core, &account_id, &msg_id, &emoji, add).await?;
        // gchat has no reaction push; re-read the message so counts update right away
        if let Ok(v) = core.gchat.history(&core, &account_id, &chat_id, 0, 20).await {
            for m in v.into_iter().filter(|m| m.id == msg_id) {
                core.put_msg(m, false);
            }
        }
        Ok(())
    }
}
#[tauri::command]
async fn pin(core: C<'_>, account_id: String, chat_id: String, msg_id: String, on: bool) -> Res<()> {
    core.tg.pin(&account_id, &chat_id, &msg_id, on).await
}
#[tauri::command]
async fn mark_read(core: C<'_>, account_id: String, chat_id: String, msg_ids: Vec<String>) -> Res<()> {
    let core = core.inner().clone();
    if core.platform(&account_id) == "telegram" {
        core.tg.mark_read(&account_id, &chat_id, msg_ids).await
    } else {
        core.gchat.mark_read(&core, &account_id, &chat_id).await
    }
}
#[tauri::command]
async fn set_open(core: C<'_>, account_id: String, chat_id: String, open: bool) -> Res<()> {
    if core.platform(&account_id) == "telegram" {
        core.tg.set_open(&account_id, &chat_id, open).await
    } else {
        core.gchat.focus(&account_id, open.then_some(chat_id));
        Ok(())
    }
}
#[tauri::command]
async fn set_muted(core: C<'_>, account_id: String, chat_id: String, muted: bool) -> Res<()> {
    if core.platform(&account_id) == "telegram" {
        core.tg.set_muted(&account_id, &chat_id, muted).await
    } else {
        let mut chat = core.store().chat(&account_id, &chat_id)?.ok_or("Không thấy chat")?;
        chat.muted = muted;
        core.store().put_chat(&chat)?;
        core.emit(Event::Chat { chat });
        Ok(())
    }
}
#[tauri::command]
async fn delete_chat(core: C<'_>, account_id: String, chat_id: String, revoke: bool) -> Res<()> {
    let core = core.inner().clone();
    if core.platform(&account_id) != "telegram" {
        return Err("Google Chat không cho xoá cuộc trò chuyện qua API".into());
    }
    core.tg.delete_chat(&core, &account_id, &chat_id, revoke).await
}
/// Copies a downloaded file out of ChatMin's folders: to `dest` (from a save dialog) or,
/// when empty, into ~/Downloads without overwriting anything. Returns where it landed.
#[tauri::command]
fn save_file(core: C, src: String, name: String, dest: Option<String>) -> Res<String> {
    let src = std::fs::canonicalize(&src).map_err(|e| e.to_string())?;
    // only files the app itself downloaded: the webview must not copy arbitrary paths
    let inside = |d: &PathBuf| std::fs::canonicalize(d).map(|d| src.starts_with(d)).unwrap_or(false);
    if !inside(&core.data_dir) && !inside(&core.cache_dir) {
        return Err("File nằm ngoài thư mục của ChatMin".into());
    }
    let dest = match dest.filter(|d| !d.is_empty()) {
        Some(d) => PathBuf::from(d),
        None => {
            let dir = core.app.path().download_dir().map_err(|e| e.to_string())?;
            unique_path(&dir, &save_name(&name, &src))
        }
    };
    std::fs::copy(&src, &dest).map_err(|e| e.to_string())?;
    Ok(dest.to_string_lossy().into())
}

/// Display name → a safe file name, borrowing the source's extension when it has none
/// ("GIF", "Video tròn").
fn save_name(name: &str, src: &std::path::Path) -> String {
    let base = std::path::Path::new(name).file_name().and_then(|n| n.to_str()).unwrap_or("file").replace(['/', ':'], "-");
    match (std::path::Path::new(&base).extension(), src.extension().and_then(|e| e.to_str())) {
        (None, Some(ext)) => format!("{base}.{ext}"),
        _ => base,
    }
}

fn unique_path(dir: &std::path::Path, name: &str) -> PathBuf {
    let p = std::path::Path::new(name);
    let stem = p.file_stem().and_then(|s| s.to_str()).unwrap_or("file");
    let ext = p.extension().and_then(|e| e.to_str()).map(|e| format!(".{e}")).unwrap_or_default();
    std::iter::once(dir.join(name))
        .chain((1..).map(|i| dir.join(format!("{stem} ({i}){ext}"))))
        .find(|c| !c.exists())
        .unwrap()
}

#[tauri::command]
async fn download(core: C<'_>, account_id: String, file_ref: String, name: String) -> Res<String> {
    let core = core.inner().clone();
    if core.platform(&account_id) == "telegram" {
        core.tg.download(&account_id, &file_ref).await
    } else {
        core.gchat.download(&core, &account_id, &file_ref, &name).await
    }
}
#[tauri::command]
fn search(core: C, query: String, account_id: Option<String>, chat_id: Option<String>, limit: i64) -> Res<Vec<Msg>> {
    let scope = account_id.as_deref().map(|a| (a, chat_id.as_deref().unwrap_or("")));
    core.store().search(&query, scope, limit)
}
#[tauri::command]
fn set_badge(app: tauri::AppHandle, count: i64) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.set_badge_count(if count > 0 { Some(count) } else { None });
    }
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            let cache_dir = app.path().app_cache_dir()?;
            std::fs::create_dir_all(&data_dir)?;
            std::fs::create_dir_all(&cache_dir)?;
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
            });
            app.manage(core.clone());
            let accounts = core.store().accounts()?;
            for a in accounts {
                core.health.lock().unwrap().insert(a.id.clone(), Health { health: "reconnecting".into(), text: "Đang kết nối".into(), until: 0 });
                if a.platform == "telegram" {
                    core.tg.open(&core, &a.id, false);
                } else {
                    GChat::start(core.clone(), a, false);
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            app_state,
            config_set,
            ai_config,
            ai_config_set,
            ai_run,
            delete_chat,
            save_file,
            tg_login_start,
            tg_phone,
            tg_code,
            tg_password,
            tg_qr,
            tg_resend,
            gchat_login,
            login_cancel,
            account_update,
            account_remove,
            messages,
            thread,
            pinned,
            members,
            send,
            edit,
            delete_msg,
            react,
            pin,
            mark_read,
            set_open,
            set_muted,
            download,
            search,
            set_badge,
        ])
        .run(tauri::generate_context!())
        .expect("error while running ChatMin");
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
