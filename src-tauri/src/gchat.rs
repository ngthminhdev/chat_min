//! Google Chat through the REST API with user OAuth (Workspace accounts only).
//! Realtime is polling: `spaces.list` every ~1s tells which spaces moved
//! (`lastActiveTime`), and only those get their new messages fetched; the open space is
//! also read directly, alongside. Workspace Events needs Pub/Sub + a public endpoint — no fit for a
//! desktop app.
use crate::model::{Account, Chat, Event, Media, Member, Msg, Reaction};
use crate::{now_ms, Core};
#[cfg(not(target_os = "android"))]
use base64::Engine;
use reqwest::{Method, StatusCode};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex};
use std::time::Duration;
#[cfg(not(target_os = "android"))]
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::sync::Notify;

const API: &str = "https://chat.googleapis.com/v1";
#[cfg(not(target_os = "android"))]
const SCOPES: &str = "openid email profile \
    https://www.googleapis.com/auth/chat.spaces.readonly \
    https://www.googleapis.com/auth/chat.messages \
    https://www.googleapis.com/auth/chat.memberships.readonly \
    https://www.googleapis.com/auth/chat.users.readstate \
    https://www.googleapis.com/auth/directory.readonly";

#[derive(Default)]
pub struct GChat {
    http: reqwest::Client,
    accs: Mutex<HashMap<String, Acc>>,
    cancel_login: Notify,
    #[cfg(target_os = "android")]
    token_refresh: tokio::sync::Mutex<()>,
    #[cfg(target_os = "android")]
    login_cancellation: crate::google_android::LoginCancellation,
}

#[derive(Default, Clone)]
struct Acc {
    me: String,
    #[cfg(not(target_os = "android"))]
    refresh_token: String,
    access_token: String,
    expires_at: i64,
    /// space name → lastActiveTime we have already caught up with
    seen: HashMap<String, String>,
    /// space name → our lastReadTime (ms)
    read: HashMap<String, i64>,
    focus: Option<String>,
    stopped: bool,
    running: bool,
    /// users/X → avatar URL ("" = looked up, none); Chat API has no avatars, People API does
    photos: HashMap<String, String>,
    /// People API disabled in the Cloud project or scope missing: stop asking
    people_off: bool,
}

/// What can go wrong talking to Google, already mapped to account health.
#[derive(Debug, Clone)]
pub enum ApiErr {
    Offline,
    Expired,
    Rate,
    Other(String),
}
impl From<ApiErr> for String {
    fn from(e: ApiErr) -> String {
        match e {
            ApiErr::Offline => "Không có kết nối tới Google".into(),
            ApiErr::Expired => "Phiên Google hết hạn — đăng nhập lại".into(),
            ApiErr::Rate => "Google giới hạn tốc độ — thử lại sau".into(),
            ApiErr::Other(m) => m,
        }
    }
}
type R<T> = Result<T, ApiErr>;

impl GChat {
    // ── auth ────────────────────────────────────────────────────────────────
    /// Loopback OAuth: open the consent page, wait for Google to redirect back with a code.
    #[cfg(not(target_os = "android"))]
    pub async fn login(&self, core: &Arc<Core>) -> Result<Account, String> {
        let (client_id, client_secret) = core.gchat_client().ok_or("Chưa cấu hình OAuth client Google")?;
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.map_err(|e| e.to_string())?;
        let redirect = format!("http://127.0.0.1:{}", listener.local_addr().unwrap().port());
        let state = format!("{:x}", now_ms() ^ 0x5eed_c0de);
        let url = reqwest::Url::parse_with_params(
            "https://accounts.google.com/o/oauth2/v2/auth",
            &[
                ("client_id", client_id.as_str()),
                ("redirect_uri", &redirect),
                ("response_type", "code"),
                ("scope", SCOPES),
                ("access_type", "offline"),
                ("prompt", "consent"),
                ("state", &state),
            ],
        )
        .unwrap();
        open_browser(url.as_str());

        let wait = async {
            loop {
                let (mut sock, _) = listener.accept().await.map_err(|e| e.to_string())?;
                let mut buf = vec![0u8; 8192];
                let n = sock.read(&mut buf).await.unwrap_or(0);
                let req = String::from_utf8_lossy(&buf[..n]).to_string();
                let path = req.split_whitespace().nth(1).unwrap_or("/").to_string();
                let q = reqwest::Url::parse(&format!("http://x{path}")).unwrap();
                let get = |k: &str| q.query_pairs().find(|(n, _)| n == k).map(|(_, v)| v.to_string());
                if get("code").is_none() && get("error").is_none() {
                    let _ = sock.write_all(b"HTTP/1.1 204 No Content\r\n\r\n").await;
                    continue;
                }
                let ok = get("code").is_some() && get("state").as_deref() == Some(state.as_str());
                let page = if ok { "Đăng nhập xong. Quay lại ChatMin." } else { "Đăng nhập không thành công. Quay lại ChatMin." };
                let html = format!(
                    "<!doctype html><meta charset=utf-8><title>ChatMin</title><body style=\"font:15px -apple-system;background:#1c2433;color:#e8ecf5;display:grid;place-items:center;height:90vh\">{page}</body>"
                );
                let _ = sock
                    .write_all(format!("HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\n\r\n{html}", html.len()).as_bytes())
                    .await;
                return match (get("code"), get("error")) {
                    (Some(code), _) if ok => Ok(code),
                    (_, Some(e)) if e == "access_denied" => Err("Google đã từ chối quyền truy cập".to_string()),
                    (_, Some(e)) => Err(format!("Google trả lỗi: {e}")),
                    _ => Err("Phản hồi OAuth không hợp lệ".to_string()),
                };
            }
        };
        let code = tokio::select! {
            r = wait => r?,
            _ = self.cancel_login.notified() => return Err("cancelled".into()),
            _ = tokio::time::sleep(Duration::from_secs(600)) => return Err("Hết thời gian chờ đăng nhập".into()),
        };

        let tok: Value = self
            .http
            .post("https://oauth2.googleapis.com/token")
            .form(&[
                ("code", code.as_str()),
                ("client_id", &client_id),
                ("client_secret", &client_secret),
                ("redirect_uri", &redirect),
                ("grant_type", "authorization_code"),
            ])
            .send()
            .await
            .map_err(|e| e.to_string())?
            .json()
            .await
            .map_err(|e| e.to_string())?;
        if let Some(e) = tok["error_description"].as_str().or(tok["error"].as_str()) {
            return Err(e.to_string());
        }
        let refresh = tok["refresh_token"].as_str().ok_or("Google không trả refresh token")?.to_string();
        let claims = jwt_claims(tok["id_token"].as_str().unwrap_or(""));
        let sub = claims["sub"].as_str().ok_or("Thiếu id_token")?.to_string();
        let email = claims["email"].as_str().unwrap_or("").to_string();
        let account = Account {
            id: format!("gc-{sub}"),
            platform: "gchat".into(),
            name: "Google Chat".into(),
            color: "purple".into(),
            handle: email,
            self_id: format!("users/{sub}"),
        };
        save_token(core, &account.id, &refresh).map_err(|e| e.to_string())?;
        core.add_account(account.clone())?;
        {
            let mut accs = self.accs.lock().unwrap();
            let acc = accs.entry(account.id.clone()).or_default();
            acc.me = account.self_id.clone();
            acc.refresh_token = refresh;
            acc.access_token = tok["access_token"].as_str().unwrap_or("").into();
            acc.expires_at = now_ms() + tok["expires_in"].as_i64().unwrap_or(0) * 1000 - 60_000;
        }
        Ok(account)
    }

    /// On-device authorization: Google Play services handles account selection and consent.
    #[cfg(target_os = "android")]
    pub async fn login(&self, core: &Arc<Core>) -> Result<Account, String> {
        use tauri::Manager;
        // Register once before dispatching native auth; reuse this future through
        // UserInfo so notify_waiters cannot be lost between the two phases.
        let cancelled = self.cancel_login.notified();
        tokio::pin!(cancelled);
        cancelled.as_mut().enable();
        let attempt = self.login_cancellation.begin();
        let google = core.app.state::<crate::google_android::GoogleAuth>();
        let authorization = google.authorize(true, None, None);
        tokio::pin!(authorization);
        // Dispatch once before selecting cancellation. A cancelled, never-polled
        // native future must not be drained by accidentally starting a fresh login.
        let immediate = futures::poll!(authorization.as_mut());
        let result = match immediate {
            std::task::Poll::Ready(result) => result,
            std::task::Poll::Pending => tokio::select! {
                biased;
                _ = &mut cancelled => {
                    google.cancel().await;
                    // Tauri's native response callback must retain a live receiver.
                    let _ = authorization.await;
                    return Err("cancelled".into());
                }
                result = &mut authorization => result,
            },
        };
        let token = result.map_err(crate::google_android::login_error)?.access_token;
        let identity = {
            let identity = self.android_identity(&token);
            tokio::pin!(identity);
            tokio::select! {
                biased;
                _ = &mut cancelled => return Err("cancelled".into()),
                result = &mut identity => result,
            }
        };
        if matches!(identity, Err(ApiErr::Expired)) { google.invalidate(&token).await; }
        let account = identity.map_err(String::from)?;
        self.login_cancellation.commit(attempt, || {
            core.add_account(account.clone())?;
            let mut accs = self.accs.lock().unwrap();
            let acc = accs.entry(account.id.clone()).or_default();
            acc.me = account.self_id.clone();
            acc.access_token = token;
            // The native result has no expiry field. Refresh conservatively, and clear
            // the Google SDK token cache before renewing or after a rejected token.
            acc.expires_at = now_ms() + 45 * 60_000;
            Ok(())
        })?;
        Ok(account)
    }

    #[cfg(target_os = "android")]
    async fn android_identity(&self, token: &str) -> R<Account> {
        let response = self.http.get("https://www.googleapis.com/oauth2/v3/userinfo")
            .bearer_auth(token).timeout(Duration::from_secs(30)).send().await
            .map_err(|_| ApiErr::Offline)?;
        if matches!(response.status(), StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN) {
            return Err(ApiErr::Expired);
        }
        if !response.status().is_success() {
            return Err(ApiErr::Other("Google chưa cho phép đọc thông tin tài khoản".into()));
        }
        let info: Value = response.json().await.map_err(|_| ApiErr::Other("Thông tin tài khoản Google không hợp lệ".into()))?;
        crate::google_android::account_from_userinfo(&info).map_err(ApiErr::Other)
    }

    pub fn cancel_login(&self) {
        #[cfg(target_os = "android")]
        self.login_cancellation.cancel();
        self.cancel_login.notify_waiters();
    }

    /// Starts polling for a saved account (app start, or right after login).
    pub fn start(core: Arc<Core>, account: Account, first_sync: bool) {
        {
            let mut accs = core.gchat.accs.lock().unwrap();
            let acc = accs.entry(account.id.clone()).or_default();
            acc.me = account.self_id.clone();
            acc.stopped = false;
            #[cfg(not(target_os = "android"))]
            if acc.refresh_token.is_empty() {
                acc.refresh_token = load_token(&core, &account.id).unwrap_or_default();
            }
            if acc.running {
                return; // re-login of a live account: the poller picks up the new token
            }
            acc.running = true;
        }
        tauri::async_runtime::spawn(async move {
            core.gchat.run(&core, &account.id, first_sync).await;
            if let Some(a) = core.gchat.accs.lock().unwrap().get_mut(&account.id) {
                a.running = false;
            }
        });
    }

    pub fn stop(&self, core: &Core, account_id: &str) {
        if let Some(a) = self.accs.lock().unwrap().get_mut(account_id) {
            a.stopped = true;
        }
        let _ = std::fs::remove_file(token_path(core, account_id));
    }

    pub fn focus(&self, account_id: &str, space: Option<String>) {
        if let Some(a) = self.accs.lock().unwrap().get_mut(account_id) {
            a.focus = space;
        }
    }

    // ── polling ─────────────────────────────────────────────────────────────
    async fn run(&self, core: &Arc<Core>, account_id: &str, first_sync: bool) {
        let sync = |step: usize, state: &str, log: &str| {
            if first_sync {
                core.emit(Event::Sync { account_id: account_id.into(), step, state: state.into(), log: log.into() })
            }
        };
        sync(0, "ok", "[auth] token accepted");
        sync(1, "run", "[chats] listing spaces");
        let mut tick: u64 = 0;
        let mut backoff = 0u64;
        let mut fails = 0u32;
        let mut first = true;
        loop {
            let (stopped, focus) = self.accs.lock().unwrap().get(account_id).map(|a| (a.stopped, a.focus.clone())).unwrap_or((true, None));
            if stopped {
                return;
            }
            let res: R<()> = async {
                // a space scan every tick (~1s + the request): how fast a message anywhere shows
                // up / rings. The open space is read in parallel, so it adds no wait. Around
                // 100 reads a minute in all, far under the 3000/min Chat API project quota
                let scan = self.poll_spaces(core, account_id, first);
                let open = async {
                    match &focus {
                        Some(space) if !first && tick % 2 == 0 => self.fetch_new(core, account_id, space, true).await.map(|_| ()),
                        _ => Ok(()),
                    }
                };
                let t0 = std::time::Instant::now();
                let (n, opened) = futures::future::join(scan, open).await;
                if tick % 60 == 0 {
                    eprintln!("[gchat] scan {}ms", t0.elapsed().as_millis()); // the cadence's other half
                }
                let n = n?;
                opened?;
                if first {
                    sync(1, "ok", &format!("[chats] {n} spaces"));
                    sync(2, "ok", "[sync] recent messages synchronized");
                    first = false;
                }
                if tick % 60 == 30 {
                    self.sync_read(core, account_id).await?;
                }
                if let Some(space) = &focus {
                    // edits, deletions and reactions don't move createTime: re-read the tail now and then
                    if tick % 10 == 5 {
                        self.fetch_tail(core, account_id, space, 20).await?;
                    }
                }
                Ok(())
            }
            .await;
            match res {
                Ok(()) => {
                    if backoff > 0 || fails > 0 || tick == 0 {
                        core.set_health(account_id, "ok", "Đã đồng bộ", 0);
                    }
                    backoff = 0;
                    fails = 0;
                }
                Err(e) => {
                    if first {
                        sync(1, "err", &format!("[chats] {}", String::from(e.clone())));
                    }
                    fails += 1;
                    backoff = (backoff * 2).clamp(5, 120);
                    match e {
                        // Google's transient 500s ("INTERNAL"): retry soon, and only call the
                        // account offline when it keeps happening
                        ApiErr::Other(m) if !first && fails < 3 => {
                            eprintln!("[gchat] transient error, retrying: {m}");
                            backoff = 3;
                        }
                        ApiErr::Offline => core.set_health(account_id, "offline", "Mất kết nối", 0),
                        ApiErr::Expired => {
                            core.set_health(account_id, "expired", "Phiên hết hạn", 0);
                            return;
                        }
                        ApiErr::Rate => core.set_health(account_id, "rate", "Rate limit", now_ms() + backoff as i64 * 1000),
                        ApiErr::Other(m) => core.set_health(account_id, "offline", &m, 0),
                    }
                    tokio::time::sleep(Duration::from_secs(backoff)).await;
                }
            }
            tick += 1;
            tokio::time::sleep(Duration::from_secs(1)).await;
        }
    }

    /// Lists spaces, upserts them, and fetches messages of every space that moved.
    async fn poll_spaces(&self, core: &Arc<Core>, account_id: &str, first: bool) -> R<usize> {
        let mut spaces: Vec<Value> = vec![];
        let mut page = String::new();
        loop {
            let v = self.api(core, account_id, Method::GET, &format!("{API}/spaces?pageSize=1000&pageToken={page}"), None).await?;
            spaces.extend(v["spaces"].as_array().cloned().unwrap_or_default());
            match v["nextPageToken"].as_str() {
                Some(t) if !t.is_empty() => page = t.to_string(),
                _ => break,
            }
        }
        let n = spaces.len();
        // newest first, so the first sync warms the busiest spaces
        spaces.sort_by_key(|s| -rfc3339_ms(s["lastActiveTime"].as_str().unwrap_or("")));
        let alive: HashSet<String> = spaces.iter().filter_map(|s| s["name"].as_str().map(String::from)).collect();
        let mut moved: Vec<(String, String, bool)> = vec![];
        for (i, s) in spaces.iter().enumerate() {
            let name = s["name"].as_str().unwrap_or_default().to_string();
            let active = s["lastActiveTime"].as_str().unwrap_or_default().to_string();
            let seen = self.accs.lock().unwrap().get(account_id).and_then(|a| a.seen.get(&name).cloned());
            let existing = core.store().chat(account_id, &name).ok().flatten();
            core.put_chat(space_chat(account_id, s, existing.as_ref()));
            let untitled = existing.as_ref().is_some_and(|c| c.kind != "space" && c.title.is_empty());
            // on the first scan after launch, compare with the newest message we hold — not
            // chat.last_ts, which follows lastActiveTime even when nothing was fetched — so a
            // space that moved while the app was closed is caught up, wherever it ranks
            let newest = core.store().msgs(account_id, &name, 0, 1).ok().and_then(|v| v.into_iter().next()).map_or(0, |m| m.ts);
            let caught_up = existing.is_some() && (rfc3339_ms(&active) <= newest || (newest == 0 && i >= 25));
            if !untitled && (seen.as_deref() == Some(active.as_str()) || (first && caught_up)) {
                // untouched since last time, or a cold never-opened space on first run: leave for later
                self.mark_seen(account_id, &name, &active);
                continue;
            }
            // first scan rings too: notify.rs drops anything older than a few minutes
            moved.push((name, active, seen.is_some() || first));
        }
        // ponytail: 8 spaces in flight keeps the first sync of ~100 spaces under a minute
        // without tripping Chat API per-user quotas
        for chunk in moved.chunks(8) {
            let jobs = chunk.iter().map(|(name, active, known)| async move {
                let complete = self.fetch_new(core, account_id, name, *known).await?;
                let chat = core.store().chat(account_id, name).ok().flatten();
                if let Some(mut chat) = chat.filter(|c| c.kind != "space" && c.title.is_empty()) {
                    if let Ok(t) = self.dm_title(core, account_id, name).await {
                        // Google returns no name for deleted / outside-the-org users
                        chat.title = if t.is_empty() { "Người dùng không xác định".into() } else { t };
                        core.put_chat(chat);
                    }
                }
                if complete {
                    self.mark_seen(account_id, name, active);
                }
                Ok::<(), ApiErr>(())
            });
            for r in futures::future::join_all(jobs).await {
                match r {
                    // a 500 on one space mustn't stall every other space: it stays unseen
                    // and is retried on the next scan
                    Err(ApiErr::Other(e)) => eprintln!("[gchat] space skipped this scan: {e}"),
                    r => r?,
                }
            }
        }
        let known = core.store().chats().unwrap_or_default();
        for c in known {
            if c.account_id == account_id && !alive.contains(&c.id) {
                core.remove_chat(account_id, &c.id);
            }
        }
        Ok(n)
    }

    /// Reading on the phone or the web doesn't move lastActiveTime, so a space's unread
    /// count would stick here: re-read the read state of the spaces that still show unread.
    async fn sync_read(&self, core: &Arc<Core>, account_id: &str) -> R<()> {
        let unread: Vec<String> = core.store().chats().unwrap_or_default().into_iter().filter(|c| c.account_id == account_id && c.unread > 0).map(|c| c.id).collect();
        for space in unread {
            if let Some(a) = self.accs.lock().unwrap().get_mut(account_id) {
                a.read.remove(&space);
            }
            self.refresh_chat(core, account_id, &space).await?;
        }
        Ok(())
    }

    fn mark_seen(&self, account_id: &str, space: &str, active: &str) {
        if let Some(a) = self.accs.lock().unwrap().get_mut(account_id) {
            a.seen.insert(space.into(), active.into());
        }
    }

    /// Messages newer than the newest cached one (or the last 30 for a cold space). Follows
    /// pages so a burst of more than one page isn't cut off: the space is marked seen after.
    /// Returns false when the backlog didn't fit: the caller leaves the space unseen so the
    /// next scan carries on from the newest message saved now.
    async fn fetch_new(&self, core: &Arc<Core>, account_id: &str, space: &str, notify: bool) -> R<bool> {
        let newest = core.store().msgs(account_id, space, 0, 1).ok().and_then(|v| v.into_iter().next());
        let url = match &newest {
            Some(m) => format!(
                "{API}/{space}/messages?pageSize=100&orderBy=createTime%20asc&showDeleted=true&filter={}",
                enc(&format!("createTime > \"{}\"", ms_rfc3339(m.ts)))
            ),
            None => format!("{API}/{space}/messages?pageSize=30&orderBy=createTime%20desc&showDeleted=true"),
        };
        let me = self.me(account_id);
        let mut raw: Vec<Value> = vec![];
        let mut token = String::new();
        // ponytail: 5 pages (500 messages) per scan; a bigger backlog continues next scan
        let mut complete = true;
        for i in 0..5 {
            let page_url = if token.is_empty() { url.clone() } else { format!("{url}&pageToken={token}") };
            let v = self.api(core, account_id, Method::GET, &page_url, None).await?;
            raw.extend(v["messages"].as_array().cloned().unwrap_or_default());
            match v["nextPageToken"].as_str() {
                Some(t) if !t.is_empty() && newest.is_some() => {
                    token = t.to_string();
                    complete = i < 4;
                }
                _ => break,
            }
        }
        let mut msgs: Vec<Msg> = raw.iter().map(|m| to_msg(account_id, &me, m)).collect();
        self.fill_photos(core, account_id, &mut msgs, true).await;
        if !msgs.is_empty() {
            let fresh = newest.is_some() && notify;
            for m in &msgs {
                core.put_msg(m.clone(), fresh && !m.outgoing);
            }
        }
        self.refresh_chat(core, account_id, space).await?;
        Ok(complete)
    }

    async fn fetch_tail(&self, core: &Arc<Core>, account_id: &str, space: &str, n: usize) -> R<()> {
        let url = format!("{API}/{space}/messages?pageSize={n}&orderBy=createTime%20desc&showDeleted=true");
        let v = self.api(core, account_id, Method::GET, &url, None).await?;
        let me = self.me(account_id);
        let mut msgs: Vec<Msg> = v["messages"].as_array().cloned().unwrap_or_default().iter().map(|m| to_msg(account_id, &me, m)).collect();
        self.fill_photos(core, account_id, &mut msgs, true).await;
        for msg in msgs {
            let old = core.store().msg(account_id, space, &msg.id).ok().flatten();
            if old.as_ref() != Some(&msg) {
                core.put_msg(msg, false);
            }
        }
        Ok(())
    }

    /// Recomputes preview, unread and mention from the cache and the server read state.
    async fn refresh_chat(&self, core: &Arc<Core>, account_id: &str, space: &str) -> R<()> {
        let Some(mut chat) = core.store().chat(account_id, space).ok().flatten() else { return Ok(()) };
        let known = self.accs.lock().unwrap().get(account_id).and_then(|a| a.read.get(space).copied());
        let read = match known {
            Some(r) => r,
            None => {
                // without the readstate scope (or on a 403) treat what we already have as read
                let r = match self.api(core, account_id, Method::GET, &format!("{API}/users/me/{space}/spaceReadState"), None).await {
                    Ok(v) => rfc3339_ms(v["lastReadTime"].as_str().unwrap_or("")),
                    Err(ApiErr::Other(_)) => chat.last_ts,
                    Err(e) => return Err(e),
                };
                if let Some(a) = self.accs.lock().unwrap().get_mut(account_id) {
                    a.read.insert(space.into(), r);
                }
                r
            }
        };
        let recent = core.store().msgs(account_id, space, 0, 200).unwrap_or_default();
        let unread: Vec<&Msg> = recent.iter().filter(|m| !m.outgoing && !m.deleted && m.ts > read).collect();
        chat.unread = unread.len() as i32;
        chat.mention = unread.iter().any(|m| m.mentions_me);
        if let Some(last) = recent.iter().rev().find(|m| !m.deleted) {
            chat.preview = crate::tg::plain(&last.text, last.media.as_ref());
            chat.preview_from = if last.outgoing { "Bạn".into() } else { last.sender_name.split_whitespace().next().unwrap_or("").into() };
            chat.last_ts = chat.last_ts.max(last.ts);
            chat.order = chat.last_ts;
            if chat.kind == "dm" {
                if let Some(other) = recent.iter().find(|m| !m.outgoing && !m.sender_name.is_empty()) {
                    if chat.title.is_empty() {
                        chat.title = other.sender_name.clone();
                    }
                    if chat.photo.is_empty() {
                        chat.photo = other.sender_photo.clone();
                    }
                }
            }
        }
        core.put_chat(chat);
        Ok(())
    }

    /// DMs and unnamed group chats have no displayName: name them after the other members
    /// (membership display names are often empty under user auth, so ask the People API).
    async fn dm_title(&self, core: &Arc<Core>, account_id: &str, space: &str) -> R<String> {
        let v = self.api(core, account_id, Method::GET, &format!("{API}/{space}/members?pageSize=20"), None).await?;
        let me = self.me(account_id);
        let others: Vec<(String, String)> = v["memberships"]
            .as_array()
            .into_iter()
            .flatten()
            .filter(|m| m["member"]["name"].as_str() != Some(me.as_str()) && m["member"]["type"].as_str() != Some("BOT"))
            .map(|m| (m["member"]["name"].as_str().unwrap_or("").to_string(), m["member"]["displayName"].as_str().unwrap_or("").to_string()))
            .collect();
        let mut names: Vec<String> = others.iter().filter(|(_, n)| !n.is_empty()).map(|(_, n)| n.clone()).collect();
        let unnamed: Vec<&str> = others.iter().filter(|(id, n)| n.is_empty() && id.starts_with("users/")).map(|(id, _)| &id[6..]).collect();
        if !unnamed.is_empty() {
            let q: String = unnamed.iter().take(10).map(|id| format!("&resourceNames=people/{id}")).collect();
            if let Ok(p) = self.api(core, account_id, Method::GET, &format!("https://people.googleapis.com/v1/people:batchGet?personFields=names{q}"), None).await {
                for r in p["responses"].as_array().into_iter().flatten() {
                    if let Some(n) = r["person"]["names"][0]["displayName"].as_str() {
                        names.push(n.to_string());
                    }
                }
            }
        }
        let shown: Vec<String> = names.iter().take(3).cloned().collect();
        Ok(match names.len() {
            0 => String::new(),
            n if n > 3 => format!("{} +{}", shown.join(", "), n - 3),
            _ => shown.join(", "),
        })
    }

    /// Avatars from the People API (directory of the user's Workspace), cached per user.
    async fn fill_photos(&self, core: &Arc<Core>, account_id: &str, msgs: &mut [Msg], net: bool) {
        let (off, missing): (bool, Vec<String>) = {
            let accs = self.accs.lock().unwrap();
            let Some(a) = accs.get(account_id) else { return };
            let mut ids: Vec<String> = msgs.iter().map(|m| m.sender_id.clone()).filter(|id| id.starts_with("users/") && !a.photos.contains_key(id)).collect();
            ids.sort();
            ids.dedup();
            (a.people_off, ids)
        };
        if net && !off && !missing.is_empty() {
            let mut url = "https://people.googleapis.com/v1/people:batchGet?personFields=photos".to_string();
            for id in missing.iter().take(200) {
                url.push_str(&format!("&resourceNames=people/{}", &id[6..]));
            }
            match self.api(core, account_id, Method::GET, &url, None).await {
                Ok(v) => {
                    let mut accs = self.accs.lock().unwrap();
                    if let Some(a) = accs.get_mut(account_id) {
                        for id in &missing {
                            a.photos.entry(id.clone()).or_default();
                        }
                        for r in v["responses"].as_array().into_iter().flatten() {
                            let id = r["requestedResourceName"].as_str().unwrap_or("").replacen("people/", "users/", 1);
                            let photo = r["person"]["photos"].as_array().into_iter().flatten().find(|p| p["default"].as_bool() != Some(true)).and_then(|p| p["url"].as_str());
                            if let Some(url) = photo {
                                a.photos.insert(id, url.to_string());
                            }
                        }
                    }
                }
                Err(ApiErr::Other(e)) => {
                    eprintln!("[gchat] People API unavailable, avatars fall back to initials: {e}");
                    if let Some(a) = self.accs.lock().unwrap().get_mut(account_id) {
                        a.people_off = true;
                    }
                }
                Err(_) => {}
            }
        }
        let accs = self.accs.lock().unwrap();
        if let Some(a) = accs.get(account_id) {
            for m in msgs.iter_mut() {
                m.sender_photo = a.photos.get(&m.sender_id).cloned().unwrap_or_default();
            }
        }
    }

    // ── reads ───────────────────────────────────────────────────────────────
    pub async fn history(&self, core: &Arc<Core>, account_id: &str, space: &str, before: i64, limit: i32) -> Result<Vec<Msg>, String> {
        let mut url = format!("{API}/{space}/messages?pageSize={limit}&orderBy=createTime%20desc&showDeleted=true");
        if before > 0 {
            url.push_str(&format!("&filter={}", enc(&format!("createTime < \"{}\"", ms_rfc3339(before)))));
        }
        let v = self.api(core, account_id, Method::GET, &url, None).await?;
        let me = self.me(account_id);
        let mut msgs: Vec<Msg> = v["messages"].as_array().cloned().unwrap_or_default().iter().map(|m| to_msg(account_id, &me, m)).collect();
        msgs.reverse();
        self.fill_quotes(core, account_id, space, &mut msgs, false).await;
        self.fill_photos(core, account_id, &mut msgs, false).await;
        core.store_mut().put_msgs(&msgs)?;
        self.enrich_later(core, account_id, space, msgs.clone(), before == 0);
        Ok(msgs)
    }

    /// Quotes of messages outside the cache, avatars and the read state each cost another
    /// request: the page goes back first, these land afterwards as message updates.
    fn enrich_later(&self, core: &Arc<Core>, account_id: &str, space: &str, msgs: Vec<Msg>, refresh: bool) {
        let (core, account_id, space) = (core.clone(), account_id.to_string(), space.to_string());
        tauri::async_runtime::spawn(async move {
            let g = &core.gchat;
            let mut full = msgs.clone();
            g.fill_quotes(&core, &account_id, &space, &mut full, true).await;
            g.fill_photos(&core, &account_id, &mut full, true).await;
            let changed: Vec<Msg> = full.into_iter().zip(&msgs).filter(|(a, b)| a != *b).map(|(a, _)| a).collect();
            if !changed.is_empty() {
                let _ = core.store_mut().put_msgs(&changed);
                for msg in changed {
                    core.emit(Event::Message { msg, is_new: false, inbox: false });
                }
            }
            if refresh {
                let _ = g.refresh_chat(&core, &account_id, &space).await;
            }
        });
    }

    pub async fn thread(&self, core: &Arc<Core>, account_id: &str, space: &str, thread: &str) -> Result<Vec<Msg>, String> {
        let url = format!(
            "{API}/{space}/messages?pageSize=200&orderBy=createTime%20asc&filter={}",
            enc(&format!("thread.name = \"{thread}\""))
        );
        let v = self.api(core, account_id, Method::GET, &url, None).await?;
        let me = self.me(account_id);
        let mut msgs: Vec<Msg> = v["messages"].as_array().cloned().unwrap_or_default().iter().map(|m| to_msg(account_id, &me, m)).collect();
        self.fill_quotes(core, account_id, space, &mut msgs, false).await;
        self.fill_photos(core, account_id, &mut msgs, false).await;
        core.store_mut().put_msgs(&msgs)?;
        self.enrich_later(core, account_id, space, msgs.clone(), false);
        Ok(msgs)
    }

    async fn fill_quotes(&self, core: &Arc<Core>, account_id: &str, space: &str, msgs: &mut [Msg], net: bool) {
        let mut originals: HashMap<String, Msg> = msgs.iter().map(|m| (m.id.clone(), m.clone())).collect();
        let mut missing = HashSet::new();
        for m in msgs.iter().filter(|m| !m.reply_to.is_empty() && (m.reply_name.is_empty() || m.reply_text.is_empty())) {
            if originals.contains_key(&m.reply_to) { continue; }
            if let Ok(Some(q)) = core.store().msg(account_id, space, &m.reply_to) {
                originals.insert(q.id.clone(), q);
            } else if m.reply_to.starts_with(&format!("{space}/messages/")) {
                missing.insert(m.reply_to.clone());
            }
        }
        // Bound extra requests for old quotes and don't fail the conversation if a quoted message was deleted.
        let missing: Vec<_> = if net { missing.into_iter().take(8).collect() } else { vec![] };
        for chunk in missing.chunks(4) {
            let results = futures::future::join_all(chunk.iter().map(|id| async move {
                self.api(core, account_id, Method::GET, &format!("{API}/{id}"), None).await.ok()
            })).await;
            for v in results.into_iter().flatten() {
                let q = to_msg(account_id, &self.me(account_id), &v);
                let _ = core.store().put_msg(&q);
                originals.insert(q.id.clone(), q);
            }
        }
        for m in msgs.iter_mut() {
            if let Some(q) = originals.get(&m.reply_to) {
                if m.reply_name.is_empty() { m.reply_name = if q.outgoing { "Bạn".into() } else { q.sender_name.clone() }; }
                if m.reply_text.is_empty() { m.reply_text = if q.text.is_empty() { q.media.as_ref().map(|a| a.name.clone()).unwrap_or_default() } else { q.text.clone() }; }
            }
        }
    }

    pub async fn members(&self, core: &Arc<Core>, account_id: &str, space: &str) -> Result<Vec<Member>, String> {
        let v = self.api(core, account_id, Method::GET, &format!("{API}/{space}/members?pageSize=100"), None).await?;
        let me = self.me(account_id);
        // user-auth membership lists often omit display names; fill from senders we have seen
        let names: HashMap<String, String> = core
            .store()
            .msgs(account_id, space, 0, 500)
            .unwrap_or_default()
            .into_iter()
            .map(|m| (m.sender_id, m.sender_name))
            .collect();
        Ok(v["memberships"]
            .as_array()
            .into_iter()
            .flatten()
            .filter(|m| m["member"]["type"].as_str() != Some("BOT"))
            .map(|m| {
                let id = m["member"]["name"].as_str().unwrap_or_default().to_string();
                let name = m["member"]["displayName"]
                    .as_str()
                    .filter(|s| !s.is_empty())
                    .map(String::from)
                    .or_else(|| names.get(&id).cloned())
                    .unwrap_or_else(|| if id == me { "Bạn".into() } else { "Thành viên".into() });
                let role = if m["role"].as_str() == Some("ROLE_MANAGER") { "Manager" } else { "" };
                Member { id, name, status: String::new(), role: role.into() }
            })
            .collect())
    }

    pub async fn download(&self, core: &Arc<Core>, account_id: &str, resource: &str, name: &str) -> Result<String, String> {
        let dir = core.cache_dir.join("gchat");
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        let safe: String = name.chars().map(|c| if c.is_alphanumeric() || ".-_".contains(c) { c } else { '_' }).collect();
        let path = dir.join(format!("{:x}-{safe}", hash(resource)));
        if path.exists() {
            return Ok(path.to_string_lossy().into());
        }
        let token = self.token(core, account_id).await?;
        let resp = self
            .http
            .get(format!("{API}/media/{resource}?alt=media"))
            .bearer_auth(token)
            .send()
            .await
            .map_err(|e| e.to_string())?;
        if !resp.status().is_success() {
            return Err(format!("Tải file lỗi ({})", resp.status()));
        }
        // stream to a temp file, reporting progress the way Telegram downloads do
        let total = resp.content_length().unwrap_or(0) as i64;
        let tmp = path.with_extension("part");
        let mut out = std::fs::File::create(&tmp).map_err(|e| e.to_string())?;
        let (mut got, mut last) = (0i64, -1i64);
        let mut resp = resp;
        while let Some(chunk) = resp.chunk().await.map_err(|e| e.to_string())? {
            std::io::Write::write_all(&mut out, &chunk).map_err(|e| e.to_string())?;
            got += chunk.len() as i64;
            if total > 300_000 && got * 100 / total != last {
                last = got * 100 / total;
                core.emit(Event::FileProgress { account_id: account_id.into(), file_ref: resource.into(), pct: last });
            }
        }
        drop(out);
        std::fs::rename(&tmp, &path).map_err(|e| e.to_string())?;
        Ok(path.to_string_lossy().into())
    }

    // ── writes ──────────────────────────────────────────────────────────────
    pub async fn send(
        &self,
        core: &Arc<Core>,
        account_id: &str,
        space: &str,
        text: String,
        reply_to: Option<String>,
        thread: Option<String>,
        file: Option<String>,
    ) -> Result<Msg, String> {
        let quoted = match reply_to.filter(|r| !r.is_empty()) {
            Some(r) => Some(core.store().msg(account_id, space, &r)?.ok_or("Tin được trả lời chưa có trong cache. Mở lại hội thoại và thử lại.")?),
            None => None,
        };
        let (url, mut body) = create_message_request(space, &text, thread.as_deref(), quoted.as_ref());
        if let Some(path) = file {
            body["attachment"] = json!([{ "attachmentDataRef": self.upload(core, account_id, space, &path).await? }]);
        }
        let v = self.api(core, account_id, Method::POST, &url, Some(body)).await?;
        let mut msg = to_msg(account_id, &self.me(account_id), &v);
        if let Some(q) = quoted {
            msg.reply_to = q.id;
            msg.reply_name = if q.outgoing { "Bạn".into() } else { q.sender_name };
            msg.reply_text = if q.text.is_empty() { q.media.map(|m| m.name).unwrap_or_default() } else { q.text };
        }
        core.store().put_msg(&msg)?;
        Ok(msg)
    }

    async fn upload(&self, core: &Arc<Core>, account_id: &str, space: &str, path: &str) -> Result<Value, String> {
        let bytes = std::fs::read(path).map_err(|e| e.to_string())?;
        let name = std::path::Path::new(path).file_name().unwrap_or_default().to_string_lossy().to_string();
        let boundary = format!("chatmin{:x}", now_ms());
        let mut body = format!(
            "--{boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n{}\r\n--{boundary}\r\nContent-Type: {}\r\n\r\n",
            json!({ "filename": name }),
            mime_of(&name)
        )
        .into_bytes();
        body.extend_from_slice(&bytes);
        body.extend_from_slice(format!("\r\n--{boundary}--").as_bytes());
        let token = self.token(core, account_id).await?;
        // sent in 256 KB pieces so the pending message can show how far the upload is
        let (total, key, acc, c) = (body.len() as i64, path.to_string(), account_id.to_string(), core.clone());
        let chunks: Vec<Vec<u8>> = body.chunks(256 * 1024).map(<[u8]>::to_vec).collect();
        let mut sent = 0i64;
        let stream = futures::StreamExt::map(futures::stream::iter(chunks), move |chunk: Vec<u8>| {
            sent += chunk.len() as i64;
            if total > 300_000 {
                c.emit(Event::FileProgress { account_id: acc.clone(), file_ref: key.clone(), pct: sent * 100 / total });
            }
            Ok::<_, std::io::Error>(chunk)
        });
        let resp = self
            .http
            .post(format!("https://chat.googleapis.com/upload/v1/{space}/attachments:upload?uploadType=multipart"))
            .bearer_auth(token)
            .header("Content-Type", format!("multipart/related; boundary={boundary}"))
            .header("Content-Length", total)
            .body(reqwest::Body::wrap_stream(stream))
            .send()
            .await
            .map_err(|e| e.to_string())?;
        let v: Value = resp.json().await.map_err(|e| e.to_string())?;
        if let Some(m) = v["error"]["message"].as_str() {
            return Err(m.to_string());
        }
        Ok(v["attachmentDataRef"].clone())
    }

    pub async fn edit(&self, core: &Arc<Core>, account_id: &str, space: &str, name: &str, text: String) -> Result<(), String> {
        let v = self.api(core, account_id, Method::PATCH, &format!("{API}/{name}?updateMask=text"), Some(json!({ "text": text }))).await?;
        core.put_msg(to_msg(account_id, &self.me(account_id), &v), false);
        let _ = space;
        Ok(())
    }

    pub async fn delete(&self, core: &Arc<Core>, account_id: &str, space: &str, name: &str) -> Result<(), String> {
        match self.api(core, account_id, Method::DELETE, &format!("{API}/{name}"), None).await {
            Ok(_) => {}
            // deleted elsewhere already (Google answers PERMISSION_DENIED / NOT_FOUND for a gone
            // message): what's left is our stale copy
            Err(ApiErr::Other(m)) if m.starts_with("PERMISSION_DENIED") || m.starts_with("NOT_FOUND") => {
                let gone = match self.api(core, account_id, Method::GET, &format!("{API}/{name}"), None).await {
                    Ok(v) => !v["deletionMetadata"].is_null(),
                    Err(ApiErr::Other(e)) => e.starts_with("NOT_FOUND"),
                    Err(e) => return Err(e.into()),
                };
                if !gone {
                    return Err(m);
                }
            }
            Err(e) => return Err(e.into()),
        }
        core.delete_msgs(account_id, space, vec![name.into()]);
        Ok(())
    }

    pub async fn react(&self, core: &Arc<Core>, account_id: &str, name: &str, emoji: &str, add: bool) -> Result<(), String> {
        if add {
            let res = self.api(core, account_id, Method::POST, &format!("{API}/{name}/reactions"), Some(json!({ "emoji": { "unicode": emoji } }))).await;
            match res {
                Err(ApiErr::Other(m)) if m.contains("ALREADY_EXISTS") || m.contains("already") => {}
                r => {
                    r?;
                }
            }
        } else {
            let filter = enc(&format!("emoji.unicode = \"{emoji}\" AND user.name = \"{}\"", self.me(account_id)));
            let v = self.api(core, account_id, Method::GET, &format!("{API}/{name}/reactions?filter={filter}"), None).await?;
            for r in v["reactions"].as_array().into_iter().flatten() {
                if let Some(rn) = r["name"].as_str() {
                    self.api(core, account_id, Method::DELETE, &format!("{API}/{rn}"), None).await?;
                }
            }
        }
        Ok(())
    }

    pub async fn mark_read(&self, core: &Arc<Core>, account_id: &str, space: &str) -> Result<(), String> {
        let now = now_ms();
        self.api(
            core,
            account_id,
            Method::PATCH,
            &format!("{API}/users/me/{space}/spaceReadState?updateMask=lastReadTime"),
            Some(json!({ "lastReadTime": ms_rfc3339(now) })),
        )
        .await?;
        if let Some(a) = self.accs.lock().unwrap().get_mut(account_id) {
            a.read.insert(space.into(), now);
        }
        let chat = core.store().chat(account_id, space)?;
        if let Some(mut chat) = chat {
            chat.unread = 0;
            chat.mention = false;
            core.put_chat(chat);
        }
        Ok(())
    }

    // ── http ────────────────────────────────────────────────────────────────
    fn me(&self, account_id: &str) -> String {
        self.accs.lock().unwrap().get(account_id).map(|a| a.me.clone()).unwrap_or_default()
    }

    #[cfg(not(target_os = "android"))]
    async fn token(&self, core: &Arc<Core>, account_id: &str) -> R<String> {
        let (tok, exp, refresh) = self
            .accs
            .lock()
            .unwrap()
            .get(account_id)
            .map(|a| (a.access_token.clone(), a.expires_at, a.refresh_token.clone()))
            .ok_or(ApiErr::Expired)?;
        if !tok.is_empty() && now_ms() < exp {
            return Ok(tok);
        }
        let (client_id, client_secret) = core.gchat_client().ok_or(ApiErr::Other("Chưa cấu hình OAuth client Google".into()))?;
        let resp = self
            .http
            .post("https://oauth2.googleapis.com/token")
            .form(&[
                ("client_id", client_id.as_str()),
                ("client_secret", &client_secret),
                ("refresh_token", &refresh),
                ("grant_type", "refresh_token"),
            ])
            .timeout(Duration::from_secs(30))
            .send()
            .await
            .map_err(|_| ApiErr::Offline)?;
        let status = resp.status();
        let v: Value = resp.json().await.map_err(|_| ApiErr::Offline)?;
        if status == StatusCode::BAD_REQUEST || status == StatusCode::UNAUTHORIZED {
            return Err(ApiErr::Expired);
        }
        let tok = v["access_token"].as_str().ok_or_else(|| ApiErr::Other(v.to_string()))?.to_string();
        if let Some(a) = self.accs.lock().unwrap().get_mut(account_id) {
            a.access_token = tok.clone();
            a.expires_at = now_ms() + v["expires_in"].as_i64().unwrap_or(3600) * 1000 - 60_000;
        }
        Ok(tok)
    }

    #[cfg(target_os = "android")]
    async fn token(&self, core: &Arc<Core>, account_id: &str) -> R<String> {
        use tauri::Manager;
        // A space scan requests many tokens concurrently; one renewal covers the scan.
        let _refresh = self.token_refresh.lock().await;
        let (token, expires, stopped) = self.accs.lock().unwrap().get(account_id)
            .map(|a| (a.access_token.clone(), a.expires_at, a.stopped)).ok_or(ApiErr::Expired)?;
        if stopped { return Err(ApiErr::Expired); }
        if !token.is_empty() && now_ms() < expires { return Ok(token); }
        let account = core.store().accounts().map_err(|_| ApiErr::Expired)?
            .into_iter().find(|a| a.id == account_id).ok_or(ApiErr::Expired)?;
        let google = core.app.state::<crate::google_android::GoogleAuth>();
        let result = google.authorize(false, Some(&account.handle), (!token.is_empty()).then_some(token.as_str())).await
            .map_err(|error| {
                if crate::google_android::is_authorization_required(&error) { ApiErr::Expired }
                else { ApiErr::Other(error.to_string()) }
            })?;
        // Never attach a token for a different Google account to cached chats.
        let identity = self.android_identity(&result.access_token).await;
        if matches!(identity, Err(ApiErr::Expired)) {
            google.invalidate(&result.access_token).await;
        }
        let identity = identity?;
        if identity.id != account_id {
            google.invalidate(&result.access_token).await;
            return Err(ApiErr::Expired);
        }
        let mut accs = self.accs.lock().unwrap();
        let acc = accs.get_mut(account_id).filter(|a| !a.stopped).ok_or(ApiErr::Expired)?;
        acc.access_token = result.access_token.clone();
        acc.expires_at = now_ms() + 45 * 60_000;
        Ok(result.access_token)
    }

    async fn api(&self, core: &Arc<Core>, account_id: &str, method: Method, url: &str, body: Option<Value>) -> R<Value> {
        for attempt in 0..2 {
            let token = self.token(core, account_id).await?;
            let mut req = self.http.request(method.clone(), url).bearer_auth(&token).timeout(Duration::from_secs(30));
            if let Some(b) = &body {
                req = req.json(b);
            }
            let resp = req.send().await.map_err(|_| ApiErr::Offline)?;
            let status = resp.status();
            if status == StatusCode::UNAUTHORIZED && attempt == 0 {
                // stale access token: drop it and refresh once
                if let Some(a) = self.accs.lock().unwrap().get_mut(account_id) {
                    #[cfg(not(target_os = "android"))]
                    a.access_token.clear();
                    a.expires_at = 0;
                }
                continue;
            }
            #[cfg(target_os = "android")]
            if status == StatusCode::UNAUTHORIZED {
                use tauri::Manager;
                core.app.state::<crate::google_android::GoogleAuth>().invalidate(&token).await;
            }
            let v: Value = resp.json().await.unwrap_or(Value::Null);
            return match status {
                s if s.is_success() => {
                    // first good answer after start/outage: usable again, even mid-sync
                    if core.health.lock().unwrap().get(account_id).map(|h| h.health != "ok").unwrap_or(true) {
                        core.set_health(account_id, "ok", "Đã đồng bộ", 0);
                    }
                    Ok(v)
                }
                StatusCode::UNAUTHORIZED => Err(ApiErr::Expired),
                StatusCode::TOO_MANY_REQUESTS => Err(ApiErr::Rate),
                _ => Err(ApiErr::Other(format!(
                    "{} {}",
                    v["error"]["status"].as_str().unwrap_or(status.as_str()),
                    v["error"]["message"].as_str().unwrap_or("")
                ))),
            };
        }
        Err(ApiErr::Expired)
    }
}

// ── translation ─────────────────────────────────────────────────────────────
fn space_chat(account_id: &str, s: &Value, existing: Option<&Chat>) -> Chat {
    let kind = match s["spaceType"].as_str().or(s["type"].as_str()) {
        Some("DIRECT_MESSAGE") | Some("DM") => "dm",
        Some("GROUP_CHAT") => "group",
        _ => "space",
    };
    let active = rfc3339_ms(s["lastActiveTime"].as_str().unwrap_or(""));
    let mut c = existing.cloned().unwrap_or_default();
    c.account_id = account_id.into();
    c.id = s["name"].as_str().unwrap_or_default().into();
    c.kind = kind.into();
    if let Some(t) = s["displayName"].as_str().filter(|t| !t.is_empty()) {
        c.title = t.into();
    } else if s["singleUserBotDm"].as_bool() == Some(true) && c.title.is_empty() {
        c.title = "Ứng dụng Chat (bot)".into();
    }
    c.description = s["spaceDetails"]["description"].as_str().unwrap_or_default().into();
    c.member_count = s["membershipCount"]["joinedDirectHumanUserCount"].as_i64().unwrap_or(0) as i32;
    c.last_ts = c.last_ts.max(active);
    c.order = c.last_ts;
    c.can_send = true;
    let threading = s["spaceThreadingState"].as_str();
    c.threaded = threading == Some("THREADED_MESSAGES")
        || (threading != Some("UNTHREADED_MESSAGES") && (kind == "space" || (kind == "dm" && s["singleUserBotDm"].as_bool() != Some(true))));
    let created = s["createTime"].as_str().unwrap_or("");
    if created.len() >= 7 {
        c.created = format!("{}/{}", &created[5..7], &created[..4]);
    }
    c
}

fn to_msg(account_id: &str, me: &str, m: &Value) -> Msg {
    let name = m["name"].as_str().unwrap_or_default();
    let space = name.split("/messages/").next().unwrap_or_default();
    let created = m["createTime"].as_str().unwrap_or_default();
    let updated = m["lastUpdateTime"].as_str().unwrap_or_default();
    let sender_id = m["sender"]["name"].as_str().unwrap_or_default().to_string();
    let ts = rfc3339_ms(created);
    let mut text = m["text"].as_str().unwrap_or_default().to_string();
    let formatted = m["formattedText"].as_str().unwrap_or_default();
    let mut names: HashMap<String, String> = HashMap::new();
    let mut mentions_me = false;
    // wrap @mentions so the frontend renders pills; walk annotations from the end so
    // earlier indices stay valid
    let mut anns: Vec<&Value> = m["annotations"].as_array().into_iter().flatten().filter(|a| a["type"] == "USER_MENTION").collect();
    anns.sort_by_key(|a| -(a["startIndex"].as_i64().unwrap_or(0)));
    for a in anns {
        if a["userMention"]["user"]["name"].as_str() == Some(me) {
            mentions_me = true;
        }
        let (s, l) = (a["startIndex"].as_i64().unwrap_or(0) as usize, a["length"].as_i64().unwrap_or(0) as usize);
        let chars: Vec<char> = text.chars().collect();
        if s + l <= chars.len() && chars.get(s) == Some(&'@') {
            let inner: String = chars[s + 1..s + l].iter().collect();
            names.insert(a["userMention"]["user"]["name"].as_str().unwrap_or_default().into(), inner.clone());
            text = format!("{}@{{{inner}}}{}", chars[..s].iter().collect::<String>(), chars[s + l..].iter().collect::<String>());
        }
    }
    // formattedText keeps lists, bold, links… that `text` flattens — but it mangles ```
    // blocks (fence dropped, newlines removed, 4 spaces in front), so those come back from `text`
    if !formatted.is_empty() {
        let raw = m["text"].as_str().unwrap_or_default();
        text = chat_markup(&restore_code_blocks(formatted, raw), &names);
    }
    // a Meet huddle ("Call ended") carries no text: only a RICH_LINK annotation whose
    // status Google rewrites in place, so it must not read as an edit either
    let huddle = m["annotations"].as_array().into_iter().flatten().find_map(|a| {
        let d = &a["richLinkMetadata"]["meetSpaceLinkData"];
        Some((d["huddleStatus"].as_str()?, a["richLinkMetadata"]["uri"].as_str().unwrap_or_default()))
    });
    if let Some((status, uri)) = huddle {
        text = match status {
            "STARTED" => format!("📞 Cuộc gọi đang diễn ra {uri}"),
            "MISSED" => "📞 Cuộc gọi nhỡ".into(),
            _ => "📞 Cuộc gọi đã kết thúc".into(),
        };
    }
    let media = m["attachment"].as_array().and_then(|a| a.first()).map(|a| {
        let mime = a["contentType"].as_str().unwrap_or_default();
        let drive = a["driveDataRef"]["driveFileId"].as_str();
        Media {
            kind: match mime.split('/').next() {
                _ if drive.is_some() => "file",
                Some("image") => "image",
                Some("video") => "video",
                _ => "file",
            }
            .into(),
            name: a["contentName"].as_str().unwrap_or("file").into(),
            mime: mime.into(),
            file_ref: a["attachmentDataRef"]["resourceName"].as_str().unwrap_or_default().into(),
            url: drive.map(|id| format!("https://drive.google.com/open?id={id}")).unwrap_or_default(),
            ..Default::default()
        }
    });
    Msg {
        account_id: account_id.into(),
        chat_id: space.into(),
        id: name.into(),
        sort: ts,
        outgoing: sender_id == me,
        sender_name: m["sender"]["displayName"].as_str().unwrap_or_default().into(),
        sender_id,
        ts,
        edited: !updated.is_empty() && updated != created && m["deletionMetadata"].is_null() && huddle.is_none(),
        deleted: !m["deletionMetadata"].is_null(),
        kind: if media.is_some() { "media" } else { "text" }.into(),
        text,
        media,
        reply_to: m["quotedMessageMetadata"]["name"].as_str().unwrap_or_default().into(),
        reply_name: m["quotedMessageMetadata"]["quotedMessageSnapshot"]["sender"]["displayName"].as_str().unwrap_or_default().into(),
        reply_text: m["quotedMessageMetadata"]["quotedMessageSnapshot"]["text"].as_str().unwrap_or_default().into(),
        reactions: m["emojiReactionSummaries"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|r| {
                Some(Reaction { emoji: r["emoji"]["unicode"].as_str()?.into(), count: r["reactionCount"].as_i64().unwrap_or(1) as i32, mine: false })
            })
            .collect(),
        thread_id: m["thread"]["name"].as_str().unwrap_or_default().into(),
        thread_reply: m["threadReply"].as_bool().unwrap_or(false),
        status: if m["sender"]["name"].as_str() == Some(me) { "sent".into() } else { String::new() },
        mentions_me,
        rev: if updated.is_empty() { created.into() } else { updated.into() },
        ..Default::default()
    }
}

// ── helpers ─────────────────────────────────────────────────────────────────
/// Google parses a line of only `---` / `***` / `___` as a markdown rule, leaving no text:
/// the API then rejects the message as empty. A zero-width space in front keeps the dashes.
fn keep_rules(text: &str) -> String {
    let rule = |l: &str| {
        let t = l.trim();
        let c = t.chars().next();
        t.len() >= 3 && matches!(c, Some('-' | '*' | '_')) && t.chars().all(|x| Some(x) == c || x == ' ')
    };
    text.split('\n').map(|l| if rule(l) { format!("\u{200B}{l}") } else { l.to_string() }).collect::<Vec<_>>().join("\n")
}

fn create_message_request(space: &str, text: &str, thread: Option<&str>, quoted: Option<&Msg>) -> (String, Value) {
    let mut body = json!({ "text": keep_rules(text) });
    let thread = thread.filter(|t| !t.is_empty());
    if let Some(t) = thread { body["thread"] = json!({ "name": t }); }
    if let Some(q) = quoted { body["quotedMessageMetadata"] = json!({ "name": q.id, "lastUpdateTime": q.rev }); }
    let option = if thread.is_some() { "?messageReplyOption=REPLY_MESSAGE_OR_FAIL" } else { "" };
    (format!("{API}/{space}/messages{option}"), body)
}

fn token_path(core: &Core, account_id: &str) -> std::path::PathBuf {
    core.data_dir.join("secrets").join(format!("{account_id}.json"))
}

#[cfg(not(target_os = "android"))]
fn save_token(core: &Core, account_id: &str, refresh: &str) -> std::io::Result<()> {
    use std::os::unix::fs::OpenOptionsExt;
    let path = token_path(core, account_id);
    std::fs::create_dir_all(path.parent().unwrap())?;
    let mut f = std::fs::OpenOptions::new().write(true).create(true).truncate(true).mode(0o600).open(path)?;
    std::io::Write::write_all(&mut f, json!({ "refresh_token": refresh }).to_string().as_bytes())
}

#[cfg(not(target_os = "android"))]
fn load_token(core: &Core, account_id: &str) -> Option<String> {
    let v: Value = serde_json::from_str(&std::fs::read_to_string(token_path(core, account_id)).ok()?).ok()?;
    v["refresh_token"].as_str().map(String::from)
}

#[cfg(not(target_os = "android"))]
fn open_browser(url: &str) {
    // the user's default browser may not be the one signed in to Workspace; prefer Chrome
    let chrome = std::process::Command::new("open").args(["-a", "Google Chrome", url]).status();
    if !matches!(chrome, Ok(s) if s.success()) {
        let _ = std::process::Command::new("open").arg(url).status();
    }
}

#[cfg(not(target_os = "android"))]
fn jwt_claims(jwt: &str) -> Value {
    let payload = jwt.split('.').nth(1).unwrap_or("");
    base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(payload.trim_end_matches('='))
        .ok()
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or(Value::Null)
}

fn enc(s: &str) -> String {
    reqwest::Url::parse_with_params("http://x/", &[("q", s)]).unwrap().query().unwrap()[2..].to_string()
}

fn hash(s: &str) -> u64 {
    use std::hash::{Hash, Hasher};
    let mut h = std::collections::hash_map::DefaultHasher::new();
    s.hash(&mut h);
    h.finish()
}

fn mime_of(name: &str) -> &'static str {
    match name.rsplit('.').next().unwrap_or("").to_lowercase().as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "pdf" => "application/pdf",
        "txt" | "log" => "text/plain",
        "json" => "application/json",
        "zip" => "application/zip",
        _ => "application/octet-stream",
    }
}

/// "2026-10-22T09:30:00.123456Z" → unix ms. Google always answers in UTC.
pub fn rfc3339_ms(s: &str) -> i64 {
    let b = s.as_bytes();
    if b.len() < 19 {
        return 0;
    }
    let n = |r: std::ops::Range<usize>| s.get(r).and_then(|x| x.parse::<i64>().ok()).unwrap_or(0);
    let (y, mo, d, h, mi, se) = (n(0..4), n(5..7), n(8..10), n(11..13), n(14..16), n(17..19));
    let frac: String = s[19..].chars().skip_while(|c| *c == '.').take_while(|c| c.is_ascii_digit()).collect();
    let ms = format!("{:0<3}", frac.chars().take(3).collect::<String>()).parse::<i64>().unwrap_or(0);
    // days from civil (Howard Hinnant)
    let y2 = if mo <= 2 { y - 1 } else { y };
    let era = y2.div_euclid(400);
    let yoe = y2 - era * 400;
    let doy = (153 * (if mo > 2 { mo - 3 } else { mo + 9 }) + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days = era * 146097 + doe - 719468;
    ((days * 86400 + h * 3600 + mi * 60 + se) * 1000) + ms
}

pub fn ms_rfc3339(ms: i64) -> String {
    let (secs, milli) = (ms.div_euclid(1000), ms.rem_euclid(1000));
    let (days, rem) = (secs.div_euclid(86400), secs.rem_euclid(86400));
    let z = days + 719468;
    let era = z.div_euclid(146097);
    let doe = z - era * 146097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + if m <= 2 { 1 } else { 0 };
    format!("{y:04}-{m:02}-{d:02}T{:02}:{:02}:{:02}.{milli:03}Z", rem / 3600, rem % 3600 / 60, rem % 60)
}

/// Google Chat's `formattedText` → ChatMin markup. Chat's own syntax (*bold*, _italic_,
/// ~strike~, `code`, ``` blocks, "* " bullets) is what format.ts renders already; only the
/// <…> tokens change: <url|label> → [label](url), <users/123> → @{Name}.
fn chat_markup(ft: &str, names: &HashMap<String, String>) -> String {
    let mut out = String::new();
    let mut rest = ft;
    while let Some(i) = rest.find('<') {
        out.push_str(&rest[..i]);
        let tail = &rest[i..];
        let Some(j) = tail.find('>') else {
            out.push_str(tail);
            return out;
        };
        let tok = &tail[1..j];
        let rendered = if tok.contains('<') || tok.starts_with(char::is_whitespace) {
            None // a literal "<", not a token
        } else if tok == "users/all" {
            Some("@{all}".to_string())
        } else if tok.starts_with("users/") {
            Some(format!("@{{{}}}", names.get(tok).map(String::as_str).unwrap_or("?")))
        } else if let Some(user) = attr(tok, "chat-user", "data-user") {
            // the newer web composer's tags: <chat-user data-user="users/1"></chat-user>
            Some(if user == "users/all" { "@{all}".into() } else { format!("@{{{}}}", names.get(user).map(String::as_str).unwrap_or("?")) })
        } else if let Some(name) = attr(tok, "chat-emoji", "data-emoji-name") {
            Some(name.to_string()) // custom emoji: its :name:, the image isn't in the API
        } else if tok == "/chat-user" || tok == "/chat-emoji" {
            Some(String::new())
        } else if tok.starts_with("http://") || tok.starts_with("https://") {
            Some(match tok.split_once('|') {
                Some((url, label)) => format!("[{}]({url})", label.replace(['[', ']'], "")),
                None => tok.to_string(),
            })
        } else if let Some((_, label)) = tok.split_once('|') {
            Some(label.to_string()) // mailto: and friends: the label reads fine on its own
        } else if tok.starts_with("customEmojis/") {
            Some(String::new())
        } else {
            None
        };
        match rendered {
            Some(r) => {
                out.push_str(&r);
                rest = &tail[j + 1..];
            }
            None => {
                out.push('<');
                rest = &tail[1..];
            }
        }
    }
    out.push_str(rest);
    unescape(&out)
}

/// A ``` block in `formattedText` is its lines glued together without newlines behind
/// four spaces; `text` has the lines but no fence. Each such run that matches a stretch of
/// `text` (newlines ignored) is replaced by that stretch inside a fence. Single lines that
/// match without a line break stay as they are: an indented line is not a code block.
fn restore_code_blocks(formatted: &str, text: &str) -> String {
    if !formatted.contains("    ") {
        return formatted.to_string();
    }
    // `text` without newlines, with each flat char's byte offset in `text`
    let (flat, at): (String, Vec<usize>) = text.char_indices().filter(|(_, c)| *c != '\n').map(|(i, c)| (c, i)).unzip();
    let mut out = String::new();
    for (n, line) in formatted.split('\n').enumerate() {
        if n > 0 {
            out.push('\n');
        }
        let Some(body) = line.strip_prefix("    ").filter(|b| !b.trim().is_empty()) else {
            out.push_str(line);
            continue;
        };
        let body = &unescape(body); // "\[2\]" in formattedText is "[2]" in text
        let restored = flat.find(body.as_str()).and_then(|i| {
            let (from, to) = (at[flat[..i].chars().count()], at[flat[..i + body.len()].chars().count() - 1] + 1);
            let orig = &text[from..to];
            orig.contains('\n').then(|| format!("```\n{orig}\n```"))
        });
        match restored {
            Some(r) => out.push_str(&r),
            None => out.push_str(line),
        }
    }
    out
}

/// `chat-user data-user="users/1"` → "users/1" for tag "chat-user", attribute "data-user"
fn attr<'a>(tok: &'a str, tag: &str, name: &str) -> Option<&'a str> {
    let rest = tok.strip_prefix(tag)?.trim_start().strip_prefix(name)?.strip_prefix("=\"")?;
    rest.split('"').next()
}

/// formattedText backslash-escapes punctuation that would otherwise read as markup
/// ("4\." so it isn't a numbered list, "v7\_3"); a real backslash comes as "\\".
/// The newer web composer also writes HTML entities ("&#9;" for a tab, "&amp;").
fn unescape(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut chars = s.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '&' {
            let ent: String = chars.clone().take(10).take_while(|&x| x != ';').collect();
            let ch = match ent.as_str() {
                "amp" => Some('&'),
                "lt" => Some('<'),
                "gt" => Some('>'),
                "quot" => Some('"'),
                "apos" => Some('\''),
                "nbsp" => Some(' '),
                e => e.strip_prefix("#x").or_else(|| e.strip_prefix("#X")).map(|h| u32::from_str_radix(h, 16))
                    .or_else(|| e.strip_prefix('#').map(|d| d.parse::<u32>()))
                    .and_then(|n| n.ok()).and_then(char::from_u32),
            };
            if let Some(ch) = ch.filter(|_| chars.clone().nth(ent.chars().count()) == Some(';')) {
                out.push(ch);
                chars.nth(ent.chars().count()); // the entity and its ';'
                continue;
            }
        }
        match chars.peek() {
            Some(&n) if c == '\\' && n.is_ascii_punctuation() => {
                out.push(n);
                chars.next();
            }
            _ => out.push(c),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rules_get_a_zero_width_space() {
        assert_eq!(keep_rules("---"), "\u{200B}---");
        assert_eq!(keep_rules("ok\n* * *\n--"), "ok\n\u{200B}* * *\n--");
        assert_eq!(keep_rules("- item"), "- item");
    }

    #[test]
    fn code_blocks_come_back_from_text() {
        let text = "see:\n{\n  \"a\": 1,\n  \"b\": [2]\n}\nthanks";
        let formatted = "see:\n    {  \"a\": 1,  \"b\": \\[2\\]}\nthanks";
        assert_eq!(restore_code_blocks(formatted, text), "see:\n```\n{\n  \"a\": 1,\n  \"b\": [2]\n}\n```\nthanks");
        // one indented line is not a block; unmatched runs and plain text pass through
        assert_eq!(restore_code_blocks("    x = 1\nok", "x = 1\nok"), "    x = 1\nok");
        assert_eq!(restore_code_blocks("    gone", "other"), "    gone");
        assert_eq!(restore_code_blocks("*bold* é", "bold é"), "*bold* é");
    }

    #[test]
    fn html_entities_decode() {
        assert_eq!(unescape("a&#9;b &amp; c&lt;d&gt; &#x1F600; &quot;q&quot; AT&T &amp no;"), "a\tb & c<d> 😀 \"q\" AT&T &amp no;");
    }

    #[test]
    fn formatted_text_to_markup() {
        let names = HashMap::from([("users/7".to_string(), "Minh".to_string())]);
        assert_eq!(
            chat_markup("Hi <users/7>, see <https://x.dev/a|the doc> & <https://y.dev>:\n* *one*\n* two <users/all> <customEmojis/abc>", &names),
            "Hi @{Minh}, see [the doc](https://x.dev/a) & https://y.dev:\n* *one*\n* two @{all} "
        );
        assert_eq!(
            chat_markup("Hi <chat-user data-user=\"users/7\"></chat-user> or <chat-user data-user=\"users/9\"></chat-user> <chat-emoji data-emoji-name=\":ok:\"></chat-emoji>", &names),
            "Hi @{Minh} or @{?} :ok:"
        );
        assert_eq!(chat_markup("a < b and <mailto:a@b.c|mail> <unclosed", &names), "a < b and mail <unclosed");
        assert_eq!(chat_markup("4\\. /var/www/wallet-services-v7\\_3 C:\\\\tmp \\n", &names), "4. /var/www/wallet-services-v7_3 C:\\tmp \\n");
    }

    #[test]
    fn ordinary_message_does_not_request_a_thread_reply() {
        for thread in [None, Some("")] {
            let (url, body) = create_message_request("spaces/A", "hello", thread, None);
            assert_eq!(url, format!("{API}/spaces/A/messages"));
            assert!(body.get("thread").is_none());
        }
    }

    #[test]
    fn thread_reply_keeps_its_destination_and_never_falls_back() {
        let (url, body) = create_message_request("spaces/A", "reply", Some("spaces/A/threads/T"), None);
        assert!(url.ends_with("messageReplyOption=REPLY_MESSAGE_OR_FAIL"));
        assert_eq!(body["thread"]["name"], "spaces/A/threads/T");
    }

    #[test]
    fn dm_supports_inline_threading_when_google_advertises_it() {
        let chat = space_chat("gc", &json!({"name":"spaces/DM", "spaceType":"DIRECT_MESSAGE", "spaceThreadingState":"THREADED_MESSAGES"}), None);
        assert!(chat.threaded);
    }

    #[test]
    fn quote_snapshot_keeps_sender_and_text() {
        let msg = to_msg("gc", "users/me", &json!({"name":"spaces/A/messages/R", "quotedMessageMetadata": {
            "name":"spaces/A/messages/Q", "quotedMessageSnapshot":{"sender":{"name":"users/2","displayName":"Lan"},"text":"original message"}
        }}));
        assert_eq!(msg.reply_name, "Lan");
        assert_eq!(msg.reply_text, "original message");
    }

    #[test]
    fn rfc3339_round_trips() {
        assert_eq!(rfc3339_ms("1970-01-01T00:00:00Z"), 0);
        assert_eq!(rfc3339_ms("2026-10-22T09:30:00.123456Z"), 1792661400123);
        assert_eq!(ms_rfc3339(1792661400123), "2026-10-22T09:30:00.123Z");
        assert_eq!(rfc3339_ms(&ms_rfc3339(951782400000)), 951782400000); // 2000-02-29
    }

    #[test]
    fn mentions_become_pills_and_flag_me() {
        let m = json!({
            "name": "spaces/A/messages/B", "createTime": "2026-10-22T09:30:00Z",
            "sender": {"name": "users/2", "displayName": "Lan Phạm"},
            "text": "@Trí Võ can you own this? cc @Sarah",
            "annotations": [
                {"type": "USER_MENTION", "startIndex": 0, "length": 7, "userMention": {"user": {"name": "users/1"}}},
                {"type": "USER_MENTION", "startIndex": 29, "length": 6, "userMention": {"user": {"name": "users/3"}}}
            ]
        });
        let msg = to_msg("gc", "users/1", &m);
        assert_eq!(msg.text, "@{Trí Võ} can you own this? cc @{Sarah}");
        assert!(msg.mentions_me);
        assert_eq!(msg.chat_id, "spaces/A");
        assert!(!msg.outgoing);
    }

    #[test]
    fn meet_huddle_gets_text_and_is_not_an_edit() {
        let m = json!({
            "name": "spaces/A/messages/C", "createTime": "2026-10-23T12:33:58Z", "lastUpdateTime": "2026-10-23T12:34:15Z",
            "sender": {"name": "users/2", "displayName": "Kamen"}, "formattedText": "\n",
            "annotations": [{"type": "RICH_LINK", "startIndex": 0, "richLinkMetadata": {
                "uri": "https://meet.google.com/pod-bawk-asu", "richLinkType": "MEET_SPACE",
                "meetSpaceLinkData": {"meetingCode": "pod-bawk-asu", "type": "HUDDLE", "huddleStatus": "ENDED"}}}]
        });
        let msg = to_msg("gc", "users/1", &m);
        assert_eq!(msg.text, "📞 Cuộc gọi đã kết thúc");
        assert!(!msg.edited);
    }
}
