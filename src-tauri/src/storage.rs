//! Media cache housekeeping for what ChatMin keeps itself (Google Chat downloads, pasted
//! files waiting to send). Telegram's own files are pruned by TDLib (`Tg::optimize`).
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

/// Every file under `dir` with its size and last-modified time.
fn files(dir: &Path) -> Vec<(PathBuf, u64, SystemTime)> {
    let mut out = vec![];
    let mut stack = vec![dir.to_path_buf()];
    while let Some(d) = stack.pop() {
        for e in std::fs::read_dir(&d).into_iter().flatten().flatten() {
            let Ok(md) = e.metadata() else { continue };
            if md.is_dir() {
                stack.push(e.path());
            } else {
                out.push((e.path(), md.len(), md.modified().unwrap_or(SystemTime::UNIX_EPOCH)));
            }
        }
    }
    out
}

pub fn dir_size(dir: &Path) -> u64 {
    files(dir).iter().map(|f| f.1).sum()
}

/// Deletes files older than `ttl`, then the oldest until the rest fit in `limit` bytes.
/// Returns the bytes freed.
pub fn prune(dir: &Path, limit: Option<u64>, ttl: Option<Duration>) -> u64 {
    let now = SystemTime::now();
    let mut fs = files(dir);
    fs.sort_by_key(|f| f.2);
    let mut total: u64 = fs.iter().map(|f| f.1).sum();
    let mut freed = 0;
    for (path, size, at) in fs {
        let old = ttl.is_some_and(|t| now.duration_since(at).unwrap_or_default() > t);
        let over = limit.is_some_and(|l| total > l);
        if (old || over) && std::fs::remove_file(&path).is_ok() {
            total -= size;
            freed += size;
        }
    }
    freed
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prunes_old_then_oldest() {
        let dir = std::env::temp_dir().join(format!("chatmin-prune-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("sub")).unwrap();
        let put = |name: &str, len: usize, age_s: u64| {
            let p = dir.join(name);
            std::fs::write(&p, vec![0u8; len]).unwrap();
            let f = std::fs::File::options().write(true).open(&p).unwrap();
            f.set_modified(SystemTime::now() - Duration::from_secs(age_s)).unwrap();
        };
        put("ancient", 10, 10 * 86400);
        put("sub/old", 100, 300);
        put("new", 100, 0);
        assert_eq!(dir_size(&dir), 210);
        // ttl 1 day drops "ancient"; a 150-byte limit then drops the older of the two left
        assert_eq!(prune(&dir, Some(150), Some(Duration::from_secs(86400))), 110);
        assert!(dir.join("new").exists() && !dir.join("sub/old").exists());
        assert_eq!(prune(&dir, None, None), 0);
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
