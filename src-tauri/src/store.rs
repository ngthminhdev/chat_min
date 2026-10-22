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
               tokenize = 'unicode61 remove_diacritics 2');",
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
                 WHERE messages_fts MATCH ?1 AND (?2 = '' OR (f.account_id = ?2 AND f.chat_id = ?3))
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
