# Welcome, account wizard and message search — 2026-10-23

Changes: scoped onboarding layout and typography, aligned provider cards with selection indicators, compact account summary, correct provider-specific help. Search account and conversation filters now use editable comboboxes with avatar/provider/account identity. Conversations sort by last message time descending, with title as a stable tie-breaker. The selected conversation keeps its avatar and account context when the list closes.

Validation:
- `npm run build`: passed (existing bridge.ts mixed static/dynamic import warning remains).
- `npm test`: 8 passed.
- `git diff --check`: passed.
- Browser demo: keyboard Cmd+N; Welcome via a temporary isolated component fixture; wizard provider layout; search combobox typing and Enter selection; account change clears conversation scope; search returns only selected-conversation matches; no-match filter; Escape closes the list and preserves selection.
- 390px iframe viewports: Welcome and wizard layout, search filter stacking and End-key navigation to the final conversation within the bounded popup.
- Temporary preview files removed after inspection.

Screenshots: welcome.png, wizard.png, search-selected.png, search-recent.png, narrow.png.

Not verified: native Tauri/macOS build, real-account login, real photo downloads, all theme variants.
