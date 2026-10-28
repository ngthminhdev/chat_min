//! Deterministic, bounded notification bookkeeping; no AppKit or WebView dependency.
use std::{collections::HashMap, time::Instant};
pub const MAX_DIGEST_CHATS: usize = 128;
pub const DOCK_BOUNCE_MS: u64 = 30_000;
#[derive(Default)]
pub struct AttentionRequest {
    current: Option<isize>,
}
impl AttentionRequest {
    pub fn is_active(&self) -> bool {
        self.current.is_some()
    }
    pub fn begin(&mut self, request: isize) -> Option<isize> {
        self.current.replace(request)
    }
    pub fn finish(&mut self, expected: Option<isize>) -> Option<isize> {
        if expected.is_some() && expected != self.current {
            return None;
        }
        self.current.take()
    }
}
#[derive(Default)]
struct UnreadChat {
    raw: i32,
    badge: i32,
}
#[derive(Default)]
pub struct UnreadBadge {
    counts: HashMap<(String, String), UnreadChat>,
    pub total: i64,
}
impl UnreadBadge {
    pub fn update_muted(
        &mut self,
        account: &str,
        chat: &str,
        count: i32,
        muted: bool,
    ) -> (i32, i64) {
        let key = (account.to_owned(), chat.to_owned());
        let count = count.max(0);
        let badge = if muted { 0 } else { count };
        let was = if count == 0 {
            self.counts.remove(&key).unwrap_or_default()
        } else {
            self.counts
                .insert(key, UnreadChat { raw: count, badge })
                .unwrap_or_default()
        };
        self.total += i64::from(badge) - i64::from(was.badge);
        (was.raw, self.total)
    }
    pub fn update(&mut self, account: &str, chat: &str, count: i32) -> (i32, i64) {
        self.update_muted(account, chat, count, false)
    }
    pub fn remove_account(&mut self, account: &str) {
        self.counts.retain(|(a, _), n| {
            if a == account {
                self.total -= i64::from(n.badge);
                false
            } else {
                true
            }
        });
    }
}
#[derive(Default)]
pub struct BounceGate {
    last: Option<Instant>,
}
impl BounceGate {
    pub fn allow(
        &mut self,
        now: Instant,
        enabled: bool,
        foreground: bool,
        reduce_motion: bool,
    ) -> bool {
        if !enabled
            || foreground
            || reduce_motion
            || self
                .last
                .is_some_and(|last| now.saturating_duration_since(last).as_secs() < 10)
        {
            return false;
        }
        self.last = Some(now);
        true
    }
}
pub struct MissedChat {
    pub title: String,
    pub key: String,
    pub count: usize,
    pub mentions: usize,
}
#[derive(Default)]
pub struct Digest {
    pub groups: Vec<MissedChat>,
}
impl Digest {
    pub fn push(&mut self, title: &str, key: &str, mentioned: bool) {
        if let Some(group) = self.groups.iter_mut().find(|g| g.key == key) {
            group.count = group.count.saturating_add(1);
            group.mentions = group.mentions.saturating_add(usize::from(mentioned));
            return;
        }
        if self.groups.len() == MAX_DIGEST_CHATS {
            self.groups.remove(0);
        }
        self.groups.push(MissedChat {
            title: title.chars().take(160).collect(),
            key: key.to_owned(),
            count: 1,
            mentions: usize::from(mentioned),
        });
    }
    pub fn total(&self) -> usize {
        self.groups.iter().map(|g| g.count).sum()
    }
    pub fn remove_chat(&mut self, key: &str) {
        self.groups.retain(|g| g.key != key);
    }
    pub fn only_mentions(&mut self, account: &str) {
        self.groups.retain_mut(|group| {
            if group.key.split('|').next() == Some(account) {
                group.count = group.mentions;
            }
            group.count > 0
        });
    }
    pub fn remove_account(&mut self, account: &str) {
        self.groups
            .retain(|g| g.key.split('|').next() != Some(account));
    }
    pub fn summary(&self) -> Option<(String, String, String)> {
        let first = self.groups.first()?;
        let names: Vec<&str> = self
            .groups
            .iter()
            .take(3)
            .map(|g| g.title.as_str())
            .collect();
        let more = if self.groups.len() > 3 {
            format!(" +{} chat", self.groups.len() - 3)
        } else {
            String::new()
        };
        Some((
            format!("{} tin nhắn trong lúc vắng", self.total()),
            format!("{}{more}", names.join(", ")),
            first.key.clone(),
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{Duration, Instant};

    #[test]
    fn stale_stop_timer_cannot_cancel_a_newer_bounce_and_activation_clears_it() {
        let mut pending = AttentionRequest::default();
        assert!(!pending.is_active());
        assert_eq!(pending.begin(11), None);
        assert!(pending.is_active());
        assert_eq!(pending.begin(12), Some(11));
        assert_eq!(pending.finish(Some(11)), None);
        assert_eq!(pending.finish(None), Some(12));
        assert!(!pending.is_active());
        assert_eq!(pending.finish(Some(12)), None);
        pending.begin(13);
        assert_eq!(pending.finish(Some(13)), Some(13));
        assert_eq!(pending.finish(None), None);
    }

    #[test]
    fn unread_totals_replace_remove_and_clamp_without_retaining_zeroes() {
        let mut badge = UnreadBadge::default();
        assert_eq!(badge.update("a", "chat", 4), (0, 4));
        assert_eq!(badge.update("b", "chat", 2), (0, 6));
        assert_eq!(badge.update("a", "chat", 1), (4, 3));
        assert_eq!(badge.update("a", "chat", -9), (1, 2));
        assert_eq!(badge.counts.len(), 1);
        badge.remove_account("b");
        assert_eq!(badge.total, 0);
        assert!(badge.counts.is_empty());
        for i in 0..10_000 {
            badge.update("a", &i.to_string(), 0);
        }
        assert!(badge.counts.is_empty());
    }

    #[test]
    fn muted_mentions_can_be_cleared_on_read_without_contributing_to_badge() {
        let mut badge = UnreadBadge::default();
        assert_eq!(badge.update_muted("tg-a", "group", 3, true), (0, 0));
        assert_eq!(badge.update_muted("tg-a", "group", 4, true), (3, 0));
        assert_eq!(badge.update_muted("tg-a", "group", 0, true), (4, 0));
        assert!(badge.counts.is_empty());
        badge.update("a", "chat", 5);
        assert_eq!(badge.update_muted("a", "chat", 5, true), (5, 0));
        assert_eq!(badge.update_muted("a", "chat", 5, false), (5, 5));
    }

    #[test]
    fn badge_total_matches_full_sum_through_mixed_provider_updates() {
        let mut badge = UnreadBadge::default();
        for i in 0..20_000 {
            badge.update(
                if i % 2 == 0 { "tg" } else { "gc" },
                &(i % 311).to_string(),
                (i % 13) - 2,
            );
            assert_eq!(
                badge.total,
                badge
                    .counts
                    .values()
                    .map(|n| i64::from(n.badge))
                    .sum::<i64>()
            );
        }
    }

    #[test]
    fn bounce_is_background_only_and_bursts_do_not_extend_cooldown() {
        let mut gate = BounceGate::default();
        let now = Instant::now();
        assert!(!gate.allow(now, true, true, false));
        assert!(!gate.allow(now, false, false, false));
        assert!(!gate.allow(now, true, false, true));
        assert!(gate.allow(now, true, false, false));
        for i in 1..10 {
            assert!(!gate.allow(now + Duration::from_secs(i), true, false, false));
        }
        assert!(gate.allow(now + Duration::from_secs(10), true, false, false));
    }

    #[test]
    fn catchup_is_bounded_and_read_chats_are_removed_by_identity() {
        let mut digest = Digest::default();
        for _ in 0..10_000 {
            digest.push("Same name", "a|1", false);
        }
        digest.push("Same name", "b|1", false);
        assert_eq!(digest.total(), 10_001);
        assert_eq!(digest.groups.len(), 2);
        digest.remove_chat("a|1");
        assert_eq!(digest.total(), 1);
        assert_eq!(digest.summary().unwrap().2, "b|1");
        let mut bounded = Digest::default();
        for i in 0..10_000 {
            bounded.push("Group", &format!("c|{i}"), false);
        }
        assert!(bounded.groups.len() <= MAX_DIGEST_CHATS);
        digest.push("Group", "c|1", false);
        assert!(digest.groups.len() <= MAX_DIGEST_CHATS);
        digest.remove_account("c");
        assert_eq!(digest.total(), 1);
    }

    #[test]
    fn switching_to_mentions_only_filters_pending_catchup_without_losing_mentions() {
        let mut digest = Digest::default();
        digest.push("Group", "a|1", false);
        digest.push("Group", "a|1", true);
        digest.push("Other group", "a|2", false);
        digest.push("Other account", "b|1", false);
        digest.only_mentions("a");
        assert_eq!(digest.total(), 2);
        assert_eq!(digest.groups.len(), 2);
        assert_eq!(digest.groups[0].count, 1);
        assert_eq!(digest.groups[1].key, "b|1");
    }
}
