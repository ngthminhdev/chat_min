# Android Mobile UX Implementation Plan

**Goal:** Make the existing Android build usable by touch while retaining the desktop UI and shared themes.

**Architecture:** Mobile presentation uses the existing Inbox data and store, one header per screen and reusable action sheets. A pure navigation resolver is tested independently; the Android Activity delegates Back to the UI and backgrounds only at the root. Following the user's supplied Android Client JSON and configuration request, Google authorization uses a native AuthorizationClient plugin with verified identity and silent token renewal.

**Tech Stack:** React, Zustand, CSS tokens, Tauri, Kotlin, Node test runner, ADB/CDP.

- [x] Add failing tests for Back precedence (overlay, details, subpage, thread, chat, root), conversation visibility and mobile Enter/newline behavior. Run `node --experimental-strip-types --test src/lib/mobile-navigation.test.mjs` and confirm failure before implementing the helpers.
- [x] Implement helpers and mobile shell. Modify `src/App.tsx`, `src/store.ts`, create `src/components/MobileHeader.tsx`, `src/lib/mobile.ts`, `src/lib/mobile-navigation.ts`, `src/mobile.ts`. Use `getMobileBackTarget(state)` to choose the action without changing drafts. Render Inbox for the mobile list and remove Sidebar/Tabs/desktop Titlebar on mobile.
- [x] Create `src/ui/MobileActions.tsx`, wrap existing conversation/thread/composer controls so their handlers remain shared. Put extra actions in labeled sheets; give primary and sheet buttons 48px hit targets. Prevent automatic keyboard focus and software Enter sending on mobile.
- [x] Adapt Inbox filters, Settings and Wizard for mobile; use native scroll, meaningful Back/cancel actions and platform-specific Google guidance. Add `src/styles/mobile.css` after existing CSS so touch geometry is explicit and inspectable.
- [x] Add tracked `scripts/android/MainActivity.kt` and copy it during `scripts/android-build.sh`. Native Back hides visible IME, calls `window.__chatminBack()`, and uses `moveTaskToBack(true)` only if the UI reports root. Ensure `adjustResize` for IME.
- [x] Run `npm test`, `npx tsc --noEmit`, browser fixture interaction/layout checks, and request an independent code review. Resolve important findings before final packaging.
- [ ] Run `scripts/android-build.sh --no-install`, inspect build output, install on the connected device, and verify actual header/button geometry, native Back, keyboard/newline, sheet closing and list scrolling. Save sanitized screenshots and a results report. No real-account sends.
- [x] Write `docs/android-google-oauth.md` using official Google docs and the APK signing certificate; distinguish Android AuthorizationClient integration from desktop loopback OAuth.

Native APK built and installed. UI/IME/Back/long-press/list verified on the phone; Google native AuthorizationActivity opened. ADB disconnected before consent/cancellation verification; see `docs/audits/2026-10-24-android/RESULTS.md`.
