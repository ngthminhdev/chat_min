//! Durable sender metadata is independent of message pages; enriching an avatar never scans
//! or rewrites the full message database. Only loaded pages are hydrated.
use crate::model::{Chat, Msg, SenderProfile};
use std::{collections::HashMap, path::Path, sync::Mutex};
#[derive(Default)]
pub struct Profiles {
    entries: Mutex<HashMap<(String, String), SenderProfile>>,
}
impl Profiles {
    pub fn load(&self, account: &str, dir: &Path) {
        let rows = std::fs::read(dir.join("profiles.json"))
            .ok()
            .and_then(|s| serde_json::from_slice::<serde_json::Value>(&s).ok())
            .and_then(|v| serde_json::from_value::<Vec<SenderProfile>>(v["users"].clone()).ok())
            .unwrap_or_default();
        self.remember(account, rows);
    }
    pub fn remember(&self, account: &str, profiles: Vec<SenderProfile>) -> Vec<SenderProfile> {
        let mut entries = self.entries.lock().unwrap();
        let mut changed = Vec::new();
        for p in profiles {
            let key = (account.to_string(), p.id.clone());
            if entries.get(&key) != Some(&p) {
                entries.insert(key, p.clone());
                changed.push(p);
            }
        }
        changed
    }
    pub fn remove(&self, account: &str) {
        self.entries
            .lock()
            .unwrap()
            .retain(|(a, _), _| a != account);
    }
    pub fn messages(&self, cache: &Path, msgs: &mut [Msg]) {
        let entries = self.entries.lock().unwrap();
        for m in msgs
            .iter_mut()
            .filter(|m| m.account_id.starts_with("zalo-"))
        {
            if let Some(p) = entries.get(&(m.account_id.clone(), m.sender_id.clone())) {
                if !p.photo.is_empty() {
                    m.sender_photo = p.photo.clone();
                }
                if !p.name.is_empty() {
                    m.sender_name = p.name.clone();
                }
            }
            m.sender_photo = cached_avatar(cache, &m.account_id, &m.sender_photo);
        }
    }
    pub fn chats(&self, cache: &Path, chats: &mut [Chat]) {
        let entries = self.entries.lock().unwrap();
        for c in chats
            .iter_mut()
            .filter(|c| c.account_id.starts_with("zalo-"))
        {
            if let Some(id) = c.id.strip_prefix("u:") {
                if let Some(p) = entries.get(&(c.account_id.clone(), id.into())) {
                    if !p.name.is_empty() {
                        c.title = p.name.clone();
                    }
                    if !p.photo.is_empty() {
                        c.photo = p.photo.clone();
                    }
                }
            }
            c.photo = cached_avatar(cache, &c.account_id, &c.photo);
        }
    }
}
pub fn cached_avatar(cache: &Path, account: &str, url: &str) -> String {
    if url.starts_with("https://") {
        let p = crate::zalo::media_path(cache, account, url, "avatar");
        if p.is_file() {
            return p.to_string_lossy().into();
        }
    }
    url.into()
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn canonical_contact_name_hydrates_messages_and_chats_but_not_groups() {
        let profiles = Profiles::default();
        profiles.remember(
            "zalo-a",
            vec![SenderProfile {
                id: "42".into(),
                name: "Contact alias".into(),
                photo: "https://a.zadn.vn/a".into(),
            }],
        );
        let mut msgs = vec![Msg {
            account_id: "zalo-a".into(),
            sender_id: "42".into(),
            sender_name: "Old wire name".into(),
            ..Default::default()
        }];
        let mut chats = vec![
            Chat {
                account_id: "zalo-a".into(),
                id: "u:42".into(),
                title: "Old wire name".into(),
                ..Default::default()
            },
            Chat {
                account_id: "zalo-a".into(),
                id: "g:42".into(),
                title: "Group".into(),
                ..Default::default()
            },
        ];
        profiles.messages(Path::new("/nonexistent"), &mut msgs);
        profiles.chats(Path::new("/nonexistent"), &mut chats);
        assert_eq!(msgs[0].sender_name, "Contact alias");
        assert_eq!(chats[0].title, "Contact alias");
        assert_eq!(chats[1].title, "Group");
    }
    #[test]
    fn hydrated_sender_uses_cached_avatar_without_rewriting_message_history() {
        let profiles = Profiles::default();
        let dir = std::env::temp_dir().join(format!("chatmin-profile-{}", crate::now_ms()));
        let url = "https://a.zadn.vn/avatar.jpg";
        let p = crate::zalo::media_path(&dir, "zalo-a", url, "avatar");
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(&p, b"cached").unwrap();
        profiles.remember(
            "zalo-a",
            vec![SenderProfile {
                id: "42".into(),
                name: "Lan".into(),
                photo: url.into(),
            }],
        );
        let mut page = vec![
            Msg {
                account_id: "zalo-a".into(),
                sender_id: "42".into(),
                ..Default::default()
            },
            Msg {
                account_id: "zalo-b".into(),
                sender_id: "42".into(),
                ..Default::default()
            },
        ];
        profiles.messages(&dir, &mut page);
        assert_eq!(page[0].sender_photo, p.to_string_lossy());
        assert_eq!(page[0].sender_name, "Lan");
        assert_eq!(page[1].sender_photo, "");
        std::fs::remove_dir_all(dir).unwrap();
    }
}
