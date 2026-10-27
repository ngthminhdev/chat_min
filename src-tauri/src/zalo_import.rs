//! One-time owned WebKit cache migration. Regular Zalo operation needs no Python/parser.
use crate::{
    model::{Chat, Msg},
    store::Store,
};
use serde::{Deserialize, Serialize};
use std::{
    io::{BufRead, BufReader},
    path::Path,
};
#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CacheRecord {
    pub owner_self_id: String,
    pub msg: Msg,
    pub chat: Option<Chat>,
}
#[derive(Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportStats {
    pub read: usize,
    pub inserted: usize,
    pub existing: usize,
}
pub fn import_file(database: &Path, input: &Path, account: &str) -> Result<String, String> {
    let metadata = std::fs::symlink_metadata(input).map_err(|_| "cache_input_missing")?;
    if !metadata.is_file() || metadata.len() > 256 << 20 {
        return Err("cache_input_budget".into());
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if metadata.permissions().mode() & 0o077 != 0 {
            return Err("cache_input_not_private".into());
        }
    }
    let mut store = Store::open(database)?;
    let mut stats = ImportStats::default();
    let mut batch = Vec::with_capacity(100);
    let file = std::fs::File::open(input).map_err(|_| "cache_input_missing")?;
    for line in BufReader::new(file).lines() {
        let line = line.map_err(|_| "cache_input_read_failed")?;
        if line.is_empty() {
            continue;
        }
        if line.len() > 4 << 20 || stats.read >= 100000 {
            return Err("cache_input_budget".into());
        }
        let record: CacheRecord =
            serde_json::from_str(&line).map_err(|_| "invalid_cache_record")?;
        batch.push(record);
        stats.read += 1;
        if batch.len() == 100 {
            let (inserted, existing) = store.import_zalo_records(account, &batch)?;
            stats.inserted += inserted;
            stats.existing += existing;
            batch.clear();
        }
    }
    if !batch.is_empty() {
        let (inserted, existing) = store.import_zalo_records(account, &batch)?;
        stats.inserted += inserted;
        stats.existing += existing;
    }
    serde_json::to_string(&stats).map_err(|_| "cache_report_failed".into())
}
#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::Account;
    fn store() -> Store {
        let s = Store::memory();
        s.put_account(&Account {
            id: "zalo-a".into(),
            platform: "zalo".into(),
            name: "Zalo".into(),
            color: "blue".into(),
            handle: "".into(),
            self_id: "1".into(),
        })
        .unwrap();
        s
    }
    fn record(id: &str, text: &str) -> CacheRecord {
        CacheRecord {
            owner_self_id: "1".into(),
            msg: Msg {
                account_id: "zalo-a".into(),
                chat_id: "u:42".into(),
                id: id.into(),
                sort: 100,
                sender_id: "42".into(),
                sender_name: "Lan".into(),
                text: text.into(),
                kind: "text".into(),
                ts: 100,
                ..Default::default()
            },
            chat: Some(Chat {
                account_id: "zalo-a".into(),
                id: "u:42".into(),
                kind: "dm".into(),
                title: "Lan".into(),
                can_send: true,
                ..Default::default()
            }),
        }
    }
    #[test]
    fn import_is_idempotent_and_never_overwrites_live_canonical_rows() {
        let mut s = store();
        let live = record("7", "current canonical");
        s.put_msg(&live.msg).unwrap();
        let rows = vec![
            record("7", "stale copy"),
            record("8", "historical searchable"),
        ];
        assert_eq!(s.import_zalo_records("zalo-a", &rows).unwrap(), (1, 1));
        assert_eq!(s.import_zalo_records("zalo-a", &rows).unwrap(), (0, 2));
        assert_eq!(
            s.msg("zalo-a", "u:42", "7").unwrap().unwrap().text,
            "current canonical"
        );
        assert_eq!(
            s.search("historical", Some(("zalo-a", "")), 10)
                .unwrap()
                .len(),
            1
        );
        assert_eq!(s.chat("zalo-a", "u:42").unwrap().unwrap().unread, 0);
    }
    #[test]
    fn a_native_recall_also_blocks_later_legacy_import() {
        let mut s = store();
        s.recall_zalo("zalo-a", "u:42", &["8".into()]).unwrap();
        assert_eq!(
            s.import_zalo_records("zalo-a", &[record("8", "recalled body")])
                .unwrap(),
            (0, 1)
        );
        assert!(s.msg("zalo-a", "u:42", "8").unwrap().is_none());
        assert!(s
            .search("recalled", Some(("zalo-a", "")), 10)
            .unwrap()
            .is_empty());
    }
    #[test]
    fn owner_failure_rolls_back_whole_batch() {
        let mut s = store();
        let good = record("7", "old");
        let mut bad = record("8", "bad");
        bad.owner_self_id = "other".into();
        assert!(s.import_zalo_records("zalo-a", &[good, bad]).is_err());
        assert!(s.msgs("zalo-a", "u:42", 0, 50).unwrap().is_empty());
    }
}
