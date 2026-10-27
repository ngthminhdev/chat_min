# Native Zalo in ChatMin

User approved the connector → local cache → shared ChatMin UI approach and requested Zalo behave like Telegram/Google Chat. Native here means no Zalo page/browser runtime; the existing ChatMin renderer remains shared.

Use a packaged Node helper with pinned zca-js 2.2.0, one process/session per account, JSON-lines RPC over stdin/stdout. Rust owns lifecycle, SQLite, notifications, commands and media cache; Node owns login and the unofficial Zalo protocol. Bundle the runtime and helper into the desktop app so Finder launch needs no system Node. Existing Telegram/Google Chat work is preserved.

QR login appears in the existing wizard. Credentials stay in private per-account directories. Login cancellation terminates unsaved workers. Existing web accounts retain their ID and are migrated through QR login; web-only rows are removed after successful authentication, never by pretending DOM IDs are protocol IDs. Messenger stays web-backed. Desktop is the initial supported target; mobile must explicitly show unsupported runtime rather than silently launch a Zalo page.

Support contacts/groups, real-time messages, text and file/image sending, quoted replies, recall, reactions, read markers, typing, members, local search, restart/resume, disconnect health, bounded catch-up and cached offline reading. Unsupported capabilities stay disabled. Normalize IDs as strings; use timestamp ordering, dedupe server IDs, keep raw metadata needed for quote/read/recall across restarts. Do not turn every friend into an active conversation; offer contacts separately for starting a chat.

History uses the SDK WebSocket backlog for DM/group, globally paginated and filtered by chat. It is not a full per-chat history API. Keep local cache, report the limitation in the timeline, and do not claim complete remote history. Empty/duplicate pages, disconnects and timeouts must terminate bounded requests without erasing cached history.

Verify normalization and RPC/lifecycle with deterministic tests, Rust integration tests, frontend build/tests and desktop bundle. Real-account QR and incoming/outgoing/media/sleep-wake need live verification; never claim them from mocked tests. No messages sent without a user-selected destination/content.
