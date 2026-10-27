//! Per-account Zalo protocol workers. No embedded provider page.
use crate::{
    model::{Account, Chat, Event, Msg, Reaction},
    Core,
};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, Mutex,
    },
    time::Duration,
};
use tauri::Manager;
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
    sync::{mpsc, oneshot},
};
type Pending = Arc<Mutex<HashMap<u64, oneshot::Sender<Result<Value, String>>>>>;
struct Worker {
    tx: mpsc::Sender<String>,
    pending: Pending,
    alive: Arc<AtomicBool>,
    pending_login: AtomicBool,
    stop: Mutex<Option<oneshot::Sender<()>>>,
}
pub struct Zalo {
    workers: Mutex<HashMap<String, Arc<Worker>>>,
    sequence: AtomicU64,
    pub profiles: crate::zalo_profiles::Profiles,
    http: reqwest::Client,
    media_slots: tokio::sync::Semaphore,
    media_locks: Mutex<HashMap<String, std::sync::Weak<tokio::sync::Mutex<()>>>>,
}
impl Default for Zalo {
    fn default() -> Self {
        Self {
            workers: Default::default(),
            sequence: AtomicU64::new(0),
            profiles: Default::default(),
            http: reqwest::Client::builder()
                .timeout(Duration::from_secs(180))
                .redirect(reqwest::redirect::Policy::custom(|attempt| {
                    if attempt.previous().len() < 3 && media_url(attempt.url().as_str()).is_ok() {
                        attempt.follow()
                    } else {
                        attempt.stop()
                    }
                }))
                .build()
                .expect("Zalo HTTP configuration"),
            media_slots: tokio::sync::Semaphore::new(4),
            media_locks: Default::default(),
        }
    }
}
fn valid_id(id: &str) -> bool {
    id.starts_with("zalo-") && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')
}
fn merge_chat(old: Option<Chat>, mut incoming: Chat) -> Chat {
    if let Some(old) = old {
        incoming.unread = old.unread;
        incoming.mention = old.mention;
        incoming.muted = old.muted;
        incoming.pinned = old.pinned;
        if incoming.last_ts <= old.last_ts {
            incoming.last_ts = old.last_ts;
            incoming.order = old.order;
            incoming.preview = old.preview;
            incoming.preview_from = old.preview_from;
        }
        if incoming.photo.is_empty() {
            incoming.photo = old.photo;
        }
        if incoming.title.is_empty()
            || incoming.title
                == incoming
                    .id
                    .trim_start_matches("u:")
                    .trim_start_matches("g:")
        {
            incoming.title = old.title;
        }
    }
    incoming
}
// Startup is synchronous on the desktop UI thread; process I/O needs the app runtime.
fn spawn_process(command: &mut tokio::process::Command) -> std::io::Result<tokio::process::Child> {
    let runtime = tauri::async_runtime::handle();
    let _guard = runtime.inner().enter();
    command.spawn()
}
impl Zalo {
    pub fn stop(&self, id: &str) {
        if let Some(w) = self.workers.lock().unwrap().remove(id) {
            w.alive.store(false, Ordering::SeqCst);
            if let Some(tx) = w.stop.lock().unwrap().take() {
                let _ = tx.send(());
            }
            for (_, p) in w.pending.lock().unwrap().drain() {
                let _ = p.send(Err("Kết nối Zalo đã đóng".into()));
            }
        }
    }
    pub fn cancel_login(&self, id: &str) -> bool {
        let pending = self
            .workers
            .lock()
            .unwrap()
            .get(id)
            .is_some_and(|w| w.pending_login.load(Ordering::SeqCst));
        if pending {
            self.stop(id);
        }
        pending
    }
    pub fn shutdown(&self) {
        let ids: Vec<_> = self.workers.lock().unwrap().keys().cloned().collect();
        for id in ids {
            self.stop(&id);
        }
    }
    pub async fn request(&self, id: &str, method: &str, params: Value) -> Result<Value, String> {
        let w = self
            .workers
            .lock()
            .unwrap()
            .get(id)
            .cloned()
            .ok_or("Zalo chưa kết nối. Hãy đăng nhập bằng QR.")?;
        if !w.alive.load(Ordering::SeqCst) {
            return Err("Zalo đã ngắt kết nối".into());
        }
        let seq = self.sequence.fetch_add(1, Ordering::Relaxed) + 1;
        let (tx, rx) = oneshot::channel();
        w.pending.lock().unwrap().insert(seq, tx);
        let line = json!({"id":seq,"method":method,"params":params}).to_string() + "\n";
        if w.tx.send(line).await.is_err() {
            w.pending.lock().unwrap().remove(&seq);
            return Err("Zalo đã đóng".into());
        }
        let response = tokio::time::timeout(Duration::from_secs(75), rx).await;
        w.pending.lock().unwrap().remove(&seq);
        response
            .map_err(|_| "Zalo phản hồi quá lâu".to_string())?
            .map_err(|_| "Zalo đã ngắt kết nối".to_string())?
    }
    pub fn start(core: &Arc<Core>, id: &str, qr: bool) -> Result<(), String> {
        if !valid_id(id) {
            return Err("ID Zalo không hợp lệ".into());
        }
        core.zalo.stop(id);
        #[cfg(mobile)]
        return Err("Connector Zalo hiện hỗ trợ bản desktop".into());
        #[cfg(desktop)]
        {
            use std::process::Stdio;
            let dir = core.data_dir.join("zalo").join(id);
            core.zalo.profiles.load(id, &dir);
            std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o700))
                    .map_err(|e| e.to_string())?;
            }
            if !qr && !dir.join("session.json").exists() {
                core.set_health(
                    id,
                    "expired",
                    "Cần quét QR để chuyển sang Zalo trong ChatMin",
                    0,
                );
                return Ok(());
            }
            let resources = core
                .app
                .path()
                .resource_dir()
                .map_err(|e| e.to_string())?
                .join("resources/zalo");
            let dev = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/zalo");
            let resources = if cfg!(debug_assertions) && dev.join("connector.cjs").exists() {
                dev
            } else {
                resources
            };
            let node = resources.join(if cfg!(windows) { "node.exe" } else { "node" });
            let expected = core
                .store()
                .accounts()?
                .into_iter()
                .find(|a| a.id == id && a.self_id != a.id)
                .map(|a| a.self_id)
                .unwrap_or_default();
            let mut command = tokio::process::Command::new(node);
            command
                .arg(resources.join("connector.cjs"))
                .arg(id)
                .arg(&dir)
                .arg(if qr { "qr" } else { "resume" })
                .arg(expected)
                .env_remove("NODE_OPTIONS")
                .env_remove("NODE_PATH")
                .stdin(Stdio::piped())
                .stdout(Stdio::piped())
                .stderr(Stdio::null())
                .kill_on_drop(true);
            let mut child = spawn_process(&mut command)
                .map_err(|e| format!("Không khởi động được connector Zalo: {e}"))?;
            let mut stdin = child.stdin.take().unwrap();
            let stdout = child.stdout.take().unwrap();
            let (tx, mut rx) = mpsc::channel::<String>(64);
            let (stop, mut stopped) = oneshot::channel();
            let pending: Pending = Default::default();
            let alive = Arc::new(AtomicBool::new(true));
            let worker = Arc::new(Worker {
                tx,
                pending: pending.clone(),
                alive: alive.clone(),
                pending_login: AtomicBool::new(qr),
                stop: Mutex::new(Some(stop)),
            });
            core.zalo.workers.lock().unwrap().insert(id.into(), worker);
            let c = Arc::downgrade(core);
            let account = id.to_string();
            let a = alive.clone();
            tauri::async_runtime::spawn(async move {
                let mut lines = BufReader::new(stdout).lines();
                while let Ok(Some(line)) = lines.next_line().await {
                    if !a.load(Ordering::SeqCst) {
                        break;
                    }
                    let Ok(v) = serde_json::from_str::<Value>(&line) else {
                        continue;
                    };
                    if let Some(seq) = v["id"].as_u64() {
                        if let Some(p) = pending.lock().unwrap().remove(&seq) {
                            let result = if let Some(e) = v["error"].as_str() {
                                Err(e.into())
                            } else {
                                Ok(v["result"].clone())
                            };
                            let _ = p.send(result);
                        }
                        continue;
                    }
                    if let Some(core) = c.upgrade() {
                        if let Err(_e) = ingest(&core, &account, v) {
                            core.set_health(
                                &account,
                                "expired",
                                "Lỗi đồng bộ Zalo; hãy đăng nhập lại",
                                0,
                            );
                            core.zalo.stop(&account);
                            break;
                        }
                    } else {
                        break;
                    }
                }
            });
            let c = Arc::downgrade(core);
            let account = id.to_string();
            tauri::async_runtime::spawn(async move {
                let writer = tauri::async_runtime::spawn(async move {
                    while let Some(line) = rx.recv().await {
                        if stdin.write_all(line.as_bytes()).await.is_err() {
                            break;
                        }
                    }
                });
                tokio::select! {_ = child.wait()=>{},_ = &mut stopped=>{let _=child.kill().await;let _=child.wait().await;}}
                writer.abort();
                if alive.swap(false, Ordering::SeqCst) {
                    if let Some(core) = c.upgrade() {
                        core.set_health(
                            &account,
                            "offline",
                            "Connector Zalo đã dừng. Đăng nhập lại để kết nối.",
                            0,
                        );
                        core.zalo.stop(&account);
                    }
                }
            });
            Ok(())
        }
    }
    pub async fn history(
        &self,
        core: &Arc<Core>,
        id: &str,
        chat: &str,
        before: i64,
        limit: i32,
    ) -> Result<Vec<Msg>, String> {
        let limit = limit.clamp(1, 100);
        let cached = core.store().msgs(id, chat, before, limit as i64)?;
        if before > 0 && cached.len() >= limit as usize {
            let mut page = cached;
            self.profiles.messages(&core.cache_dir, &mut page);
            hydrate(&core.cache_dir, &mut page);
            return Ok(page);
        }
        let started = std::time::Instant::now();
        let group = chat.strip_prefix("g:");
        let checkpoint = if group.is_some() {
            core.store().zalo_history(id, chat)?
        } else {
            None
        };
        let live = if let Some(group_id) = group {
            self.request(
                id,
                "group_history",
                json!({"groupId":group_id,"before":before,"limit":limit,"checkpoint":checkpoint}),
            )
            .await
        } else {
            self.request(
                id,
                "history",
                json!({"chatId":chat,"before":before,"limit":limit}),
            )
            .await
        };
        match live {
            Ok(v) => {
                let raw = if group.is_some() {
                    v["messages"].clone()
                } else {
                    v.clone()
                };
                let incoming: Vec<Msg> =
                    serde_json::from_value(raw).map_err(|_| "Invalid Zalo history page")?;
                let mut store = core.store_mut();
                let mut messages = Vec::with_capacity(incoming.len());
                for m in incoming {
                    if m.account_id != id || m.chat_id != chat {
                        return Err("Invalid Zalo history identity".into());
                    }
                    if store.zalo_recalled(id, chat, &m.id)? {
                        continue;
                    }
                    let old = store.msg(id, chat, &m.id)?;
                    messages.push(merge_message(old, m));
                }
                if group.is_some() {
                    let next = &v["checkpoint"];
                    let preserve = checkpoint.as_ref().is_some_and(|old| {
                        old["before"].as_i64().unwrap_or(0) > 0
                            && next["before"].as_i64().unwrap_or(i64::MAX)
                                > old["before"].as_i64().unwrap()
                    });
                    store.put_zalo_page(
                        id,
                        chat,
                        &messages,
                        if preserve {
                            checkpoint.as_ref().unwrap()
                        } else {
                            next
                        },
                    )?;
                } else {
                    store.put_msgs(&messages)?;
                }
                if v["partial"].as_bool() == Some(true) && cached.is_empty() {
                    return Err("Đang quét thêm lịch sử Zalo; bấm tải tiếp để tiếp tục".into());
                }
            }
            Err(e) if cached.is_empty() => return Err(e),
            Err(_) => {}
        }
        let mut page = core.store().msgs(id, chat, before, limit as i64)?;
        self.profiles.messages(&core.cache_dir, &mut page);
        hydrate(&core.cache_dir, &mut page);
        eprintln!(
            "[zalo] history source={} count={} elapsedMs={}",
            if group.is_some() {
                "group_cloud"
            } else {
                "backlog"
            },
            page.len(),
            started.elapsed().as_millis()
        );
        Ok(page)
    }
    pub async fn send_sticker(
        &self,
        core: &Arc<Core>,
        id: &str,
        chat: &str,
        sticker: i32,
    ) -> Result<Msg, String> {
        let value = self
            .request(id, "send_sticker", json!({"chatId":chat,"id":sticker}))
            .await?;
        let msg: Msg =
            serde_json::from_value(value).map_err(|_| "Dữ liệu sticker Zalo không hợp lệ")?;
        let old = core.store().msg(id, chat, &msg.id)?;
        let msg = merge_message(old, msg);
        upsert_message(core, msg.clone(), None, false);
        Ok(msg)
    }
    pub async fn send(
        &self,
        core: &Arc<Core>,
        id: &str,
        chat: &str,
        text: String,
        reply: Option<String>,
        file: Option<String>,
    ) -> Result<Msg, String> {
        let source = if let Some(ref r) = reply {
            Some(source(core, id, chat, r)?)
        } else {
            None
        };
        let value = self
            .request(
                id,
                "send",
                json!({"chatId":chat,"text":text,"replyTo":reply,"source":source,"file":file}),
            )
            .await?;
        let m: Msg = serde_json::from_value(value).map_err(|e| e.to_string())?;
        let old = core.store().msg(id, chat, &m.id)?;
        let m = merge_message(old, m);
        upsert_message(core, m.clone(), None, false);
        Ok(m)
    }
}
pub fn source(core: &Core, id: &str, chat: &str, msg: &str) -> Result<Value, String> {
    let m = core
        .store()
        .msg(id, chat, msg)?
        .ok_or("Không tìm thấy tin Zalo")?;
    serde_json::from_str(&m.rev).map_err(|_| "Thiếu dữ liệu tin nhắn Zalo".into())
}
fn merge_message(old: Option<Msg>, mut msg: Msg) -> Msg {
    if let Some(old) = old {
        let previous: Value = serde_json::from_str(&old.rev).unwrap_or(json!({}));
        let mut raw: Value = serde_json::from_str(&msg.rev).unwrap_or(json!({}));
        // An HTTP send acknowledgment is less complete than the self-listen echo.
        if raw["cliMsgId"].as_str() == Some("")
            && previous["cliMsgId"].as_str().is_some_and(|s| !s.is_empty())
        {
            return old;
        }
        msg.reactions = old.reactions;
        if previous["_reactions"].is_object() {
            raw["_reactions"] = previous["_reactions"].clone();
            msg.rev = raw.to_string();
        }
        if old.status == "seen" {
            msg.status = "seen".into();
        }
        if let (Some(old), Some(new)) = (&old.media, &mut msg.media) {
            if old.file_ref == new.file_ref && new.local_path.is_empty() {
                new.local_path = old.local_path.clone();
            }
        }
    }
    msg
}
fn upsert_message(core: &Core, msg: Msg, chat: Option<Chat>, fresh: bool) {
    if core
        .store()
        .zalo_recalled(&msg.account_id, &msg.chat_id, &msg.id)
        .unwrap_or(true)
    {
        return;
    }
    let old = core
        .store()
        .chat(&msg.account_id, &msg.chat_id)
        .ok()
        .flatten();
    let previous = core
        .store()
        .msg(&msg.account_id, &msg.chat_id, &msg.id)
        .ok()
        .flatten();
    let exists = previous.is_some();
    let msg = merge_message(previous, msg);
    let incoming = chat.unwrap_or_else(|| Chat {
        account_id: msg.account_id.clone(),
        id: msg.chat_id.clone(),
        title: msg
            .chat_id
            .trim_start_matches("u:")
            .trim_start_matches("g:")
            .into(),
        kind: if msg.chat_id.starts_with("g:") {
            "group"
        } else {
            "dm"
        }
        .into(),
        can_send: true,
        ..Default::default()
    });
    let mut chat = merge_chat(old, incoming);
    if msg.ts >= chat.last_ts {
        chat.last_ts = msg.ts;
        chat.order = msg.ts;
        chat.preview = crate::tg::plain(&msg.text, msg.media.as_ref());
        chat.preview_from = if msg.outgoing {
            "Bạn".into()
        } else {
            msg.sender_name.clone()
        };
    }
    if fresh && !exists && !msg.outgoing {
        chat.unread += 1;
    }
    core.put_chat(chat);
    core.put_msg(msg, fresh);
}
fn ingest(core: &Arc<Core>, id: &str, v: Value) -> Result<(), String> {
    match v["event"].as_str().unwrap_or("") {
        "auth" => {
            if v["step"] == "ready" {
                if let Some(w) = core.zalo.workers.lock().unwrap().get(id) {
                    w.pending_login.store(false, Ordering::SeqCst);
                }
            }
            core.emit(Event::Auth {
                account_id: id.into(),
                step: v["step"].as_str().unwrap_or("error").into(),
                info: v["info"].as_str().unwrap_or("").into(),
                error: v["error"].as_str().unwrap_or("").into(),
            });
        }
        "health" => core.set_health(
            id,
            v["health"].as_str().unwrap_or("offline"),
            v["text"].as_str().unwrap_or(""),
            0,
        ),
        "sync" => core.emit(Event::Sync {
            account_id: id.into(),
            step: v["step"].as_u64().unwrap_or(0) as usize,
            state: v["state"].as_str().unwrap_or("err").into(),
            log: v["log"].as_str().unwrap_or("").into(),
        }),
        "account" => {
            let account: Account =
                serde_json::from_value(v["account"].clone()).map_err(|e| e.to_string())?;
            if account.id != id {
                return Err("Zalo account mismatch".into());
            }
            core.add_account(account)?;
            let old = core.store().account_chats(id)?;
            for c in old.into_iter().filter(|c| c.kind == "web") {
                core.remove_chat(id, &c.id);
            }
        }
        "profiles" => {
            let profiles: Vec<crate::model::SenderProfile> =
                serde_json::from_value(v["profiles"].clone())
                    .map_err(|_| "Invalid Zalo profiles")?;
            let changed = core.zalo.profiles.remember(id, profiles);
            for p in &changed {
                let chat = core.store().chat(id, &format!("u:{}", p.id))?;
                if let Some(mut chat) = chat {
                    if !p.name.is_empty() {
                        chat.title = p.name.clone();
                    }
                    if !p.photo.is_empty() {
                        chat.photo = p.photo.clone();
                    }
                    core.put_chat(chat);
                }
            }
            if !changed.is_empty() {
                core.emit(Event::Profiles {
                    account_id: id.into(),
                    profiles: changed,
                });
            }
        }
        "chat" => {
            let chat: Chat =
                serde_json::from_value(v["chat"].clone()).map_err(|e| e.to_string())?;
            let old = core.store().chat(id, &chat.id)?;
            core.put_chat(merge_chat(old, chat));
        }
        "history" => {
            let rows: Vec<Msg> = serde_json::from_value(v["messages"].clone())
                .map_err(|_| "Invalid Zalo history batch")?;
            let chats: Vec<Chat> = serde_json::from_value(v["chats"].clone())
                .map_err(|_| "Invalid Zalo history chats")?;
            if rows.len() > 100
                || rows.iter().any(|m| m.account_id != id)
                || chats.iter().any(|c| c.account_id != id)
            {
                return Err("Invalid Zalo batch identity".into());
            }
            let mut store = core.store_mut();
            let mut messages = Vec::with_capacity(rows.len());
            for msg in rows {
                if store.zalo_recalled(id, &msg.chat_id, &msg.id)? {
                    continue;
                }
                let old = store.msg(id, &msg.chat_id, &msg.id)?;
                messages.push(merge_message(old, msg));
            }
            store.put_msgs(&messages)?;
            let mut changed = Vec::new();
            for chat in chats {
                let old = store.chat(id, &chat.id)?;
                let mut chat = merge_chat(old.clone(), chat);
                if let Some(last) = messages
                    .iter()
                    .filter(|m| m.chat_id == chat.id)
                    .max_by_key(|m| m.sort)
                {
                    if last.ts >= chat.last_ts {
                        chat.last_ts = last.ts;
                        chat.order = last.ts;
                        chat.preview = crate::tg::plain(&last.text, last.media.as_ref());
                        chat.preview_from = if last.outgoing {
                            "Bạn".into()
                        } else {
                            last.sender_name.clone()
                        };
                    }
                }
                if old.as_ref() != Some(&chat) {
                    store.put_chat(&chat)?;
                    changed.push(chat);
                }
            }
            drop(store);
            core.zalo.profiles.messages(&core.cache_dir, &mut messages);
            hydrate(&core.cache_dir, &mut messages);
            core.zalo.profiles.chats(&core.cache_dir, &mut changed);
            core.emit(Event::History {
                messages,
                chats: changed,
            });
        }
        "message" => {
            let msg: Msg = serde_json::from_value(v["msg"].clone()).map_err(|e| e.to_string())?;
            if msg.account_id != id {
                return Err("Zalo message mismatch".into());
            }
            let chat = serde_json::from_value(v["chat"].clone()).ok();
            upsert_message(core, msg, chat, v["isNew"].as_bool().unwrap_or(false));
        }
        "delete" => {
            let chat_id = v["chatId"].as_str().unwrap_or("").to_string();
            let ids: Vec<String> = serde_json::from_value(v["ids"].clone()).unwrap_or_default();
            core.store_mut().recall_zalo(id, &chat_id, &ids)?;
            core.emit(Event::MessagesDeleted {
                account_id: id.into(),
                chat_id: chat_id.clone(),
                ids,
            });
            let chat = core.store().chat(id, &chat_id)?;
            if let Some(mut chat) = chat {
                let last = core.store().msgs(id, &chat_id, 0, 1)?.pop();
                chat.preview = last
                    .as_ref()
                    .map(|m| crate::tg::plain(&m.text, m.media.as_ref()))
                    .unwrap_or_default();
                chat.preview_from = last
                    .as_ref()
                    .map(|m| {
                        if m.outgoing {
                            "Bạn".into()
                        } else {
                            m.sender_name.clone()
                        }
                    })
                    .unwrap_or_default();
                if last.is_none() {
                    chat.unread = 0;
                    chat.mention = false;
                }
                core.put_chat(chat);
            }
        }
        "typing" => core.emit(Event::Typing {
            account_id: id.into(),
            chat_id: v["chatId"].as_str().unwrap_or("").into(),
            who: v["who"].as_str().unwrap_or("").into(),
            on: true,
        }),
        "seen" => {
            let chat = v["chatId"].as_str().unwrap_or("");
            let msg_id = v["msgId"].as_str().unwrap_or("");
            let seen = core.store().msg(id, chat, msg_id)?;
            if let Some(m) = seen {
                let rows = core.store().msgs(id, chat, 0, 200)?;
                for mut row in rows.into_iter().filter(|r| r.outgoing && r.sort <= m.sort) {
                    row.status = "seen".into();
                    core.put_msg(row, false);
                }
                core.emit(Event::ReadOutbox {
                    account_id: id.into(),
                    chat_id: chat.into(),
                    up_to: m.sort,
                });
            }
        }
        "reaction" => {
            let chat = v["chatId"].as_str().unwrap_or("");
            for msg_id in v["ids"]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(Value::as_str)
            {
                let old = core.store().msg(id, chat, msg_id)?;
                if let Some(mut m) = old {
                    let mut raw: Value = serde_json::from_str(&m.rev).unwrap_or(json!({}));
                    let actor = v["senderId"].as_str().unwrap_or("");
                    let emoji = v["emoji"].as_str().unwrap_or("");
                    if !raw["_reactions"].is_object() {
                        raw["_reactions"] = json!({});
                    }
                    if v["remove"].as_bool() == Some(true) {
                        raw["_reactions"].as_object_mut().unwrap().remove(actor);
                    } else {
                        raw["_reactions"][actor] = json!(emoji);
                    }
                    let me = core
                        .store()
                        .accounts()?
                        .into_iter()
                        .find(|a| a.id == id)
                        .map(|a| a.self_id)
                        .unwrap_or_default();
                    let mut counts: HashMap<String, Reaction> = HashMap::new();
                    for (uid, e) in raw["_reactions"].as_object().unwrap() {
                        let s = e.as_str().unwrap_or("");
                        let r = counts.entry(s.into()).or_insert(Reaction {
                            emoji: s.into(),
                            count: 0,
                            mine: false,
                        });
                        r.count += 1;
                        r.mine |= uid == &me;
                    }
                    m.reactions = counts.into_values().collect();
                    m.reactions.sort_by(|a, b| a.emoji.cmp(&b.emoji));
                    m.rev = raw.to_string();
                    core.put_msg(m, false);
                }
            }
        }
        _ => {}
    }
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn legacy_media_repair_keeps_remote_assets_available_on_cached_pages() {
        let mut rows = vec![Msg { account_id: "zalo-a".into(), rev: json!({"content":{"oriUrl":"https://a.zdn.vn/full", "thumbUrl":"https://a.zdn.vn/thumb", "params":"{\"width\":640,\"height\":480}"}}).to_string(), media: Some(crate::model::Media { kind: "image".into(), ..Default::default() }), ..Default::default() }, Msg { account_id: "zalo-a".into(), rev: json!({"content":{"id":123,"catId":4}}).to_string(), media: Some(crate::model::Media { kind: "sticker".into(), name:"Tệp".into(), ..Default::default() }), ..Default::default() }];
        hydrate(std::path::Path::new("/nonexistent"), &mut rows);
        let image = rows[0].media.as_ref().unwrap();
        assert_eq!(image.file_ref, "https://a.zdn.vn/full");
        assert_eq!(image.thumb, "https://a.zdn.vn/thumb");
        assert_eq!(image.width, 640);
        let sticker = rows[1].media.as_ref().unwrap();
        assert_eq!(sticker.file_ref, "zalo-sticker:123");
        assert_eq!(sticker.name, "Sticker.webp");
        assert!(media_url("https://file-stal-1.dlfl.vn/file").is_ok());
        assert!(media_url("https://video-stal-1.dlmd.me/video").is_ok());
        assert!(media_url("https://dlfl.vn.evil.test/file").is_err());
    }
    #[test]
    #[cfg(unix)]
    fn worker_process_can_start_from_a_synchronous_setup_thread() {
        std::thread::spawn(|| {
            assert!(tokio::runtime::Handle::try_current().is_err());
            let mut command = tokio::process::Command::new("/usr/bin/true");
            let mut child = spawn_process(&mut command).unwrap();
            assert!(tauri::async_runtime::block_on(child.wait())
                .unwrap()
                .success());
        })
        .join()
        .unwrap();
    }
    #[test]
    fn metadata_does_not_erase_cached_chat_state() {
        let old = Chat {
            last_ts: 42,
            unread: 3,
            preview: "hi".into(),
            title: "Lan".into(),
            ..Default::default()
        };
        let merged = merge_chat(
            Some(old),
            Chat {
                title: "Lan mới".into(),
                ..Default::default()
            },
        );
        assert_eq!(merged.last_ts, 42);
        assert_eq!(merged.unread, 3);
        assert_eq!(merged.title, "Lan mới");
    }
    #[test]
    fn provider_echo_survives_late_send_ack() {
        let old = Msg {
            id: "7".into(),
            rev: json!({"cliMsgId":"88","_reactions":{"42":"❤️"}}).to_string(),
            text: "hello".into(),
            reactions: vec![Reaction {
                emoji: "❤️".into(),
                count: 1,
                mine: false,
            }],
            ..Default::default()
        };
        let ack = Msg {
            id: "7".into(),
            rev: json!({"cliMsgId":""}).to_string(),
            ..Default::default()
        };
        let merged = merge_message(Some(old), ack);
        assert_eq!(
            serde_json::from_str::<Value>(&merged.rev).unwrap()["cliMsgId"],
            "88"
        );
        assert_eq!(merged.reactions.len(), 1);
        assert_eq!(merged.text, "hello");
    }
    #[test]
    fn backlog_keeps_reactions_and_downloaded_files() {
        let old = Msg {
            rev: json!({"cliMsgId":"8","_reactions":{"42":"❤️"}}).to_string(),
            reactions: vec![Reaction {
                emoji: "❤️".into(),
                count: 1,
                mine: false,
            }],
            media: Some(crate::model::Media {
                file_ref: "https://a.zadn.vn/photo".into(),
                local_path: "/cached/photo".into(),
                ..Default::default()
            }),
            ..Default::default()
        };
        let page = Msg {
            rev: json!({"cliMsgId":"8"}).to_string(),
            media: Some(crate::model::Media {
                file_ref: "https://a.zadn.vn/photo".into(),
                ..Default::default()
            }),
            ..Default::default()
        };
        let merged = merge_message(Some(old), page);
        assert_eq!(merged.reactions.len(), 1);
        assert_eq!(merged.media.unwrap().local_path, "/cached/photo");
        assert!(merged.rev.contains("_reactions"));
    }
    #[test]
    fn worker_paths_cannot_escape_account_directory() {
        assert!(valid_id("zalo-123"));
        assert!(!valid_id("zalo-../../session"));
        assert!(!valid_id("tg-123"));
    }
}

pub(super) fn media_path(
    cache: &std::path::Path,
    id: &str,
    url: &str,
    name: &str,
) -> std::path::PathBuf {
    use std::hash::{Hash, Hasher};
    let mut h = std::collections::hash_map::DefaultHasher::new();
    url.hash(&mut h);
    let safe: String = crate::save_name(name, std::path::Path::new(""))
        .chars()
        .take(100)
        .map(|c| {
            if c.is_alphanumeric() || ".-_".contains(c) {
                c
            } else {
                '_'
            }
        })
        .collect();
    cache
        .join("zalo")
        .join(id)
        .join(format!("{:x}-{safe}", h.finish()))
}
fn media_url(url: &str) -> Result<reqwest::Url, String> {
    let url = reqwest::Url::parse(url).map_err(|_| "URL tệp Zalo không hợp lệ")?;
    let host = url.host_str().unwrap_or("");
    if url.scheme() != "https"
        || ![
            "zadn.vn",
            "zdn.vn",
            "zaloapp.com",
            "zalo.me",
            "dlfl.vn",
            "dlmd.me",
        ]
        .iter()
        .any(|d| host == *d || host.ends_with(&format!(".{d}")))
    {
        return Err("Tệp không thuộc CDN Zalo".into());
    }
    Ok(url)
}
fn repair_media(msg: &mut Msg) {
    let Some(media) = &mut msg.media else { return };
    if !media.file_ref.is_empty() && !media.thumb.is_empty() && media.width > 0 {
        return;
    }
    let raw: Value = serde_json::from_str(&msg.rev).unwrap_or_default();
    let content = &raw["content"];
    let params: Value = if let Some(text) = content["params"].as_str() {
        serde_json::from_str(text).unwrap_or_default()
    } else {
        content["params"].clone()
    };
    if media.file_ref.is_empty() {
        media.file_ref = ["href", "url", "oriUrl", "hdUrl", "normalUrl"]
            .iter()
            .filter_map(|k| content[k].as_str())
            .find(|v| !v.is_empty())
            .unwrap_or("")
            .into();
        if media.kind == "sticker" {
            let id = content["id"]
                .as_u64()
                .or_else(|| content["id"].as_str().and_then(|s| s.parse().ok()));
            if let Some(id) = id.filter(|id| *id > 0 && *id <= u32::MAX as u64) {
                media.file_ref = format!("zalo-sticker:{id}");
            }
        }
    }
    if media.thumb.is_empty() {
        media.thumb = content["thumb"]
            .as_str()
            .or_else(|| content["thumbUrl"].as_str())
            .unwrap_or("")
            .into();
    }
    let dimension = |keys: &[&str]| -> i32 {
        keys.iter()
            .filter_map(|k| {
                params[k]
                    .as_i64()
                    .or_else(|| params[k].as_str().and_then(|s| s.parse().ok()))
            })
            .find(|n| *n > 0 && *n <= 32768)
            .unwrap_or(0) as i32
    };
    if media.width <= 0 {
        media.width = dimension(&["width", "video_width"]);
    }
    if media.height <= 0 {
        media.height = dimension(&["height", "video_height"]);
    }
    if media.kind == "sticker" {
        media.name = "Sticker.webp".into();
        if media.width <= 0 {
            media.width = 128;
        }
        if media.height <= 0 {
            media.height = 128;
        }
    }
}
pub fn hydrate(cache: &std::path::Path, msgs: &mut [Msg]) {
    for m in msgs
        .iter_mut()
        .filter(|m| m.account_id.starts_with("zalo-"))
    {
        repair_media(m);
        if let Some(media) = &mut m.media {
            if !media.file_ref.is_empty() {
                let p = media_path(cache, &m.account_id, &media.file_ref, &media.name);
                if p.is_file() {
                    media.local_path = p.to_string_lossy().into();
                }
            }
        }
    }
}
pub async fn download(
    core: &Arc<Core>,
    id: &str,
    url: &str,
    name: &str,
    refresh: bool,
) -> Result<String, String> {
    if !valid_id(id) {
        return Err("Tài khoản Zalo không hợp lệ".into());
    }
    let reference = url;
    let sticker = reference
        .strip_prefix("zalo-sticker:")
        .map(|id| {
            id.parse::<u32>()
                .ok()
                .filter(|id| *id > 0)
                .ok_or("Sticker Zalo không hợp lệ")
        })
        .transpose()?;
    let direct = if sticker.is_none() {
        Some(media_url(reference)?)
    } else {
        None
    };
    let dest = media_path(&core.cache_dir, id, reference, name);
    if dest.is_file() && !refresh {
        return Ok(dest.to_string_lossy().into());
    }
    // One flight per URL and at most four active transfers across accounts.
    let key = format!("{id}|{reference}|{name}");
    let flight = {
        let mut locks = core.zalo.media_locks.lock().unwrap();
        if locks.len() > 256 {
            locks.retain(|_, v| v.strong_count() > 0);
        }
        if let Some(lock) = locks.get(&key).and_then(std::sync::Weak::upgrade) {
            lock
        } else {
            let lock = Arc::new(tokio::sync::Mutex::new(()));
            locks.insert(key, Arc::downgrade(&lock));
            lock
        }
    };
    let _flight = flight.lock().await;
    if dest.is_file() && !refresh {
        return Ok(dest.to_string_lossy().into());
    }
    let _slot = core
        .zalo
        .media_slots
        .acquire()
        .await
        .map_err(|_| "Zalo downloads stopped")?;
    tokio::fs::create_dir_all(dest.parent().unwrap())
        .await
        .map_err(|e| e.to_string())?;
    let url = if let Some(sticker) = sticker {
        let value = core
            .zalo
            .request(id, "sticker", json!({"id":sticker.to_string()}))
            .await?;
        media_url(value.as_str().ok_or("Không tìm thấy ảnh sticker Zalo")?)?
    } else {
        direct.unwrap()
    };
    let mut response = core
        .zalo
        .http
        .get(url)
        .timeout(Duration::from_secs(if name == "avatar" { 15 } else { 180 }))
        .send()
        .await
        .map_err(|_| "Không tải được tệp Zalo")?
        .error_for_status()
        .map_err(|_| "URL tệp Zalo đã hết hạn hoặc không tải được")?;
    if !response.status().is_success() {
        return Err("URL tệp Zalo không tải được".into());
    }
    if name == "avatar"
        && response
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|v| v.to_str().ok())
            .is_some_and(|mime| mime.starts_with("text/") || mime.contains("json"))
    {
        return Err("Ảnh đại diện Zalo không hợp lệ".into());
    }
    let max: u64 = if name == "avatar" { 2 << 20 } else { 512 << 20 };
    if response.content_length().unwrap_or(0) > max {
        return Err("Tệp Zalo vượt quá 512 MB".into());
    }
    let temp = dest.with_extension(format!("{}.part", crate::now_ms()));
    let mut f = tokio::fs::File::create(&temp)
        .await
        .map_err(|e| e.to_string())?;
    let mut total = 0;
    let result: Result<(), String> = async {
        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|_| "Tải tệp Zalo bị gián đoạn")?
        {
            total += chunk.len() as u64;
            if total > max {
                return Err("Tệp Zalo vượt quá 512 MB".into());
            }
            f.write_all(&chunk).await.map_err(|e| e.to_string())?;
        }
        if total == 0 {
            return Err("Tệp Zalo rỗng".into());
        }
        f.flush().await.map_err(|e| e.to_string())?;
        tokio::fs::rename(&temp, &dest)
            .await
            .map_err(|e| e.to_string())?;
        Ok(())
    }
    .await;
    if result.is_err() {
        let _ = tokio::fs::remove_file(temp).await;
    }
    result?;
    Ok(dest.to_string_lossy().into())
}
