# ChatMin performance verification — 2026-10-27

Scope: native Zalo history/profile/media connector and the shared Telegram/Google Chat/Zalo timeline, composer, search and preferences. Measurements ran sequentially, without a parallel build or another scripted benchmark. Hardware: Apple M4 Pro, 14 logical CPUs, 24 GiB memory, macOS 26.3.1; Node 22.20.0. Normal desktop/background activity was not controlled. These are current measurements, not a controlled speedup comparison against an older build.

## Shared UI: production React components, synthetic data

The committed `scripts/performance/` harness imports the actual application components and mocks provider APIs. Each provider starts a fresh headless Playwright WebKit browser at 1280×900 with 1,000 loaded messages per chat, including code blocks. Twelve switches/refreshes are sampled, dropping the first two for warm CPU statistics. The browser's frame cadence is approximately 60 Hz; this does not prove native ProMotion/120 Hz behavior.

| Provider | Switch CPU p95 | Refresh CPU p95 | Navigation frame gap p95 / max | Scroll frame gap p95 / max | Mounted rows |
|---|---:|---:|---:|---:|---:|
| Zalo | 10 ms | 1 ms | 20 / 22 ms | 17 / 18 ms | 9 initially, 12 scrolling |
| Telegram | 10 ms | 1 ms | 21 / 22 ms | 17 / 17 ms | 9 initially, 12 scrolling |
| Google Chat | 10 ms | 1 ms | 21 / 21 ms | 18 / 19 ms | 9 initially, 12 scrolling |

Switch CPU measures the synchronous state/render commit, **not** click-to-visible latency. The harness's content-ready wait plus two additional animation frames was approximately 100 ms per switch and 33–35 ms per refresh. Scroll tests sampled 89 frames per provider, with no gap above 25 ms in these final runs. Earlier exploratory runs included isolated 31 ms navigation gaps; the results are not a guarantee of zero stalls on the user's desktop.

All three providers passed:

- Offscreen message jump, newest-message jump and thread-root jump.
- Older-message prepend and thread prepend: visible anchor movement 0 px.
- Incoming append while reading older messages: anchor retained; bottom reader follows incoming output and late content growth.
- Lazy toolbar, keyboard actions, hover actions and Escape focus restoration.
- Typing 120 characters into an already 80-line draft: composer stays at 176 px, old-message anchor movement 0 px. Frame-gap p95 was 18 / 18 / 19 ms (Zalo / Telegram / Google Chat), with no gap above 25 ms.

No unexpected page errors occurred. Each deliberate late-content-growth stress case produced one WebKit `ResizeObserver loop completed with undelivered notifications` warning; it did not recur continuously, shift the tested anchor or fail the assertions. This warning is reported, not counted as an error-free console.

Raw aggregate evidence: [ui-results.json](audits/2026-10-27-native-zalo/performance/ui-results.json).

## SQLite reads and search

Read-only benchmark of the actual paging/search SQL plus JSON decode, using Python/SQLite rather than the bundled Rust runtime. Database at sampling contained 24,664 messages across the three native providers. Each provider's largest cached chat was selected. Warm paging used 200 iterations; searches used 60. Reopened-connection measurements retain the OS file cache and exclude connection-open time; they are not disk-cold measurements.

| Operation | Warm p95 |
|---|---:|
| Telegram latest / older 50 | 0.211 / 0.210 ms |
| Google Chat latest / older 50 | 0.227 / 0.182 ms |
| Google Chat primary 50 | 1.674 ms |
| Zalo latest / older 50 | 0.291 / 0.300 ms |
| Per-chat prefix search | 7.71–13.23 ms |
| Global prefix search | 28.23 ms |

Paging uses the `messages_sort` index. Search uses FTS and a temporary B-tree for cross-provider timestamp ordering; broader matches cost more. The benchmark exposed that search's Tauri command was synchronous. It now runs on `spawn_blocking`, keeping SQLite/JSON work off the UI thread, and bounds the requested result limit to 1–200. This changes scheduling, not the underlying query time. SQLite's shared store mutex can still delay other cache operations while a broad search executes.

Details and reproduction: [cache report](audits/2026-10-27-native-zalo/performance/CACHE-CONNECTOR-REPORT.md), [cache results](audits/2026-10-27-native-zalo/performance/cache-results.json).

## Connector batching and native writes

Synthetic offline tests import the production connector modules directly, with no account/session, network or provider listener:

- Normalize 10,000 messages: p95 3.76 ms.
- Normalize/batch 10,000 historical messages: p95 6.59 ms, emitting 100 history events rather than 10,000 live deliveries.
- 10,000 profile lookups for 250 identities coalesce into five fake loads of at most 50 users. Timings exclude production's 20 ms batching delay and provider latency.
- Twenty concurrent backlog readers share three fake pages; twenty identical group-history requests coalesce into one fake provider request.

A separate native Rust **debug** CLI benchmark imported 10,000 synthetic records into each of three fresh temporary databases. Process/migration/parsing/transactions/FTS costs are included: 3,085 / 1,042 / 1,043 ms, median 1,043 ms. Three idempotent repeats took median 549 ms. Every run retained exactly 10,000 messages, 10,000 FTS records, 20 chats, 2,500 media records and unread count zero. The temporary databases and fixture inputs were deleted. Three samples do not establish a p95, and debug timings are not release-build throughput.

Details: [native import report](audits/2026-10-27-native-zalo/performance/NATIVE-IMPORT-REPORT.md), [native import results](audits/2026-10-27-native-zalo/performance/native-import-results.json), [connector results](audits/2026-10-27-native-zalo/performance/connector-results.json).

## Native process observations

Twenty one-second intervals without scripted UI input measured cumulative CPU deltas and RSS. Visibility and ordinary user/background activity were not controlled. CPU percentages are relative to one core. RSS includes shared mappings and must not be summed as private physical memory.

| Process | Median CPU | p95 CPU | Median RSS |
|---|---:|---:|---:|
| ChatMin Rust host | 0.96% | 1.93% | 135.3 MiB |
| Zalo protocol worker | 0% | 0% | 69.1 MiB |
| Main WebKit content, inferred by launch sequence | 0% | 0.97% | 139.3 MiB |
| Messenger WebKit content, confirmed by app data handles | 2.93% | 8.74% | 419.7 MiB |

Networking/GPU observations are retained in [idle samples](audits/2026-10-27-native-zalo/performance/unscripted-idle.json). Zalo no longer owns a provider WebView. Messenger remains a WebView and is the dominant sampled content process; this release does not claim to remove that cost or to implement a native Messenger connector.

## Real-account checks and limits

The installed media candidate resumed the saved Zalo session without QR. Sidebar, tab, header and sender labels consistently use contact profiles. Existing imported images and a received sticker were visually rendered in the native timeline. Download/cache work is coalesced and limited to four concurrent transfers; histories/profiles update in bounded batches, and only loaded pages are hydrated. No real message or sticker was sent by the agent.

Actual CDN read checks found both valid legacy images (`image/jxl`) and an old image whose original/normal/thumbnail all returned 404. Missing/expired remote assets cannot be restored from an unavailable URL. Failures expose retry instead of an endless spinner; retry requests fresh bytes and atomically replaces cache files. Full arbitrary per-peer DM history, full phone backup restore, long-duration soak, physical sleep/wake and real outgoing sticker/quote/recall verification remain outside the evidence here.

Validation: 118 frontend tests, 47 connector tests, 84 Rust tests across `--all-targets`, production frontend build and diff whitespace check passed. Independent read-only reviews found no blocking regression in the reviewed paths. The final release installation, native navigation probes and signature/hash checks are recorded after the final candidate build below.

## Pre-release re-run

Everything above was re-run sequentially on the same machine before the release commit, with no parallel build. Raw aggregate: [rerun-results.json](audits/2026-10-27-native-zalo/performance/rerun-results.json) and [rerun-idle.json](audits/2026-10-27-native-zalo/performance/rerun-idle.json); the original result files are unchanged.

Gates: 118 frontend, 47 connector and 84 Rust tests (`--all-targets`), production frontend build and `git diff --check` passed.

| Shared UI, 1000 messages | Switch CPU median / p95 | Refresh p95 | Navigation gap p95 / max | Scroll gap p95 / max | Typing gap p95 / max |
|---|---:|---:|---:|---:|---:|
| Zalo | 7 / 8 ms | 1 ms | 18 / 20 ms | 18 / 19 ms | 18 / 18 ms |
| Telegram | 7 / 7 ms | 1 ms | 18 / 21 ms | 18 / 25 ms | 18 / 19 ms |
| Google Chat | 7 / 7 ms | 1 ms | 18 / 24 ms | 18 / 21 ms | 18 / 19 ms |

No gap above 25 ms in these final runs. All functional checks passed again (jumps, 0 px prepend/thread anchors, append/late-growth follow, lazy toolbar, keyboard/hover/Escape, 176 px composer, 0 px typing anchor); one `ResizeObserver` warning per provider in the deliberate late-growth case, as before. Exploratory runs before the final set showed isolated 26–29 ms gaps.

The Google Chat run initially failed `hover must reveal one toolbar` in about half the attempts. This was a harness race: focusing the DOM-last row scrolled the virtual list, so the subsequent `.msg` `last()` resolved to a different row and the page then legitimately held two lazily mounted toolbars (the unfocused one at opacity 0). The harness now pins the hovered row by id and checks that row's toolbar; 5/5 subsequent Google Chat runs and the final three-provider set passed. Application code was not changed for this.

SQLite/connector/native-import, warm p95 (first run → re-run): Telegram latest 0.211 → 0.179 ms, Google Chat primary 1.674 → 1.461 ms, Zalo latest 0.291 → 0.291 ms, per-chat search 7.63–12.68 ms, global search 28.23 → 26.56 ms; connector normalize 10,000 3.76 → 3.64 ms, historical batching 6.59 → 5.77 ms; native debug import median 1,043 → 927 ms, duplicate import 549 → 491 ms, with identical row/FTS/chat/media/unread counters. Run-to-run noise is of the same order as these differences; they do not establish a speedup.

Release `.app` rebuilt with `tauri build --bundles app`, ad-hoc signed, `codesign --verify --deep --strict` passed; installed binary SHA-256 `c703c64a…` matches the build artifact. Previous install backed up at `/tmp/ChatMin-before-release-20261027.app`. The saved Zalo session resumed and `text-format` reported `engine:worker`; no errors in `js.log`. Twenty one-second idle samples taken about one minute after launch: Rust host median 1.95% / p95 1.98% CPU of one core, RSS 178 MiB; Zalo worker 0% CPU, 94 MiB. This is higher than the earlier 0.96% / 135 MiB sample, which was taken later in a long-running session; startup sync was not excluded, so the two are not comparable and no regression is concluded.

## Reproduction

Run tests with `npm test`, `npm run test:zalo`, `cargo test --manifest-path src-tauri/Cargo.toml --all-targets`, and `npm run build`.

The UI harness needs a Playwright WebKit installation. Set `CHATMIN_PLAYWRIGHT_MODULE` to its `index.mjs` and, when using a non-default browser location, `CHATMIN_WEBKIT_EXECUTABLE` to `pw_run.sh`; then run sequentially:

```sh
node scripts/performance/run-ui.mjs zalo 1000 shell zalo
node scripts/performance/run-ui.mjs telegram 1000 shell telegram
node scripts/performance/run-ui.mjs gchat 1000 shell gchat
```

Cache, connector and native-import scripts live beside their aggregate results. Cache reads use SQLite `mode=ro`; native imports create synthetic temporary databases, never the real user database. Benchmark outputs and screenshot generation normally remain ignored; only the reviewed aggregate reports/results and reproduction scripts are intentionally retained in this commit.
