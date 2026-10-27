# ChatMin notification performance

The user requested a complete notification polish, including macOS Dock bounce, and asked to review the result tomorrow while work continues. Proceed with conservative defaults and reversible local changes.

Keep the existing native Island. A system-banner-only implementation would lose its grouped history; continuous critical Dock requests would demand attention indefinitely. Use AppKit informational attention requests instead: background only, at most once per ten seconds across accounts, never steal focus, respect account rules and Reduce Motion, and allow disabling bounce per account. Island remains silent as before; system mode retains OS-controlled sounds/Focus.

Update unread totals incrementally under one mutex, coalesce badge writes, and remove account entries when signing out. Clear delivered notifications by their account/chat destination rather than display title. Use collision-free request identifiers and thread identifiers for system grouping. Restore native account notification preferences from SQLite before provider listeners start, with backwards-compatible defaults.

Show the first Island delivery immediately and batch subsequent updates. During an active transition, preserve the content tree and apply new content after it settles, preventing opacity jumps. Keep avatar updates in place and keep the existing screen selection, semantic palette, click snapshots and Reduce Motion behavior.

Bound the catch-up digest by chat count rather than retaining an allocation per message; remove read chats and recheck current account settings before delivery. Verify policies with Rust tests, run frontend/connector/Rust suites and production build, exercise the provider-free AppKit preview, then build/sign/install the app with a rollback backup. Document measured results and distinguish synthetic checks from real incoming messages and physical sleep/wake.
