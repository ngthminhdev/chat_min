//! SQLite cache: accounts, chats, messages, and an FTS5 index for ⌘⇧F.
//! Messages are stored whole as JSON next to the few columns we query on.
use crate::model::{Account, Chat, Msg};
use rusqlite::{params, Connection, OptionalExtension};
use std::path::Path;

pub struct Store {
    db: Connection,
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
             CREATE TABLE IF NOT EXISTS accounts (
               id TEXT PRIMARY KEY, data TEXT NOT NULL, position INTEGER NOT NULL);
             CREATE TABLE IF NOT EXISTS chats (
               account_id TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL,
               PRIMARY KEY (account_id, id));
             CREATE TABLE IF NOT EXISTS messages (
               account_id TEXT NOT NULL, chat_id TEXT NOT NULL, id TEXT NOT NULL,
               sort INTEGER NOT NULL, data TEXT NOT NULL,
               PRIMARY KEY (account_id, chat_id, id));
             CREATE INDEX IF NOT EXISTS messages_sort ON messages (account_id, chat_id, sort);
             CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
               body, account_id UNINDEXED, chat_id UNINDEXED, id UNINDEXED,
               tokenize = 'unicode61 remove_diacritics 2');
             -- deleted Google Chat messages used to be kept as tombstones; they are hidden now
             DELETE FROM messages WHERE json_extract(data, '$.deleted') = 1;",
        )
        .map_err(e)?;
        Ok(Self { db })
    }

    // ── accounts ────────────────────────────────────────────────────────────
    pub fn accounts(&self) -> R<Vec<Account>> {
        let mut st = self.db.prepare("SELECT data FROM accounts ORDER BY position").map_err(e)?;
        let rows = st.query_map([], |r| r.get::<_, String>(0)).map_err(e)?;
        Ok(rows.filter_map(|r| r.ok()).filter_map(|s| serde_json::from_str(&s).ok()).collect())
    }

    pub fn put_account(&self, a: &Account) -> R<()> {
        let pos: i64 = self
            .db
            .query_row("SELECT position FROM accounts WHERE id = ?1", [&a.id], |r| r.get(0))
            .optional()
            .map_err(e)?
            .unwrap_or_else(|| {
                self.db
                    .query_row("SELECT COALESCE(MAX(position), 0) + 1 FROM accounts", [], |r| r.get(0))
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
        ] {
            self.db.execute(sql, [id]).map_err(e)?;
        }
        Ok(())
    }

    // ── chats ───────────────────────────────────────────────────────────────
    pub fn chats(&self) -> R<Vec<Chat>> {
        let mut st = self.db.prepare("SELECT data FROM chats").map_err(e)?;
        let rows = st.query_map([], |r| r.get::<_, String>(0)).map_err(e)?;
        Ok(rows.filter_map(|r| r.ok()).filter_map(|s| serde_json::from_str(&s).ok()).collect())
    }

    pub fn account_chats(&self, account_id: &str) -> R<Vec<Chat>> {
        let mut st = self.db.prepare("SELECT data FROM chats WHERE account_id = ?1").map_err(e)?;
        let rows = st.query_map([account_id], |r| r.get::<_, String>(0)).map_err(e)?;
        Ok(rows.filter_map(|r| r.ok()).filter_map(|s| serde_json::from_str(&s).ok()).collect())
    }

    pub fn chat(&self, account_id: &str, id: &str) -> R<Option<Chat>> {
        let s: Option<String> = self
            .db
            .query_row("SELECT data FROM chats WHERE account_id = ?1 AND id = ?2", [account_id, id], |r| r.get(0))
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
        self.db.execute("DELETE FROM chats WHERE account_id = ?1 AND id = ?2", [account_id, id]).map_err(e)?;
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
            .query_row("SELECT 1 FROM messages WHERE json_extract(data, '$.media.localPath') = ?1 LIMIT 1", [path], |_| Ok(()))
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
        let rows = st.query_map(params![account_id, chat_id, before, limit], |r| r.get::<_, String>(0)).map_err(e)?;
        let mut out: Vec<Msg> = rows.filter_map(|r| r.ok()).filter_map(|s| serde_json::from_str(&s).ok()).collect();
        out.reverse();
        Ok(out)
    }

    /// Threaded chat timeline, independent of how many replies dominate the recent tail.
    pub fn primary_msgs(&self, account_id: &str, chat_id: &str, before: i64, limit: i64) -> R<Vec<Msg>> {
        let mut st = self.db.prepare(
            "SELECT data FROM messages WHERE account_id = ?1 AND chat_id = ?2 AND sort < ?3
             AND json_extract(data, '$.threadReply') = 0 ORDER BY sort DESC LIMIT ?4"
        ).map_err(e)?;
        let rows = st.query_map(params![account_id, chat_id, if before > 0 { before } else { i64::MAX }, limit.clamp(1, 100)], |r| r.get::<_, String>(0)).map_err(e)?;
        let mut out: Vec<Msg> = rows.filter_map(|r| r.ok()).filter_map(|s| serde_json::from_str(&s).ok()).collect();
        out.reverse();
        Ok(out)
    }

    pub fn cached_msgs(&self, account_id: &str, chat_id: &str, limit: i64, primary: bool) -> R<(Vec<Msg>, Vec<Msg>)> {
        let page = self.msgs(account_id, chat_id, 0, limit)?;
        let mut roots = if primary { self.primary_msgs(account_id, chat_id, 0, limit.min(50))? } else { vec![] };
        let led: std::collections::HashSet<&str> = page.iter().chain(&roots).filter(|m| !m.thread_reply).map(|m| m.thread_id.as_str()).collect();
        let missing: std::collections::HashSet<String> = page.iter().filter(|m| m.thread_reply && !led.contains(m.thread_id.as_str())).map(|m| m.thread_id.clone()).collect();
        if !missing.is_empty() {
            if let Some(first) = page.first() {
                let found = self.roots(account_id, chat_id, first.sort)?.into_iter().filter(|m| missing.contains(&m.thread_id));
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
        let rows = st.query_map(params![account_id, chat_id, before], |r| r.get::<_, String>(0)).map_err(e)?;
        Ok(rows.filter_map(|r| r.ok()).filter_map(|s| serde_json::from_str(&s).ok()).collect())
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
        let rows = st.query_map(params![limit], |r| r.get::<_, String>(0)).map_err(e)?;
        Ok(rows.filter_map(|r| r.ok()).filter_map(|s| serde_json::from_str(&s).ok()).collect())
    }

    pub fn thread_msgs(&self, account_id: &str, chat_id: &str, thread_id: &str) -> R<Vec<Msg>> {
        let mut st = self
            .db
            .prepare(
                "SELECT data FROM messages WHERE account_id = ?1 AND chat_id = ?2
                 AND json_extract(data, '$.threadId') = ?3 ORDER BY sort",
            )
            .map_err(e)?;
        let rows = st.query_map([account_id, chat_id, thread_id], |r| r.get::<_, String>(0)).map_err(e)?;
        Ok(rows.filter_map(|r| r.ok()).filter_map(|s| serde_json::from_str(&s).ok()).collect())
    }

    /// Bounded cached thread reads: never deserialize a whole thread to show its preview.
    pub fn thread_page(&self, account_id: &str, chat_id: &str, thread_id: &str, limit: i64, root: bool) -> R<Vec<Msg>> {
        let sql = if root {
            "SELECT data FROM messages WHERE account_id = ?1 AND chat_id = ?2
             AND json_extract(data, '$.threadId') = ?3 AND json_extract(data, '$.threadReply') = 0
             ORDER BY sort ASC LIMIT ?4"
        } else {
            "SELECT data FROM messages WHERE account_id = ?1 AND chat_id = ?2
             AND json_extract(data, '$.threadId') = ?3 ORDER BY sort DESC LIMIT ?4"
        };
        let mut st = self.db.prepare(sql).map_err(e)?;
        let rows = st.query_map(params![account_id, chat_id, thread_id, if root { 1 } else { limit.clamp(1, 20) }], |r| r.get::<_, String>(0)).map_err(e)?;
        let mut msgs: Vec<Msg> = rows.filter_map(|r| r.ok()).filter_map(|s| serde_json::from_str(&s).ok()).collect();
        msgs.reverse();
        Ok(msgs)
    }

    pub fn remove_msg(&self, account_id: &str, chat_id: &str, id: &str) -> R<()> {
        self.db
            .execute("DELETE FROM messages WHERE account_id = ?1 AND chat_id = ?2 AND id = ?3", [account_id, chat_id, id])
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
        let rows = st.query_map(params![q, acc, cid, limit], |r| r.get::<_, String>(0)).map_err(e)?;
        Ok(rows.filter_map(|r| r.ok()).filter_map(|s| serde_json::from_str(&s).ok()).collect())
    }
}

fn write_msg(db: &Connection, m: &Msg) -> R<()> {
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
        Msg { account_id: "a".into(), chat_id: "c".into(), id: id.into(), sort, ts: sort, kind: "text".into(), text: text.into(), ..Default::default() }
    }

    #[test]
    fn reply_heavy_cache_returns_primary_rows_in_one_snapshot() {
        let mut s = Store::memory();
        let mut rows: Vec<Msg> = (1..=80).map(|i| {
            let mut m = msg(&format!("root-{i}"), i, "root");
            m.thread_id = format!("t-{i}");
            m
        }).collect();
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
        assert_eq!(roots.len(), 51, "50 newest primary rows plus the old starter of the active thread");
        assert!(roots.iter().all(|m| !m.thread_reply));
        assert!(roots.iter().any(|m| m.id == "root-1"));
        assert!(roots.iter().any(|m| m.id == "root-80"));
        let older = s.primary_msgs("a", "c", 40, 3).unwrap();
        assert_eq!(older.iter().map(|m| m.sort).collect::<Vec<_>>(), vec![37, 38, 39]);
        let (plain, _) = s.cached_msgs("a", "c", 50, false).unwrap();
        assert_eq!(plain.iter().map(|m| m.id.as_str()).collect::<Vec<_>>(), tail.iter().map(|m| m.id.as_str()).collect::<Vec<_>>(), "ordinary chat cache paging stays unchanged");
    }

    #[test]
    fn cached_thread_preview_is_bounded_and_root_lookup_is_separate() {
        let mut s = Store::memory();
        let mut rows: Vec<Msg> = (1..=45).map(|i| {
            let mut m = msg(&i.to_string(), i, "reply");
            m.thread_id = "t".into();
            m.thread_reply = i != 1;
            m
        }).collect();
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
        assert_eq!(s.thread_msgs("a", "c", "t").unwrap().len(),45, "notification participation checks retain the full cached history");
    }

    #[test]
    fn search_ignores_accents_and_matches_prefix() {
        let s = Store::memory();
        s.put_msg(&msg("1", 1, "Kế hoạch deploy thứ Sáu, nhớ rollback")).unwrap();
        s.put_msg(&msg("2", 2, "Không liên quan")).unwrap();
        let hits = s.search("ke hoach rollb", None, 10).unwrap();
        assert_eq!(hits.iter().map(|m| m.id.as_str()).collect::<Vec<_>>(), vec!["1"]);
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
        s.put_msg(&first).unwrap(); s.put_msg(&second).unwrap(); s.put_msg(&third).unwrap();
        assert_eq!(s.search("deploy", Some(("a", "")), 100).unwrap().len(), 2);
        assert_eq!(s.search("deploy", Some(("a", "c")), 100).unwrap().len(), 1);
        assert_eq!(s.search("deploy", None, 100).unwrap().len(), 3);
    }

    #[test]
    fn msgs_pages_backwards_oldest_first() {
        let mut s = Store::memory();
        s.put_msgs(&(1..=5).map(|i| msg(&i.to_string(), i, "x")).collect::<Vec<_>>()).unwrap();
        let ids = |v: Vec<Msg>| v.into_iter().map(|m| m.id).collect::<Vec<_>>();
        assert_eq!(ids(s.msgs("a", "c", 0, 2).unwrap()), vec!["4", "5"]);
        assert_eq!(ids(s.msgs("a", "c", 4, 2).unwrap()), vec!["2", "3"]);
    }

    #[test]
    fn replayed_messages_are_updates_not_new_deliveries() {
        let s = Store::memory();
        let mut m = msg("last", 123, "last message");
        assert!(s.put_msg_if_new(&m).unwrap());
        for _ in 0..20 { assert!(!s.put_msg_if_new(&m).unwrap()); }
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
        assert!(s.put_msg_if_new(&msg("new-id", 123, "new message at same millisecond")).unwrap());
    }
}

#[cfg(test)]
mod account_chat_tests {
    use super::*;
    #[test]
    fn web_snapshot_reads_only_its_account_and_preserves_cached_chats() {
        let store = Store::memory();
        for account in ["zalo-1", "messenger-1", "tg-1"] {
            store.put_chat(&Chat { account_id: account.into(), id: "same-id".into(), muted: true, unread: 6, ..Default::default() }).unwrap();
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
