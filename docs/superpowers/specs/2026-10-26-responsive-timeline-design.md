# Responsive chat timeline

User-approved scope: keep UI responsive with a 60 FPS target; loading/skeleton is acceptable. This continues the proposed viewport-only timeline optimization. Existing themes, draft state, provider behavior, and unrelated working changes stay intact. No commit/push requested.

The shell/header/composer render immediately. A small skeleton paints before mounting a bounded virtual timeline. React Virtuoso owns dynamic-height measurement and scroll anchoring; a shared adapter handles initial bottom positioning, genuine-user top pagination, append following, fresh-count/jump-bottom, and quote/search jumps including offscreen loaded messages. Both conversation and thread/topic views use it. It replaces full-list DOM mounting rather than hiding an already expensive render behind a spinner.

Formatting message bodies runs in a module Web Worker; the UI renders a small placeholder until escaped HTML arrives. Requests are coalesced and cached with bounded memory. Stale responses cannot replace edited text. Worker failure falls back to escaped plain text; no synchronous expensive highlighting fallback. Content, edits, reactions, and media remain accessible as virtual rows mount.

Alternatives considered: keeping a few full tabs mounted consumes memory and retains subscriptions; merely deferring the entire existing timeline still causes a later long task. Viewport virtualization plus worker formatting bounds both DOM work and parsing cost.

Acceptance: production WebKit switch path under 16.7 ms in the audit fixture, bounded mounted rows when history grows, frame-gap measurement during switching/scrolling, no synchronous main-thread syntax detection, and regression QA for bottom-follow, prepend anchoring, unread/album layout, jump to offscreen message, drafts, fast switching, errors/retry. Report measured limits rather than guarantee every device/network renders at 60 FPS. Native release build provides a concrete artifact for installed-app verification.
