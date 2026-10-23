# ChatMin motion polish implementation plan

User authorized implementing the preceding UI/UX audit autonomously, then reporting results. Keep the existing checkout/theme; do not commit or push. Preserve the pre-existing untracked screenshot.

**Goal:** responsive, restrained feedback without repeated message entrances or scroll jumps.

**Architecture:** keep provider IDs intact and introduce a frontend render identity preserved by message reconciliation. Separate first appearance from unread flags. Coordinate native smooth scrolling with sticky-scroll restoration. Reuse the existing motion library and semantic CSS tokens.

**Validation:** meaningful regression tests for message reconciliation, browser fixtures for actual components/scroll, normal demo interaction, TypeScript/build, existing tests and diff review. CSS polish is checked visually rather than tested with source-string assertions.

## Tasks

- [x] Add failing message identity tests: optimistic acknowledgement, duplicate event before response, ID-change chains and regular edits retaining identity.
- [x] Implement reconciliation and stable keys in normal chat/thread render paths. Suppress history/reopen entrances without changing unread semantics.
- [x] Reproduce sticky-scroll interference in a local fixture; coordinate explicit bottom/quote scrolling with restore and user cancellation. Respect reduced motion.
- [x] Add shared compact/regular typing dots, subtle state fades and reduced-motion fallback. Preserve row dimensions.
- [x] Polish reaction press/exit, unread growth-only emphasis, translation exit and delayed loading.
- [x] Make toast lifetime owned by its mounted item, with pause/dismiss and longer error reading time. Protect errors when the stack fills.
- [x] Implement main tab roving focus, arrows/Home/End and close-focus restoration; retain existing shortcuts.
- [x] Add hover-preview intent guards and cancellation on scrolling, navigation, layout changes and blur.
- [x] Run tests/build and browser QA; request independent review of the final working diff; resolve material findings.
- [x] Record fixes, evidence, limitations and any intentionally deferred detail in the audit follow-up. Remove temporary fixtures.

## Design decisions

- Typing loops only on three dots, approximately 2px amplitude and 120ms stagger. Names/avatars do not bounce.
- Keep 80–140ms feedback and 140–200ms entrances; use the existing UI easing.
- No whole-list layout animation, no artificial wait for chat content, no provider/API changes.
- Preserve global `fresh` for thread unread. First-appearance bookkeeping belongs to the mounted message list.
- Stable render identity is UI-only and never sent to the provider.
- Errors have more reading time; no permanent or unbounded toast accumulation.
