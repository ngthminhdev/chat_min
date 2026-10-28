# Background conversation notifications — 2026-10-28

## Problem and change

A selected conversation could be treated as read while ChatMin was on another macOS desktop. The old native gate used only window visibility/key-focus flags; WebKit focus could also remain stale, and its queued 250 ms automatic read did not recheck focus before acknowledging.

The shared native reading gate now observes application activation, main-window key/visibility/minimization, the active macOS Space and login-session state. [Apple documents](https://developer.apple.com/documentation/appkit/nswindow/isonactivespace) that window visibility alone does not establish presence on the active Space. Space-change notifications are registered on [NSWorkspace's notification center](https://developer.apple.com/documentation/appkit/nsworkspace/activespacedidchangenotification). The cached result is used by every provider, without per-message polling or UI IPC.

The rendered conversation is separate from provider background fetch targets, so an open Google Chat space keeps receiving updates without suppressing its alerts when away. Native foreground events carry revisions; the frontend awaits subscription readiness before its initial snapshot and ignores older snapshots. Settings/search/list views are not treated as a rendered chat.

Automatic acknowledgements recheck the visible conversation before dispatch and are rejected independently by native code if focus changed. Rejected/failed reads keep unread state. Google/Zalo read completions also compare the captured unread/last-message snapshot atomically before changing the cache, badge and event stream. A late completion cannot erase newer unread data, including same-millisecond arrivals. Explicit mark-as-read remains available. A Google thread becomes seen only when actually viewed; returning to it does not mark the whole parent space read. The 30-second Dock bounce policy is unchanged.

## Verification

- 127 frontend tests, 94 Rust tests across `--all-targets`, and 47 Zalo connector tests passed.
- Nine focused frontend regressions cover stale DOM focus after leaving a desktop, a queued-read focus loss, rejected native reads, newer/same-millisecond arrivals, explicit reads, thread seen state, stale presence revisions, parent-thread isolation and subscription readiness. Relevant cases were observed failing before correction.
- Native tests reject a key/visible window on another Space or in an inactive application/session, and preserve newer unread data during read acknowledgement while retaining metadata and deleted-chat behavior.
- Production TypeScript/Vite and native release builds passed; existing Vite chunk/import warnings remain. Independent read-only review found and helped fix native read fencing, whole-space thread reads and listener readiness; final review found no additional actionable issue.
- Installed native logs observed foreground revisions `true → false → true → false`, then two real active-Space-change notifications while foreground remained false. The native notification test delivered through the Island path without becoming key. This is layered native/policy verification; no artificial Google/Telegram/Zalo message was sent, and a newly received Google Chat message on another desktop was not independently reproduced by the agent.

## Installed artifact

Installed `/Applications/ChatMin.app` passes `codesign --verify --deep --strict`; its binary hash matches the build artifact: `de68d7032c2d3eba686e3b52941945f5710f85b105d2ae27dedafcf0836ee98e`. The saved draft digest matches before/after restart. Backup: `/Users/qc-bright/Library/Caches/chatmin/backups/ChatMin-before-space-focus-20261028-1793154972.app`.

Local native evidence is in `docs/audits/2026-10-28-background-chat/`. To reproduce automated checks: `npm test`, `npm run test:zalo`, `cargo test --manifest-path src-tauri/Cargo.toml --all-targets`, and `npm run tauri -- build --bundles app`.
