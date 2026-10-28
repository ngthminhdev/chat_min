# Reading presence and background chat notifications

An open/selected chat is not proof that it is being read. On macOS a window can retain its key/visible flags while belonging to a different Space. Use main-thread AppKit observations of application activation, key window, visibility/minimization, active Space and login-session state to publish one cached foreground snapshot. No per-message polling or IPC is needed.

Separate the conversation rendered by the frontend from provider polling targets. A background Google Chat space must continue its fast fetch cadence while receiving notifications. Settings/search/list-only views must not suppress notifications for the previously selected chat. All providers use the same native reading gate.

Mirror native foreground changes to the frontend with monotonically increasing revisions, including an initial snapshot after event subscription. Ignore stale snapshots. Automatic reads recheck foreground/selected chat at the end of their 250 ms delay; the native command independently rejects stale automatic reads. Do not clear local unread state after a rejected/failed acknowledgement or when newer messages arrived during it. Explicit mark-as-read remains available. Thread seen/inbox logic uses the same actual reading presence.

Verify the stale WebKit focus/other-Space case, pending-read blur race, native rejection, manual reads, thread seen state and out-of-order snapshots with behavioral tests. Run full checks, review the concurrency paths, build/sign/install the app with a rollback backup, then exercise native foreground/blur and Space changes. Keep the existing 30-second Dock attention policy.
