# Native Rust synthetic SQLite import benchmark — 2026-10-27

The real debug `chatmin --import-zalo-cache DATABASE INPUT ACCOUNT` CLI executed against three newly created **synthetic temporary databases only**. No application UI, provider connection, listener, login, user database or session file was accessed. `main.rs` handles this CLI branch and returns before normal app startup.

Build succeeded: `cargo build --manifest-path src-tauri/Cargo.toml --bin chatmin` (2.69 seconds, excluded from timings). All build, generator and benchmark processes exited successfully before native app profiling resumed.

The production `normalizeMessage` and `normalizeChat` modules generated 10,000 incoming records across 20 group chats, including 2,500 photo records and 250 synthetic senders. Input JSONL size was 10,340,288 bytes. The working directory had mode 0700; JSONL had mode 0600. Temporary databases and input were removed automatically after the benchmark.

## Real native writes and duplicate imports

Each first import included process startup/shutdown, `Store::open` and schema/index initialization, file reads, Rust Serde decoding, identity validation, **100 transactions of 100 records**, messages/thread indexes, FTS indexing and chat metadata writes. Each repeat imported the identical JSONL into the same database and exercised duplicate checks. Fixture generation and initial account-table setup were outside the timed operation.

| Run | First import ms | Duplicate import ms |
|---|---:|---:|
| 1 | 3085.489 | 553.245 |
| 2 | 1041.948 | 548.300 |
| 3 | 1043.162 | 549.077 |
| Median | **1043.162** | **549.077** |
| p95 / max | **3085.489** | **553.245** |

The first process was substantially slower; this benchmark did not isolate the cause. The p95 is simply the maximum with only three samples and should not be treated as a stable tail-latency estimate. Fresh SQLite databases do not imply cold OS filesystem caches, and no cache eviction was attempted. This debug-build result does not establish release-build throughput.

Every first import reported `read=10000, inserted=10000, existing=0`; every duplicate import reported `read=10000, inserted=0, existing=10000`. After every pair, SQL checks confirmed:

- 10,000 message rows and 10,000 FTS rows.
- 20 chat rows, 2,500 media messages, total unread count 0.
- Counts remained identical after duplicate import; each database occupied 10,895,360 bytes after closing the native process.

This verifies aggregate idempotence for the synthetic input and preservation of the historical-import unread behavior. It does not simulate concurrent live writes or network event delivery.

## Bounded reads after native writes

The last synthetic database contained 500 messages per chat. Queries used the production `Store::msgs` SQL, fetched 50 rows, decoded JSON and reversed chronological output. Older paging started after the newest 100 rows. This read phase used Python SQLite/`json.loads`, while the import/write phase above used real Rust production code.

| Query | Iterations | Median ms | p95 ms | Max ms |
|---|---:|---:|---:|---:|
| Latest 50 | 200 | 0.2120 | 0.2574 | 0.4198 |
| Older 50 | 200 | 0.2102 | 0.2482 | 0.3227 |

Both plans used `messages_sort (account_id, chat_id, sort)`; both returned exactly 50 rows.

## Reproduction and limits

Run sequentially from the repository root:

```sh
cargo build --manifest-path src-tauri/Cargo.toml --bin chatmin
python3 docs/audits/2026-10-27-native-zalo/performance/native-import-benchmark.py
```

Artifacts: `native-import-benchmark.py` and `native-import-results.json`. No production source changes were required. These timings include process/migration overhead and exclude UI, IPC, provider latency, media download/decode, live-account behavior and concurrent writers. They complement the read-only real-cache and offline connector report; neither report alone demonstrates complete native UI latency or continuous CPU/RAM usage.
