# Audit performance: chuyển tab / mở hội thoại — 2026-10-26

## Kết luận

Có chi phí chặn main thread khi dựng lại timeline. Ba tối ưu bảo toàn hành vi đã được sửa trong source, nhưng chuyển tab với nhiều tin vẫn vượt ngân sách 16,7 ms/frame của màn hình 60 Hz. Chưa thể kết luận bản app cài trong Applications đã hết lag.

## Bằng chứng

- Log của bản app đang cài: các lượt history/live Google Chat khoảng 832–1105 ms; Telegram khoảng 143–288 ms. Đây là thời gian hoàn thành luồng lấy/merge history, **không phải** thời gian UI bị chặn hay phép đo FPS.
- Dựng bản frontend production, chạy Playwright WebKit headless trên máy local, viewport 1280×900.
- Fixture tổng hợp: hai chat đã có sẵn dữ liệu; mỗi chat 100 tin, 25 tin chứa code block không ghi ngôn ngữ. Đổi `active` trong store và dùng React `flushSync` để đo thời gian commit đồng bộ; sau đó refresh 50 tin cuối bằng snapshot được clone như dữ liệu IPC. Bỏ hai vòng warm-up, lấy 10 mẫu. Không dùng tài khoản hay nội dung tin thật.
- Fixture chỉ mount `Conversation`, không gồm Sidebar/Inspector/native IPC/provider webview. Đây là phép đo cô lập, không phải latency end-to-end trên bản macOS đang cài.

| Phép đo CPU đồng bộ | Trước | Sau |
| --- | ---: | ---: |
| Đổi chat, 100 tin — median | 58 ms | 49 ms |
| Đổi chat, 100 tin — p95 | 64 ms | 49 ms |
| Refresh dữ liệu không đổi — median | 9 ms | dưới độ phân giải 1 ms |
| Refresh dữ liệu không đổi — p95 | 12 ms | 1 ms |

Đo bổ sung sau sửa: 50 tin/chat, khoảng 13 code block, median 26 ms, p95 28 ms khi đổi chat. Không có mẫu trước sửa cho cấu hình 50 tin nên không dùng số này để tính cải thiện.

Harness và raw samples tạm thời: `/tmp/chatmin-perf-20261026/` (`before.json`, `after.json`, `after-50.json`, `entry.tsx`, `run.mjs`). Thư mục tạm có thể bị hệ thống dọn. Không thêm script/ảnh kiểm tra vào repository.

## Đã sửa

1. `src/lib/message-identity.ts`: snapshot giống nhau vẫn tạo object/array mới cho mọi tin, làm mất tác dụng `React.memo`. Giữ lại reference nếu mọi trường, kể cả reaction/media/link và trạng thái seen, không đổi. Các edit/ACK/ID chuyển tiếp vẫn giữ quy tắc cũ.
2. `src/lib/format.ts`: mỗi lần mount lại bubble đều format và chạy syntax highlighting lại. Dùng cache LRU chia sẻ giữa các lần mount; key gồm text và danh sách mention. Giới hạn 256 mục và 1 triệu ký tự key+HTML, bỏ qua text trên 64.000 ký tự. Không persist cache ra đĩa.
3. `src/store.ts`: chuyển nhanh ra/vào cùng chat khi request cũ chưa xong có thể gọi trùng latest-history. Gộp request đang chạy theo chat; giải phóng khi hoàn thành hoặc lỗi. Lần mở tiếp theo sau khi request hoàn thành vẫn refresh bình thường, không thêm TTL làm chậm cập nhật tin.

## Còn lại / ưu tiên tiếp theo

- **Ưu tiên cao: timeline mount đồng bộ toàn bộ tin.** `Conversation` đổi key của `MessageList` theo chat; `ThreadView` cũng được key theo tab. Dữ liệu đã cache vẫn phải dựng lại toàn bộ bubble, toolbar, avatar và các subscription. `layoutMessages(visible).map(...)` chưa có windowing. Mốc 49 ms/100 tin và 26 ms/50 tin cho thấy ba sửa trên chưa đủ để đạt một frame khi chuyển tab.
- Hướng xử lý tiếp theo: windowing timeline theo viewport với chiều cao động. Phải giữ đúng vị trí khi tải lịch sử, jump tới quote/search, unread marker, album và ảnh đổi chiều cao. Cần benchmark và kiểm tra các hành vi này trước khi áp dụng rộng.
- Cache markup giúp khi quay lại chat; lần đầu mở nội dung mới vẫn phải parse/highlight. Không coi kết quả warm-switch là số đo cold-open.
- Chi phí Sidebar/Inspector, đổi webview Messenger/Zalo và native focus chưa được profile trong phép đo này; không gán phần lag còn lại cho chúng nếu chưa có trace.

## Kiểm chứng / trạng thái giao giai đoạn audit đầu

- Regression tests được chạy đỏ trước sửa cho no-op identity, reuse formatting và request coalescing; sau sửa đã xanh.
- `npm test`: 91/91 pass, gồm kiểm tra edit/ACK/retired ID, nested changes, mention identity, cache eviction/size và retry sau request lỗi.
- `npm run build`: pass. Vẫn có cảnh báo bundle lớn và dynamic/static import `bridge.ts` đã có sẵn.
- Smoke test bản production đầy đủ trong WebKit/demo: 6 lần chọn hội thoại và 12 lần chuyển tab, không có lỗi JavaScript; hội thoại và tin nhắn cuối hiển thị đúng. Không gửi tin nhắn.
- Review độc lập ba thay đổi: không có finding cần sửa.
- `git diff --check` trên các file sửa trong lượt audit: pass. Full-workspace check có một lỗi whitespace đã tồn tại tại `docs/HANDOFF.md:239`; giữ nguyên thay đổi có sẵn.
- Chưa commit/push, chưa build/cài lại native app trong lượt audit này. Phép đo sau sửa áp dụng cho source frontend production, không phải binary hiện tại trong `/Applications/ChatMin.app`.

## Follow-up: yêu cầu UI phản hồi ở mục tiêu 60 FPS

Yêu cầu mới của user: ưu tiên không đứng UI; cho phép skeleton/loading. Đã thực hiện:

- Timeline dùng React Virtuoso 4.18.19, chỉ mount các row gần viewport; dùng chung cho conversation/thread/topic. Skeleton nhẹ được paint trước khi mount list. Không giữ nguyên full-list render rồi chỉ phủ loading lên trên.
- Format nội dung/translation bằng module Web Worker. Coalesce request, bỏ queued work khi row rời màn hình, cache giới hạn cả số lượng và text/HTML; lỗi worker dùng escaped plain text, không highlight đồng bộ trên luồng UI.
- First-item index giữ anchor khi prepend; thread root nằm ngoài cửa sổ reply trong Header để không phá quy tắc prepend. Quote/search tìm cả row chưa mount và album tile. Chỉ top-scroll có chủ đích mới gọi tải lịch sử.
- Giữ bottom-follow khi ảnh/HTML thay đổi chiều cao muộn, giữ anchor cho người đang đọc tin cũ, và giữ jump-bottom/new-message count.
- Có diagnostic nhẹ `text-format` (worker/plain, không nội dung tin), `timeline-frames` (32 mẫu rAF, p95/max/row count) để kiểm tra native.

### WebKit production, viewport timeline cố định 1280×900

Đã bổ sung ràng buộc chiều cao viewport và đợi row thật + worker text hoàn tất trước khi chốt mỗi lượt. Fixture audit đầu chỉ đo synchronous full-list commit; số 49 ms là baseline khảo sát, không dùng làm số FPS thực tế hay so sánh geometry hoàn toàn đồng nhất với fixture mới.

| Dataset | Switch CPU median / p95 | Nội dung hoàn tất | Mounted rows | rAF gap p95 / max | Gap >25 ms |
| --- | --- | --- | --- | --- | --- |
| 100 tin, 25 code blocks | 5 / 5 ms | khoảng 167 ms | 8 | 17 / 20 ms | 0/146 |
| 1000 tin, 250 code blocks | 5 / 10 ms | khoảng 166 ms | 8 | 18 / 25 ms | 0/146 |

Đây là thời gian điều hướng phản hồi nhanh và đợi nội dung riêng; không đổi `1000 / switchCPU` thành tuyên bố FPS. rAF của browser có độ phân giải/jitter; cần đối chiếu log native và thao tác thật trước khi kết luận trải nghiệm native. Không thể bảo đảm mọi frame trên mọi máy từ hai fixture này.

### Regression QA

- Browser với 100 và 1000 tin: offscreen jump pass; prepend 20 tin giữ anchor delta 0 px; incoming khi đang đọc không kéo xuống; new counter pass; notification jump/bottom append follow pass; thêm 600 px chiều cao muộn vào row cuối vẫn ở bottom.
- Production app đầy đủ/demo: 18 lượt mở chat/chuyển tab, không lỗi JavaScript, row thật và nội dung hoàn tất; đã xem screenshot ở `/tmp/chatmin-perf-20261026/full-ui.png`.
- `npm test`:99/99 pass. `npm run build` pass. Review độc lập đã sửa hai vấn đề (root prepend và late-height following); lượt review cuối không còn finding quan trọng.
- Raw samples/harness ở `/tmp/chatmin-perf-20261026/virtual-final-100.json`, `virtual-final-1000.json` và source cùng thư mục. File/harness tạm có thể bị hệ thống dọn.


### Kiểm tra shell đầy đủ và native

- Fixture shell đầy đủ có Sidebar/Tabs/Inspector với 1000 tin: switch CPU median 8 ms, p95 10 ms; chỉ 7 row mount; frame-gap p95 18 ms, max 24 ms, không có gap trên 25 ms trong 136 mẫu. Scroll 89 frame: p95 17 ms, max 18 ms, không gap trên 25 ms. Đây là phép đo browser trên máy local, không phải cam kết mọi frame của native.
- Native release đầu đã cài, worker xác nhận `engine:worker` trong js.log. Bắt đầu app có spike 31–37 ms khi provider khởi động; các lượt đổi tab ban đầu 22–27 ms. Lượt warm-switch không poll accessibility trong cửa sổ đo đạt p95/max 18/18 ms, 0/32 gap trên 25 ms.
- Sau phép đo native, đã giảm cold DOM của MessageItem: toolbar/icon chỉ mount lần đầu hover hoặc focus row; giữ button connected cho tới khi row unmount để menu Escape phục hồi focus. Browser kiểm tra zero toolbar lúc cold, hover/focus hiện toolbar, và keyboard More → Escape trả focus. Bản native cuối đã được build lại và cài để cập nhật thay đổi này.
- Bản cũ trước cập nhật giữ ở `/tmp/ChatMin-before-responsive-timeline-20261026.app`; không sửa dữ liệu account/draft, không gửi tin nhắn.


### Kiểm tra cuối trước đóng gói

- Shell đầy đủ + 1000 tin + toolbar lazy: switch CPU median 8 ms, p95 9 ms; 7 row mount. Không có gap rAF trên 25 ms trong 136 mẫu. Scroll 89 frame: p95/max 18/18 ms.
- Đã kiểm tra thêm thread có root ngoài cửa sổ reply: prepend giữ anchor trong 0,5 px; jump về root pass. Khi first-row grouping/day label thay đổi, giữ anchor theo row DOM thực tế trong tối đa 8 frame; hủy correction ngay khi có thao tác/điều hướng mới.
- Quote/search jump là một lệnh, không chạy lại khi thêm lịch sử trong lúc highlight còn hiện.
- Keyboard focus vào row hiện toolbar; Enter mở More và Escape trả lại đúng button. Mouse click trên WebKit có thể focus row; Escape vẫn về row ổn định.
- Lượt review cuối không còn finding cần sửa. `npm test`: 99/99 pass; diff-check trên các file thay đổi trong lượt này pass.


## Bàn giao bản native cuối

- Release build và ad-hoc signature verify pass; đã cài `/Applications/ChatMin.app` và mở lại. SHA-256 binary cài và binary bundle cùng là `66036267e9d6ac1fd340ee531c161d681a5685700337fce8b91050548c095569`.
- Native xác nhận worker hoạt động. UI đã hiển thị tin nhắn và composer, không còn ở skeleton khi hoàn thành đọc dữ liệu. Không gửi tin.
- Native rAF probe 32 frame sau đổi chat, không poll accessibility trong cửa sổ đo: average 16,0 ms (ước lượng 62,6 callbacks/s), p95 19 ms, max 25 ms; lượt tiếp theo average 16,5 ms (60,5 callbacks/s), p95 22 ms, max 26 ms. Đây là nhịp callback UI, không phải GPU-present trace; không suy ra rằng mọi frame đều đạt tối thiểu 60 FPS. Startup probe có max 28 ms.
- Không còn full-list mount hoặc syntax highlighting trên luồng UI. Source và bản app đã cập nhật; không commit/push. Backup trước cập nhật vẫn ở `/tmp/ChatMin-before-responsive-timeline-20261026.app`.

## Follow-up: scroll "giựt giựt" trên màn 120 Hz (chiều 2026-10-26)

- Bằng chứng từ recording của user (120 fps, `Screen Recording 2026-10-26 at 16.28.57.mov`), đo dịch chuyển dọc giữa từng frame: khi scroll, cứ một frame di chuyển lại một frame đứng yên (`.4.4.4.`). Nội dung chỉ cập nhật 60 Hz trên màn ProMotion 120 Hz; rAF probe trong app cùng lúc cho averageMs 16.5. Không phải main thread chậm: p95 18 ms, 0 frame trên 25 ms.
- Nguyên nhân: WKWebView mặc định bật feature `PreferPageRenderingUpdatesNear60FPSEnabled` (danh sách `_features` của `WKPreferences`). Private API; property `_preferPageRenderingUpdatesNear60FPSEnabled` không còn tồn tại trên macOS 26, phải tắt qua `_setEnabled:forFeature:`.
- Kiểm chứng ngoài app bằng WKWebView trần (ObjC, cùng máy): mặc định 60,6 rAF/s; tắt feature 120,3 rAF/s; tắt sau khi webview đã tạo vẫn 120,7 rAF/s.
- Sửa: `src-tauri/src/lib.rs` setup hook tắt feature trên webview `main` qua `with_webview`; log `[webview] rendering updates no longer capped near 60 Hz` trong app.log.
- Sửa kèm: `FormattedText` không còn skeleton cho row lạnh; hiển thị text đã escape (`plainHtml`) tới khi worker trả HTML. Skeleton cao 40 px cố định nên mỗi row lạnh đổi chiều cao khi có kết quả và Virtuoso phải bù scrollTop lúc đang scroll lên. Chưa có phép đo riêng cho phần này; suy luận từ cấu trúc.
- Probe native bản mới sau 6 lần đổi tab warm: averageMs 8,9–9,4 (106–112 callbacks/s), p95 17–20 ms, max 18–22 ms, 0/32 frame trên 25 ms. Bản cũ cùng ngày: averageMs 16,1–16,6, p95 18–19, max 18–24. p95/max không tăng dù ngân sách mỗi frame còn 8,3 ms.
- Giới hạn: `screencapture -V` trên máy này chỉ ghi ~48 fps (kể cả với animation 120 Hz thuần) nên không dùng được để đo độ mượt; cần QuickTime như recording gốc. Chưa có recording 120 fps sau sửa. `npm test` 99/99, `npx tsc --noEmit` pass, `cargo check` pass.
- Build release, ký ad-hoc, cài `/Applications/ChatMin.app` (SHA-256 binary bắt đầu `d0885b2f4b39453b`); backup trước cập nhật `/tmp/ChatMin-before-120hz-20261026.app`. Không commit.

## Follow-up: Enter / dynamic-row scroll anchor (2026-10-26)

- Reproduced small reverse-wheel movements on a fresh 80-message mixed-height fixture in production WebKit: visible rows jumped backward 24.56 px repeatedly, with one 60.44 px bottom pullback. The old list-height callback forced bottom scrolling while unknown row estimates were being replaced by measured heights.
- Replaced the timeline adapter with `@tanstack/react-virtual@3.14.23`: stable message keys, end anchoring, append following and direct DOM position updates. Removed the unconditional resize-to-bottom callback. Header/footer heights use list padding; one prepend snapshot preserves the first visible reply when the viewport overlaps the thread header. No repeated animation-frame scroll correction.
- Enter had two additional geometry triggers: optimistic senderId was empty (a grouped bubble changed by 16 px through ACK), and a native outgoing echo could appear before the send response, briefly adding a duplicate bubble. Local sends now use account selfId; matching early outgoing text events wait for authoritative ID correlation, then replay without losing incoming messages or other-device messages. Parallel identical-send and temporary-ID-chain regressions are covered.
- Final isolated fixture: zero reverse scroll movements across 24 native wheel steps; optimistic/ACK sender grouping remains unchanged. Full shell with 1000 messages: 9 mounted rows, switch CPU median 8 ms / p95 9 ms. Separate 89-frame scroll sample: p95 18 ms, max 19 ms, no gaps above 25 ms. Ordinary and thread prepend anchors both delta 0 px; quote/root jumps, away-message stability, late media-height following and keyboard toolbar focus pass.
- Verification: 104 frontend tests, TypeScript/build and diff-check pass. These fixtures do not establish a guaranteed minimum FPS or real-provider send latency. WebKit emitted an occasional ResizeObserver undelivered-notifications warning during resize tests; tested anchors and final geometry remained stable.
- Adapter references: https://tanstack.com/virtual/latest/docs/chat and https://tanstack.com/virtual/latest/docs/framework/react/react-virtual .
- Native release installed at `/Applications/ChatMin.app`; signature verification passed, installed/bundle binary SHA-256 both `c74f9b6cc589a923ecd781a3d723ae750c9b87707c5e370f9d722989e46c4c52`. Backup: `/tmp/ChatMin-before-scroll-jitter-20261026.app`. Native messages/composer eventually rendered; automatic AX checks initially saw skeleton while the window was not actively rendering. No real messages sent. User was navigating chats during QA, so no isolated native scroll benchmark was obtained.
- Native 32-frame callback samples after installation ranged ~100–120 callbacks/s, including p95/max 13/14 ms in one sample and 29/34 ms in another. These startup/navigation samples do not prove every frame meets 60 FPS. Rust tests: 64 passed. Independent final review found no actionable regression. Changes remain uncommitted.
