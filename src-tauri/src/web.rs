//! Messenger and Zalo have no public API for personal accounts, so each runs as its own
//! web app in a child webview laid over the conversation area. ChatMin only creates,
//! positions, shows and hides it. The injected bridge observes sidebar mutations and sends
//! changed snapshots to a sequential background worker; title counts remain a fallback.
//! Every account gets its own WKWebsiteDataStore, so logins persist and never mix.
use crate::model::{Account, Chat};
use crate::{now_ms, Core};
use serde::Deserialize;
use std::collections::{HashMap, HashSet};
use std::hash::{Hash, Hasher};
use std::sync::Arc;
#[cfg(desktop)]
use tauri::webview::NewWindowResponse;
#[cfg(desktop)]
use tauri::{Emitter, LogicalPosition, LogicalSize, Manager, WebviewBuilder, WebviewUrl};

/// platform → (display name, start URL)
pub fn site(platform: &str) -> Option<(&'static str, &'static str)> {
    match platform {
        "messenger" => Some(("Messenger", "https://www.facebook.com/messages/")),
        "zalo" => Some(("Zalo", "https://chat.zalo.me/")),
        _ => None,
    }
}

/// Both sites serve their full web app to desktop Safari; WKWebView's default UA gets a
/// reduced or "unsupported browser" page.
const UA: &str = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15";

/// Runs in the provider page without access to ChatMin IPC. Snapshots cross a private
/// window-open URL intercepted by the webview; only changed rows are persisted off-thread.
const PAGE_JS: &str = include_str!("../resources/web-bridge.js");
const SHORTCUT_JS: &str = include_str!("../resources/web-shortcuts.js");

/// Only app-owned keyboard commands cross from an external document to the shell.
#[derive(Clone, serde::Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Shortcut {
    key: String,
    meta_key: bool,
    ctrl_key: bool,
    shift_key: bool,
    alt_key: bool,
    in_field: bool,
}
impl Shortcut {
    fn allowed(&self) -> bool {
        if self.alt_key || !(self.meta_key || self.ctrl_key) { return false; }
        if self.key.eq_ignore_ascii_case("f") && !self.shift_key { return false; }
        matches!(self.key.to_ascii_lowercase().as_str(), "k" | "f" | "n" | "," | "[" | "]" | "w" | "e" | "b" | "r")
            || matches!(self.key.as_str(), "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9")
            || (self.key == "Tab" && self.ctrl_key && !self.meta_key)
            || (!self.in_field && matches!(self.key.as_str(), "ArrowUp" | "ArrowDown" | "Backspace"))
    }
}

fn label(account_id: &str) -> String {
    format!("web-{account_id}")
}

/// The one sidebar row that stands for the whole web app.
pub fn chat_of(a: &Account) -> Chat {
    Chat {
        account_id: a.id.clone(),
        id: "web".into(),
        kind: "web".into(),
        title: site(&a.platform).map(|s| s.0).unwrap_or("Web").into(),
        description: site(&a.platform).map(|s| s.1).unwrap_or("").into(),
        order: 1,
        can_send: true,
        ..Default::default()
    }
}

pub fn add(core: &Core, platform: &str) -> Result<Account, String> {
    let (name, url) = site(platform).ok_or("Nền tảng không hỗ trợ")?;
    let id = format!("{platform}-{}", now_ms());
    let a = Account {
        id: id.clone(),
        platform: platform.into(),
        name: name.into(),
        color: if platform == "zalo" { "blue".into() } else { "purple".into() },
        handle: url.trim_start_matches("https://").trim_end_matches('/').into(),
        self_id: id,
    };
    core.add_account(a.clone())?;
    core.put_chat(chat_of(&a));
    core.set_health(&a.id, "ok", "Web", 0);
    Ok(a)
}

/// 16-byte data store id derived from the account id: stable across launches.
fn store_id(account_id: &str) -> [u8; 16] {
    let mut out = [0u8; 16];
    for (i, half) in out.chunks_mut(8).enumerate() {
        let mut h = std::collections::hash_map::DefaultHasher::new();
        (i, account_id).hash(&mut h);
        half.copy_from_slice(&h.finish().to_le_bytes());
    }
    out
}

/// "(3) Messenger" → 3; no count → 0.
fn title_count(title: &str) -> i32 {
    let t = title.trim_start();
    t.strip_prefix('(').and_then(|r| r.split(')').next()).and_then(|n| n.trim().trim_end_matches('+').parse().ok()).unwrap_or(0)
}

/// One thread as the page script sees it.
#[derive(Clone, Deserialize)]
pub struct Row {
    id: String,
    title: String,
    preview: String,
    unread: i32,
    #[serde(default)]
    outgoing: bool,
    #[serde(default)]
    pinned: bool,
    /// avatar URL as the site shows it
    #[serde(default)]
    photo: String,
    /// seconds since the last message as the site labels it; -1 = unknown
    #[serde(default = "unknown_age")]
    ago: i64,
}
fn unknown_age() -> i64 {
    -1
}

/// Whether an observed row represents a new incoming message after the initial snapshot.
fn incoming(prev: Option<&Chat>, chat: &Chat, initialized: bool, outgoing: bool, age: i64) -> bool {
    initialized && !outgoing && chat.unread > 0 && match prev {
        None => (0..=120).contains(&age),
        Some(p) => chat.unread > p.unread || (chat.unread >= p.unread && chat.preview != p.preview),
    }
}

/// The page's thread list → one sidebar `Chat` per thread (kind "web", so the conversation
/// area still shows the site). Virtualized rows that leave the DOM stay cached.
pub fn rows(core: &Core, account_id: &str, rows: Vec<Row>, initialized: bool) {
    if rows.is_empty() {
        return;
    }
    let all = {
        let store = core.store();
        // Closing an account can race an already queued snapshot. Never recreate removed chats.
        if !store.accounts().unwrap_or_default().iter().any(|a| a.id == account_id) { return; }
        store.account_chats(account_id)
    };
    let Ok(all) = all else { return };
    let old: HashMap<String, Chat> = all.into_iter().map(|c| (c.id.clone(), c)).collect();
    let url = site(platform_of(account_id)).map(|s| s.1).unwrap_or("");
    let n = rows.len() as i64;
    let mut seen = HashSet::new();
    let now = now_ms();
    for (i, r) in rows.into_iter().enumerate() {
        seen.insert(r.id.clone());
        let prev = old.get(&r.id);
        let changed = prev.map_or(true, |p| p.preview != r.preview || r.unread > p.unread);
        let chat = Chat {
            account_id: account_id.into(),
            id: r.id,
            kind: "web".into(),
            title: r.title,
            description: url.into(),
            // the site's own "5 phút" label places the row among Telegram/Google chats in "Mới nhất";
            // without one: first sight keeps the page's order, a later change bumps the row up
            last_ts: match (prev, r.ago) {
                (_, ago) if ago >= 0 && changed => now.saturating_sub(ago.saturating_mul(1000)),
                (Some(p), _) if changed => now.max(p.last_ts.saturating_add(1)),
                (Some(p), _) => p.last_ts,
                (None, _) => now - i as i64,
            },
            preview: r.preview,
            unread: r.unread,
            muted: prev.is_some_and(|p| p.muted),
            order: n - i as i64,
            pinned: r.pinned,
            can_send: true,
            photo: r.photo,
            ..Default::default()
        };
        if prev.is_some_and(|p| *p == chat) {
            continue;
        }
        // Baseline the first snapshot; later incoming preview changes also ring at capped badges.
        if incoming(prev, &chat, initialized, r.outgoing, r.ago) {
            core.notifier.web(&core.app, &chat, &chat.preview);
        }
        core.put_chat(chat);
    }
    // ponytail: the sites render only as many rows as fit their (hidden) list, so a row leaving
    // the DOM is not gone — keep it; Messenger opens it by URL, Zalo once it is rendered again.
    // Only the pre-rows placeholder goes. Re-adding the account clears everything.
    if old.contains_key("web") && !seen.contains("web") {
        core.remove_chat(account_id, "web");
    }
}

fn platform_of(account_id: &str) -> &str {
    account_id.split('-').next().unwrap_or("")
}

fn open_js(id: &str) -> String {
    format!("window.__cm && __cm.open({})", serde_json::to_string(id).unwrap_or_default())
}

/// Create saved web accounts at launch, rather than waiting for a sidebar click. Keep a
/// real layout size for virtual lists, but park/hide the native view until opened.
#[cfg(desktop)]
pub fn start_background(core: &Arc<Core>, account: &Account) {
    if core.app.get_webview(&label(&account.id)).is_some() { return; }
    core.set_health(&account.id, "reconnecting", "Đang tải web", 0);
    match show(core, account, "web", -10000.0, 0.0, 1000.0, 800.0, false) {
        Ok(()) => hide(core, &account.id),
        Err(e) => core.set_health(&account.id, "offline", &format!("Không mở được web: {e}"), 0),
    }
}
#[cfg(mobile)]
pub fn start_background(_core: &Arc<Core>, _account: &Account) {}

/// Shows the account's web app at the given logical rect, creating it on first use, and asks
/// the page to open `chat_id` (a row id from `rows`; "web" = whatever the site shows).
#[cfg(desktop)]
pub fn show(core: &Arc<Core>, a: &Account, chat_id: &str, x: f64, y: f64, w: f64, h: f64, navigate: bool) -> Result<(), String> {
    let (pos, size) = (LogicalPosition::new(x, y), LogicalSize::new(w.max(1.0), h.max(1.0)));
    let want = (chat_id != "web").then(|| chat_id.to_string());
    let prev = core.web_open.lock().unwrap().insert(a.id.clone(), want.clone());
    if let Some(wv) = core.app.get_webview(&label(&a.id)) {
        wv.set_position(pos).map_err(|e| e.to_string())?;
        wv.set_size(size).map_err(|e| e.to_string())?;
        if let (Some(id), true) = (&want, navigate || prev.as_ref() != Some(&want)) {
            let _ = wv.eval(&open_js(id));
        }
        wv.show().map_err(|e| e.to_string())?;
        if navigate { let _ = wv.set_focus(); }
        core.notifier.set_open(&a.id, chat_id, true);
        return Ok(());
    }
    let (_, url) = site(&a.platform).ok_or("Nền tảng không hỗ trợ")?;
    let window = core.app.get_window("main").ok_or("Không thấy cửa sổ chính")?;
    let (c, c2, c3, c4) = (core.clone(), core.clone(), core.clone(), core.clone());
    // WKWebView callbacks execute on the UI thread. Coalesce snapshots here and do SQLite
    // and notification work sequentially on the blocking pool, never in that callback.
    let (snapshots, mut updates) = tokio::sync::watch::channel::<Option<(u64, Vec<Row>)>>(None);
    let generation = Arc::new(std::sync::atomic::AtomicU64::new(0));
    let load_generation = generation.clone();
    let worker_core = core.clone();
    let worker_id = a.id.clone();
    tauri::async_runtime::spawn(async move {
        let mut previous_generation = None;
        while updates.changed().await.is_ok() {
            let snapshot = updates.borrow_and_update().clone();
            let Some((generation, snapshot)) = snapshot.filter(|(_, r)| !r.is_empty()) else { continue };
            let initialized = previous_generation == Some(generation);
            let (core, id) = (worker_core.clone(), worker_id.clone());
            let result = tauri::async_runtime::spawn_blocking(move || rows(&core, &id, snapshot, initialized)).await;
            if let Err(e) = result { worker_core.log_line("web.log", &format!("rows worker: {e}")); }
            previous_generation = Some(generation);
        }
    });
    let (id, id2, id3, id4) = (a.id.clone(), a.id.clone(), a.id.clone(), a.id.clone());
    let builder = WebviewBuilder::new(label(&a.id), WebviewUrl::External(url.parse().map_err(|e| format!("{e}"))?))
        .user_agent(UA)
        // Hidden providers must keep their sockets and DOM observers running (macOS 14+).
        .background_throttling(tauri::utils::config::BackgroundThrottlingPolicy::Disabled)
        .initialization_script(PAGE_JS)
        .initialization_script_for_all_frames(SHORTCUT_JS)
        .data_store_identifier(store_id(&a.id))
        .devtools(true)
        .on_navigation(move |url| {
            c3.log_line("web.log", &format!("[{id2}] nav {}{}", url.host_str().unwrap_or(""), url.path()));
            true
        })
        .on_page_load(move |wv, p| {
            c4.log_line("web.log", &format!("[{}] load {:?}", wv.label(), p.event()));
            if matches!(p.event(), tauri::webview::PageLoadEvent::Started) {
                load_generation.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
            }
            // The page bridge retries until the requested row has rendered.
            if matches!(p.event(), tauri::webview::PageLoadEvent::Finished) {
                if let Some(Some(want)) = c4.web_open.lock().unwrap().get(&id3).cloned() {
                    let _ = wv.eval(&open_js(&want));
                }
            }
        })
        .on_document_title_changed(move |_, title| {
            // Messenger flashes "X đã nhắn tin cho bạn" between "(1) Messenger": only the site title counts
            if title.contains("Messenger") || title.contains("Zalo") {
                c.web_unread(&id, title_count(&title));
            }
        })
        // links that want a new window belong in the browser; chatmin://<kind>/<json> is the page script reporting in
        .on_new_window(move |url, _| {
            if url.scheme() == "chatmin" {
                let body = percent_decode(url.path().trim_start_matches('/'));
                match url.host_str() {
                    Some("rows") => match serde_json::from_str::<Vec<Row>>(&body) {
                        Ok(r) => {
                            snapshots.send_replace(Some((generation.load(std::sync::atomic::Ordering::Relaxed), r)));
                        }
                        Err(e) => c2.log_line("web.log", &format!("rows parse: {e}")),
                    },
                    Some("shortcut") => {
                        if let Ok(shortcut) = serde_json::from_str::<Shortcut>(&body) {
                            if shortcut.allowed() {
                                let shell_overlay = matches!(shortcut.key.to_ascii_lowercase().as_str(), "k" | "n" | "," | "e" | "backspace")
                                    || (shortcut.key.eq_ignore_ascii_case("f") && shortcut.shift_key);
                                if shell_overlay {
                                    if let Some(main) = c2.app.get_webview("main") { let _ = main.set_focus(); }
                                }
                                let _ = c2.app.emit_to("main", "chatmin-shortcut", shortcut);
                            }
                        }
                    }
                    Some("state") => match serde_json::from_str::<String>(&body).as_deref() {
                        Ok("ready") => c2.set_health(&id4, "ok", "Web đã kết nối", 0),
                        Ok("inactive") => {
                            generation.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                            c2.set_health(&id4, "expired", "Mở Zalo và bấm Kích hoạt để tiếp tục nhận tin", 0);
                        }
                        Ok("login") => {
                            generation.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                            c2.set_health(&id4, "expired", "Mở web để đăng nhập lại", 0);
                        }
                        _ => {}
                    },
                    _ => c2.log_line("web.log", "page bridge diagnostic"),
                }
            } else {
                c2.open_url(url.as_str());
            }
            NewWindowResponse::Deny
        });
    let wv = window.add_child(builder, pos, size).map_err(|e| e.to_string())?;
    if navigate { let _ = wv.set_focus(); }
    core.notifier.set_open(&a.id, chat_id, true);
    Ok(())
}

#[cfg(desktop)]
pub fn hide(core: &Core, account_id: &str) {
    let open = core.web_open.lock().unwrap().get(account_id).cloned().flatten().unwrap_or_else(|| "web".into());
    core.notifier.set_open(account_id, &open, false);
    if let Some(wv) = core.app.get_webview(&label(account_id)) {
        let _ = wv.hide();
        // A hidden child must not remain the native first responder.
        if let Some(main) = core.app.get_webview("main") { let _ = main.set_focus(); }
    }
}

#[cfg(desktop)]
pub fn close(core: &Core, account_id: &str) {
    core.web_open.lock().unwrap().remove(account_id);
    if let Some(wv) = core.app.get_webview(&label(account_id)) {
        let _ = wv.close();
    }
}

/// Minimal %XX decoder for the page's log payload (ASCII JSON, UTF-8 inside).
fn percent_decode(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' && i + 2 < b.len() {
            if let Some(v) = std::str::from_utf8(&b[i + 1..i + 3]).ok().and_then(|s| u8::from_str_radix(s, 16).ok()) {
                out.push(v);
                i += 3;
                continue;
            }
        }
        out.push(b[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

#[cfg(desktop)]
pub fn devtools(core: &Core, account_id: &str) {
    if let Some(wv) = core.app.get_webview(&label(account_id)) {
        wv.open_devtools();
    }
}
#[cfg(mobile)]
pub fn devtools(_core: &Core, _account_id: &str) {}

#[cfg(desktop)]
pub fn reload(core: &Core, account_id: &str) {
    if let Some(wv) = core.app.get_webview(&label(account_id)) {
        let _ = wv.reload();
    }
}

// ponytail: child webviews are desktop-only in Tauri; on a phone the row just explains itself
#[cfg(mobile)]
pub fn show(_core: &Arc<Core>, _a: &Account, _chat_id: &str, _x: f64, _y: f64, _w: f64, _h: f64, _navigate: bool) -> Result<(), String> {
    Err("Messenger/Zalo chưa hỗ trợ trên điện thoại".into())
}
#[cfg(mobile)]
pub fn hide(_core: &Core, _account_id: &str) {}
#[cfg(mobile)]
pub fn close(_core: &Core, _account_id: &str) {}
#[cfg(mobile)]
pub fn reload(_core: &Core, _account_id: &str) {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn incoming_handles_capped_badges_and_new_threads_without_history_floods() {
        let old = Chat { unread: 6, preview: "old".into(), ..Default::default() };
        let new = Chat { unread: 6, preview: "new".into(), ..old.clone() };
        assert!(incoming(Some(&old), &new, true, false, 0), "5+ badges still receive messages");
        assert!(!incoming(Some(&old), &new, true, true, 0), "own messages never ring");
        assert!(incoming(None, &new, true, false, 0), "newly discovered unread thread rings");
        assert!(!incoming(None, &new, true, false, 86400), "virtualized historical rows never ring");
        assert!(!incoming(None, &new, true, false, -1), "unknown-age new rows are baselined");
        assert!(!incoming(Some(&old), &new, false, false, 0), "initial snapshot is history");
        assert!(!incoming(Some(&old), &old, true, false, 0), "unchanged rows never ring");
        assert!(!incoming(Some(&old), &Chat { unread: 0, ..new.clone() }, true, false, 0));
        assert!(!incoming(Some(&old), &Chat { unread: 5, ..new }, true, false, 0), "reading messages must not ring");
    }

    #[test]
    fn provider_shortcuts_are_bounded_and_keep_editing_context() {
        let mut key = Shortcut { key: "w".into(), meta_key: true, ctrl_key: false, shift_key: false, alt_key: false, in_field: true };
        assert!(key.allowed());
        key.key = "c".into();
        assert!(!key.allowed(), "copy stays in the provider");
        key.key = "Backspace".into();
        assert!(!key.allowed(), "deleting a word must not remove an account");
        key.in_field = false;
        assert!(key.allowed());
        key.key = "2".into();
        assert!(key.allowed());
        key.meta_key = false;
        assert!(!key.allowed(), "plain typing never becomes a command");
        key.ctrl_key = true;
        key.key = "Tab".into();
        assert!(key.allowed());
        key.alt_key = true;
        assert!(!key.allowed());
    }

    #[test]
    fn counts_from_titles() {
        assert_eq!(title_count("(3) Messenger"), 3);
        assert_eq!(title_count("(99+) Zalo"), 99);
        assert_eq!(title_count("Messenger"), 0);
        assert_ne!(store_id("messenger-1"), store_id("messenger-2"));
        assert_eq!(percent_decode("%7B%22a%22%3A1%7D"), r#"{"a":1}"#);
        assert_eq!(percent_decode("%E1%BA%A3%"), "ả%");
        assert_eq!(percent_decode("%ả%"), "%ả%");
    }
}
