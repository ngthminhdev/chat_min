//! Android obtains short-lived Google tokens from Play services. No refresh token or
//! client secret is persisted by ChatMin; account identity remains in the normal store.
use crate::model::Account;
use serde_json::Value;

pub(crate) fn account_from_userinfo(info: &Value) -> Result<Account, String> {
    let sub = info["sub"]
        .as_str()
        .filter(|s| !s.is_empty() && s.bytes().all(|b| b.is_ascii_digit()))
        .ok_or("Google chưa trả mã tài khoản hợp lệ")?;
    let email = info["email"]
        .as_str()
        .filter(|s| s.contains('@'))
        .ok_or("Google chưa trả email tài khoản")?;
    if info["email_verified"].as_bool() != Some(true) {
        return Err("Google chưa xác nhận email tài khoản".into());
    }
    Ok(Account {
        id: format!("gc-{sub}"),
        platform: "gchat".into(),
        name: "Google Chat".into(),
        color: "purple".into(),
        handle: email.into(),
        self_id: format!("users/{sub}"),
    })
}

/// Cancellation and account persistence share one gate so a cancelled attempt
/// cannot commit even if its network result and cancellation become ready together.
#[derive(Default)]
pub(crate) struct LoginCancellation(std::sync::Mutex<u64>);

impl LoginCancellation {
    pub fn begin(&self) -> u64 {
        *self.0.lock().unwrap()
    }
    pub fn cancel(&self) {
        let mut generation = self.0.lock().unwrap();
        *generation = generation.wrapping_add(1);
    }
    pub fn commit<T>(
        &self,
        attempt: u64,
        save: impl FnOnce() -> Result<T, String>,
    ) -> Result<T, String> {
        let generation = self.0.lock().unwrap();
        if *generation != attempt {
            return Err("cancelled".into());
        }
        // Hold this guard until persistence finishes: cancel linearizes before or
        // after the commit, never between the generation check and the actual save.
        save()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn cancelled_attempt_cannot_persist_even_after_identity_finishes() {
        let cancellation = LoginCancellation::default();
        let attempt = cancellation.begin();
        cancellation.cancel();
        let mut saved = false;
        assert_eq!(
            cancellation.commit(attempt, || {
                saved = true;
                Ok(())
            }),
            Err("cancelled".into())
        );
        assert!(!saved);
        assert!(cancellation.commit(cancellation.begin(), || Ok(())).is_ok());
    }

    #[test]
    fn authorization_identity_uses_stable_google_subject() {
        let account = account_from_userinfo(
            &json!({"sub":"123456", "email":"me@example.com", "email_verified":true}),
        )
        .unwrap();
        assert_eq!(account.id, "gc-123456");
        assert_eq!(account.self_id, "users/123456");
        assert_eq!(account.handle, "me@example.com");
    }

    #[test]
    fn authorization_requires_subject_and_verified_email_for_silent_restore() {
        for info in [
            json!({"email":"me@example.com","email_verified":true}),
            json!({"sub":"123"}),
            json!({"sub":"123","email":"me@example.com","email_verified":false}),
        ] {
            assert!(account_from_userinfo(&info).is_err());
        }
    }
}

#[cfg(target_os = "android")]
mod native {
    use serde::Deserialize;
    use serde_json::json;
    use tauri::{
        plugin::{mobile::PluginInvokeError, Builder, PluginHandle, TauriPlugin},
        Manager,
    };

    pub struct GoogleAuth(PluginHandle<tauri::Wry>);

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct Authorization {
        pub access_token: String,
    }

    pub fn init() -> TauriPlugin<tauri::Wry> {
        Builder::new("google-auth")
            .setup(|app, api| {
                let handle = api.register_android_plugin("com.chatmin.app", "GoogleAuthPlugin")?;
                app.manage(GoogleAuth(handle));
                Ok(())
            })
            .build()
    }

    impl GoogleAuth {
        pub async fn authorize(
            &self,
            interactive: bool,
            email: Option<&str>,
            invalid_token: Option<&str>,
        ) -> Result<Authorization, PluginInvokeError> {
            self.0.run_mobile_plugin_async("authorize", json!({ "interactive": interactive, "email": email, "invalidToken": invalid_token })).await
        }

        pub async fn invalidate(&self, token: &str) {
            let _: Result<(), _> = self
                .0
                .run_mobile_plugin_async("invalidate", json!({"token": token}))
                .await;
        }

        pub async fn cancel(&self) {
            let _: Result<(), _> = self.0.run_mobile_plugin_async("cancel", ()).await;
        }
    }

    pub fn is_authorization_required(error: &PluginInvokeError) -> bool {
        matches!(error, PluginInvokeError::InvokeRejected(e) if matches!(e.code.as_deref(), Some("authorization_required" | "cancelled")))
    }

    pub fn login_error(error: PluginInvokeError) -> String {
        match error {
            PluginInvokeError::InvokeRejected(e) if e.code.as_deref() == Some("cancelled") => {
                "cancelled".into()
            }
            other => other.to_string(),
        }
    }
}

#[cfg(target_os = "android")]
pub use native::*;
