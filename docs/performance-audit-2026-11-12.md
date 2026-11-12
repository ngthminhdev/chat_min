# ChatMin — Audit performance, 12/11/2026

**Kết luận:** ưu tiên xử lý chi phí ghi full-text search (FTS) và thời gian chiếm khóa database. Timeline đã có virtualization và cuộn ổn trong tải 1.000 tin được đo; các vấn đề rõ hơn nằm ở đồng bộ, mở rộng sidebar và dữ liệu giữ lâu trong phiên.

Đây là **audit, không triển khai sửa lỗi**. Không sửa source, dependency, cấu hình hay cài lại app. Chỉ tạo báo cáo và bằng chứng đo; không gửi tin nhắn thật. Các tương tác UI tự động dùng API giả lập và dữ liệu tổng hợp.

## Phạm vi và độ tin cậy

- Source: `/Users/qc-bright/Project/chat_min`, nhánh `main`, commit `b1f5505c6c6a1ee39088894985f38d98f08ef5b2`. Working tree sạch khi bắt đầu.
- Máy: Mac16,7, 14 logical CPU, 24 GiB RAM; Node 22.20.0. Không kiểm soát hoạt động thông thường của người dùng và các app nền.
- UI: source hiện tại được Vite build ở production mode; Playwright WebKit 26.5, headless, viewport 1280×900, nhịp khoảng 60 Hz. **Không phải phép đo native WKWebView/ProMotion 120 Hz.**
- SQLite thật: mở `mode=ro` và `query_only=ON`; chỉ xuất số lượng, query plan và thời gian, không xuất nội dung hay định danh chat. Phép đo SQL dùng Python/SQLite 3.54.1, không gồm Rust serde, Tauri IPC hay thời gian chờ mutex.
- Ghi FTS: database tổng hợp trong RAM, chạy đúng cặp SQL DELETE/INSERT của production. Không ghi vào database thật.
- Store: import production module qua harness VM có sẵn, dùng API giả lập. Timings của phần này là Node/V8, không phải WebKit.
- Native: lấy 20 mẫu CPU delta cách nhau khoảng một giây và RSS từ app đang chạy; không điều khiển UI, không restart. Đây là **quan sát workload không được kiểm soát**, không phải idle benchmark hay memory-leak soak test.

**Không đồng nhất app cài và source:** binary `/Applications/ChatMin.app` có SHA-256 `ee47b1d8e310e1a66f1bde1dd0249aee6cd47ed709749e08894322dda294119c`; binary release trong checkout có SHA-256 `1525343cddd93f4b61dfaab1e78bdc21902abaec740b04531fd937c3f1c9dcba`. Vì khác hash, số liệu native/log không được xem là xác nhận hành vi của đúng source đang audit.

## Thứ tự ưu tiên

P1 = nút thắt có chi phí lớn, nằm trên luồng thường xuyên. P2 = vấn đề cần xử lý tiếp theo, ảnh hưởng phụ thuộc thao tác, tải hoặc thời gian sử dụng.

| ID | Mức | Phát hiện | Bằng chứng nổi bật |
|---|---|---|---|
| F1 | P1 | Mỗi tin được ghi lại đều quét FTS theo định danh không có index | Batch 50 tin: median 554 ms ở 95.308 bản ghi tổng hợp, riêng phần FTS |
| F2 | P2 | Search và cache dùng chung một mutex/connection | Global search p95 110 ms; page 50 tin chỉ 0,2–0,3 ms khi đo riêng |
| F3 | P2 | “Xem thêm” sidebar mount toàn bộ section | Frame gap 64 / 121 / 235 ms với 200 / 500 / 1.000 chat thêm vào |
| F4 | P2 | Cache chat đã đóng và `fresh` không có ngân sách tổng/eviction | Đóng 3 tab vẫn giữ 3.000 tin; thêm 100 event thành 3.100 tin |
| F5 | P2 | Virtualization giới hạn DOM, nhưng xử lý dữ liệu vẫn chạy trên cả danh sách | Switch CPU median 12 → 24 ms khi tăng 1.000 → 10.000 tin/chat |
| F6 | P2 | Mỗi lần mở DB đều chạy cleanup bằng cách quét JSON toàn bộ messages | Predicate quét 95.946 tin mất median 89 ms dù không có tombstone |

## F1 — Ghi FTS có chi phí tăng theo toàn bộ lịch sử

**Trigger:** nhận/cập nhật tin, tải thêm lịch sử hoặc refresh một trang tin đã có.

Schema FTS đánh dấu `account_id`, `chat_id`, `id` là `UNINDEXED`. `write_msg()` luôn thực hiện DELETE theo ba cột này rồi INSERT lại nội dung tìm kiếm; không có nhánh bỏ qua khi nội dung search không đổi. Một transaction của `put_msgs()` gọi thao tác này cho từng tin. Telegram và Google Chat history đều ghi batch trước khi trả kết quả.

- [Schema FTS](/Users/qc-bright/Project/chat_min/src-tauri/src/store.rs:61)
- [write_msg](/Users/qc-bright/Project/chat_min/src-tauri/src/store.rs:856)
- [put_msgs](/Users/qc-bright/Project/chat_min/src-tauri/src/store.rs:440)
- [Telegram history](/Users/qc-bright/Project/chat_min/src-tauri/src/tg.rs:625), [Google Chat history](/Users/qc-bright/Project/chat_min/src-tauri/src/gchat.rs:937)

Database thật tại thời điểm đo có 95.946 messages và 95.308 FTS rows. SELECT dùng đúng predicate của DELETE cho plan `SCAN messages_fts VIRTUAL TABLE INDEX 0:`; tìm một bản ghi mất median **16,66 ms**, p95 **21,81 ms**, 20 mẫu. Đây là chi phí tìm bản ghi để xóa, chưa đo toàn bộ ghi tin thật.

Benchmark ghi FTS tổng hợp, cùng schema và cặp DELETE/INSERT, 50 tin trong một transaction, một lượt warm-up và 7 lượt đo:

| Tổng FTS rows | Median một batch 50 | Max |
|---:|---:|---:|
| 10.000 | 56,44 ms | 56,82 ms |
| 50.000 | 281,93 ms | 285,94 ms |
| 95.308 | 553,77 ms | 561,44 ms |

**Ảnh hưởng:** chi phí xử lý một trang lịch sử tăng theo toàn bộ kho tin, kể cả khi page chỉ có 50 tin. Transaction giữ store mutex suốt batch, nên còn có thể trì hoãn các thao tác đọc khác. Benchmark trong RAM đã cho thấy vấn đề thuật toán; 554 ms **không phải** latency native đã đo của một page thật.

**Hướng xử lý đề xuất:** định vị FTS bằng rowid/mapping có index; chỉ cập nhật FTS khi phần nội dung tìm kiếm thay đổi. Cần thiết kế migration giữ đúng dữ liệu search và đối chiếu lịch sử/update/delete. Chỉ gom transaction hoặc chuyển sang worker không loại bỏ việc quét bảng này.

**Cách nghiệm thu sau này:** benchmark write/refresh page 50 ở 10k, 100k và 500k records; thời gian không tăng tuyến tính theo toàn bộ FTS, kết quả search và số rows vẫn đúng.

Bằng chứng: [predicate trên DB thật](/Users/qc-bright/Project/chat_min/docs/audits/2026-11-12-performance/database-extra.json), [ghi FTS tổng hợp](/Users/qc-bright/Project/chat_min/docs/audits/2026-11-12-performance/fts-write-synthetic.json).

## F2 — Query chậm chặn các thao tác cache nhanh qua mutex chung

`Core` giữ một `Mutex<Store>`, bên trong là một SQLite connection. Search đã chạy qua `spawn_blocking`, cached messages cũng vậy, nhưng cả hai vẫn lấy cùng store guard. WAL không tạo ra concurrency giữa các thao tác đang bị serialize bởi mutex ứng dụng.

- [Store mutex](/Users/qc-bright/Project/chat_min/src-tauri/src/lib.rs:95)
- [Search command](/Users/qc-bright/Project/chat_min/src-tauri/src/lib.rs:2012)
- [Cached messages command](/Users/qc-bright/Project/chat_min/src-tauri/src/lib.rs:1292)
- [Search SQL và sắp xếp theo timestamp trong JSON](/Users/qc-bright/Project/chat_min/src-tauri/src/store.rs:831)

Đo query production và JSON decode trên DB thật, page đọc 200 mẫu, search 60 mẫu, đều warm:

| Thao tác | p95 |
|---|---:|
| Telegram latest / older 50 | 0,200 / 0,233 ms |
| Google Chat latest / older 50 | 0,234 / 0,291 ms |
| Zalo latest / older 50 | 0,300 / 0,303 ms |
| Google Chat primary 50 | 2,977 ms |
| Search prefix `a` trong từng chat lớn nhất | 27,60–62,74 ms |
| Search prefix `a` toàn cục, limit 50 | 109,70 ms |

Search dùng FTS MATCH rồi join messages và temporary B-tree để sắp xếp timestamp. Limit 50 không giới hạn số ứng viên cần xét trước khi lấy top results.

**Ảnh hưởng:** một page đọc rất nhanh vẫn có thể phải xếp hàng sau search hoặc batch ghi F1. Chuyển SQL khỏi UI thread là bước đúng đã có, nhưng chưa giải quyết cạnh tranh tài nguyên giữa đồng bộ và tương tác.

Log của app cài, kể từ marker `11-12 10:40:11`, có 33 lần cached-history: median 1 ms, p95 382 ms, max 1.312 ms. Timer này bao gồm lấy store/query/hydration bên trong blocking task. Nó cho thấy có độ trễ đuôi, **không chứng minh riêng mutex là nguyên nhân**: chưa có lock-wait trace, log khác binary và workload không kiểm soát.

**Hướng xử lý đề xuất:** xử lý F1 trước; sau đó đo riêng thời gian chờ khóa và thời gian query. Cân nhắc reader connection độc lập và hàng ghi có giới hạn. Tối ưu lọc/sắp xếp search khi dữ liệu tăng, thay vì chỉ hạ result limit.

Bằng chứng: [SQL benchmark đầy đủ và query plan](/Users/qc-bright/Project/chat_min/docs/audits/2026-11-12-performance/cache-results.json), [log phiên hiện tại](/Users/qc-bright/Project/chat_min/docs/audits/2026-11-12-performance/current-session-log-aggregates.json).

## F3 — Sidebar mất giới hạn DOM khi bấm “Xem thêm”

Ở chế độ không filter, `extra[id]` chuyển limit từ 10 sang `Infinity`; tất cả chat trong section được map thành các row có drag/reorder. Filtered mode tăng từng 10 dòng, nhưng unfiltered mode mở toàn bộ.

Nguồn: [tính limit và render section](/Users/qc-bright/Project/chat_min/src/components/Sidebar.tsx:318).

Đo qua component thật, một account, thêm chat tổng hợp cùng một group section; mỗi quy mô là một page/browser context mới:

| Chat thêm vào | Row sidebar trước → sau | Click đến frame kế tiếp / max frame gap |
|---:|---:|---:|
| 200 | 20 → 212 | 64 ms |
| 500 | 20 → 512 | 121 ms |
| 1.000 | 20 → 1.012 | 235 ms |

**Ảnh hưởng:** người dùng mở section lớn có thể thấy khựng ngay ở cú bấm, dù timeline đang cuộn tốt. Đây là tổng frame delay gồm render/layout/motion, không phải isolated React CPU. Mỗi quy mô mới có một lần mở, chưa phải phân bố p95 của thao tác.

**Hướng xử lý đề xuất:** giữ “Xem thêm” theo batch ở mọi chế độ; nếu cần hiển thị hết, virtualize section và giữ đúng keyboard focus/drag order. Đây là thay đổi có thể khoanh vùng, không cần redesign sidebar.

Bằng chứng: [UI scale](/Users/qc-bright/Project/chat_min/docs/audits/2026-11-12-performance/ui-scale.json).

## F4 — Đóng tab không kết thúc vòng đời cache

`closeTab()` xóa metadata tab nhưng không xóa `msgs[k]` hoặc reading anchor. `trimLoaded()` chỉ chạy khi `openChat()` rời một chat; nếu anchor nằm sâu thì nó còn giữ phần lịch sử để phục hồi vị trí đọc. Không có ngân sách tổng cho số chat/tổng messages đã load. Event mới vẫn được append nếu `msgs[k]` tồn tại, dù tab đã đóng.

`fresh` được thêm key rồi spread toàn object ở mỗi tin mới, không có đường prune tương ứng trong store.

- [closeTab](/Users/qc-bright/Project/chat_min/src/store.ts:1351)
- [trimLoaded và giữ anchor](/Users/qc-bright/Project/chat_min/src/store.ts:1065)
- [nhận message và copy fresh](/Users/qc-bright/Project/chat_min/src/store.ts:544)

Tái hiện bằng production store trong VM: bắt đầu với 3 chat, mỗi chat đã load 1.000 tin; đóng hết tab; gửi 100 event tổng hợp vào một chat đã đóng. Kết quả: **0 tab mở, 3 cache chat, 3.100 tin retained**, chat đóng vẫn tăng lên 1.100 tin.

Stress riêng `fresh`: khi chỉ có một tin trong cache nhưng `fresh` có 100.000 key, một event mới tốn median 19,30 ms, p95 21,75 ms trên Node/V8; với 10.000 key p95 1,56 ms. **100.000 key là điều kiện stress, chưa đo thấy trong app thật.**

**Ảnh hưởng:** phiên dài và nhiều chat đã truy cập có thể làm cả RAM và chi phí mỗi event tăng dần. Đây là retention có bằng chứng, không phải kết luận leak từ heap snapshot hay RSS.

**Hướng xử lý đề xuất:** giới hạn cache theo tổng messages/bytes và LRU chat không mở; giữ các vùng đang đọc rồi rehydrate phần còn lại từ SQLite. Prune `fresh` và metadata theo vòng đời dữ liệu; cần giữ nguyên restore anchor và unread semantics.

Bằng chứng: [store scale và retention](/Users/qc-bright/Project/chat_min/docs/audits/2026-11-12-performance/store-scale.json).

## F5 — Xử lý toàn bộ danh sách vẫn tăng dù DOM đã virtualize

Các page/history event upsert từng message. `reconcileMessage()` tìm, copy và khi prepend có thể sort lại list; `layoutMessages()` tính ngày, grouping và album cho toàn bộ danh sách mỗi lần array thay đổi. Timeline cũng tạo keys từ tất cả rows.

- [merge history](/Users/qc-bright/Project/chat_min/src/store.ts:461), [merge older page](/Users/qc-bright/Project/chat_min/src/store.ts:1309)
- [reconcileMessage](/Users/qc-bright/Project/chat_min/src/lib/message-identity.ts:34)
- [layoutMessages](/Users/qc-bright/Project/chat_min/src/lib/message-layout.ts:16)
- [MessageList tạo layout](/Users/qc-bright/Project/chat_min/src/components/Conversation.tsx:194)
- [virtualizer/keys](/Users/qc-bright/Project/chat_min/src/components/Timeline.tsx:53)

Đo WebKit với số tin được kiểm tra trước/sau, mỗi chat giữ đúng 1.000 hoặc 10.000 tin:

| Tải | Switch CPU median / p95* | Navigation frame gap p95 / max | Scroll p95 / max | DOM ban đầu |
|---|---:|---:|---:|---:|
| 1.000 tin/chat | 12 / 15 ms | 23 / 25 ms | 17 / 18 ms | 9 rows |
| 10.000 tin/chat | 24 / 27 ms | 34 / 36 ms | 18 / 19 ms | 9 rows |

*Harness giữ 10 mẫu sau warm-up và gọi giá trị lớn nhất là p95. Switch CPU là synchronous state/render commit, không phải click-to-visible của native app. Việc đổi active trực tiếp ở harness cố ý giữ nguyên tải, không đi qua trim của điều hướng thường.

Phép đo Node riêng ở 10.000 tin: merge 50 tin cũ p95 14,54 ms; layout p95 12,10 ms. Hai số này không được cộng vào thời gian WebKit hoặc xem như latency UI thật.

**Ảnh hưởng:** đọc sâu hoặc giữ nhiều trang qua anchor có thể làm navigation và xử lý event khựng, trong khi cuộn ổn định vẫn nhanh. Không nên kết luận virtualization đã xử lý xong mọi chi phí của timeline.

**Hướng xử lý đề xuất:** batch merge theo ID một lần/page; chỉ cập nhật vùng layout bị ảnh hưởng; kết hợp ngân sách cache F4. Kiểm chứng đồng thời thứ tự tin, album, message identity và anchor.

Bằng chứng: [WebKit scale](/Users/qc-bright/Project/chat_min/docs/audits/2026-11-12-performance/ui-scale.json), [Node microbench](/Users/qc-bright/Project/chat_min/docs/audits/2026-11-12-performance/store-scale.json).

## F6 — Cleanup cũ nằm trên đường khởi động mỗi lần

`Store::init()` thực hiện `DELETE FROM messages WHERE json_extract(data, '$.deleted') = 1` mỗi lần mở DB. `Store::open()` được gọi trực tiếp trong Tauri setup trước khi setup hoàn thành.

Nguồn: [cleanup](/Users/qc-bright/Project/chat_min/src-tauri/src/store.rs:41), [startup gọi Store::open](/Users/qc-bright/Project/chat_min/src-tauri/src/lib.rs:2253).

SELECT dùng đúng predicate trên DB thật trả **0 rows**, nhưng query plan vẫn `SCAN messages`: median **88,76 ms**, p95 **96,66 ms**, 20 mẫu warm. Không chạy DELETE trên DB thật, không đo launch end-to-end, không xóa OS file cache.

**Ảnh hưởng:** mỗi lần mở app trả lại chi phí quét/parse JSON lịch sử để làm một cleanup có vẻ phục vụ dữ liệu cũ. Chi phí có thể tăng cùng DB.

**Hướng xử lý đề xuất:** nếu đây là migration một lần, đánh dấu schema/data version; nếu cleanup vẫn cần lặp lại, đưa ra khỏi đường khởi động và giới hạn batch. Xác nhận semantics tombstone trước khi thay đổi.

Bằng chứng: [startup predicate](/Users/qc-bright/Project/chat_min/docs/audits/2026-11-12-performance/database-extra.json).

## CPU nền và bộ nhớ native: điểm cần đo sâu hơn

Google Chat quét danh sách spaces mỗi vòng rồi ngủ 1 giây, không có nhánh hạ cadence theo foreground/background. Mỗi space đi qua đọc chat, kiểm tra/upsert metadata, đọc tin mới nhất; cuối vòng đọc danh sách chats. Có skip khi metadata không đổi, vì vậy không phải mọi vòng đều ghi toàn bộ dữ liệu. Trade-off hiện tại ưu tiên độ trễ thông báo.

Nguồn: [poll cadence](/Users/qc-bright/Project/chat_min/src-tauri/src/gchat.rs:373), [scan spaces](/Users/qc-bright/Project/chat_min/src-tauri/src/gchat.rs:465).

Web providers được khởi động nền; hide chỉ park/hide WebView, không đóng nó. Đây là chi phí kiến trúc cần có để giữ session/nhận tin, chưa phải bằng chứng lỗi vòng đời.

Nguồn: [start background](/Users/qc-bright/Project/chat_min/src-tauri/src/web.rs:259), [hide](/Users/qc-bright/Project/chat_min/src-tauri/src/web.rs:413).

Quan sát app cài trong 20 khoảng một giây, CPU theo một core:

| Process | CPU median / p95 | RSS median |
|---|---:|---:|
| Rust host | 2,86% / 5,74% | 86,0 MiB |
| Zalo Node child | 0% / 0% | 8,0 MiB |
| WebContent A | 0% / 24,84% | 140,1 MiB |
| WebContent B | 1,92% / 2,88% | 148,2 MiB |
| WebContent C | 2,91% / 32,55% | 434,1 MiB |

Provider cụ thể của A/B/C chưa được xác nhận; association dựa vào thời điểm launch và data handles. Không gán process C chắc chắn là Messenger. RSS có shared mappings và có thể bị reclaim/compress; **không cộng các dòng thành RAM riêng của app**, không suy ra leak hoặc mức hao pin. Các spike không có trace để quy trách nhiệm cho polling hay thao tác cụ thể.

Nên đo idle thật ở foreground/background, wakeups và CPU theo từng account; thử cadence thích ứng với độ trễ thông báo được thống nhất. Chưa có cơ sở chọn một chu kỳ polling mới hoặc đóng WebView nền tự động.

Bằng chứng: [process samples](/Users/qc-bright/Project/chat_min/docs/audits/2026-11-12-performance/passive-processes.json).

## Những phần hiện đang làm tốt

- Timeline có virtualization, overscan 3. Ba lượt đo cố định 1.000 tin/provider giữ khoảng 9 row ban đầu và 13 khi cuộn.
- Scroll frame gap p95: Zalo 17 ms, Telegram 17 ms, Google Chat 18 ms; không có gap >25 ms trong 89 frame scroll/provider của các lượt này.
- Gõ vào draft 80 dòng không làm lệch anchor trong fixture; typing frame gap p95 17–19 ms. Prepend và incoming-while-reading giữ anchor 0 px trong các scenario được kiểm tra.
- Worker xử lý rich text; cache text/HTML có giới hạn 256 entries và 1.000.000 ký tự. Không phải toàn bộ cache trong app đều unbounded.
- Latest request được coalesce; cached page được dùng trước live refresh; search và cached-read đã tách sang blocking worker.
- Zalo giới hạn 4 media transfers đồng thời. UI preferences không persist messages; có debounce/coalescing.

Nguồn: [Timeline](/Users/qc-bright/Project/chat_min/src/components/Timeline.tsx:66), [formatter cache](/Users/qc-bright/Project/chat_min/src/lib/format-worker-client.ts:12), [request coalescing](/Users/qc-bright/Project/chat_min/src/store.ts:1098), [Zalo semaphore](/Users/qc-bright/Project/chat_min/src-tauri/src/zalo.rs:53), [UI persistence](/Users/qc-bright/Project/chat_min/src/lib/ui-persistence.ts:1).

Bằng chứng UI: [fixed-1000 aggregate](/Users/qc-bright/Project/chat_min/docs/audits/2026-11-12-performance/ui-1000-results.json). Không có unexpected page errors ở ba lượt; mỗi lượt có một `ResizeObserver loop` warning trong scenario tăng chiều cao nội dung có chủ đích. Không tuyên bố console hoàn toàn sạch.

## Giới hạn và bước nghiệm thu cần có sau khi tối ưu

1. Chưa đo cold launch end-to-end, native input-to-paint ở 120 Hz, heap allocation/GC hay leak qua phiên nhiều giờ. Các thiếu hụt này được ghi rõ, không được biến thành kết luận app chậm ở mọi tình huống.
2. Chưa capture lock-wait trace của native source hiện tại; F1 có SQL/scale evidence mạnh, nhưng chưa phân rã latency native thành provider/network, database và IPC.
3. Các bộ đo chạy lần lượt, không chạy nhiều benchmark/build đồng thời. Hoạt động desktop bình thường không bị dừng.
4. Harness `run-audit.mjs` có scenario tên `scroll1000`, nhưng các bước điều hướng trước đó có thể trim cache. Vì vậy bảng 1.000/10.000 tin trong báo cáo dựa vào harness riêng và phép kiểm tra số tin thực tế, không dựa riêng vào tên scenario.
5. Phép đo bổ sung ghi kết quả JSON bằng lệnh tạm, không thêm test hay implementation vào source. Không chạy toàn bộ regression suite vì không có thay đổi sản phẩm; các check nêu trên là performance/fixture checks trong phạm vi báo cáo.

Thứ tự xử lý đề xuất: **F1 → F2 → F3/F4 → F5 → F6**. Sau mỗi nhóm, đo lại đúng workload và kiểm tra dữ liệu/anchor/unread tương ứng. Với CPU nền, cần trace có kiểm soát trước khi đổi chính sách đồng bộ.

Các công cụ sẵn có được sử dụng: [run-ui.mjs](/Users/qc-bright/Project/chat_min/scripts/performance/run-ui.mjs), [run-audit.mjs](/Users/qc-bright/Project/chat_min/scripts/performance/run-audit.mjs), [cache-benchmark.py](/Users/qc-bright/Project/chat_min/docs/audits/2026-10-27-native-zalo/performance/cache-benchmark.py), [store-harness.mjs](/Users/qc-bright/Project/chat_min/src/lib/store-harness.mjs). Chỉ redirect output của runner sang thư mục audit mới; script gốc không bị sửa.
