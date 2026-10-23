# Audit chi tiết UI, UX và motion — 23/10/2026

> Cập nhật: người dùng đã cho phép sửa sau audit. Xem [kết quả triển khai và kiểm thử](2026-10-23-ui-ux-motion-fixes.md). Nội dung dưới đây giữ nguyên như checkpoint audit trước sửa.

Phạm vi: ChatMin tại commit `b310a2c`, tập trung các tương tác nhỏ trong sidebar, tin nhắn, composer, tab, loading và thông báo. Điểm xuất phát là ảnh “đang gõ…” của người dùng. Giữ giao diện/theme hiện tại; Messenger và Zalo không nằm trong lượt rà này. Đây là báo cáo audit, chưa sửa code ứng dụng.

## Cách kiểm tra và giới hạn

- Đọc source hiện tại qua CodeGraph, đối chiếu CSS và DOM/computed style trong browser demo tại `http://localhost:1424`.
- Browser được quan sát ở viewport 938 × 1189. Kiểm tra chuyển chat Telegram/Google Chat, mở lại chat, một chuỗi gửi/nhận bằng backend demo trong bộ nhớ, reaction và bàn phím trên tab chính. Backend demo không gửi tin ra tài khoản thật.
- Phân biệt rõ bằng chứng từ source, quan sát browser và rủi ro cần tái hiện khi sửa. Không coi suy luận từ source là số đo hiệu năng.
- Chưa đo frame time, chưa kiểm tra native Tauri/WKWebView, mạng/tài khoản thật, reduced-motion bằng OS, toàn bộ theme hoặc viewport nhỏ trong lượt này. Không khẳng định đạt 60 fps.

P1 bên dưới nghĩa là ưu tiên cho đợt polish này vì ảnh hưởng trực tiếp cảm giác phản hồi; không có nghĩa là lỗi mất dữ liệu. P2 là chi tiết cần hoàn thiện tiếp.

## Phát hiện và hướng xử lý

### M01 · P1 · Typing indicator chưa tạo được cảm giác người kia đang hoạt động

**Bằng chứng:** `src/components/Sidebar.tsx:528` render một span chữ “đang gõ…”; `src/styles/chatmin.css:85` chỉ đặt màu và italic. Ba chấm trong khung chat ở `src/components/Conversation.tsx:280` có animation, nhưng `src/styles/chatmin.css:243–246` chỉ thay opacity. Hai nơi thể hiện cùng trạng thái theo hai cách khác nhau.

**Đề xuất:** dùng chung một cụm ba chấm nhỏ, đặt cạnh chữ đứng yên. Chấm nhô lên khoảng 2px, lệch pha khoảng 120ms, chu kỳ khoảng 1–1,2 giây; chỉ animate transform/opacity. Sidebar dùng bản compact; khung chat dùng cùng nhịp. Fade chuyển preview ↔ typing khoảng 100–140ms trong cùng một vùng có chiều cao cố định. Không làm tên, avatar hoặc cả hàng chat nảy theo. Khi giảm chuyển động, giữ chấm tĩnh và chữ rõ nghĩa. Không phát thông báo screen reader theo từng nhịp chấm.

**Nghiệm thu:** không đổi chiều cao hàng; tên người gõ dài vẫn ellipsis; trạng thái mất đi khi có tin/timeout; một và nhiều chat cùng typing không gây layout shift.

### M02 · P1 · Bubble gửi đi có đường dẫn chạy animation xuất hiện lần thứ hai khi xác nhận

**Bằng chứng từ source:** `src/store.ts:818–834` tạo `local-*`, rồi xoá message tạm và chèn message với ID thật; cả hai ID đều được đánh dấu `fresh`. `src/components/Conversation.tsx:253` dùng ID làm React key, còn `src/components/Message.tsx:45–46` animate message fresh từ opacity 0 và y=8.

**Hệ quả:** xác nhận gửi có thể remount cả bubble, chạy lại entrance và khởi tạo lại state con. Browser đã kiểm tra chuỗi demo gửi → xác nhận → nhận phản hồi; lượt này chưa ghi lại từng frame để lượng hoá mức nháy.

**Đề xuất:** giữ identity hiển thị ổn định trong suốt local → server acknowledgement, tách khỏi ID provider. Chỉ đổi trạng thái sending/sent/seen; entrance chạy một lần. Giữ nguyên ID provider cho reply, edit, delete và dedupe.

**Nghiệm thu:** xác nhận chậm, event đến trước response hoặc response đến trước event đều chỉ có một bubble và một entrance; media không bị reset khi xác nhận.

### M03 · P1 · Tin đã xem vẫn đủ điều kiện animate lại khi quay lại chat

**Bằng chứng từ source:** `fresh` được thêm tại `src/store.ts:415`, `437`, `784`, `829`, `834`, không có bước tiêu thụ riêng cho animation. `src/components/Conversation.tsx:144` remount MessageList theo chat; `src/components/Message.tsx:45–46` dùng lại cờ đó để quyết định initial animation. Browser xác nhận tin demo còn có motion styles sau khi rời rồi mở lại chat; chưa capture frame đầu của lần mở lại.

**Đề xuất:** animation có bộ nhớ “đã xuất hiện” riêng với ngữ nghĩa chưa đọc. Không xoá tuỳ tiện `fresh`: `src/store.ts:535–538` còn dùng nó để tính unread của thread. Chỉ animate arrival khi chat đang hiển thị; mở lịch sử hoặc quay lại chat render ngay.

**Nghiệm thu:** chuyển qua lại hai chat nhiều lần không phát lại entrance của tin đã xem; badge unread/thread vẫn đúng.

### M04 · P1 · Smooth-scroll có thể bị cơ chế bám đáy cắt ngang

**Bằng chứng từ source:** `src/components/useStickyScroll.ts:105–110` bật `stick`, gọi smooth scroll rồi `setFresh(0)`. Khi số tin mới khác 0, cập nhật này dẫn đến render; layout effect tại `59–63` gọi `restore()`, và `47–49` gán `scrollTop` thẳng xuống đáy. ResizeObserver tại `69` cũng gọi cùng restore.

**Rủi ro:** bấm “N tin mới” bắt đầu cuộn mượt rồi chuyển thành nhảy ngay; ảnh/bản dịch thay đổi chiều cao có thể can thiệp trong lúc cuộn. Chưa tái hiện đường dẫn này bằng fixture có tin mới ngoài viewport trong lượt audit.

**Đề xuất:** tách trạng thái người dùng đang yêu cầu cuộn mượt khỏi auto-stick. Trong thời gian cuộn chủ động, tránh ghi đè scrollTop; wheel/touch mới phải huỷ được animation. Giữ đường nhảy ngay khi mở chat/notification vốn đã được giải thích trong source.

**Nghiệm thu:** chat dài, có tin mới ngoài viewport, ảnh tải muộn và bản dịch mở giữa chừng; không giật về đáy khi người dùng chủ động cuộn ngược.

### M05 · P2 · Giảm chuyển động chưa được áp dụng cho các lệnh cuộn JS

**Bằng chứng:** CSS có `prefers-reduced-motion` và app có `MotionConfig reducedMotion="user"` (`src/App.tsx:136`). Tuy nhiên `src/components/Conversation.tsx:201` và `src/components/useStickyScroll.ts:109` vẫn truyền thẳng `behavior: "smooth"`; hai đường này không kiểm tra preference.

**Đề xuất:** helper cuộn dùng chung, chọn auto/smooth theo preference ở thời điểm thao tác. CSS tắt transition không thay thế việc xử lý các lệnh cuộn JS tường minh.

**Nghiệm thu:** tìm tin, bấm quote, xuống tin mới và thread đều không cuộn dài khi OS yêu cầu giảm chuyển động. Kiểm tra thêm height animation trong cùng pass, không mặc định rằng mọi motion prop đã được tắt.

### M06 · P2 · Reaction có entrance nhưng thiếu phản hồi nhất quán khi tương tác và biến mất

**Bằng chứng:** browser đo reaction cao 22px, computed transition duration `0s`. CSS `.reaction` tại `src/styles/chatmin.css:207–210` đổi nền/border tức thì. `src/components/Message.tsx:127–137` có initial/animate nhưng không có exit; số đếm thay trực tiếp. Nhóm press feedback dùng chung ở CSS `1317–1329` chưa bao gồm reaction.

**Đề xuất:** chuyển màu 100ms; press nhẹ trên emoji hoặc nội dung bên trong để hit target đứng yên; exit 80–120ms; ổn định độ rộng số đếm khi phù hợp. Mở rộng vùng bấm bằng padding/vùng hit nếu vẫn giữ chip nhìn gọn. Không animate layout toàn bộ reaction khi cuộn hoặc nạp lịch sử.

**Nghiệm thu:** thêm/xoá reaction cuối cùng, count 9 → 10, mine/unmine nhanh và thao tác bàn phím; không tạo click trùng hoặc dịch vị trí toolbar.

### M07 · P2 · Badge unread nảy cả khi chỉ được mount lại

**Bằng chứng:** `src/components/Sidebar.tsx:561` luôn gắn class `pop` và dùng `key={c.unread}`. CSS `src/styles/chatmin.css:714–715` scale từ .6 lên 1.12 rồi về 1. Các badge lịch sử cũng đủ điều kiện chạy khi section được mount lại; đếm tăng và giảm đều đổi key.

**Đề xuất:** chỉ nhấn nhẹ khi unread thật sự tăng trên một hàng đang hiện. Mở section/lọc danh sách hoặc load lần đầu render tĩnh; số đếm giảm chỉ đổi chữ. Giới hạn chuyển động đồng thời khi nhiều chat nhận tin.

### M08 · P2 · Bản dịch mở có animation, ẩn thì bị tháo ngay

**Bằng chứng:** `src/components/Message.tsx:93–108` render có điều kiện một motion.div với height entrance, không có AnimatePresence/exit bao ngoài vùng dịch.

**Đề xuất:** mở 140–180ms, đóng 100–120ms, có clipping phù hợp; phối hợp với scroll anchor để tin đang đọc đứng yên. Khi loading thành kết quả, tránh nhảy chiều cao đột ngột với đoạn dài.

**Nghiệm thu:** dịch đoạn dài, ẩn bản dịch ở giữa lịch sử và ở đáy; không làm viewport bật lên/xuống ngoài chủ ý.

### M09 · P2 · Lần mở chat chưa có cache hiện loading ngay, dễ tạo chớp trạng thái ngắn

**Bằng chứng:** browser quan sát “Đang tải tin nhắn…” khi mở chat chưa tải; `src/components/Conversation.tsx:215–220` hiện veil ngay khi list chưa có. Demo cố ý trễ 250ms (`src/lib/demo.ts:142–143`), đây không phải số đo mạng production.

**Đề xuất:** ưu tiên cache nếu có; delay chỉ báo khoảng 120–160ms để request rất nhanh không chớp spinner. Request chậm hơn có thể dùng skeleton gọn bám hình dạng message. Không thêm delay nhân tạo vào nội dung hoặc crossfade toàn bộ lịch sử mỗi lần đổi chat.

**Nghiệm thu:** dữ liệu về trong 50ms/250ms/2s và lỗi tải; composer/header không nhảy, retry luôn có đường thoát.

### M10 · P2 · Toast lỗi dài có cùng thời gian sống ngắn như thông báo thành công

**Bằng chứng:** `src/store.ts:295–298` xoá tất cả toast sau 2.800ms, giữ tối đa ba toast. `src/components/Overlays.tsx:515–535` không có nút đóng hay pause khi hover/focus.

**Đề xuất:** success ngắn giữ khoảng 2,8s; lỗi dài có thời gian đọc dài hơn hoặc trạng thái inline tồn tại tới khi xử lý. Có dismiss, pause khi tương tác; tránh để một loạt success đẩy mất lỗi cần hành động. Giữ animation hiện tại vốn đã có enter/exit/layout.

### M11 · P2 · Tab chính chưa có cách điều hướng bàn phím như Inspector

**Bằng chứng:** `src/components/Tabs.tsx:43–48` đặt mọi tab `tabIndex=0`, chỉ xử lý Enter/Space. Browser có 10 tab chat cùng tabIndex 0; click tab rồi nhấn Right giữ nguyên focus và selection. Nút đóng tạo thêm các điểm dừng. Inspector đã dùng mô hình 0/-1.

**Đề xuất:** roving tabindex cho tab chính, ArrowLeft/Right và Home/End; giữ phím tắt chuyển tab hiện có. Khi đóng tab đang focus, chuyển focus có chủ ý tới tab kế cận. Không để mở chat tự kéo focus khỏi thanh tab trong lúc đang điều hướng bằng phím.

### M12 · P2 · Hover preview dễ che nội dung khi con trỏ nghỉ trên danh sách

**Bằng chứng quan sát:** trong chuỗi demo, popup preview “Minh Trần” xuất hiện che vùng message của chat đang mở khi con trỏ ở sidebar. Source `src/components/Sidebar.tsx:458–464` mở sau 500ms mà không kiểm tra ý định mới ở callback; handler của hàng tại `541–542` chỉ dựa mouseenter/leave. Thứ tự mới nhất có thể đổi khi nhận tin. Chưa chứng minh riêng việc reorder là nguyên nhân của popup quan sát được.

**Đề xuất:** huỷ preview/timer khi scroll, đổi chat, đổi thứ tự, mở overlay hoặc blur; callback kiểm tra hàng vẫn ở vị trí ổn định và vẫn hover. Chỉ hiện khi con trỏ có ý định nghỉ trên một hàng; tránh popup xuất hiện chỉ vì một hàng khác dịch vào dưới con trỏ. Giữ delay khoảng 500–650ms, không thêm animation cho cả danh sách để giải quyết việc này.

## Những điểm hiện tại nên giữ

- Easing chung `[0.2, 0, 0, 1]` và transition mặc định 180ms; không cần thêm thư viện motion.
- Icon press feedback hiện có giữ nguyên kích thước nút; browser xác nhận toolbar message 32 × 32px.
- Tooltip có cleanup trên keyboard, scroll, resize, blur; không cần thiết kế lại.
- Reply suggestions có skeleton, retry/close và guard cho kết quả về muộn; không mở lại các vấn đề đã xử lý nếu không có regression mới.
- Inspector tab một hàng, roving focus và reduced-motion riêng; dùng làm chuẩn cho tab chính.
- Scroll anchor đã xử lý ảnh/bản dịch nở và lịch sử chèn phía trên; cần điều phối với animation, không thay toàn bộ bằng smooth scroll.
- Không bật lại layout animation toàn sidebar: source đã chủ ý giới hạn nó khi drag để tránh chữ bị scale và sibling nhảy.

## Thứ tự thực hiện đề nghị

1. M01: typing dùng chung — thay đổi nhỏ, đúng chi tiết người dùng chỉ ra.
2. M02–M04: ổn định identity của bubble, entrance một lần và quyền điều khiển scroll.
3. M05–M08: giảm chuyển động, reaction, badge, bản dịch.
4. M09–M12: loading, toast, tab bàn phím và hover intent.

Timing khởi điểm: feedback màu 80–100ms; press 80–120ms; indicator/state fade 100–140ms; panel/message entrance 140–200ms; exit 80–140ms. Chỉ typing/loading/recording được loop khi trạng thái đó còn tồn tại. Các con số này là đề xuất để tinh chỉnh sau khi quan sát native, chưa phải kết quả benchmark.

Sau sửa cần kiểm tra trên WKWebView ở kích thước cửa sổ thực tế, normal/reduced motion, chat dài và nhiều arrival. Profile trước khi kết luận mượt: không dùng screenshot tĩnh làm bằng chứng fps. Các lỗi về reconcile/scroll cần fixture tái hiện trước và sau; những thay đổi CSS nhỏ chỉ cần kiểm tra tương tác/visual phù hợp.

## Thay đổi của lượt audit

Chỉ thêm báo cáo này. Không sửa source ứng dụng, không commit/push. File untracked có sẵn `docs/audits/message-search-mobile.png` được giữ nguyên. Không chạy build/test lại vì chưa thay code; các quan sát browser và source ở trên là bằng chứng của audit, không phải xác nhận đã sửa các phát hiện.
