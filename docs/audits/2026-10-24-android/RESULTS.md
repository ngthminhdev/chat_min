# Android UI/UX fixes — 24/10/2026

## Current state

The Android changes are implemented locally and a new APK was built and installed on the connected A301SH (Android 15). No commit or push. The macOS app was not rebuilt or restarted.

The user additionally supplied an Android OAuth client JSON and authorized configuration. Google authorization now uses native Android AuthorizationClient. Its native Google AuthorizationActivity opened successfully on the installed build. End-to-end Google consent, Chat sync, cold restoration and revocation have **not** been verified with a real Google account. ADB disconnected immediately after the native Google screen opened, so native cancellation could not be checked in that attempt.

## Implemented

- Phone shell starts on a chronological conversation list with search/account/unread filters. Desktop titlebar, sidebar and tab strip are excluded on mobile.
- Conversation header has Back, avatar/readable title and one action menu. Secondary actions retain their existing handlers and appear with labels in a bottom sheet.
- Primary actions and reactions have 48px touch targets. Composer has tools, text and send/voice; it does not autofocus on chat entry. Software Enter inserts a newline.
- Native Back hides IME first, then closes UI layers/details/pages/threads, returns to the list, and backgrounds the root Android task. Drafts are retained.
- Sheets render in a portal, make the app frame inert, contain keyboard focus and restore it when closed.
- Mobile Settings excludes desktop background/window/shortcut controls and uses Android notification instructions. Google onboarding no longer requests Desktop OAuth JSON on Android.
- Android build preparation copies tracked native Activity/OAuth sources and declares RECORD_AUDIO so recording can request its runtime permission. Real microphone capture was not tested.
- Native Google auth uses the supplied Android registration and package/signing identity; validates UserInfo identity and required scopes; renews tokens silently without opening consent in background; handles cancellation/cache invalidation. No Android refresh token or client secret is stored.

## Verification

### Actual Android device

- App viewport: 420 × 858 CSS px, devicePixelRatio 3.
- List header actions: 48 × 48px. No desktop tab strip.
- Conversation title: 260px wide; header: 64px; composer bottom: y=858; no autofocus.
- With real software keyboard: viewport approximately 420 × 574; composer bottom approximately y=574.67. Enter on an empty draft inserted a newline. No message sent; the original empty draft was restored.
- Back from keyboard returned to full-height chat, without leaving it.
- Action sheet: x=0, width=420, height=354; underlying frame inert. System Back closed the sheet and retained the chat.
- Back from Settings returned to the list; desktop background selector absent.
- Notifications opened and closed using system Back.
- Long-press on an existing message opened its menu (8 items); Back closed it without leaving the chat. No menu action was executed.
- Touch swipe scrolled the list from 0 to 517px.
- Root Back moved the task to the background; the app PID stayed unchanged. Resuming brought the existing task forward.
- Final APK install succeeded; signing SHA-1 matches the documented Android OAuth registration. Merged APK manifest includes RECORD_AUDIO.
- Google onboarding showed the native login button with no Desktop JSON field. Invoking login opened `com.google.android.gms/.auth.api.credentials.authorization.ui.AuthorizationActivity`, with no inline error before launch.

### Automated / fixture checks

- Frontend Node tests: 23 passed, 0 failed.
- Rust tests: 32 passed, including identity and cancelled-login persistence regression coverage.
- Android cargo check, TypeScript and full APK build passed.
- Browser fixture checks at 360/390/420px: title widths 200/230/260px, 64px header, 48px primary controls, no horizontal overflow, retained draft after list navigation, Enter newline and full-viewport notifications.
- Additional fixtures: emoji insertion, details/thread Back, offline/long title, 390 × 420 reduced viewport, landscape, light theme, wizard Back.
- Empty chat composer and wizard occupy full viewport height (regression caught and fixed during independent review).
- Sheet keyboard focus/inert/Escape behavior independently verified. Desktop titlebar/sidebar/tabs remain present in the desktop fixture.
- Independent UI/spec and OAuth reviews completed; all important findings addressed. `git diff --check` passed.

Fixture measurements: [fixture-verification.json](fixture-verification.json). Screenshots prefixed `after-` use the **in-memory demo**, not private message content from the phone. They do not substitute for the actual-device measurements above.

## Artifacts / continuation

- APK: `src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk`
- Build/install helper: `scripts/android-build.sh` (`--no-install` builds without installing).
- Google setup and platform constraints: [android-google-oauth.md](../../android-google-oauth.md).
- Design: `docs/superpowers/specs/2026-10-24-android-mobile-design.md`.
- Plan: `docs/superpowers/plans/2026-10-24-android-mobile.md`.

Next required real-account check: finish Google account selection and grant permissions, confirm initial Chat sync and restart restoration. Console API enablement/Workspace policy still require actual account verification. Do not infer success from the native chooser opening.
