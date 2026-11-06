use super::*;

fn source(id: &str) -> Source {
    Source {
        account_id: "gc-1".into(),
        chat_id: "spaces/team".into(),
        message_id: id.into(),
        thread_id: "spaces/team/threads/a".into(),
        label: "Team".into(),
        excerpt: "Nhờ bạn gửi báo cáo trước 17h ngày mai".into(),
        sent_at: Local
            .with_ymd_and_hms(2026, 11, 6, 9, 0, 0)
            .unwrap()
            .timestamp_millis(),
        preview: false,
    }
}

fn draft(due: i64, remind: i64) -> Draft {
    Draft {
        title: " Gửi báo cáo ".into(),
        notes: "Kèm số liệu tuần".into(),
        link: "https://jira.example.test/browse/DEV-42".into(),
        due_at: Some(due),
        remind_at: Some(remind),
    }
}

#[test]
fn explicit_requests_are_extracted_and_relative_deadlines_use_message_time() {
    let s = source("m1");
    let (title, due) = detect(&s.excerpt, s.sent_at).unwrap();
    assert_eq!(title, "Gửi báo cáo");
    assert_eq!(
        due,
        Some(
            Local
                .with_ymd_and_hms(2026, 11, 7, 17, 0, 0)
                .unwrap()
                .timestamp_millis()
        )
    );
    assert_eq!(
        detect(
            "Linh: Please review the PR by 2026-11-09 at 10:30",
            s.sent_at
        )
        .unwrap()
        .0,
        "Review the PR"
    );
    assert_eq!(
        detect("Nhờ bạn kiểm tra log trước 17h", s.sent_at)
            .unwrap()
            .1,
        Some(
            Local
                .with_ymd_and_hms(2026, 11, 6, 17, 0, 0)
                .unwrap()
                .timestamp_millis()
        )
    );
    assert_eq!(
        detect("Nhờ bạn gửi báo cáo, hôm nay mình bận", s.sent_at)
            .unwrap()
            .1,
        None
    );
    assert_eq!(
        detect("Nhờ bạn kiểm tra vào 31/02", s.sent_at).unwrap().1,
        None
    );
    assert_eq!(
        detect("Please send the report before 5:30 PM tomorrow", s.sent_at)
            .unwrap()
            .1,
        Some(
            Local
                .with_ymd_and_hms(2026, 11, 7, 17, 30, 0)
                .unwrap()
                .timestamp_millis()
        )
    );
    assert_eq!(
        detect("Please send the report by 5 PM UTC", s.sent_at)
            .unwrap()
            .1,
        None
    );
    assert_eq!(
        detect("@{Minh} kiểm tra log trước 17h", s.sent_at)
            .unwrap()
            .0,
        "Kiểm tra log"
    );
    assert!(detect("Mình đã gửi báo cáo rồi", s.sent_at).is_none());
    assert!(detect("Please don't send the file", s.sent_at).is_none());
    assert!(detect("Nhờ bạn đừng gửi nữa", s.sent_at).is_none());
}

#[test]
fn suggested_work_stays_separate_and_acceptance_is_idempotent() {
    let mut db = TodoStore::init(Connection::open_in_memory().unwrap()).unwrap();
    assert!(db.capture(source("m1"), || true).unwrap());
    assert!(!db.capture(source("m1"), || true).unwrap());
    let rows = db.list().unwrap();
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].status, "suggested");
    assert_eq!(rows[0].draft.remind_at, None);
    let id = rows[0].id;
    db.save(Some(id), draft(200_000, 100_000), None, 1).unwrap();
    assert!(!db.capture(source("m1"), || true).unwrap());
    assert_eq!(db.list().unwrap()[0].status, "open");
    db.capture(source("m2"), || true).unwrap();
    let id = db
        .list()
        .unwrap()
        .into_iter()
        .find(|t| t.status == "suggested")
        .unwrap()
        .id;
    db.dismiss(id).unwrap();
    assert!(!db.capture(source("m2"), || true).unwrap());
    assert_eq!(db.list().unwrap().len(), 1);
}

#[test]
fn reminder_retries_after_an_interrupted_claim_and_remembers_native_acceptance() {
    let path = std::env::temp_dir().join(format!(
        "chatmin-todo-test-{}-{}.db",
        std::process::id(),
        now_ms()
    ));
    let db = TodoStore::open(&path).unwrap();
    let id = db.save(None, draft(500_000, 100_000), None, 1).unwrap();
    assert!(db.claim_reminder(99_999).unwrap().is_none());
    let first = db.claim_reminder(100_000).unwrap().unwrap();
    assert_eq!((first.id, first.title.as_str()), (id, "Gửi báo cáo"));
    drop(db);

    let db = TodoStore::open(&path).unwrap();
    assert!(db.claim_reminder(100_001).unwrap().is_none());
    let retry = db.claim_reminder(160_000).unwrap().unwrap();
    assert!(!db.acknowledge(&first, 160_001).unwrap());
    assert!(db.acknowledge(&retry, 160_002).unwrap());
    assert!(db.claim_reminder(250_000).unwrap().is_none());

    db.save(Some(id), draft(500_000, 300_000), None, 250_000)
        .unwrap();
    let claim = db.claim_reminder(300_000).unwrap().unwrap();
    db.set_done(id, true, 300_001).unwrap();
    assert!(!db.acknowledge(&claim, 300_002).unwrap());
    db.set_done(id, false, 301_000).unwrap();
    assert!(db.claim_reminder(301_000).unwrap().is_none());
    db.save(Some(id), draft(500_000, 400_000), None, 301_000)
        .unwrap();
    assert!(db.claim_reminder(400_000).unwrap().is_some());
    drop(db);
    std::fs::remove_file(path).unwrap();
}

#[test]
fn removing_an_account_clears_pending_suggestions_and_saved_source_text() {
    let mut db = TodoStore::init(Connection::open_in_memory().unwrap()).unwrap();
    db.capture(source("m1"), || true).unwrap();
    db.save(None, draft(200_000, 100_000), Some(source("m2")), 1)
        .unwrap();
    db.remove_account("gc-1").unwrap();
    assert!(!db.capture(source("m3"), || false).unwrap());
    let rows = db.list().unwrap();
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].status, "open");
    assert!(rows[0].source.as_ref().unwrap().excerpt.is_empty());
}

#[test]
fn manual_capture_from_same_message_reuses_the_suggestion_and_validates_links() {
    let mut db = TodoStore::init(Connection::open_in_memory().unwrap()).unwrap();
    db.capture(source("m1"), || true).unwrap();
    let id = db.list().unwrap()[0].id;
    assert_eq!(
        db.save(None, draft(200_000, 100_000), Some(source("m1")), 1)
            .unwrap(),
        id
    );
    assert!(db
        .save(None, draft(200_000, 100_000), Some(source("m1")), 2)
        .is_err());
    let mut invalid = draft(200_000, 100_000);
    invalid.link = "javascript:alert(1)".into();
    assert!(db.save(Some(id), invalid, None, 3).is_err());
    assert!(db.save(None, draft(100_000, 200_000), None, 3).is_err());
}
