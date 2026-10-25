//! Bounded notification groups and screen-space geometry; independent of AppKit.
pub const MAX_GROUPS: usize = 12;

#[derive(Clone, Debug)]
pub struct Group {
    pub key: String,
    pub title: String,
    pub body: String,
    pub target: String,
    pub count: usize,
    pub avatar_ref: String,
    pub avatar_path: String,
}

#[derive(Default)]
pub struct IslandQueue {
    pub groups: Vec<Group>, // newest group first
}

impl IslandQueue {
    #[cfg(test)]
    pub fn push(&mut self, title: &str, body: &str, target: &str) -> bool {
        self.push_with_avatar(title, body, target, "")
    }
    pub fn push_with_avatar(&mut self, title: &str, body: &str, target: &str, photo: &str) -> bool {
        let title: String = title.chars().take(160).collect();
        let body: String = body.chars().take(320).collect();
        let chat = target.split('\n').next().unwrap_or("");
        let key = if chat.is_empty() {
            format!("alert:{title}")
        } else {
            chat.to_owned()
        };
        let previous = self.groups.iter().position(|g| g.key == key);
        if previous.is_some_and(|i| self.groups[i].target == target && self.groups[i].title == title && self.groups[i].body == body) {
            return false;
        }
        let old = previous.map(|i| self.groups.remove(i));
        let count = old.as_ref().map(|g| g.count.saturating_add(1).min(999)).unwrap_or(1);
        let avatar_path = old.filter(|g| g.avatar_ref == photo).map(|g| g.avatar_path).unwrap_or_default();
        self.groups.insert(
            0,
            Group {
                key,
                title,
                body,
                target: target.to_owned(),
                count,
                avatar_ref: photo.to_owned(),
                avatar_path,
            },
        );
        self.groups.truncate(MAX_GROUPS);
        true
    }

    /// Late image completions may only update the same rendered message and source.
    pub fn set_avatar(&mut self, target: &str, source: &str, path: &str) -> bool {
        if !path.starts_with('/') {
            return false;
        }
        let Some(g) = self.groups.iter_mut().find(|g| g.target == target && g.avatar_ref == source) else {
            return false;
        };
        g.avatar_path = path.to_owned();
        true
    }

    pub fn total(&self) -> usize {
        self.groups.iter().map(|g| g.count).sum()
    }

    pub fn remove_chat(&mut self, key: &str) -> bool {
        let before = self.groups.len();
        self.groups.retain(|g| g.key != key);
        self.groups.len() != before
    }

    pub fn take_matching(&mut self, key: &str, target: &str) -> Option<Group> {
        let index = self.groups.iter().position(|g| g.key == key && g.target == target)?;
        self.take(index)
    }

    pub fn take(&mut self, index: usize) -> Option<Group> {
        (index < self.groups.len()).then(|| self.groups.remove(index))
    }
}

#[derive(Debug)]
pub struct Placement {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[cfg(test)]
fn placement(x: f64, y: f64, width: f64, height: f64, notch_height: f64, panel_height: f64) -> Placement {
    placement_with_width(x, y, width, height, notch_height, 520.0, panel_height)
}

pub fn placement_with_width(x: f64, y: f64, width: f64, height: f64, _notch_height: f64, panel_width: f64, panel_height: f64) -> Placement {
    let panel_width = panel_width.min((width - 24.0).max(1.0));
    Placement {
        x: x + (width - panel_width) / 2.0,
        y: y + height - panel_height,
        width: panel_width,
        height: panel_height,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn avatar_completion_cannot_replace_a_new_sender_or_reopen_a_dismissed_group() {
        let mut q = IslandQueue::default();
        q.push_with_avatar("An", "first", "tg-1|42\nm1", "111");
        assert!(q.set_avatar("tg-1|42\nm1", "111", "/cache/an.jpg"));
        assert_eq!(q.groups[0].avatar_path, "/cache/an.jpg");
        q.push_with_avatar("Bình", "second", "tg-1|42\nm2", "222");
        assert!(!q.set_avatar("tg-1|42\nm1", "111", "/cache/an.jpg"));
        assert!(!q.set_avatar("tg-1|42\nm2", "111", "/cache/an.jpg"));
        assert!(q.groups[0].avatar_path.is_empty());
        assert!(q.set_avatar("tg-1|42\nm2", "222", "/cache/binh.jpg"));
        q.remove_chat("tg-1|42");
        assert!(!q.set_avatar("tg-1|42\nm2", "222", "/cache/binh.jpg"));
        assert!(q.groups.is_empty());
    }

    #[test]
    fn opening_one_group_preserves_the_other_destinations() {
        let mut q = IslandQueue::default();
        q.push("One", "a", "a|1\nm1\nt1");
        q.push("Two", "b", "a|2\nm2\nt2");
        assert_eq!(q.take(0).unwrap().target, "a|2\nm2\nt2");
        assert_eq!(q.groups[0].target, "a|1\nm1\nt1");
        assert!(q.take(4).is_none());
        assert_eq!(q.total(), 1);
    }
    #[test]
    fn clicking_a_rendered_notice_preserves_a_newer_delivery() {
        let mut q = IslandQueue::default();
        q.push("One", "shown", "a|1\nm1");
        q.push("One", "pending", "a|1\nm2");
        q.push("Two", "pending other", "a|2\nm3");
        assert!(q.take_matching("a|1", "a|1\nm1").is_none());
        assert_eq!(q.total(), 3);
        assert_eq!(q.take_matching("a|2", "a|2\nm3").unwrap().target, "a|2\nm3");
        assert_eq!(q.groups[0].target, "a|1\nm2");
    }
    #[test]
    fn bursts_group_by_account_and_chat_and_open_the_latest_message() {
        let mut q = IslandQueue::default();
        q.push("An · Team", "one", "tg-1|42\nm1\nt1");
        q.push("Bình · Team", "two", "tg-1|42\nm2\nt2");
        assert_eq!(q.groups.len(), 1);
        assert_eq!(q.groups[0].count, 2);
        assert_eq!(q.groups[0].target, "tg-1|42\nm2\nt2");
        q.push("Team", "other account", "tg-2|42\nm1");
        assert_eq!(q.groups.len(), 2);
    }
    #[test]
    fn identical_delivery_is_not_counted_twice_and_groups_are_bounded() {
        let mut q = IslandQueue::default();
        for _ in 0..10 {
            q.push("Team", "same", "tg|42\nm1");
        }
        assert_eq!(q.total(), 1);
        for i in 0..100 {
            q.push("Team", "new", &format!("tg|{i}\nm1"));
        }
        assert_eq!(q.groups.len(), MAX_GROUPS);
        assert_eq!(q.groups[0].target, "tg|99\nm1");
    }
    #[test]
    fn read_removes_only_the_exact_chat_and_empty_targets_are_separate_alerts() {
        let mut q = IslandQueue::default();
        q.push("Same title", "a", "a|1\nm1");
        q.push("Same title", "b", "b|1\nm1");
        q.push("Account expired", "sign in", "");
        q.remove_chat("a|1");
        assert_eq!(q.total(), 2);
        assert!(!q.groups.iter().any(|g| g.key == "a|1"));
        q.push("Another account expired", "sign in", "");
        assert_eq!(q.groups.len(), 3);
    }
    #[test]
    fn previews_are_bounded_without_splitting_unicode() {
        let mut q = IslandQueue::default();
        q.push(&"ế".repeat(500), &"👋".repeat(5000), "a|b");
        assert!(q.groups[0].title.chars().count() <= 160);
        assert!(q.groups[0].body.chars().count() <= 320);
    }
    #[test]
    fn notch_and_plain_screens_anchor_in_logical_points_with_offsets() {
        let p = placement(0.0, 0.0, 1512.0, 982.0, 32.0, 136.0);
        assert_eq!(p.x + p.width / 2.0, 756.0);
        assert_eq!(p.y + p.height, 982.0); // starts at the physical screen edge
        let external = placement(-1920.0, 200.0, 1920.0, 1080.0, 0.0, 136.0);
        assert_eq!(external.x + external.width / 2.0, -960.0);
        assert_eq!(external.y + external.height, 1280.0);
        let narrow = placement(0.0, 0.0, 400.0, 600.0, 0.0, 136.0);
        assert_eq!(narrow.width, 376.0);
        assert!(narrow.x >= 0.0 && narrow.x + narrow.width <= 400.0);
    }
}
