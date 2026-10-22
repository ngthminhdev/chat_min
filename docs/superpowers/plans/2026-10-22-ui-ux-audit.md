# ChatMin UI/UX audit implementation plan

**Goal:** Keep the established design system while fixing clipped layouts, unclear search feedback, keyboard access, and lost edit drafts.

**Architecture:** App-local CSS overrides only; React manages panel navigation and overlay focus. Keep the existing demo/native bridge boundary and account data intact.

**Tech stack:** React 18, Zustand, Motion, CSS tokens, Tauri 2.

- [x] Reproduce small-window clipping and palette keyboard escape in the running demo at localhost:1424.
- [x] Fix adaptive columns in `src/styles/chatmin.css`: inspector overlay below 1180px, sidebar navigation below 760px, wrapping forms/inbox/composer. Keep shared symlinked styles untouched.
- [x] Update `src/App.tsx` and `src/store.ts` for narrow-window navigation, boot retry, and overlay shortcut isolation.
- [x] Update `src/components/Overlays.tsx`: trap/restore focus, named dialogs, selectable search modes, loading/error/retry states, discard stale searches, combobox semantics.
- [x] Update `src/components/Composer.tsx`: await edit save; preserve text/context on failure and prevent duplicate submissions.
- [x] Improve input labels and empty-state actions in Settings/Inbox/Conversation.
- [x] Run `npm test` and `npm run build`. Browser-check 1280x800, 900x650, and 390x844; exercise sidebar, inspector, inbox, settings, search, keyboard, draft switching and demo sending/editing.
- [x] Write audit findings, verification evidence, and remaining native-only checks to `docs/audits/2026-10-22-ui-ux.md`.

No Git repository is present. Original edited sources are preserved in `docs/audits/ui-ux-2026-10-22-before/`.
