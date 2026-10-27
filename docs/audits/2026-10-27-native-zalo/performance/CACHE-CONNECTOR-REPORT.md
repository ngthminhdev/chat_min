# Read-only cache and offline connector performance — 2026-10-27

Production code was unchanged. SQLite was opened with URI `mode=ro` and `query_only=ON`; no app process, provider connection, login, send operation, or session file was used. Outputs contain only aggregate counts, timings and query plans.

## Cached paging and search

The local database contained 24,664 cached messages: Telegram 10,114 across 59 chats; Google Chat 13,576 across 109 chats; Zalo 974 across 33 chats. Database size was 49,033,216 bytes plus a 6,674,432-byte WAL. Page size was 4096 bytes and the benchmark connection cache setting was -2000 KiB.

The script uses the exact `Store::msgs`, `Store::primary_msgs` and `Store::search` SQL from `src-tauri/src/store.rs`, including JSON decoding and page reversal. Each provider's largest cached chat was selected (2,133 / 4,943 / 247 messages respectively); older pages start after the newest 100 rows. Limits are 50. Search uses a fixed public `a` prefix, never a term extracted from private content.

Warm-connection values in milliseconds:

| Provider / operation | Iterations | Median | p95 | Max |
|---|---:|---:|---:|---:|
| Telegram latest | 200 | 0.172 | 0.211 | 0.307 |
| Telegram older | 200 | 0.178 | 0.210 | 0.292 |
| Google Chat latest | 200 | 0.213 | 0.227 | 0.322 |
| Google Chat older | 200 | 0.171 | 0.182 | 0.197 |
| Google Chat primary latest | 200 | 1.469 | 1.674 | 1.771 |
| Zalo latest | 200 | 0.278 | 0.291 | 0.303 |
| Zalo older | 200 | 0.243 | 0.300 | 0.374 |
| Telegram per-chat search | 60 | 8.489 | 9.169 | 9.203 |
| Google Chat per-chat search | 60 | 12.626 | 13.233 | 13.728 |
| Zalo per-chat search | 60 | 7.159 | 7.709 | 8.092 |
| Global search | 60 | 26.706 | 28.233 | 28.831 |

Every paging plan used `messages_sort (account_id, chat_id, sort)`. The Google primary query also used that index and filtered JSON thread replies. Search plans used the FTS virtual-table index, a message primary-key lookup per hit, and a temporary B-tree for timestamp ordering. Search is the measured heavier cache path; its cost depends on matching token count, including matches excluded by the per-chat filter.

Thirty additional iterations per operation reopened SQLite connections with statement caching disabled. Paging p95 ranged 0.290–0.443 ms; Google primary p95 was 2.053 ms. Search p95 ranged 7.744–12.844 ms per chat and 30.539 ms globally; global max was 43.073 ms. These reset SQLite page/statement caches but reuse the OS filesystem cache. They are **not disk-cold measurements**. Connection-open time is excluded. First-query timings and complete plans appear in `cache-results.json`.

## Offline Zalo connector

Production normalization, runtime, backlog and profile-cache modules were imported directly. Synthetic input had 10,000 messages, 250 distinct senders and a 25% photo-content mix. Fake APIs and EventEmitter supplied all responses.

| Operation | Iterations | Median ms | p95 ms | Max ms |
|---|---:|---:|---:|---:|
| Normalize 10,000 messages | 100 | 3.508 | 3.761 | 3.908 |
| `old_messages` normalize + batch events, 10,000 | 100 | 5.884 | 6.592 | 11.245 |
| Cold profile cache, 10,000 get requests | 30 | 1.525 | 2.108 | 2.275 |

The old-message path emitted **100 history events for 10,000 messages**, each bounded to 100 rows; seeded profiles required zero API calls. Profile-cache testing used 250 unique identities repeated 10,000 times: exactly **5 fake loads of at most 50 identities**, 250 cached profiles and 5 profile-update events. `delayMs=0` was explicit for the profile microbenchmark; production's 20 ms coalescing delay and provider latency are excluded from that timing. Profiles were seeded for normalization/history measurements so deferred work could not contaminate those measurements.

Coalescing checks (single observations, not statistically robust latency benchmarks): 20 concurrent backlog readers shared the same result, made 3 fake page requests and obtained 300 rows each (0.534 ms). Twenty identical concurrent group-history requests made 1 fake provider call and obtained 50 messages each (0.459 ms).

## Limits and reproduction

These are local microbenchmarks, without a previous-build baseline or a performance pass/fail budget. SQLite ran through Python 3.15.0 / SQLite 3.54.1 with `json.loads`, not the bundled Rust SQLite/Serde runtime. Connector ran Node v22.20.0. Measurements exclude Rust ingestion, database writes/transactions, FTS maintenance, IPC serialization, UI layout/scrolling, media work, network/history server latency and actual account behavior. Fake event emission only counts events and rows; it does not serialize or transport the emitted payloads. The small Zalo cache does not prove behavior at large history sizes. Native app CPU/RAM and UI measurements require separate evidence.

Run sequentially from the repository root:

```sh
python3 docs/audits/2026-10-27-native-zalo/performance/cache-benchmark.py
node docs/audits/2026-10-27-native-zalo/performance/connector-benchmark.mjs
```

Artifacts: `cache-benchmark.py`, `cache-results.json`, `connector-benchmark.mjs`, `connector-results.json` and this report.
