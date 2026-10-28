# Notification optimization — 2026-10-28

## Delivered behavior

- macOS Dock bounce for eligible notifications while the app is in the background. After the user found the original one-second informational bounce too subtle, it now repeats for up to 30 seconds using a bounded critical request. Incoming bursts share the current window without restarting its timer. The existing ten-second cooldown also remains; account notification/mute/mention/quiet rules run first. Per-account switch in Settings defaults on for existing settings. Reduce Motion suppresses the bounce. Activation cancels outstanding attention; the effect never focuses the app.
- Keep the existing silent, themed, grouped Notification Island. The first notification no longer waits for the 80 ms batching timer. Later burst updates keep the fading content tree alive until its animation settles, preserving click targets and preventing opacity jumps. Timers use common run-loop modes; hovering pins the current display.
- Unread totals update by delta, with raw unread retained for read cleanup in muted Telegram groups. Badge writes coalesce for 40 ms and apply the latest total on the main thread. Zero-unread entries are removed, and signing out removes that account's badge, Island and system entries.
- System notifications use unique request IDs and account/chat grouping. Read cleanup matches the destination key, including DMs whose sender name differs from their chat title and same-named chats on different accounts. System delivery remains under macOS lock-screen/Focus control; custom Island/Dock effects use ChatMin's own quiet-hours policy.
- Native settings restore from SQLite before provider listeners start. Frontend hydration cannot overwrite them with an empty initial account list. Catch-up digests retain at most 128 chat groups, discard read/deleted/muted chats, and recheck current enabled/quiet/mentions settings before dispatch.
- Settings keeps the immediate notification test and adds **Thử Dock sau 3 giây**. Click it, then press **⌘H**. Tests bypass account rules/quiet hours but still honor Reduce Motion.
- Each test click has its own delivery identity, so repeating a test reopens the preview instead of being suppressed as a duplicate message.

## Initial optimization verification

Fresh final source checks: 118 frontend tests, 47 Zalo connector tests and 90 Rust tests across `--all-targets` passed. Production TypeScript/Vite compilation passed. Vite retains its existing mixed-import/chunk-size warnings. Independent read-only review found and helped fix system-mode lock-screen suppression, late mentions-only digest changes, and muted Telegram read cleanup. Final review reported no release-blocking issue.

Pure Rust state tests were observed failing before fixes for badge updates, burst throttling, bounded digest state, late mentions filtering and muted-chat read transitions. A 20,000-update check compares incremental badge totals against a full sum after every update.

The provider-free native AppKit preview delivers 103 synthetic notifications, including 100 in a burst. It verifies that the original content tree survives the active animation, the latest message target and exact total survive grouping, no pending refresh remains after settling, the panel never becomes key, and its top stays at the physical screen edge. Final run: two content renders; first cold render 16.223 ms and second render 3.180 ms in a debug process. These are CPU/render-call durations, not measured display FPS or continuous visual QA.

Offline optimized Rust benchmark: 2,000 chats, 50,000 updates, nine samples with alternating execution order. Median prior full-sum calculation: **83.187 ms**; incremental calculation: **2.500 ms**, about **33×** faster for bookkeeping only. Checksums match. This excludes provider/network latency, AppKit badge updates and end-to-end arrival latency.

Reproduce from repository root:

```sh
npm test
npm run test:zalo
cargo test --manifest-path src-tauri/Cargo.toml --all-targets
cargo build --manifest-path src-tauri/Cargo.toml --example notification_island
python3 scripts/performance/run-notification-island.py
rustc -O --edition=2021 scripts/performance/notification-state.rs -o /tmp/chatmin-notify-bench
/tmp/chatmin-notify-bench
npm run tauri -- build --bundles app
git diff --check
```

Local raw results are in `docs/audits/2026-10-28-notifications/`. Real incoming provider messages and physical sleep/wake are not established by the synthetic preview.

## Initial installed release

Built with `tauri build --bundles app`, ad-hoc signed, and verified with `codesign --verify --deep --strict`. Installed at `/Applications/ChatMin.app`; installed and build binary SHA-256 match: `e1a95fb9f05643ecb66ec023b23b0cf72f32661166ecfff2f63c22624bf2d7fe`. Notarization was skipped because Apple credentials were unavailable.

The installed app's delayed test was triggered through Settings, then hidden with ⌘H. Native logs confirmed one Dock attention request, Island display without becoming key, and a 3.219 ms main-queue delay. A second test while active produced no extra attention request and reopened the Island with group total 2; its render call took 2.054 ms. This verifies the native request/dispatch and repeat-button behavior, rather than a continuous recording of the Dock animation. Settings controls were visually checked. The synthetic notices were cleared by restarting the app after QA.

The SQLite draft snapshot digest matched before and after installation/restarts (two nonempty stored values, one draft reported by the UI). Existing sessions, theme, pins and notification preferences resumed. No provider message was sent by the agent.

Rollback app: `/Users/qc-bright/Library/Caches/chatmin/backups/ChatMin-before-notifications-20261028-1793122860.app`. The original app remains intact there. Source changes are on `codex/notification-performance-20261028`; pre-existing window/resize/statusbar/style edits were preserved separately.

AppKit attention uses Apple's documented [requestUserAttention](https://developer.apple.com/documentation/appkit/nsapplication/requestuserattention%28_%3A%29) API. The initial [informational request](https://developer.apple.com/documentation/appkit/nsapplication/requestuserattentiontype/informationalrequest) bounces for one second. The follow-up uses a [critical request](https://developer.apple.com/documentation/appkit/nsapplication/requestuserattentiontype/criticalrequest), explicitly canceled after 30 seconds, as requested by the user. The OS controls the animation's shape. A stop callback checks its request identity before canceling, so an old timeout cannot cancel a newer bounce.

## Follow-up: 30-second repeated bounce

The user confirmed the initial bounce worked but was too subtle, and explicitly requested repetition for 30 seconds. The new native request uses a 30,000 ms automatic cancellation timer, stops early on activation/read cleanup, and ignores additional attention requests while a bounce is active so bursts cannot extend its deadline. The Settings test still starts after a three-second delay; that label is separate from the bounce duration.

Verification: 91 Rust tests across all targets passed, including request ownership/activation cleanup; production frontend/release build and whitespace checks passed. Read-only review of the timer implementation found no actionable lifecycle/borrow defect. A real request and automatic timeout were observed on the intermediate three-second build. The final 30-second build was installed and its signature/hash verified; a continuous 30-second animation recording was not captured. Native UI automation yielded to the user's concurrent interaction during the final test attempt.

Current installed binary SHA-256: `052f7061e0319fe00ef3db8114bcaeac1b1406985a175b0ebbb4c94f2165f98f`. Draft digest still matches across the update. Previous build backup: `/Users/qc-bright/Library/Caches/chatmin/backups/ChatMin-before-dock30-20261028-1793151821.app`. Local evidence: `docs/audits/2026-10-28-notifications/dock30-installation.json` and `dock30-smoke.log`.
