use chrono::{Datelike, Days, Local, NaiveDate, NaiveTime, TimeZone};
use regex::Regex;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::{
    path::Path,
    sync::{
        atomic::{AtomicI64, Ordering},
        LazyLock,
    },
    time::Duration,
};

use crate::{now_ms, Core, Event};

type Result<T> = std::result::Result<T, String>;
const REMINDER_LEASE_MS: i64 = 60_000;
static PENDING_OPEN: AtomicI64 = AtomicI64::new(0);

pub fn queue_open(id: i64) {
    PENDING_OPEN.store(id, Ordering::Release);
}

pub fn take_open() -> Option<i64> {
    let id = PENDING_OPEN.swap(0, Ordering::AcqRel);
    (id > 0).then_some(id)
}

struct Reminder {
    id: i64,
    title: String,
    schedule: i64,
    claimed_at: i64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Source {
    pub account_id: String,
    pub chat_id: String,
    pub message_id: String,
    pub thread_id: String,
    pub label: String,
    pub excerpt: String,
    pub sent_at: i64,
    pub preview: bool,
}

impl Source {
    fn bounded(mut self) -> Self {
        self.label = self.label.chars().take(160).collect();
        self.excerpt = self.excerpt.chars().take(600).collect();
        self
    }

    fn key(&self) -> String {
        serde_json::json!([self.account_id, self.chat_id, self.message_id]).to_string()
    }
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Draft {
    pub title: String,
    pub notes: String,
    pub link: String,
    pub due_at: Option<i64>,
    pub remind_at: Option<i64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Todo {
    id: i64,
    #[serde(flatten)]
    draft: Draft,
    status: String,
    source: Option<Source>,
    created_at: i64,
    completed_at: Option<i64>,
    reminded_at: Option<i64>,
}

pub struct TodoStore {
    db: Connection,
}

fn db_error(error: rusqlite::Error) -> String {
    error.to_string()
}

impl TodoStore {
    pub fn open(path: &Path) -> Result<Self> {
        Self::init(Connection::open(path).map_err(db_error)?)
    }

    fn init(db: Connection) -> Result<Self> {
        db.execute_batch(
            "CREATE TABLE IF NOT EXISTS todos (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                notes TEXT NOT NULL DEFAULT '',
                link TEXT NOT NULL DEFAULT '',
                status TEXT NOT NULL CHECK (status IN ('suggested','open','done','dismissed')),
                source_key TEXT UNIQUE,
                source TEXT,
                created_at INTEGER NOT NULL,
                due_at INTEGER,
                remind_at INTEGER,
                reminded_at INTEGER,
                reminder_claimed_at INTEGER,
                completed_at INTEGER
            );
            CREATE INDEX IF NOT EXISTS todo_pending_reminders ON todos(remind_at)
                WHERE status = 'open' AND reminded_at IS NULL AND remind_at IS NOT NULL;",
        )
        .map_err(db_error)?;
        Ok(Self { db })
    }

    pub fn list(&self) -> Result<Vec<Todo>> {
        let mut stmt = self.db.prepare(
            "SELECT id, title, notes, link, due_at, remind_at, status, source, created_at, completed_at, reminded_at
             FROM todos WHERE status <> 'dismissed' ORDER BY id DESC",
        ).map_err(db_error)?;
        let rows = stmt
            .query_map([], |row| {
                let source: Option<String> = row.get(7)?;
                let source = source
                    .map(|s| serde_json::from_str(&s))
                    .transpose()
                    .map_err(|error| {
                        rusqlite::Error::FromSqlConversionFailure(
                            7,
                            rusqlite::types::Type::Text,
                            Box::new(error),
                        )
                    })?;
                Ok(Todo {
                    id: row.get(0)?,
                    draft: Draft {
                        title: row.get(1)?,
                        notes: row.get(2)?,
                        link: row.get(3)?,
                        due_at: row.get(4)?,
                        remind_at: row.get(5)?,
                    },
                    status: row.get(6)?,
                    source,
                    created_at: row.get(8)?,
                    completed_at: row.get(9)?,
                    reminded_at: row.get(10)?,
                })
            })
            .map_err(db_error)?;
        rows.collect::<rusqlite::Result<Vec<_>>>().map_err(db_error)
    }

    pub fn capture(
        &mut self,
        source: Source,
        account_exists: impl FnOnce() -> bool,
    ) -> Result<bool> {
        let source = source.bounded();
        let Some((title, due_at)) = detect(&source.excerpt, source.sent_at) else {
            return Ok(false);
        };
        if !account_exists() {
            return Ok(false);
        }
        let link = source
            .excerpt
            .split_whitespace()
            .find_map(|word| {
                let word = word.trim_matches(['(', ')', '[', ']', '<', '>', ',', '.']);
                valid_link(word)
                    .filter(|url| url.path().contains("/browse/"))
                    .map(|url| url.to_string())
            })
            .unwrap_or_default();
        let tx = self.db.transaction().map_err(db_error)?;
        let changed = tx
            .execute(
                "INSERT INTO todos (title, link, status, source_key, source, created_at, due_at)
             VALUES (?1, ?2, 'suggested', ?3, ?4, ?5, ?6) ON CONFLICT(source_key) DO NOTHING",
                params![
                    title,
                    link,
                    source.key(),
                    serde_json::to_string(&source).map_err(|e| e.to_string())?,
                    now_ms(),
                    due_at
                ],
            )
            .map_err(db_error)?
            != 0;
        if changed {
            tx.execute(
                "DELETE FROM todos WHERE id IN (
                    SELECT id FROM todos WHERE status = 'suggested' ORDER BY id DESC LIMIT -1 OFFSET 100
                )",
                [],
            ).map_err(db_error)?;
        }
        tx.commit().map_err(db_error)?;
        Ok(changed)
    }

    pub fn save(
        &self,
        id: Option<i64>,
        draft: Draft,
        source: Option<Source>,
        now: i64,
    ) -> Result<i64> {
        let title = draft.title.trim();
        let notes = draft.notes.trim();
        let link = draft.link.trim();
        if title.is_empty() || title.chars().count() > 160 || notes.chars().count() > 5000 {
            return Err("Tiêu đề cần 1–160 ký tự, ghi chú tối đa 5.000 ký tự.".into());
        }
        if link.len() > 2048 || (!link.is_empty() && valid_link(link).is_none()) {
            return Err("Liên kết phải là địa chỉ http hoặc https hợp lệ.".into());
        }
        let valid_time = |value| (1..=253_402_300_799_999).contains(&value);
        if draft.due_at.is_some_and(|value| !valid_time(value))
            || draft.remind_at.is_some_and(|value| !valid_time(value))
            || matches!((draft.remind_at, draft.due_at), (Some(remind), Some(due)) if remind > due)
        {
            return Err("Thời gian nhắc phải trước hoặc bằng hạn chót.".into());
        }
        if let Some(id) = id {
            return self
                .db
                .query_row(
                    "UPDATE todos SET title=?2, notes=?3, link=?4, due_at=?5, remind_at=?6,
                    reminded_at=CASE WHEN remind_at IS ?6 THEN reminded_at ELSE NULL END,
                    reminder_claimed_at=CASE WHEN remind_at IS ?6 THEN reminder_claimed_at ELSE NULL END,
                    status=CASE WHEN status='suggested' THEN 'open' ELSE status END,
                    created_at=CASE WHEN status='suggested' THEN ?7 ELSE created_at END
                 WHERE id=?1 AND status<>'dismissed' RETURNING id",
                    params![id, title, notes, link, draft.due_at, draft.remind_at, now],
                    |row| row.get(0),
                )
                .optional()
                .map_err(db_error)?
                .ok_or_else(|| "Việc hoặc gợi ý này đã bị xoá.".into());
        }

        let source = source.map(Source::bounded);
        let source_json = source
            .as_ref()
            .map(serde_json::to_string)
            .transpose()
            .map_err(|e| e.to_string())?;
        self.db.query_row(
            "INSERT INTO todos (title,notes,link,status,source_key,source,created_at,due_at,remind_at)
             VALUES (?1,?2,?3,'open',?4,?5,?6,?7,?8)
             ON CONFLICT(source_key) DO UPDATE SET title=excluded.title, notes=excluded.notes, link=excluded.link,
               status='open', source=excluded.source, created_at=excluded.created_at,
               due_at=excluded.due_at, remind_at=excluded.remind_at, reminded_at=NULL, reminder_claimed_at=NULL, completed_at=NULL
             WHERE todos.status IN ('suggested','dismissed') RETURNING id",
            params![title, notes, link, source.as_ref().map(Source::key), source_json, now, draft.due_at, draft.remind_at],
            |row| row.get(0),
        ).optional().map_err(db_error)?.ok_or_else(|| "Tin nhắn này đã được thêm vào danh sách việc.".into())
    }

    pub fn dismiss(&self, id: i64) -> Result<()> {
        self.db
            .execute(
                "UPDATE todos SET status='dismissed', title='', link='', source=NULL, due_at=NULL
             WHERE id=?1 AND status='suggested'",
                [id],
            )
            .map_err(db_error)?;
        Ok(())
    }

    pub fn delete(&self, id: i64) -> Result<()> {
        self.db
            .execute(
                "DELETE FROM todos WHERE id=?1 AND status IN ('open','done')",
                [id],
            )
            .map_err(db_error)?;
        Ok(())
    }

    pub fn set_done(&self, id: i64, done: bool, now: i64) -> Result<()> {
        let (from, to) = if done {
            ("open", "done")
        } else {
            ("done", "open")
        };
        self.db.execute(
            "UPDATE todos SET status=?2, completed_at=CASE WHEN ?2='done' THEN ?3 ELSE NULL END,
               reminder_claimed_at=NULL,
               reminded_at=CASE WHEN ?2='open' AND remind_at<=?3 THEN coalesce(reminded_at,?3) ELSE reminded_at END
             WHERE id=?1 AND status=?4",
            params![id, to, now, from],
        ).map_err(db_error)?;
        Ok(())
    }

    pub fn remove_account(&mut self, account: &str) -> Result<()> {
        let tx = self.db.transaction().map_err(db_error)?;
        tx.execute(
            "DELETE FROM todos WHERE status IN ('suggested','dismissed') AND json_extract(source_key,'$[0]')=?1",
            [account],
        ).map_err(db_error)?;
        tx.execute(
            "UPDATE todos SET source=json_set(source,'$.excerpt','')
             WHERE status IN ('open','done') AND json_extract(source_key,'$[0]')=?1",
            [account],
        )
        .map_err(db_error)?;
        tx.commit().map_err(db_error)
    }

    fn claim_reminder(&self, now: i64) -> Result<Option<Reminder>> {
        self.db.query_row(
            "UPDATE todos SET reminder_claimed_at=?1 WHERE id=(
                SELECT id FROM todos WHERE status='open' AND reminded_at IS NULL AND remind_at IS NOT NULL
                 AND remind_at<=?1 AND (reminder_claimed_at IS NULL OR reminder_claimed_at<=?2)
                 ORDER BY remind_at,id LIMIT 1
            ) RETURNING id, title, remind_at",
            params![now, now.saturating_sub(REMINDER_LEASE_MS)],
            |row| Ok(Reminder { id: row.get(0)?, title: row.get(1)?, schedule: row.get(2)?, claimed_at: now }),
        ).optional().map_err(db_error)
    }

    fn acknowledge(&self, reminder: &Reminder, now: i64) -> Result<bool> {
        self.db
            .execute(
                "UPDATE todos SET reminded_at=?1,reminder_claimed_at=NULL
             WHERE id=?2 AND remind_at=?3 AND reminder_claimed_at=?4 AND status='open'",
                params![now, reminder.id, reminder.schedule, reminder.claimed_at],
            )
            .map(|rows| rows > 0)
            .map_err(db_error)
    }
}

fn valid_link(link: &str) -> Option<reqwest::Url> {
    if !link.starts_with("https://") && !link.starts_with("http://") {
        return None;
    }
    let url = reqwest::Url::parse(link).ok()?;
    (url.host_str().is_some() && url.username().is_empty() && url.password().is_none())
        .then_some(url)
}

static REQUEST: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
    r"(?i)^(?:(?:nhờ|giúp)\s+(?:(?:bạn|anh|chị|em|mình)\s+)?|(?:bạn|anh|chị|em)\s+(?:ơi[,\s]+)?(?:giúp\s+(?:mình|anh|chị|em)\s+)?|please\s+|(?:could|can|would) you\s+(?:please\s+)?)(?P<task>.+)$",
).unwrap()
});
static ADDRESS: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^@\{[^}]{1,80}\}[\s,:]*").unwrap());
static ACTION: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
    r"(?i)^(?:gửi|nộp|làm|kiểm tra|xem|sửa|cập nhật|chốt|chuẩn bị|phản hồi|trả lời|xử lý|hoàn thành|triển khai|đặt lịch|tạo|đọc|viết|gọi|duyệt|rà soát|review|send|submit|check|fix|update|finish|complete|prepare|deploy|schedule|reply|book|share|confirm|write|call|create)\s+\S",
).unwrap()
});
static DEADLINE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
    r"(?i)\s+(?:(?:chậm nhất(?: là)?|hạn(?: chót)?|trước|vào|deadline|due(?: by)?|before|by)[:\s]+(?P<marked>.+)|(?P<relative>(?:ngày mai|hôm nay|tomorrow|today)(?:\s+(?:at|lúc)\s+.+)?))[.!?]*$",
).unwrap()
});
static DATE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
    r"(?i)\b(?:(?P<tomorrow>ngày mai|tomorrow)|(?P<today>hôm nay|today)|(?P<iso>[0-9]{4}-[0-9]{1,2}-[0-9]{1,2})|(?P<day>[0-9]{1,2})/(?P<month>[0-9]{1,2})(?:/(?P<year>[0-9]{4}))?)\b",
).unwrap()
});
static TIME: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)\b([0-9]{1,2})(?:(?::([0-9]{2})|h([0-9]{2})?)(?:\s*(am|pm))?|\s*(am|pm))\b")
        .unwrap()
});

fn due_time(text: &str, sent_at: i64) -> Option<i64> {
    let rest = DATE.replace(text, " ");
    let rest = TIME.replace(&rest, " ").to_lowercase();
    if rest
        .split(|c: char| c.is_whitespace() || matches!(c, ',' | '.' | '!' | '?'))
        .any(|word| {
            !matches!(
                word,
                "" | "lúc" | "ngày" | "at" | "nhé" | "nha" | "ạ" | "please"
            )
        })
    {
        return None;
    }
    let base = Local.timestamp_millis_opt(sent_at).single()?;
    let day = base.date_naive();
    let time = TIME.captures(text).map(|parts| {
        let mut hour = parts[1].parse::<u32>().ok()?;
        if let Some(meridiem) = parts.get(4).or_else(|| parts.get(5)) {
            if !(1..=12).contains(&hour) {
                return None;
            }
            hour = hour % 12
                + if meridiem.as_str().eq_ignore_ascii_case("pm") {
                    12
                } else {
                    0
                };
        }
        let minute = parts
            .get(2)
            .or_else(|| parts.get(3))
            .map_or(Some(0), |m| m.as_str().parse().ok())?;
        NaiveTime::from_hms_opt(hour, minute, 0)
    });
    let at = match time {
        Some(value) => value?,
        None => NaiveTime::from_hms_opt(18, 0, 0)?,
    };
    let date = match DATE.captures(text) {
        Some(parts) if parts.name("tomorrow").is_some() => day.checked_add_days(Days::new(1))?,
        Some(parts) if parts.name("today").is_some() => day,
        Some(parts) if parts.name("iso").is_some() => {
            NaiveDate::parse_from_str(&parts["iso"], "%Y-%m-%d").ok()?
        }
        Some(parts) => {
            let d = parts["day"].parse().ok()?;
            let m = parts["month"].parse().ok()?;
            if let Some(year) = parts.name("year") {
                NaiveDate::from_ymd_opt(year.as_str().parse().ok()?, m, d)?
            } else {
                let year = day.year() + i32::from((m, d) < (day.month(), day.day()));
                NaiveDate::from_ymd_opt(year, m, d)?
            }
        }
        None if time.is_some() => day,
        None => return None,
    };
    Local
        .from_local_datetime(&date.and_time(at))
        .single()
        .map(|t| t.timestamp_millis())
}

fn detect(raw: &str, sent_at: i64) -> Option<(String, Option<i64>)> {
    // Ignore code blocks entirely. A quoted command can look like a work request.
    let first = raw.split("```").next()?.replace('\u{200b}', "");
    let text = first.split_whitespace().collect::<Vec<_>>().join(" ");
    let text = text.trim_start_matches('*');
    let address = ADDRESS.find(text);
    let body = address.map_or(text, |m| &text[m.end()..]);
    let request = REQUEST.captures(body).or_else(|| {
        let (sender, body) = text.split_once(": ")?;
        (sender.chars().count() <= 40 && !sender.contains(['?', '!', '/', '@']))
            .then(|| REQUEST.captures(body))
            .flatten()
    });
    let task = request
        .as_ref()
        .and_then(|parts| parts.name("task"))
        .map(|m| m.as_str())
        .or_else(|| address.map(|_| body))?
        .trim_start_matches('*');
    if !ACTION.is_match(task) {
        return None;
    }
    let (title, due) = DEADLINE
        .captures(task)
        .and_then(|parts| {
            let tail = parts.name("marked").or_else(|| parts.name("relative"))?;
            let due = due_time(tail.as_str(), sent_at)?;
            Some((&task[..parts.get(0)?.start()], Some(due)))
        })
        .unwrap_or((task, None));
    let mut chars = title
        .trim_end_matches([' ', '.', '?', '!', '*'])
        .chars()
        .take(160);
    let title = chars.next()?.to_uppercase().chain(chars).collect();
    Some((title, due))
}

pub fn capture(core: &Core, source: Source) {
    let account = source.account_id.clone();
    let result = core.todos.lock().unwrap().capture(source, || {
        core.store().has_account(&account).unwrap_or(false)
    });
    match result {
        Ok(true) => core.emit(Event::TodoChanged),
        Ok(false) => {}
        Err(error) => eprintln!("[todo] could not capture suggestion: {error}"),
    }
}

pub fn start_reminders(core: std::sync::Arc<Core>) {
    tauri::async_runtime::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(10));
        interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        loop {
            interval.tick().await;
            // The Island cannot deliver while the session is locked. Leave those reminders due.
            #[cfg(target_os = "macos")]
            if !crate::island::session_active() {
                continue;
            }
            #[cfg(mobile)]
            if crate::notify::permission(&core.app, false) != "granted" {
                continue;
            }
            let mut changed = false;
            for _ in 0..10 {
                let claim = core.todos.lock().unwrap().claim_reminder(now_ms());
                let reminder = match claim {
                    Ok(Some(reminder)) => reminder,
                    Ok(None) => break,
                    Err(error) => {
                        eprintln!("[todo] could not claim reminder: {error}");
                        break;
                    }
                };
                if !crate::notify::todo(&core.app, reminder.id, &reminder.title).await {
                    // The claim expires so a lock, process exit or transient OS failure can retry.
                    break;
                }
                match core.todos.lock().unwrap().acknowledge(&reminder, now_ms()) {
                    Ok(updated) => changed |= updated,
                    Err(error) => eprintln!("[todo] could not acknowledge reminder: {error}"),
                }
            }
            if changed {
                core.emit(Event::TodoChanged);
            }
        }
    });
}

#[cfg(test)]
#[path = "todo_tests.rs"]
mod tests;
