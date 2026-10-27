# Native Zalo verification — 2026-10-27

Goal: use shared ChatMin timeline/composer/sidebar for Zalo, like Telegram/Google Chat, without running the Zalo website.

## Implemented

- Packaged Node + pinned zca-js protocol worker per account; Rust JSON-lines RPC over private pipes. No web page or hidden browser for Zalo.
- Desktop QR wizard, reauthentication, QR regeneration/cancellation, legacy web-account migration after successful authentication.
- Group discovery and separate contacts picker; local SQLite message cache/search and common notification path.
- Live/backlog normalization, bounded global backlog retrieval, cached offline reading, text/image/file send, quote/recall/reaction/read/typing/member RPC.
- Explicit history limitations; unsupported edit/sticker/voice sending disabled.
- Reconnect after recoverable disconnect and transient offline startup; duplicate/kicked or rejected sessions require login.
- Echo/ACK merge preserves provider metadata, saved reactions and downloaded media.

## Verified so far

- Frontend production build succeeded; 118 frontend tests passed.
- 84 Rust tests passed, including Zalo cache ownership, durable recall tombstones, transactional import and lifecycle regressions.
- 47 connector tests passed, including bundled process startup with empty PATH, private directory, JSON-only stdout, missing-session errors and parent-EOF shutdown.
- Desktop release .app built with packaged runtime/resources; codesign --verify --deep --strict succeeded.
- Connector production dependency audit: zero vulnerabilities. Existing root Vite audit findings are outside this change.
- Independent review findings fixed: ACK vs echo race, reaction loss on history, orphan QR workers, cancel after prior health=ok, late socket error crash, startup retry and own-group read receipts.

## Real-account evidence

A read-only run with the saved October 23 probe session failed at authentication. No account/chat/message was emitted. A separate direct SDK login confirmed a rejected session, not a bundled-module or network error. The old credentials were insufficient for further runtime validation.

The user then completed a fresh QR login in the installed app. The native account identity was persisted, 64 group chats were loaded, zero legacy web rows remained, and the contacts action became enabled. Installed binary SHA-256 matched the final release artifact; installed codesign verification passed. The app was restarted to ensure the updated executable, not a prior running process, was loaded.

The user manually exchanged real incoming/outgoing text and media in the installed
baseline. Native messages and raw provider metadata were persisted. This task did
not send a real message or perform reactions/recalls on the user's behalf.

## Historical cache and performance

- Read-only SQLite/WAL snapshots from the owned legacy WebKit IndexedDB cache were
  decoded offline; identity checked against the native account. No original WebKit
  database was changed. Temporary decryption-key file was removed after use.
- Imported 936 unique historical messages into native SQLite, spanning 31 legacy
  conversations (33 conversations with cached messages after merging native data).
  Import runs in transactions of at most 100 rows, preserves live canonical rows,
  FTS indexing, unread state and per-account ownership.
- Repeated import: 0 inserted, 936 existing, 151 ms process time. Recall controls,
  recalled targets and expired/ephemeral rows were excluded. Durable tombstones
  also prevent delayed provider pages from restoring later recalled bodies.
- 330 indexed latest-page reads including JSON decode: median 0.085 ms, p95 0.314 ms.
  SQLite uses messages_sort for account/chat/sort. This measures database access,
  not UI frame times or network latency.
- Old socket pages produce bounded history batches instead of per-message live
  delivery/notification events. Profile lookups coalesce in batches, disk snapshots
  debounce, and history requests/checkpoints are bounded and coalesced.
- Avatar/media downloads share keepalive, four-transfer concurrency and per-key
  single-flight. Avatars cap at 2 MiB/15 s; redirects and responses are validated.
- Sparse group scans remain retryable instead of falsely marking history complete;
  replay timeout remains an error until valid late metadata arrives. Unsafe numeric
  action cursors cannot be accepted after timeout.

## Limits and remaining real-provider checks

- Group cloud endpoint accepted read-only requests but returned empty pages for the
  three sampled groups; this is not proof of complete cloud history availability.
- Arbitrary deep per-peer DM history and full phone backup restore are unproven.
- Real quote/reaction/recall and sleep/wake remain unverified. Voice sending stays disabled. Sticker asset lookup and sending were added in the follow-up below.
- Final source release installation, avatar UI, old-page navigation and persisted
  session resume are checked separately below after the release build completes.

## Contact identity regression reported during final QA

The user's screenshots showed the same DM avatar changing title after opening its
workspace tab. Live/history fallback used wire display names, while opening a chat
used contact metadata. Canonical contact names now hydrate both sender labels and
DM titles at startup/profile update, and all worker chat paths share the same
identity lookup. Unknown groups cannot borrow a participant name or same-ID DM
profile. Tests reproduce history/live/open consistency and cross-kind isolation.
Avatar hook results are bound to account/photo during render, preventing a reused
row from painting the previous person's resolved image before effects run.

## Startup resume regression found during installed-app QA

The first launch with an already authenticated native Zalo account exposed a panic:
Tokio process spawn ran from Tauri's synchronous setup thread without a reactor.
Process creation now explicitly enters the app runtime. A regression test starts
and awaits a child from a fresh synchronous OS thread with no current runtime;
it failed before the fix and passes after it. Full Rust suite: 83 passed.
The affected build was not accepted as final; rebuilt installation is required.

## Media follow-up reported by the user

- 122 imported image records used oriUrl/hdUrl/normalUrl/thumbUrl rather than the
  live SDK's href/thumb fields. Normalization now accepts both schemas; cached-page
  hydration repairs existing records from retained raw metadata without re-import
  or full database scans. Legacy video geometry/URLs are also recovered.
- 67 cached stickers carried an ID without a download URL. Logical sticker refs
  resolve lazily through the existing authenticated worker and cache to disk under
  the same single-flight and four-transfer limit. Prefer WebP when supplied, PNG
  fallback otherwise. SDK suggestions feed the shared picker; sending uses provider
  category/type metadata, with canonical echo/ACK merge retained.
- Authenticated read-only API test: 12 hello suggestions, 12 detail records with
  assets and valid send metadata. Two existing sticker assets returned image/png.
  No additional socket listener and no real sticker send.
- Legacy photo reads: one sample returned 404 for original/normal/thumbnail;
  two others returned image/jxl successfully. Deleted/expired remote media cannot
  be reconstructed just from a URL. UI now exposes failure/retry instead of a spinner
  forever and disables file actions when no reference exists.
- Download hook results are scoped to account/asset identity; late async completion
  cannot display an earlier chat's image in a recycled component.
- Validation: 47 connector, 118 frontend, 84 Rust tests, production frontend build
  and diff-check pass. Media release installation/visual checks follow separately.

- Review found no blocker in media normalization, SDK routing, logical asset cache
  or per-asset hook results. Added forced cache refresh on decode/retry so bad cached
  bytes do not win every attempt; replacement remains atomic. Sticker picker data
  is scoped to its account before render, preventing old-provider packs flashing
  while a newly selected provider is loading. Picker currently exposes three bounded
  suggestion categories rather than a claim to enumerate all installed Zalo packs.
