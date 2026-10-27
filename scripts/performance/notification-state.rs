//! Offline bookkeeping benchmark. rustc -O --edition=2021 scripts/performance/notification-state.rs -o /tmp/chatmin-notify-bench
#[allow(dead_code)]
#[path = "../../src-tauri/src/notify_state.rs"]
mod state;
use std::{collections::HashMap, hint::black_box, time::Instant};

fn main() {
    let chats: Vec<String> = (0..2_000).map(|i| i.to_string()).collect();
    let run = |incremental: bool| {
        let mut badge = state::UnreadBadge::default();
        let mut old = HashMap::new();
        for chat in &chats {
            if incremental { badge.update("a", chat, 1); }
            else { old.insert(("a".to_owned(), chat.clone()), 1i32); }
        }
        let start = Instant::now();
        let mut checksum = 0i64;
        for n in 0..50_000 {
            let chat = &chats[n % chats.len()];
            let count = (n % 7) as i32 + 1;
            let total = if incremental { badge.update("a", chat, count).1 }
                else {
                    old.insert(("a".to_owned(), chat.clone()), count);
                    old.values().map(|&n| i64::from(n)).sum()
                };
            checksum += black_box(total);
        }
        (start.elapsed().as_micros(), checksum)
    };
    let mut before = Vec::new();
    let mut after = Vec::new();
    for n in 0..9 {
        // Alternate order to reduce systematic warm CPU bias.
        let (a, b) = if n % 2 == 0 { (run(false), run(true)) }
            else { let b = run(true); (run(false), b) };
        assert_eq!(a.1, b.1);
        before.push(a.0); after.push(b.0);
    }
    before.sort(); after.sort();
    println!("{{\"chats\":2000,\"updates\":50000,\"samples\":9,\"full_sum_median_us\":{},\"incremental_median_us\":{},\"checksums_equal\":true}}", before[4], after[4]);
}
