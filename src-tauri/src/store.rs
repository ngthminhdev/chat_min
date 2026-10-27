//! SQLite cache: accounts, chats, messages, and an FTS5 index for ⌘⇧F.
//! Messages are stored whole as JSON next to the few columns we query on.
use crate::model::{Account, Chat, Msg};
use rusqlite::{params, Connection, OptionalExtension};
use std::path::Path;

pub struct Store {
    db: Connection,
}

/// One row of a threaded space's thread list, from the cache alone.
#[derive(serde::Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ThreadSummary {
    pub thread_id: String,
    /// cached replies: a floor; `thread_count` asks Google for the total
    pub replies: i64,
    pub last_sort: i64,
    pub last_ts: i64,
    pub root: Option<Msg>,
    /// up to three newest replies, oldest first
    pub recent: Vec<Msg>,
}

type R<T> = Result<T, String>;
fn e(err: rusqlite::Error) -> String {
    err.to_string()
}

impl Store {
    pub fn open(path: &Path) -> R<Self> {
        let db = Connection::open(path).map_err(e)?;
        Self::init(db)
    }

    #[cfg(test)]
    pub fn memory() -> Self {
        Self::init(Connection::open_in_memory().unwrap()).unwrap()
    }

    fn init(db: Connection) -> R<Self> {
        db.execute_batch(
            "PRAGMA journal_mode=WAL;
             PRAGMA synchronous=NORMAL;
             CREATE TABLE IF NOT EXISTS ui_settings (id INTEGER PRIMARY KEY CHECK (id = 1), data TEXT NOT NULL);
             CREATE TABLE IF NOT EXISTS accounts (
               id TEXT PRIMARY KEY, data TEXT NOT NULL, position INTEGER NOT NULL);
             CREATE TABLE IF NOT EXISTS chats (
               account_id TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL,
               PRIMARY KEY (account_id, id));
             CREATE TABLE IF NOT EXISTS zalo_recalled (account_id TEXT NOT NULL, chat_id TEXT NOT NULL, id TEXT NOT NULL, PRIMARY KEY(account_id,chat_id,id));
             CREATE TABLE IF NOT EXISTS zalo_history (account_id TEXT NOT NULL, chat_id TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(account_id,chat_id));
             CREATE TABLE IF NOT EXISTS messages (
               account_id TEXT NOT NULL, chat_id TEXT NOT NULL, id TEXT NOT NULL,
               sort INTEGER NOT NULL, data TEXT NOT NULL,
               PRIMARY KEY (account_id, chat_id, id));
             CREATE INDEX IF NOT EXISTS messages_sort ON messages (account_id, chat_id, sort);
             -- thread list and thread pages: no scan of a whole chat's JSON per query
             CREATE INDEX IF NOT EXISTS messages_thread ON messages (account_id, chat_id,
               json_extract(data, '$.threadReply'), json_extract(data, '$.threadId'), sort);
             CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
               body, account_id UNINDEXED, chat_id UNINDEXED, id UNINDEXED,
               tokenize = 'unicode61 remove_diacritics 2');
             -- deleted Google Chat messages used to be kept as tombstones; they are hidden now
             DELETE FROM messages WHERE json_extract(data, '$.deleted') = 1;",
        )
        .map_err(e)?;
        Ok(Self { db })
    }

    pub fn ui_state(&self) -> R<Option<serde_json::Value>> {
        let raw: Option<String> = self
            .db
            .query_row("SELECT data FROM ui_settings WHERE id = 1", [], |row| {
                row.get(0)
            })
            .optional()
            .map_err(e)?;
        raw.map(|raw| serde_json::from_str(&raw).map_err(|e| e.to_string()))
            .transpose()
    }
    pub fn set_ui_state(&self, value: &serde_json::Value) -> R<()> {
        if !value.is_object() {
            return Err("UI settings must be an object".into());
        }
        self.db
            .execute(
                "INSERT OR REPLACE INTO ui_settings (id, data) VALUES (1, ?1)",
                [value.to_string()],
            )
            .map_err(e)?;
        Ok(())
    }
    /// Explicit user change bypasses Core::put_chat's provider-refresh preservation.
    pub fn set_chat_muted(&self, account: &str, id: &str, muted: bool) -> R<Chat> {
        let mut chat = self.chat(account, id)?.ok_or("Không thấy chat")?;
        chat.muted = muted;
        self.put_chat(&chat)?;
        Ok(chat)
    }

    // ── accounts ────────────────────────────────────────────────────────────
    pub fn accounts(&self) -> R<Vec<Account>> {
        let mut st = self
            .db
            .prepare("SELECT data FROM accounts ORDER BY position")
            .map_err(e)?;
        let rows = st.query_map([], |r| r.get::<_, String>(0)).map_err(e)?;
        Ok(rows
            .filter_map(|r| r.ok())
            .filter_map(|s| serde_json::from_str(&s).ok())
            .collect())
    }

    pub fn put_account(&self, a: &Account) -> R<()> {
        let pos: i64 = self
            .db
            .query_row(
                "SELECT position FROM accounts WHERE id = ?1",
                [&a.id],
                |r| r.get(0),
            )
            .optional()
            .map_err(e)?
            .unwrap_or_else(|| {
                self.db
                    .query_row(
                        "SELECT COALESCE(MAX(position), 0) + 1 FROM accounts",
                        [],
                        |r| r.get(0),
                    )
                    .unwrap_or(1)
            });
        self.db
            .execute(
                "INSERT OR REPLACE INTO accounts (id, data, position) VALUES (?1, ?2, ?3)",
                params![a.id, serde_json::to_string(a).unwrap(), pos],
            )
            .map_err(e)?;
        Ok(())
    }

    pub fn remove_account(&self, id: &str) -> R<()> {
        for sql in [
            "DELETE FROM accounts WHERE id = ?1",
            "DELETE FROM chats WHERE account_id = ?1",
            "DELETE FROM messages WHERE account_id = ?1",
            "DELETE FROM messages_fts WHERE account_id = ?1",
            "DELETE FROM zalo_history WHERE account_id = ?1",
            "DELETE FROM zalo_recalled WHERE account_id = ?1",
        ] {
            self.db.execute(sql, [id]).map_err(e)?;
        }
        Ok(())
    }

    // ── chats ───────────────────────────────────────────────────────────────
    pub fn chats(&self) -> R<Vec<Chat>> {
        let mut st = self.db.prepare("SELECT data FROM chats").map_err(e)?;
        let rows = st.query_map([], |r| r.get::<_, String>(0)).map_err(e)?;
        Ok(rows
            .filter_map(|r| r.ok())
            .filter_map(|s| serde_json::from_str(&s).ok())
            .collect())
    }

    pub fn account_chats(&self, account_id: &str) -> R<Vec<Chat>> {
        let mut st = self
            .db
            .prepare("SELECT data FROM chats WHERE account_id = ?1")
            .map_err(e)?;
        let rows = st
            .query_map([account_id], |r| r.get::<_, String>(0))
            .map_err(e)?;
        Ok(rows
            .filter_map(|r| r.ok())
            .filter_map(|s| serde_json::from_str(&s).ok())
            .collect())
    }

    pub fn chat(&self, account_id: &str, id: &str) -> R<Option<Chat>> {
        let s: Option<String> = self
            .db
            .query_row(
                "SELECT data FROM chats WHERE account_id = ?1 AND id = ?2",
                [account_id, id],
                |r| r.get(0),
            )
            .optional()
            .map_err(e)?;
        Ok(s.and_then(|s| serde_json::from_str(&s).ok()))
    }

    pub fn put_chat(&self, c: &Chat) -> R<()> {
        self.db
            .execute(
                "INSERT OR REPLACE INTO chats (account_id, id, data) VALUES (?1, ?2, ?3)",
                params![c.account_id, c.id, serde_json::to_string(c).unwrap()],
            )
            .map_err(e)?;
        Ok(())
    }

    pub fn remove_chat(&self, account_id: &str, id: &str) -> R<()> {
        self.db
            .execute(
                "DELETE FROM chats WHERE account_id = ?1 AND id = ?2",
                [account_id, id],
            )
            .map_err(e)?;
        Ok(())
    }

    // ── messages ────────────────────────────────────────────────────────────
    pub fn put_msg(&self, m: &Msg) -> R<()> {
        write_msg(&self.db, m)
    }

    pub fn put_msg_if_new(&self, m: &Msg) -> R<bool> {
        let existed: bool = self.db.query_row(
            "SELECT EXISTS(SELECT 1 FROM messages WHERE account_id = ?1 AND chat_id = ?2 AND id = ?3)",
            [&m.account_id, &m.chat_id, &m.id], |row| row.get(0),
        ).map_err(e)?;
        self.put_msg(m)?;
        Ok(!existed)
    }

    /// Owned legacy pages only insert missing identities. Live canonical rows always win.
    pub fn zalo_recalled(&self, account: &str, chat: &str, id: &str) -> R<bool> {
        self.db.query_row("SELECT EXISTS(SELECT 1 FROM zalo_recalled WHERE account_id=?1 AND chat_id=?2 AND id=?3)",[account,chat,id],|r|r.get(0)).map_err(e)
    }
    pub fn recall_zalo(&mut self, account: &str, chat: &str, ids: &[String]) -> R<()> {
        if !account.starts_with("zalo-") {
            return Err("invalid_zalo_account".into());
        }
        let tx = self
            .db
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(e)?;
        for id in ids {
            tx.execute(
                "INSERT OR IGNORE INTO zalo_recalled(account_id,chat_id,id) VALUES (?1,?2,?3)",
                [account, chat, id],
            )
            .map_err(e)?;
            tx.execute(
                "DELETE FROM messages WHERE account_id=?1 AND chat_id=?2 AND id=?3",
                [account, chat, id],
            )
            .map_err(e)?;
            tx.execute(
                "DELETE FROM messages_fts WHERE account_id=?1 AND chat_id=?2 AND id=?3",
                [account, chat, id],
            )
            .map_err(e)?;
        }
        tx.commit().map_err(e)
    }
    pub fn import_zalo_records(
        &mut self,
        account: &str,
        rows: &[crate::zalo_import::CacheRecord],
    ) -> R<(usize, usize)> {
        if rows.len() > 100 {
            return Err("cache_batch_budget".into());
        }
        let tx = self
            .db
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(e)?;
        let account_data: String = tx
            .query_row("SELECT data FROM accounts WHERE id=?1", [account], |r| {
                r.get(0)
            })
            .map_err(e)?;
        let owner: Account =
            serde_json::from_str(&account_data).map_err(|_| "invalid_cache_account")?;
        if owner.platform != "zalo" || owner.self_id == owner.id {
            return Err("invalid_cache_account".into());
        }
        let decimal =
            |s: &str| !s.is_empty() && s.len() <= 128 && s.bytes().all(|b| b.is_ascii_digit());
        // Validate every identity before writing the batch, including optional chat metadata.
        for record in rows {
            let m = &record.msg;
            let peer = m
                .chat_id
                .strip_prefix("u:")
                .or_else(|| m.chat_id.strip_prefix("g:"))
                .unwrap_or("");
            if record.owner_self_id != owner.self_id
                || m.account_id != account
                || !decimal(peer)
                || !decimal(&m.id)
                || !decimal(&m.sender_id)
                || m.sort <= 0
                || m.ts <= 0
                || m.ts > crate::now_ms() + 86400000
                || m.deleted
                || m.outgoing != (m.sender_id == owner.self_id)
            {
                return Err("invalid_cache_identity".into());
            }
            if record
                .chat
                .as_ref()
                .is_some_and(|c| c.account_id != account || c.id != m.chat_id)
            {
                return Err("invalid_cache_chat".into());
            }
        }
        let mut inserted = 0;
        let mut existing = 0;
        for record in rows {
            let m = &record.msg;
            let recalled:bool=tx.query_row("SELECT EXISTS(SELECT 1 FROM zalo_recalled WHERE account_id=?1 AND chat_id=?2 AND id=?3)",[account,&m.chat_id,&m.id],|r|r.get(0)).map_err(e)?;
            if recalled {
                existing += 1;
                continue;
            }
            let count=tx.execute("INSERT OR IGNORE INTO messages(account_id,chat_id,id,sort,data) VALUES (?1,?2,?3,?4,?5)",params![account,m.chat_id,m.id,m.sort,serde_json::to_string(m).unwrap()]).map_err(e)?;
            if count == 0 {
                existing += 1;
                continue;
            }
            inserted += 1;
            let body = search_body(m);
            if !body.is_empty() {
                tx.execute(
                    "INSERT INTO messages_fts(body,account_id,chat_id,id) VALUES (?1,?2,?3,?4)",
                    params![body, account, m.chat_id, m.id],
                )
                .map_err(e)?;
            }
            let old: Option<String> = tx
                .query_row(
                    "SELECT data FROM chats WHERE account_id=?1 AND id=?2",
                    [account, &m.chat_id],
                    |r| r.get(0),
                )
                .optional()
                .map_err(e)?;
            let mut chat: Chat = old
                .as_ref()
                .and_then(|s| serde_json::from_str(s).ok())
                .or_else(|| record.chat.clone())
                .unwrap_or_else(|| Chat {
                    account_id: account.into(),
                    id: m.chat_id.clone(),
                    kind: if m.chat_id.starts_with("g:") {
                        "group"
                    } else {
                        "dm"
                    }
                    .into(),
                    title: m.sender_name.clone(),
                    can_send: false,
                    ..Default::default()
                });
            if m.ts >= chat.last_ts {
                chat.last_ts = m.ts;
                chat.order = m.ts;
                chat.preview = crate::tg::plain(&m.text, m.media.as_ref());
                chat.preview_from = if m.outgoing {
                    "Bạn".into()
                } else {
                    m.sender_name.clone()
                };
            }
            // The source is historical: retain current unread/mute state; new chats start read.
            if old.is_none() {
                chat.unread = 0;
                chat.mention = false;
            }
            tx.execute(
                "INSERT OR REPLACE INTO chats(account_id,id,data) VALUES (?1,?2,?3)",
                params![account, chat.id, serde_json::to_string(&chat).unwrap()],
            )
            .map_err(e)?;
        }
        tx.commit().map_err(e)?;
        Ok((inserted, existing))
    }
    pub fn zalo_history(&self, account: &str, chat: &str) -> R<Option<serde_json::Value>> {
        let raw: Option<String> = self
            .db
            .query_row(
                "SELECT data FROM zalo_history WHERE account_id=?1 AND chat_id=?2",
                [account, chat],
                |r| r.get(0),
            )
            .optional()
            .map_err(e)?;
        raw.map(|s| serde_json::from_str(&s).map_err(|e| e.to_string()))
            .transpose()
    }
    /// Page and continuation advance in one durable transaction; no unread/notification effects.
    pub fn put_zalo_page(
        &mut self,
        account: &str,
        chat: &str,
        msgs: &[Msg],
        checkpoint: &serde_json::Value,
    ) -> R<()> {
        if !account.starts_with("zalo-")
            || !chat.starts_with("g:")
            || msgs
                .iter()
                .any(|m| m.account_id != account || m.chat_id != chat)
        {
            return Err("Invalid Zalo history identity".into());
        }
        let tx = self.db.transaction().map_err(e)?;
        for m in msgs {
            write_msg(&tx, m)?;
        }
        tx.execute(
            "INSERT OR REPLACE INTO zalo_history(account_id,chat_id,data) VALUES (?1,?2,?3)",
            params![account, chat, checkpoint.to_string()],
        )
        .map_err(e)?;
        tx.commit().map_err(e)
    }
    pub fn put_msgs(&mut self, msgs: &[Msg]) -> R<()> {
        let tx = self.db.transaction().map_err(e)?;
        for m in msgs {
            write_msg(&tx, m)?;
        }
        tx.commit().map_err(e)
    }

    pub fn msg(&self, account_id: &str, chat_id: &str, id: &str) -> R<Option<Msg>> {
        let s: Option<String> = self
            .db
            .query_row(
                "SELECT data FROM messages WHERE account_id = ?1 AND chat_id = ?2 AND id = ?3",
                [account_id, chat_id, id],
                |r| r.get(0),
            )
            .optional()
            .map_err(e)?;
        Ok(s.and_then(|s| serde_json::from_str(&s).ok()))
    }

    /// Newest `limit` messages strictly older than `before` (0 = from the end), oldest first.
    /// A file one of my messages was sent from (its local copy outside the app's folders).
    pub fn knows_local_path(&self, path: &str) -> bool {
        self.db
            .query_row(
                "SELECT 1 FROM messages WHERE json_extract(data, '$.media.localPath') = ?1 LIMIT 1",
                [path],
                |_| Ok(()),
            )
            .optional()
            .map(|r| r.is_some())
            .unwrap_or(false)
    }

    pub fn msgs(&self, account_id: &str, chat_id: &str, before: i64, limit: i64) -> R<Vec<Msg>> {
        let before = if before <= 0 { i64::MAX } else { before };
        let mut st = self
            .db
            .prepare(
                "SELECT data FROM messages WHERE account_id = ?1 AND chat_id = ?2 AND sort < ?3
                 ORDER BY sort DESC LIMIT ?4",
            )
            .map_err(e)?;
        let rows = st
            .query_map(params![account_id, chat_id, before, limit], |r| {
                r.get::<_, String>(0)
            })
            .map_err(e)?;
        let mut out: Vec<Msg> = rows
            .filter_map(|r| r.ok())
            .filter_map(|s| serde_json::from_str(&s).ok())
            .collect();
        out.reverse();
        Ok(out)
    }

    /// Threaded chat timeline, independent of how many replies dominate the recent tail.
    pub fn primary_msgs(
        &self,
        account_id: &str,
        chat_id: &str,
        before: i64,
        limit: i64,
    ) -> R<Vec<Msg>> {
        let mut st = self
            .db
            .prepare(
                "SELECT data FROM messages WHERE account_id = ?1 AND chat_id = ?2 AND sort < ?3
             AND json_extract(data, '$.threadReply') = 0 ORDER BY sort DESC LIMIT ?4",
            )
            .map_err(e)?;
        let rows = st
            .query_map(
                params![
                    account_id,
                    chat_id,
                    if before > 0 { before } else { i64::MAX },
                    limit.clamp(1, 100)
                ],
                |r| r.get::<_, String>(0),
            )
            .map_err(e)?;
        let mut out: Vec<Msg> = rows
            .filter_map(|r| r.ok())
            .filter_map(|s| serde_json::from_str(&s).ok())
            .collect();
        out.reverse();
        Ok(out)
    }

    pub fn cached_msgs(
        &self,
        account_id: &str,
        chat_id: &str,
        limit: i64,
        primary: bool,
    ) -> R<(Vec<Msg>, Vec<Msg>)> {
        let page = self.msgs(account_id, chat_id, 0, limit)?;
        let mut roots = if primary {
            self.primary_msgs(account_id, chat_id, 0, limit.min(50))?
        } else {
            vec![]
        };
        let led: std::collections::HashSet<&str> = page
            .iter()
            .chain(&roots)
            .filter(|m| !m.thread_reply)
            .map(|m| m.thread_id.as_str())
            .collect();
        let missing: std::collections::HashSet<String> = page
            .iter()
            .filter(|m| m.thread_reply && !led.contains(m.thread_id.as_str()))
            .map(|m| m.thread_id.clone())
            .collect();
        if !missing.is_empty() {
            if let Some(first) = page.first() {
                let found = self
                    .roots(account_id, chat_id, first.sort)?
                    .into_iter()
                    .filter(|m| missing.contains(&m.thread_id));
                roots.extend(found);
            }
        }
        Ok((page, roots))
    }

    /// Thread starters older than `before`, to lead the threads of a cached page whose
    /// starter fell outside it (one scan instead of a query per thread).
    pub fn roots(&self, account_id: &str, chat_id: &str, before: i64) -> R<Vec<Msg>> {
        let mut st = self
            .db
            .prepare(
                "SELECT data FROM messages WHERE account_id = ?1 AND chat_id = ?2 AND sort < ?3
                 AND json_extract(data, '$.threadReply') = 0 AND json_extract(data, '$.threadId') != ''",
            )
            .map_err(e)?;
        let rows = st
            .query_map(params![account_id, chat_id, before], |r| {
                r.get::<_, String>(0)
            })
            .map_err(e)?;
        Ok(rows
            .filter_map(|r| r.ok())
            .filter_map(|s| serde_json::from_str(&s).ok())
            .collect())
    }

    /// Newest messages that call for me: mentions anywhere, DMs that aren't muted, and
    /// replies in threads I posted in (same rule as `Event::Message.inbox`).
    pub fn inbox(&self, limit: i64) -> R<Vec<Msg>> {
        let mut st = self
            .db
            .prepare(
                "WITH f AS (SELECT DISTINCT account_id, chat_id, json_extract(data, '$.threadId') AS t FROM messages
                            WHERE json_extract(data, '$.outgoing') = 1 AND json_extract(data, '$.threadId') != '')
                 SELECT m.data FROM messages m JOIN chats c ON c.account_id = m.account_id AND c.id = m.chat_id
                 LEFT JOIN f ON f.account_id = m.account_id AND f.chat_id = m.chat_id
                      AND f.t = json_extract(m.data, '$.threadId') AND json_extract(m.data, '$.threadReply') = 1
                 WHERE json_extract(m.data, '$.outgoing') = 0
                 AND (json_extract(m.data, '$.mentionsMe') = 1
                      OR (json_extract(c.data, '$.kind') = 'dm' AND json_extract(c.data, '$.muted') = 0)
                      OR f.t IS NOT NULL)
                 ORDER BY json_extract(m.data, '$.ts') DESC LIMIT ?1",
            )
            .map_err(e)?;
        let rows = st
            .query_map(params![limit], |r| r.get::<_, String>(0))
            .map_err(e)?;
        Ok(rows
            .filter_map(|r| r.ok())
            .filter_map(|s| serde_json::from_str(&s).ok())
            .collect())
    }

    pub fn thread_msgs(&self, account_id: &str, chat_id: &str, thread_id: &str) -> R<Vec<Msg>> {
        let mut st = self
            .db
            .prepare(
                "SELECT data FROM messages WHERE account_id = ?1 AND chat_id = ?2
                 AND json_extract(data, '$.threadId') = ?3 ORDER BY sort",
            )
            .map_err(e)?;
        let rows = st
            .query_map([account_id, chat_id, thread_id], |r| r.get::<_, String>(0))
            .map_err(e)?;
        Ok(rows
            .filter_map(|r| r.ok())
            .filter_map(|s| serde_json::from_str(&s).ok())
            .collect())
    }

    /// Bounded cached thread reads: never deserialize a whole thread to show its preview.
    pub fn thread_page(
        &self,
        account_id: &str,
        chat_id: &str,
        thread_id: &str,
        limit: i64,
        root: bool,
    ) -> R<Vec<Msg>> {
        let sql = if root {
            "SELECT data FROM messages WHERE account_id = ?1 AND chat_id = ?2
             AND json_extract(data, '$.threadId') = ?3 AND json_extract(data, '$.threadReply') = 0
             ORDER BY sort ASC LIMIT ?4"
        } else {
            "SELECT data FROM messages WHERE account_id = ?1 AND chat_id = ?2
             AND json_extract(data, '$.threadId') = ?3 ORDER BY sort DESC LIMIT ?4"
        };
        let mut st = self.db.prepare(sql).map_err(e)?;
        let rows = st
            .query_map(
                params![
                    account_id,
                    chat_id,
                    thread_id,
                    if root { 1 } else { limit.clamp(1, 20) }
                ],
                |r| r.get::<_, String>(0),
            )
            .map_err(e)?;
        let mut msgs: Vec<Msg> = rows
            .filter_map(|r| r.ok())
            .filter_map(|s| serde_json::from_str(&s).ok())
            .collect();
        msgs.reverse();
        Ok(msgs)
    }

    /// Threads of a space by latest reply, independent of which messages the timeline holds.
    /// `before`: the previous page's last `last_sort` (0 = newest). The count walks the
    /// `messages_thread` index; starters and newest replies are index lookups per thread.
    pub fn thread_summaries(
        &self,
        account_id: &str,
        chat_id: &str,
        before: i64,
        limit: i64,
    ) -> R<Vec<ThreadSummary>> {
        let mut st = self.db.prepare_cached(
            "SELECT json_extract(data, '$.threadId') AS t, count(*), max(sort) AS last
             FROM messages WHERE account_id = ?1 AND chat_id = ?2 AND json_extract(data, '$.threadReply') = 1
             GROUP BY t HAVING t != '' AND last < ?3 ORDER BY last DESC LIMIT ?4"
        ).map_err(e)?;
        let before = if before > 0 { before } else { i64::MAX };
        let mut out: Vec<ThreadSummary> = st
            .query_map(
                params![account_id, chat_id, before, limit.clamp(1, 50)],
                |r| {
                    Ok(ThreadSummary {
                        thread_id: r.get(0)?,
                        replies: r.get(1)?,
                        last_sort: r.get(2)?,
                        last_ts: 0,
                        root: None,
                        recent: vec![],
                    })
                },
            )
            .map_err(e)?
            .filter_map(|r| r.ok())
            .collect();
        let mut st = self
            .db
            .prepare_cached(
                "SELECT data FROM messages WHERE account_id = ?1 AND chat_id = ?2
             AND json_extract(data, '$.threadReply') = ?3 AND json_extract(data, '$.threadId') = ?4
             ORDER BY sort DESC LIMIT ?5",
            )
            .map_err(e)?;
        for t in &mut out {
            let mut rows = |reply: bool, n: i64| -> R<Vec<Msg>> {
                let rows = st
                    .query_map(params![account_id, chat_id, reply, t.thread_id, n], |r| {
                        r.get::<_, String>(0)
                    })
                    .map_err(e)?;
                Ok(rows
                    .filter_map(|r| r.ok())
                    .filter_map(|s| serde_json::from_str(&s).ok())
                    .collect())
            };
            t.root = rows(false, 1)?.pop();
            t.recent = rows(true, 3)?;
            t.recent.reverse();
            t.last_ts = t.recent.last().map_or(0, |m| m.ts);
        }
        Ok(out)
    }

    /// Where a walk into older history starts: below everything cached for the chat.
    pub fn oldest_sort(&self, account_id: &str, chat_id: &str) -> R<Option<i64>> {
        self.db
            .query_row(
                "SELECT min(sort) FROM messages WHERE account_id = ?1 AND chat_id = ?2",
                [account_id, chat_id],
                |r| r.get(0),
            )
            .map_err(e)
    }

    pub fn remove_msg(&self, account_id: &str, chat_id: &str, id: &str) -> R<()> {
        self.db
            .execute(
                "DELETE FROM messages WHERE account_id = ?1 AND chat_id = ?2 AND id = ?3",
                [account_id, chat_id, id],
            )
            .map_err(e)?;
        self.db
            .execute(
                "DELETE FROM messages_fts WHERE account_id = ?1 AND chat_id = ?2 AND id = ?3",
                [account_id, chat_id, id],
            )
            .map_err(e)?;
        Ok(())
    }

    /// Accent- and case-insensitive search across every account, newest first.
    pub fn search(&self, query: &str, chat: Option<(&str, &str)>, limit: i64) -> R<Vec<Msg>> {
        let q = fts_query(query);
        if q.is_empty() {
            return Ok(vec![]);
        }
        let (acc, cid) = chat.unwrap_or(("", ""));
        let mut st = self
            .db
            .prepare(
                "SELECT m.data FROM messages_fts f
                 JOIN messages m ON m.account_id = f.account_id AND m.chat_id = f.chat_id AND m.id = f.id
                 WHERE messages_fts MATCH ?1 AND (?2 = '' OR f.account_id = ?2) AND (?3 = '' OR f.chat_id = ?3)
                 ORDER BY json_extract(m.data, '$.ts') DESC LIMIT ?4",
            )
            .map_err(e)?;
        let rows = st
            .query_map(params![q, acc, cid, limit], |r| r.get::<_, String>(0))
            .map_err(e)?;
        Ok(rows
            .filter_map(|r| r.ok())
            .filter_map(|s| serde_json::from_str(&s).ok())
            .collect())
    }
}

fn write_msg(db: &Connection, m: &Msg) -> R<()> {
    if m.account_id.starts_with("zalo-") {
        let recalled:bool=db.query_row("SELECT EXISTS(SELECT 1 FROM zalo_recalled WHERE account_id=?1 AND chat_id=?2 AND id=?3)",[&m.account_id,&m.chat_id,&m.id],|r|r.get(0)).map_err(e)?;
        if recalled {
            return Ok(());
        }
    }
    db.execute(
        "INSERT OR REPLACE INTO messages (account_id, chat_id, id, sort, data) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![m.account_id, m.chat_id, m.id, m.sort, serde_json::to_string(m).unwrap()],
    )
    .map_err(e)?;
    db.execute(
        "DELETE FROM messages_fts WHERE account_id = ?1 AND chat_id = ?2 AND id = ?3",
        [&m.account_id, &m.chat_id, &m.id],
    )
    .map_err(e)?;
    let body = search_body(m);
    if !body.is_empty() {
        db.execute(
            "INSERT INTO messages_fts (body, account_id, chat_id, id) VALUES (?1, ?2, ?3, ?4)",
            [&body, &m.account_id, &m.chat_id, &m.id],
        )
        .map_err(e)?;
    }
    Ok(())
}

fn search_body(m: &Msg) -> String {
    if m.deleted || m.kind == "service" {
        return String::new();
    }
    let mut body = m.text.replace("@{", "@").replace('}', "").replace('`', "");
    if let Some(media) = &m.media {
        body.push(' ');
        body.push_str(&media.name);
    }
    fold_d(body.trim())
}

/// FTS5's remove_diacritics leaves "đ" alone (it is a letter, not d + accent).
fn fold_d(s: &str) -> String {
    s.replace('đ', "d").replace('Đ', "D")
}

/// Every word becomes a prefix term, so "rollb" finds "rollback". Quotes keep FTS syntax out.
fn fts_query(q: &str) -> String {
    fold_d(q)
        .split_whitespace()
        .map(|w| w.replace('"', ""))
        .filter(|w| !w.is_empty())
        .map(|w| format!("\"{w}\"*"))
        .collect::<Vec<_>>()
        .join(" ")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn msg(id: &str, sort: i64, text: &str) -> Msg {
        Msg {
            account_id: "a".into(),
            chat_id: "c".into(),
            id: id.into(),
            sort,
            ts: sort,
            kind: "text".into(),
            text: text.into(),
            ..Default::default()
        }
    }

    #[test]
    fn reply_heavy_cache_returns_primary_rows_in_one_snapshot() {
        let mut s = Store::memory();
        let mut rows: Vec<Msg> = (1..=80)
            .map(|i| {
                let mut m = msg(&format!("root-{i}"), i, "root");
                m.thread_id = format!("t-{i}");
                m
            })
            .collect();
        rows.extend((100..500).map(|i| {
            let mut m = msg(&format!("reply-{i}"), i, "reply");
            m.thread_id = "t-1".into();
            m.thread_reply = true;
            m
        }));
        s.put_msgs(&rows).unwrap();
        let (tail, roots) = s.cached_msgs("a", "c", 50, true).unwrap();
        assert_eq!(tail.len(), 50);
        assert!(tail.iter().all(|m| m.thread_reply));
        assert_eq!(
            roots.len(),
            51,
            "50 newest primary rows plus the old starter of the active thread"
        );
        assert!(roots.iter().all(|m| !m.thread_reply));
        assert!(roots.iter().any(|m| m.id == "root-1"));
        assert!(roots.iter().any(|m| m.id == "root-80"));
        let older = s.primary_msgs("a", "c", 40, 3).unwrap();
        assert_eq!(
            older.iter().map(|m| m.sort).collect::<Vec<_>>(),
            vec![37, 38, 39]
        );
        let (plain, _) = s.cached_msgs("a", "c", 50, false).unwrap();
        assert_eq!(
            plain.iter().map(|m| m.id.as_str()).collect::<Vec<_>>(),
            tail.iter().map(|m| m.id.as_str()).collect::<Vec<_>>(),
            "ordinary chat cache paging stays unchanged"
        );
    }

    #[test]
    fn thread_list_reaches_past_a_reply_heavy_tail_and_pages_by_latest_reply() {
        let mut s = Store::memory();
        let mut rows = vec![];
        // 30 threads with one reply each, then 400 replies all in thread t-1
        for i in 1..=30 {
            let mut root = msg(&format!("root-{i}"), i, "root");
            root.thread_id = format!("t-{i}");
            let mut reply = msg(&format!("r-{i}"), 100 + i, "reply");
            reply.thread_id = root.thread_id.clone();
            reply.thread_reply = true;
            rows.extend([root, reply]);
        }
        rows.extend((1000..1400).map(|i| {
            let mut m = msg(&format!("busy-{i}"), i, "busy");
            m.thread_id = "t-1".into();
            m.thread_reply = true;
            m
        }));
        s.put_msgs(&rows).unwrap();
        let first = s.thread_summaries("a", "c", 0, 20).unwrap();
        assert_eq!(
            first.len(),
            20,
            "the newest replies all belong to one thread, the list still fills"
        );
        assert_eq!(first[0].thread_id, "t-1");
        assert_eq!(first[0].replies, 401);
        assert_eq!(
            first[0].recent.iter().map(|m| m.sort).collect::<Vec<_>>(),
            vec![1397, 1398, 1399]
        );
        assert_eq!(
            first[0].root.as_ref().map(|m| m.id.as_str()),
            Some("root-1")
        );
        assert_eq!(first[1].thread_id, "t-30");
        let rest = s
            .thread_summaries("a", "c", first[19].last_sort, 20)
            .unwrap();
        assert_eq!(rest.len(), 10);
        assert!(rest.iter().all(|t| t.replies == 1 && t.root.is_some()));
        assert_eq!(s.oldest_sort("a", "c").unwrap(), Some(1));
        assert_eq!(s.oldest_sort("a", "none").unwrap(), None);
    }

    #[test]
    fn cached_thread_preview_is_bounded_and_root_lookup_is_separate() {
        let mut s = Store::memory();
        let mut rows: Vec<Msg> = (1..=45)
            .map(|i| {
                let mut m = msg(&i.to_string(), i, "reply");
                m.thread_id = "t".into();
                m.thread_reply = i != 1;
                m
            })
            .collect();
        let mut other = msg("other", 100, "other thread");
        other.thread_id = "another".into();
        rows.push(other);
        s.put_msgs(&rows).unwrap();
        let page = s.thread_page("a", "c", "t", 200, false).unwrap();
        assert_eq!(page.len(), 20);
        assert_eq!(page.first().unwrap().sort, 26);
        assert_eq!(page.last().unwrap().sort, 45);
        let root = s.thread_page("a", "c", "t", 20, true).unwrap();
        assert_eq!(root.len(), 1);
        assert_eq!(root[0].id, "1");
        assert_eq!(
            s.thread_msgs("a", "c", "t").unwrap().len(),
            45,
            "notification participation checks retain the full cached history"
        );
    }

    #[test]
    fn search_ignores_accents_and_matches_prefix() {
        let s = Store::memory();
        s.put_msg(&msg("1", 1, "Kế hoạch deploy thứ Sáu, nhớ rollback"))
            .unwrap();
        s.put_msg(&msg("2", 2, "Không liên quan")).unwrap();
        let hits = s.search("ke hoach rollb", None, 10).unwrap();
        assert_eq!(
            hits.iter().map(|m| m.id.as_str()).collect::<Vec<_>>(),
            vec!["1"]
        );
        // re-putting replaces the index entry instead of duplicating it
        s.put_msg(&msg("1", 1, "đã đổi nội dung")).unwrap();
        assert!(s.search("rollback", None, 10).unwrap().is_empty());
        assert_eq!(s.search("doi", None, 10).unwrap().len(), 1);
    }

    #[test]
    fn search_filters_account_without_requiring_a_chat() {
        let s = Store::memory();
        let first = msg("1", 1, "deploy service");
        let mut second = msg("2", 2, "deploy other chat");
        second.chat_id = "other".into();
        let mut third = msg("3", 3, "deploy other account");
        third.account_id = "b".into();
        s.put_msg(&first).unwrap();
        s.put_msg(&second).unwrap();
        s.put_msg(&third).unwrap();
        assert_eq!(s.search("deploy", Some(("a", "")), 100).unwrap().len(), 2);
        assert_eq!(s.search("deploy", Some(("a", "c")), 100).unwrap().len(), 1);
        assert_eq!(s.search("deploy", None, 100).unwrap().len(), 3);
    }

    #[test]
    fn msgs_pages_backwards_oldest_first() {
        let mut s = Store::memory();
        s.put_msgs(
            &(1..=5)
                .map(|i| msg(&i.to_string(), i, "x"))
                .collect::<Vec<_>>(),
        )
        .unwrap();
        let ids = |v: Vec<Msg>| v.into_iter().map(|m| m.id).collect::<Vec<_>>();
        assert_eq!(ids(s.msgs("a", "c", 0, 2).unwrap()), vec!["4", "5"]);
        assert_eq!(ids(s.msgs("a", "c", 4, 2).unwrap()), vec!["2", "3"]);
    }

    #[test]
    fn replayed_messages_are_updates_not_new_deliveries() {
        let s = Store::memory();
        let mut m = msg("last", 123, "last message");
        assert!(s.put_msg_if_new(&m).unwrap());
        for _ in 0..20 {
            assert!(!s.put_msg_if_new(&m).unwrap());
        }
        m.text = "edited".into();
        assert!(!s.put_msg_if_new(&m).unwrap());
        assert_eq!(s.msg("a", "c", "last").unwrap().unwrap().text, "edited");
        m.account_id = "other".into();
        assert!(s.put_msg_if_new(&m).unwrap());
    }

    #[test]
    fn cached_history_must_not_be_announced_when_polled_again() {
        let s = Store::memory();
        let m = msg("cached", 123, "already read");
        s.put_msg(&m).unwrap();
        assert!(!s.put_msg_if_new(&m).unwrap());
        assert!(s
            .put_msg_if_new(&msg("new-id", 123, "new message at same millisecond"))
            .unwrap());
    }
    #[test]
    fn ui_settings_survive_database_reopen_and_local_mute_is_written() {
        let dir = std::env::temp_dir().join(format!(
            "chatmin-ui-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir(&dir).unwrap();
        let path = dir.join("chatmin.db");
        let snapshot =
            serde_json::json!({"favorites":["gc-test|space"],"prefs":{"quickReactions":["🔥"]}});
        {
            let store = Store::open(&path).unwrap();
            assert_eq!(store.ui_state().unwrap(), None);
            store.set_ui_state(&snapshot).unwrap();
            store
                .put_chat(&Chat {
                    account_id: "gc-test".into(),
                    id: "space".into(),
                    ..Default::default()
                })
                .unwrap();
            assert!(
                store
                    .set_chat_muted("gc-test", "space", true)
                    .unwrap()
                    .muted
            );
        }
        {
            let store = Store::open(&path).unwrap();
            assert_eq!(store.ui_state().unwrap(), Some(snapshot));
            assert!(store.chat("gc-test", "space").unwrap().unwrap().muted);
            assert!(
                !store
                    .set_chat_muted("gc-test", "space", false)
                    .unwrap()
                    .muted
            );
        }
        std::fs::remove_dir_all(dir).unwrap();
    }
}

#[cfg(test)]
mod account_chat_tests {
    use super::*;
    #[test]
    fn web_snapshot_reads_only_its_account_and_preserves_cached_chats() {
        let store = Store::memory();
        for account in ["zalo-1", "messenger-1", "tg-1"] {
            store
                .put_chat(&Chat {
                    account_id: account.into(),
                    id: "same-id".into(),
                    muted: true,
                    unread: 6,
                    ..Default::default()
                })
                .unwrap();
        }
        let rows = store.account_chats("zalo-1").unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].account_id, "zalo-1");
        assert!(rows[0].muted);
        assert_eq!(rows[0].unread, 6);
        assert!(store.account_chats("missing").unwrap().is_empty());
        assert_eq!(store.chats().unwrap().len(), 3);
    }
}

#[cfg(test)]
mod zalo_history_tests {
    use super::*;
    #[test]
    fn group_page_and_checkpoint_survive_reopen_without_cross_account_leaks() {
        let path =
            std::env::temp_dir().join(format!("chatmin-zalo-history-{}.db", crate::now_ms()));
        {
            let mut s = Store::open(&path).unwrap();
            let m = Msg {
                account_id: "zalo-a".into(),
                chat_id: "g:42".into(),
                id: "7".into(),
                sort: 100,
                ..Default::default()
            };
            s.put_zalo_page(
                "zalo-a",
                "g:42",
                &[m],
                &serde_json::json!({"cursor":"9007199254740999","old":true,"before":100}),
            )
            .unwrap();
        }
        let s = Store::open(&path).unwrap();
        assert_eq!(s.msgs("zalo-a", "g:42", 0, 50).unwrap().len(), 1);
        assert_eq!(
            s.zalo_history("zalo-a", "g:42").unwrap().unwrap()["cursor"],
            "9007199254740999"
        );
        assert!(s.zalo_history("zalo-b", "g:42").unwrap().is_none());
        drop(s);
        let _ = std::fs::remove_file(path);
    }
    #[test]
    fn rejected_page_cannot_advance_checkpoint() {
        let mut s = Store::memory();
        let m = Msg {
            account_id: "zalo-b".into(),
            chat_id: "g:42".into(),
            id: "7".into(),
            ..Default::default()
        };
        assert!(s
            .put_zalo_page("zalo-a", "g:42", &[m], &serde_json::json!({"cursor":"7"}))
            .is_err());
        assert!(s.zalo_history("zalo-a", "g:42").unwrap().is_none());
    }
}

#[cfg(test)]
mod zalo_recall_tests {
    use super::*;
    #[test]
    fn recalled_identity_cannot_be_reintroduced_by_history() {
        let mut s = Store::memory();
        let m = Msg {
            account_id: "zalo-a".into(),
            chat_id: "u:42".into(),
            id: "7".into(),
            sort: 100,
            text: "historical secret".into(),
            ..Default::default()
        };
        s.put_msg(&m).unwrap();
        s.recall_zalo("zalo-a", "u:42", &["7".into()]).unwrap();
        assert!(s.zalo_recalled("zalo-a", "u:42", "7").unwrap());
        s.put_msgs(&[m.clone()]).unwrap();
        assert!(s.msg("zalo-a", "u:42", "7").unwrap().is_none());
        assert!(s
            .search("historical", Some(("zalo-a", "")), 10)
            .unwrap()
            .is_empty());
        let other = Msg {
            account_id: "zalo-b".into(),
            ..m
        };
        s.put_msg(&other).unwrap();
        assert!(s.msg("zalo-b", "u:42", "7").unwrap().is_some());
    }
}
