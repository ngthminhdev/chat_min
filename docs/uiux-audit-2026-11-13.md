# ChatMin — Audit UI/UX, 13/11/2026

## Kết luận

ChatMin có nền tảng giao diện nhất quán và đã xử lý nhiều trạng thái quan trọng: giữ nháp khi offline, cache-first, retry tại chỗ, phục hồi vị trí đọc, phân biệt tab chat/thread/topic. Ưu tiên tiếp theo là **trạng thái đáng tin và hành vi có thể đoán trước**: thông báo lưu thất bại, click sidebar đổi mục đích theo trạng thái, kết quả tìm kiếm cũ còn thao tác được và chevron không thu gọn khi lọc.

Không đề xuất thay design system, font, màu hay layout tổng thể chỉ để làm mới. Đây là audit; chưa sửa code.

## Phạm vi và bằng chứng

- Quan sát trực tiếp screenshot cửa sổ ChatMin đang chạy: sidebar, tabs, header, timeline, composer và Inspector. Không click chat, gửi tin, đổi settings hoặc thao tác tài khoản thật. Không đưa tên, nội dung tin nhắn hoặc định danh riêng từ screenshot vào báo cáo.
- Đọc source frontend hiện tại bằng CodeGraph. HEAD `b1f5505c6c6a1ee39088894985f38d98f08ef5b2`; khi kiểm tra, frontend `src/` không có diff. Repo có thay đổi Rust và rust-analyzer từ công việc khác; không chỉnh sửa hoặc hoàn tác chúng.
- Đối chiếu kết quả fixture WebKit đã chạy **12/11/2026 trong cùng chat**: [Telegram](/Users/qc-bright/Project/chat_min/docs/audits/2026-11-12-performance/current-telegram.json), [Google Chat](/Users/qc-bright/Project/chat_min/docs/audits/2026-11-12-performance/current-gchat.json). Đây là bằng chứng tái sử dụng, **không phải rerun ngày 13/11**. Fixture dùng dữ liệu tổng hợp/API giả lập.
- Quan sát thêm ảnh fixture Settings: [ảnh phần đầu Settings](/Users/qc-bright/Project/chat_min/docs/audits/2026-11-12-performance/current-telegram-settings.png).
- App cài và binary release trong checkout đã được xác định khác hash ở audit performance. Không coi screenshot native là bằng chứng mọi nhánh code mới đã được cài.

Phân biệt bằng chứng: **code xác nhận** là nhánh xử lý đọc được trực tiếp; **fixture** là hành vi trong dữ liệu kiểm thử; **heuristic** là nhận định về khả năng sử dụng cần kiểm chứng với người dùng. Không suy diễn thiếu accessibility từ việc công cụ native chỉ trả window/menu thay vì cây control WebView; chưa chạy VoiceOver hay đo contrast ratio.

## Danh sách ưu tiên

| ID | Mức | Vấn đề | Loại bằng chứng |
|---|---|---|---|
| U1 | P1 | Công tắc thông báo không rollback khi lưu thất bại | Code xác nhận |
| U2 | P2 | Một dòng sidebar có nhiều hành vi mở khác nhau | Code + fixture; tác động là heuristic |
| U3 | P2 | Kết quả search cũ còn bấm được dưới query/filter mới | Code xác nhận; fixture xác nhận giữ kết quả cũ |
| U4 | P2 | Chevron section không thu gọn được khi đang lọc | Code xác nhận |
| U5 | P2 | Con số cạnh section đổi đơn vị giữa số chat và số tin chưa đọc | Code xác nhận |
| U6 | P2 | Tìm tệp/ảnh cũ phải rời Inspector và cuộn timeline | Code + fixture |
| U7 | P2 | Lỗi search local hướng dẫn kiểm tra kết nối tài khoản | Code xác nhận |
| U8 | P2 | Search dừng ở 100 kết quả, không có đường xem tiếp | Code xác nhận; ưu tiên tùy tần suất tra cứu |
| V1 | P3 | Toolbar composer dày icon, ngôn ngữ viết thiếu ngữ cảnh tại chỗ | Native screenshot + code; heuristic |
| V2 | P3 | Inspector đưa ID kỹ thuật lên cùng mức với thông tin sử dụng | Native screenshot + code; heuristic |

P1: trạng thái hiển thị có thể khiến người dùng tin một thiết lập quan trọng đã có hiệu lực. P2: cản trở thao tác hoặc gây nhầm lẫn trong luồng thường dùng. P3: cải thiện khả năng nhận biết và thứ bậc thông tin. Đây không phải điểm số usability từ nghiên cứu người dùng.

## U1 — Công tắc thông báo báo trạng thái chưa được lưu

**Luồng:** mở Chi tiết hội thoại → bật/tắt Thông báo → API hoặc ghi local thất bại.

Handler cập nhật `chats[k].muted` trước, sau đó gọi `api.setMuted(...).catch(fail)`. Nhánh lỗi chỉ báo lỗi, không rollback, không có pending/error ngay bên cạnh switch. Telegram gửi yêu cầu tới provider; các nền tảng khác có thể lỗi ghi store. Vì vậy switch có thể tiếp tục hiển thị trạng thái mới dù thao tác thất bại, ít nhất tới khi có snapshot khác thay thế.

**Ảnh hưởng:** người dùng tưởng đã tắt hoặc bật thông báo; toast thoáng qua không làm rõ trạng thái cuối. Sidebar dùng cùng state nên biểu tượng mute cũng có thể phản ánh giá trị lạc quan đó.

**Đề xuất:** pending rõ ràng, commit khi lưu thành công hoặc rollback có kiểm tra request/version khi thất bại; thông báo lỗi cạnh switch và nút thử lại. Không rollback mù nếu người dùng đã đổi ý bằng thao tác mới.

**Nghiệm thu:** ép reject API; switch và badge phải về trạng thái đã xác nhận. Hai thao tác nhanh không cho response cũ ghi đè ý định mới. Đây là kịch bản cần test sau khi sửa; audit này không cố tình làm hỏng kết nối thật.

Nguồn: [Inspector.tsx:188](/Users/qc-bright/Project/chat_min/src/components/Inspector.tsx:188), [set_muted:1686](/Users/qc-bright/Project/chat_min/src-tauri/src/lib.rs:1686).

## U2 — Click dòng sidebar chưa có một ý nghĩa ổn định

Một row có thể:

- Mở đúng tin trong thread/topic khi có preview chưa đọc.
- Mở chat chính khi preview đã đọc.
- Quay về tin mới nhất nếu click lại row của parent timeline đang active.
- Chuyển sang hành vi mở chat thường khi draft hoặc typing che preview.

Các nhánh này có chủ đích và fixture kiểm tra đúng hành vi hiện tại. Vấn đề UX là người dùng phải hiểu trạng thái ẩn để đoán cú click tiếp theo, nhất là khi đang đọc tin cũ. Label `# chủ đề`/`↳ luồng` giúp nhận biết một phần nhưng cả row vẫn là cùng một vùng click.

**Đề xuất để cân nhắc, chưa phải quyết định đã duyệt:** tên/avatar luôn mở hội thoại ở vị trí đọc gần nhất; một target riêng cho preview chưa đọc đi tới thread/topic; “Tin mới nhất” dùng control có nhãn riêng. Giữ context-menu mở chat chính cho người dùng quen.

**Nghiệm thu:** cùng một vùng click giữ cùng mục đích trước/sau khi đọc, có nháp hoặc typing; target thread/topic có tên accessible và dùng được bằng bàn phím. Không đánh đổi khả năng mở thẳng tin chưa đọc.

Nguồn: [ChatRow:594](/Users/qc-bright/Project/chat_min/src/components/Sidebar.tsx:594), [onClick:621](/Users/qc-bright/Project/chat_min/src/components/Sidebar.tsx:621), [previewTarget:731](/Users/qc-bright/Project/chat_min/src/store.ts:731). Fixture `leftDock` xác nhận unread-preview và read-preview có đích khác nhau.

## U3 — Kết quả cũ vẫn tương tác được trong lúc search mới

Giữ kết quả cũ khi nhập tiếp là một lựa chọn tốt, giảm nhấp nháy. Tuy nhiên `hits` chưa được thay khi đổi query/account/scope; row chỉ thêm class `stale`. `disabled` chỉ phụ thuộc `opening`, không phụ thuộc loading hay identity của kết quả. Highlight cũng dùng query mới. Vì thế người dùng có thể thấy dropdown đã chọn tài khoản B nhưng bấm vào một tin thuộc kết quả cũ của A trong lúc chờ.

**Đề xuất:** giữ visual ổn định nhưng gắn kết quả với đủ identity `{query, account, scope}`. Trong lúc chuyển scope, chặn mở kết quả cũ hoặc ghi rõ scope cũ ngay trên nhóm kết quả; chỉ highlight theo query thực sự tạo ra nhóm đó.

**Nghiệm thu:** delay query 1 giây, đổi tài khoản rồi bấm result cũ; không được mở tin khác với phạm vi người dùng đang hiểu. ArrowDown/Enter cũng phải nhất quán.

Nguồn: [effect search:29](/Users/qc-bright/Project/chat_min/src/views/MessageSearch.tsx:29), [render result:99](/Users/qc-bright/Project/chat_min/src/views/MessageSearch.tsx:99). Fixture cũ xác nhận 30 kết quả còn hiển thị ở trạng thái stale; lỗi bấm sau đổi account được xác định từ code, chưa tái hiện trực tiếp trên UI trong lượt này.

## U4 — Chevron section nhận click nhưng không gập khi lọc

`AccountGroup` truyền `forceOpen={filtering}`. `Section` tính `collapsed = savedCollapsed && !forceOpen`, nhưng vẫn render button chevron và handler thay `savedCollapsed`. Khi đang search hoặc ở Chưa đọc/Nhắc tên, click không đổi trạng thái hiển thị; giá trị ẩn vẫn thay đổi và có thể ảnh hưởng khi bỏ filter.

**Ảnh hưởng:** control trông hoạt động nhưng không phản hồi đúng mục đích; người dùng có thể bấm nhiều lần rồi thấy trạng thái bất ngờ khi quay về Tất cả.

**Đề xuất:** filter mở section khi bắt đầu, sau đó cho phép người dùng gập; hoặc nếu bắt buộc mở, bỏ affordance thu gọn và nói rõ trạng thái. Ưu tiên phương án cho gập để giảm nhiễu.

**Nghiệm thu:** lọc → gập → mở lại → bỏ filter; chevron, `aria-expanded` và nội dung luôn đồng bộ, không có thao tác vô hiệu nhưng ghi state.

Nguồn: [forceOpen:330](/Users/qc-bright/Project/chat_min/src/components/Sidebar.tsx:330), [Section:403](/Users/qc-bright/Project/chat_min/src/components/Sidebar.tsx:403).

## U5 — Số cạnh tiêu đề section đổi ý nghĩa khi gập/mở

Khi section gập và có unread, con số là tổng tin chưa đọc; khi mở, cùng vị trí đó là `chats.length`. Ví dụ một nhóm 10 chat có tổng 60 tin chưa đọc sẽ đổi từ 60 sang 10 chỉ vì mở section. Nếu không unread, con số ở trạng thái gập lại trở thành số chat. Badge có khác style, nhưng thiếu đơn vị trực tiếp.

**Ảnh hưởng:** khó biết số đếm nói về chat hay tin, và có thể tưởng mở section đã làm giảm unread.

**Đề xuất:** tách số hội thoại và unread, hoặc giữ một nghĩa cố định ở vị trí đó; thêm accessible label “10 hội thoại, 60 tin chưa đọc”. Không dùng màu/hình dạng làm lời giải thích duy nhất.

**Nghiệm thu:** gập/mở không làm cùng một chỉ số đổi đơn vị; mute và filter không làm caption hiểu sai phạm vi.

Nguồn: [Section count:405](/Users/qc-bright/Project/chat_min/src/components/Sidebar.tsx:405).

## U6 — Tệp/ảnh giải thích đúng giới hạn nhưng chưa giúp hoàn thành việc tìm

Inspector chỉ lọc media từ `msgs[chat]` đang load. Dòng phạm vi đã nói rõ “trong phần lịch sử đã tải”, đây là điểm tốt. Nhưng hướng dẫn duy nhất để tìm thêm là cuộn lên trong hội thoại; tab Tệp/Ảnh không có action tải tiếp tại chỗ.

**Ảnh hưởng:** người dùng đang muốn tìm một tệp phải quay về luồng tin, tải lịch sử nhiều lần rồi kiểm tra Inspector; con số media cũng phụ thuộc các trang còn trong cache. “Không có trong phần đã tải” không phải kết thúc được tác vụ.

**Đề xuất:** action “Tải thêm lịch sử” có tiến độ và lỗi ngay trong Inspector, hoặc mở search tên tệp với scope chat điền sẵn. Hiển thị ranh giới lịch sử đã duyệt nếu có dữ liệu tin cậy; không hứa đã tìm toàn bộ server.

**Nghiệm thu:** tìm tệp nằm ngoài page đầu mà không cần tự cuộn timeline; stop/retry không làm mất vị trí đọc hiện tại. Nếu provider không cung cấp lịch sử đó, nói đúng giới hạn.

Nguồn: [filter media:61](/Users/qc-bright/Project/chat_min/src/components/Inspector.tsx:61), [scope và nội dung tab:96](/Users/qc-bright/Project/chat_min/src/components/Inspector.tsx:96). Fixture `inspectorScopeAndRetry` xác nhận nội dung scope hiện tại.

## U7 — Hướng dẫn lỗi search không khớp cơ chế local

Header nói rõ tìm trong lịch sử trên máy, không tìm server. Nhưng error state lại nói “Thử lại hoặc kiểm tra kết nối tài khoản”. Search command thực hiện SQLite local, nên mất mạng không phải điều kiện bắt buộc khiến search thất bại. Lời nhắc này dễ dẫn người dùng kiểm tra mạng hoặc đăng nhập lại không cần thiết.

**Đề xuất:** “Chưa tìm được trong dữ liệu đã lưu” + retry; phân loại lỗi dữ liệu/IPC nếu biết chắc. Chỉ yêu cầu kết nối khi hành động tiếp theo thực sự tải thêm lịch sử.

**Nghiệm thu:** search dữ liệu đã cache vẫn có lời giải thích phù hợp khi offline; lỗi local không hướng dẫn sửa tài khoản.

Nguồn: [header:62](/Users/qc-bright/Project/chat_min/src/views/MessageSearch.tsx:62), [error:97](/Users/qc-bright/Project/chat_min/src/views/MessageSearch.tsx:97), [native search:2012](/Users/qc-bright/Project/chat_min/src-tauri/src/lib.rs:2012).

## U8 — Search 100 kết quả không có đường truy cập phần còn lại

UI yêu cầu limit 100, có nhãn “100 kết quả đầu tiên” và nhắc thu hẹp từ khóa. Đây là giới hạn được công khai, không phải trả kết quả thiếu mà im lặng. Tuy vậy, với từ khóa phổ biến, người dùng không nhớ chat hoặc đang tìm tin cũ hơn, UI không có pagination/load more hay bộ lọc ngày để đi tiếp.

**Đề xuất:** cursor “Xem kết quả cũ hơn” hoặc lọc thời gian. Không chỉ tăng limit vô hạn vì audit performance đã chỉ ra chi phí search/khóa DB.

**Nghiệm thu:** một tin ngoài 100 kết quả đầu phải có đường tới từ màn search mà không cần đoán thêm nội dung.

Nguồn: [search limit:36](/Users/qc-bright/Project/chat_min/src/views/MessageSearch.tsx:36), [count:96](/Users/qc-bright/Project/chat_min/src/views/MessageSearch.tsx:96), [footer:111](/Users/qc-bright/Project/chat_min/src/views/MessageSearch.tsx:111).

## Nhận định visual cần kiểm chứng thêm

### V1 — Composer có nhiều action ngang cấp

Screenshot native cho thấy attachment, emoji, gợi ý AI, dịch, plain text, ngôn ngữ, sticker, voice và send cùng xuất hiện trên một hàng. Code đã có tooltip và aria-label, nên không kết luận chúng không có tên. Vấn đề là người mới cần hover để phân biệt nhiều icon, trong khi các tác vụ AI và gửi cơ bản có mức nổi tương tự. Tag ngôn ngữ có thể bị hiểu là mọi tin sẽ tự được dịch, dù có nút dịch nháp riêng.

Đề xuất giữ attachment/emoji/send dễ thấy; nhóm AI/dịch/ngôn ngữ thành một cụm có nhãn, plain text ở vị trí thứ cấp. Đây là đề xuất thiết kế cần thử với tác vụ thật, không phải lỗi chức năng đã tái hiện. Nguồn: [composer tools:439](/Users/qc-bright/Project/chat_min/src/components/Composer.tsx:439), [translation/plain/language:499](/Users/qc-bright/Project/chat_min/src/components/Composer.tsx:499).

### V2 — Inspector ưu tiên thông tin kỹ thuật hơn tác vụ thường ngày

Trong chat 1-1 được quan sát, panel dành một hàng chi tiết nổi bật cho ID hội thoại và có tab Thành viên dẫn đến mô tả chat 1-1. ID có ích khi debug nhưng ít giúp tìm tệp, xem ảnh hay quản lý thông báo. Có thể đưa ID vào “Thông tin kỹ thuật”, bỏ/đổi tab Thành viên cho DM và ưu tiên action thường dùng. Giữ thao tác copy ID phục vụ người dùng kỹ thuật. Nguồn: [tabs:65](/Users/qc-bright/Project/chat_min/src/components/Inspector.tsx:65), [ID:178](/Users/qc-bright/Project/chat_min/src/components/Inspector.tsx:178), [members DM:246](/Users/qc-bright/Project/chat_min/src/components/Inspector.tsx:246).

Không có cơ sở đề xuất thay palette/icon library hoặc thêm hiệu ứng. Chưa đo contrast ở tất cả theme; không gắn nhãn vi phạm accessibility chỉ bằng cảm giác màu nhạt.

## Các điểm tốt nên giữ

- Sidebar và message search đã phân biệt “Lọc theo tên hội thoại” với tìm nội dung; search có scope account/chat, clear query và điều hướng kết quả bằng phím mũi tên.
- Offline vẫn soạn được nháp; nút gửi có lý do bị chặn. Retry attachment giữ tệp/caption trong fixture.
- Cached content được giữ khi live refresh lỗi; có status và retry ngay trong timeline.
- Tab thread/topic có label và loại riêng; jump từ search/Todo về đúng nguồn đã có fixture.
- Position restore, prepend và incoming khi đang đọc giữ anchor trong fixture; không nên phá để làm UI mới.
- Settings có mục điều hướng tới từng nhóm, focus về heading; không còn là trang dài không lối tắt.
- Wizard phân biệt đang sync nền với sync lỗi; Zalo nói rõ giới hạn lịch sử, không khẳng định đã tải hết server.
- Error/retry cho members và Messenger WebView đã có. Không ghi lại các vấn đề “thiếu loading/error state” chung chung như thể app chưa xử lý.

Các khẳng định fixture ở đây dựa vào JSON ngày 12/11, không chứng minh network/account thật. Kiểm tra screen reader, bàn phím toàn bộ app native, light theme, mobile và nhiều mức zoom vẫn chưa được thực hiện trong audit này.

## Thứ tự xử lý đề xuất

1. U1: trạng thái thông báo khi lỗi.
2. U3/U4/U5/U7: sửa tương tác và thông điệp có phạm vi nhỏ, bằng chứng code rõ.
3. U2: thống nhất semantics mở chat/thread trước khi sửa điều hướng; cần giữ các entry point đang hữu ích.
4. U6/U8: hoàn thiện hành trình tìm tệp và tra cứu tin cũ, phối hợp với tối ưu DB.
5. V1/V2: thử nghiệm thứ bậc action, giữ ngôn ngữ thiết kế hiện tại.

Liên quan: [audit performance](/Users/qc-bright/Project/chat_min/docs/performance-audit-2026-11-12.md). Các đề xuất trên chưa được triển khai, chưa thay đổi hành vi sản phẩm.
