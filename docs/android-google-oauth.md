# Google Chat authorization on Android

ChatMin uses Google Identity Services `AuthorizationClient` on Android. Google Play
services opens the account chooser and scope consent screen, then returns an access
token to Rust. Android does not use the desktop loopback redirect or a client secret.

## Current OAuth registration

- Cloud project: `chatmin-512409`
- Android package: `com.chatmin.app`
- Android client ID (public):
  `1072274940233-euo0umuej2tsbrfq1ir0barhkrolm4cu.apps.googleusercontent.com`
- Current debug signing certificate SHA-1:
  `8F:9C:71:1E:17:AC:31:3B:69:66:ED:87:18:7A:EB:58:5C:F4:1B:F8`

The client ID is documented in `scripts/android/GoogleAuthPlugin.kt`. The SDK selects
the Android registration using the installed package and signing certificate; this
client ID is not passed as a Web/server client. The downloaded Android client JSON
having no `client_secret` is expected. Do not add a fabricated secret or reuse a
Desktop/Web client in the Android form.

Google Cloud must have Google Chat API and People API enabled for this project. The
consent screen must allow the intended Workspace account (test user if External and
Testing), and Workspace administration must allow the requested scopes. Verify those
settings in Google Cloud; source code cannot establish their current state. Release
or Play signing uses a different certificate and needs a matching Android OAuth
registration. These console settings and real account consent have not been verified
by automated compilation.

## Build integration

Before `tauri android build`, `scripts/android-build.sh` must copy
`scripts/android/GoogleAuthPlugin.kt` into the generated app's
`src/main/java/com/chatmin/app/GoogleAuthPlugin.kt`, and ensure the generated app's
`build.gradle.kts` dependencies include:

```kotlin
implementation("com.google.android.gms:play-services-auth:22.0.0")
```

Rust registers the plugin in `src-tauri/src/google_android.rs`. No change to the
Android main activity is needed for OAuth; Tauri supplies activity-result handling.
Google Play services must be installed and working on the device.

## UI and persistence contract

- `app_state.gchatConfigured` is true on Android so onboarding does not ask for
  Desktop client JSON. Existing desktop configuration is unchanged.
- `gchat_login` requests native authorization with `Prompt.SELECT_ACCOUNT`, validates
  the returned user's stable subject and verified email through Google's UserInfo
  endpoint, and returns the normal `Account` object (`gc-<sub>`, `users/<sub>`).
- `login_cancel` cancels the pending native request; late activity results are ignored.
  The cancellation generation and account save share a commit gate, so a simultaneous
  UserInfo result cannot save a cancelled login. While a previously launched Google
  activity is still open, another interactive authorization is rejected as busy until
  that activity returns; it cannot replace the earlier activity-result callback.
- Only account identity is saved in ChatMin's account store on Android. Access tokens
  live in memory. ChatMin stores neither Android refresh tokens nor client secrets.
- On cold start or after conservative in-memory expiry, the poller calls `authorize`
  with the stored Google email and `interactive=false`. It never launches a chooser
  or consent resolution in this path. A result requiring user action marks the
  account expired so the user can reconnect explicitly.
- Renewals are serialized, invalid/replaced tokens (including rejected UserInfo
  tokens on cold restore) are cleared from the Google SDK cache, and restored tokens must identify the same stable Google subject as the
  account already stored. A Chat API 401 clears that token's expiry and retries once.
- Google controls the grant cache. Removing an account from ChatMin removes local
  account data; it does not revoke the project's Google grant.

Scopes: `openid`, UserInfo email/profile, `chat.spaces.readonly`, `chat.messages`,
`chat.memberships.readonly`, `chat.users.readstate`, and `directory.readonly`. ChatMin
checks that all API scopes were granted. Missing identity/API permissions require
reconnection; the app does not save a partially authorized account.

## Device acceptance checks

On a matching signed Android build: open Google Chat onboarding, select the intended
Workspace account, approve permissions, verify initial spaces/messages sync, restart
and confirm silent restore, then revoke access in Google's account settings and
confirm the app requests explicit reconnect instead of opening consent in the
background. Cancellation/back must not create an account. This needs the account
owner's interaction; do not infer it from builds or fixture tests.

## Sources

- [Android authorization guide](https://developer.android.com/identity/authorization)
- [AuthorizationRequest.Builder reference](https://developers.google.com/android/reference/com/google/android/gms/auth/api/identity/AuthorizationRequest.Builder)
