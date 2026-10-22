# Notification replay fix

Google Chat polling compares a millisecond cache timestamp to higher-precision server timestamps. The newest cached message can therefore be returned again. Previously every replay was emitted as a new message.

Core now checks persisted message identity under its store mutex before emitting is_new. Updates still reach the UI. A frontend deduper also consumes events while focused/muted, and cached history cannot trigger a new popup. Thread tabs count as viewing their underlying chat. Boot subscribes once and asynchronous listener teardown handles early disposal.

Verification:
- Rust: 13 tests passed, including cached history, 20 replays, edits and distinct IDs at the same millisecond.
- Node: 6 tests passed, including replay and account/chat isolation.
- TypeScript and Vite production build passed; git diff --check passed.
- Browser runtime integration: 20 fresh events for one ID invoked notify once. A focused thread event invoked notify zero times; 20 replays after leaving still invoked zero times. Focus was simulated; no live messages were sent.
- Actual native macOS popup delivery with a live account was not exercised.
