//! Messenger and Zalo have no public API for personal accounts, so each runs as its own
//! web app in a child webview laid over the conversation area. ChatMin only creates,
//! positions, shows and hides it, and reads the unread count from the page title.
//! Every account gets its own WKWebsiteDataStore, so logins persist and never mix.
use crate::model::{Account, Chat};
use crate::{now_ms, Core};
use std::hash::{Hash, Hasher};
use std::sync::Arc;
#[cfg(desktop)]
use tauri::webview::NewWindowResponse;
#[cfg(desktop)]
use tauri::{LogicalPosition, LogicalSize, Manager, WebviewBuilder, WebviewUrl};

/// platform → (display name, start URL)
pub fn site(platform: &str) -> Option<(&'static str, &'static str)> {
    match platform {
        "messenger" => Some(("Messenger", "https://www.messenger.com/")),
        "zalo" => Some(("Zalo", "https://chat.zalo.me/")),
        _ => None,
    }
}

/// Both sites serve their full web app to desktop Safari; WKWebView's default UA gets a
/// reduced or "unsupported browser" page.
const UA: &str = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15";

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

/// Shows the account's web app at the given logical rect, creating it on first use.
#[cfg(desktop)]
pub fn show(core: &Arc<Core>, a: &Account, x: f64, y: f64, w: f64, h: f64) -> Result<(), String> {
    let (pos, size) = (LogicalPosition::new(x, y), LogicalSize::new(w.max(1.0), h.max(1.0)));
    if let Some(wv) = core.app.get_webview(&label(&a.id)) {
        wv.set_position(pos).map_err(|e| e.to_string())?;
        wv.set_size(size).map_err(|e| e.to_string())?;
        return wv.show().map_err(|e| e.to_string());
    }
    let (_, url) = site(&a.platform).ok_or("Nền tảng không hỗ trợ")?;
    let window = core.app.get_window("main").ok_or("Không thấy cửa sổ chính")?;
    let (c, id) = (core.clone(), a.id.clone());
    let builder = WebviewBuilder::new(label(&a.id), WebviewUrl::External(url.parse().map_err(|e| format!("{e}"))?))
        .user_agent(UA)
        .data_store_identifier(store_id(&a.id))
        .on_document_title_changed(move |_, title| c.web_unread(&id, title_count(&title)))
        // links that want a new window belong in the browser
        .on_new_window(|url, _| {
            let _ = tauri_plugin_opener::open_url(url.as_str(), None::<&str>);
            NewWindowResponse::Deny
        });
    window.add_child(builder, pos, size).map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(desktop)]
pub fn hide(core: &Core, account_id: &str) {
    if let Some(wv) = core.app.get_webview(&label(account_id)) {
        let _ = wv.hide();
    }
}

#[cfg(desktop)]
pub fn close(core: &Core, account_id: &str) {
    if let Some(wv) = core.app.get_webview(&label(account_id)) {
        let _ = wv.close();
    }
}

#[cfg(desktop)]
pub fn reload(core: &Core, account_id: &str) {
    if let Some(wv) = core.app.get_webview(&label(account_id)) {
        let _ = wv.reload();
    }
}

// ponytail: child webviews are desktop-only in Tauri; on a phone the row just explains itself
#[cfg(mobile)]
pub fn show(_core: &Arc<Core>, _a: &Account, _x: f64, _y: f64, _w: f64, _h: f64) -> Result<(), String> {
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
    fn counts_from_titles() {
        assert_eq!(title_count("(3) Messenger"), 3);
        assert_eq!(title_count("(99+) Zalo"), 99);
        assert_eq!(title_count("Messenger"), 0);
        assert_ne!(store_id("messenger-1"), store_id("messenger-2"));
    }
}
