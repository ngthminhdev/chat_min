# ChatMin Android UI/UX audit — 24/10/2026

> Sau audit, người dùng đã yêu cầu sửa và cung cấp Android OAuth Client. Xem [kết quả triển khai và kiểm tra](RESULTS.md). Nội dung bên dưới là checkpoint trước sửa.

## Phạm vi và kết luận

Kiểm tra **bản Android đã cài trên điện thoại**, không dùng viewport browser desktop để thay cho Android. Bản hiện tại vẫn giữ quá nhiều cấu trúc desktop: titlebar, tab strip, toolbar của chat, composer nhiều công cụ và Settings dành cho cửa sổ desktop. Các override `.mobile` chưa tạo thành một luồng sử dụng trên điện thoại hoàn chỉnh.

Thiết bị A301SH, Android 15 / API 35, 1260 × 2730px, density 480; WebView báo devicePixelRatio=3 và viewport thường 420 × 858 CSS px. App `com.chatmin.app`, versionName 0.1.0, versionCode 1000, targetSdk 35, lastUpdateTime 24/10/2026 01:39:10 theo thiết bị. Source checkout `c16dc77`. APK local có metadata tương ứng nhưng chưa đối chiếu hash với APK cài trên máy.

Bằng chứng: ADB screenshot, đo DOM/computed layout của WebView thật qua CDP, đối chiếu source hiện tại. Không build/cài APK mới, không sửa source ứng dụng. Có thao tác điều hướng kiểm tra; không gửi tin, đăng nhập hay sửa thiết lập tài khoản. Điện thoại có thay đổi trạng thái trong lúc audit, nên số đo là các snapshot, không phải toàn bộ một kịch bản kiểm thử độc lập.

## Các vấn đề ưu tiên

### A01 · P1 · Tên chat bị toolbar ép mất hoàn toàn

**Đo trực tiếp:** tại một snapshot viewport 420 × 858, `.conv-head .title` có width **0px**. `.conv-actions` width 224px; `.conv-head` height 96px ở snapshot có health state. Một snapshot khác có 5 nút action hiển thị, mỗi nút rộng 40px. Tên chat có thể bị co khác nhau theo trạng thái/provider.

**Nguồn:** `src/styles/chatmin.css:1542–1545` ép header không wrap, title cho phép co về 0, actions không co. Chỉ action không có `.icon-only` bị ẩn, phần lớn action vẫn hiện. `.with-health .conv-head` tại dòng 670 còn có min-height 96px.

**Hướng sửa:** một app bar của màn chat gồm Back, avatar/tên đủ diện tích, tối đa một action chính và menu thêm. Đưa tìm kiếm, AI, dịch, ghim vào menu. Health banner là hàng riêng dưới app bar, không tranh chiều rộng với tên.

**Nghiệm thu:** tên luôn đọc được tại 360/390/420dp, tên dài ellipsis; không co về 0; offline/reconnecting không phá hàng chính.

### A02 · P1 · Ba tầng điều khiển desktop vẫn hiện trên Android

**Đo trực tiếp:** `.titlebar` 48px + `.tabs` 42px + `.conv-head` 96px trong trạng thái đo được; vùng messages bắt đầu ở y=187px, chiếm gần 22% chiều cao WebView trước nội dung. Header 96px là trạng thái có health, không khẳng định mọi chat đều cao như vậy.

**Nguồn:** `src/App.tsx:139–150` luôn render Titlebar và Tabs; CSS mobile chỉ ẩn `.conv-tabs` (subtab bên trong chat), không ẩn `.tabs` (tab strip desktop). Nút `+ Chat`, nút đóng tab và toolbar toàn cục vẫn tồn tại.

**Hướng sửa:** mobile shell theo màn: danh sách hội thoại → hội thoại → chi tiết/thread. Mỗi màn có app bar riêng. Theme và thêm tài khoản đặt trong Cài đặt/quản lý tài khoản. Tránh giữ nguyên tab strip desktop trên điện thoại.

### A03 · P1 · Vùng chạm nhỏ, override mobile bị CSS desktop thắng

**Đo trực tiếp trên máy:** search trên titlebar cao 28px; bell/settings/add-account 40 × 30px; nút đóng tab 24 × 24px; composer attach/emoji/AI/translate/sticker/voice 28 × 28px; nút gửi 40 × 30px. Đây là kích thước button DOM, không chỉ kích thước nét icon.

**Nguồn:** rule `.titlebar .tool-btn.icon-only` / `.conv-head .tool-btn.icon-only` tại `chatmin.css:1285–1287` có specificity cao hơn `.mobile .tool-btn` tại 1551. Composer có rule `min-height:28px` tại 1530. Do đó thêm `.mobile .tool-btn { min-height:40px }` chưa đảm bảo hit area thực tế.

**Hướng sửa:** vùng chạm tối thiểu 48 × 48 CSS px cho action chính, icon bên trong có thể nhỏ hơn. Gom công cụ vào sheet/menu để không phải thu nhỏ tất cả nút.

### A04 · P1 · Composer mang mật độ công cụ desktop

**Quan sát DOM:** đồng thời có attach, emoji, gợi ý AI, dịch nháp, ngôn ngữ, sticker, ghi âm và gửi, cộng nhãn tài khoản. Những nút 28px giúp nhét nhiều công cụ nhưng khó chạm và khó nhận biết. Chưa kiểm tra đủ composer khi bàn phím mở với chat thật.

**Hướng sửa:** giữ đính kèm, ô nhập, gửi/ghi âm trên hàng chính; chuyển AI, dịch và công cụ phụ vào sheet. Nhãn tài khoản chỉ cần nổi bật khi có lựa chọn người gửi. Khi bàn phím mở, người dùng vẫn nhìn thấy ô nhập và nút gửi, cuộn lịch sử độc lập.

### A05 · P1 · Luồng quay lại chưa được nối với navigation Android

**Quan sát hạn chế:** một lần gửi KEYCODE_BACK khi app ở workspace đã đưa foreground về launcher. Đây chưa phải bằng chứng Back sai từ Settings hay từ chat vì snapshot trước đó là workspace trống và thiết bị có đổi trạng thái trong lượt audit.

**Bằng chứng source:** route lưu trong Zustand; `App.tsx:239–255` xử lý Escape, chưa có xử lý Back/history tương ứng trong source app. `MainActivity.kt` chỉ gọi `super.onCreate`. Settings không có nút Back riêng trong header (`Settings.tsx:53–59`). Runtime Tauri local có API `onBackButtonPress` trong `node_modules/@tauri-apps/api/app.d.ts:243–285`; native AppPlugin mặc định dùng WebView history hoặc chuyển cho Activity khi không có listener. Route Zustand hiện chưa được nối vào cơ chế này. Cần test độc lập từng bước trước khi khẳng định hành vi runtime của mọi màn.

**Hướng sửa:** thứ tự Back rõ ràng: đóng bàn phím/overlay → rời chi tiết/thread → rời chat về danh sách → ở danh sách gốc mới để Android đưa app xuống nền. Giữ nháp và trạng thái cuộn.

### A06 · P1 · Onboarding Google Chat chưa phù hợp với điện thoại

**Quan sát trực tiếp:** màn xác thực yêu cầu OAuth client JSON loại **Desktop app**, tải từ Cloud Console, dán JSON/chọn file. Nội dung hướng dẫn dài, dạng form quản trị; người dùng chưa có hành động đăng nhập trực tiếp. Screenshot `01-current-screen.png` ghi lại màn này.

**Hướng sửa:** nếu Android là sản phẩm cho người dùng cuối, cần thiết kế và kiểm chứng luồng xác thực dành cho Android, callback/lifecycle và cấu hình provider. Không xem đổi chữ trên form là sửa xong OAuth. Nếu là công cụ cá nhân cần BYO credentials, giải thích rõ điều kiện trước khi vào bước xác thực và giảm thao tác cấu hình trên điện thoại.

### A07 · P2 · Cài đặt đưa ra lựa chọn Android không áp dụng

**Nguồn:** `Settings.tsx:71–85` luôn render Nền cửa sổ / Kính mờ / Xuyên desktop và mô tả hai dock. `App.tsx:83` lại ép mobile dùng nền đặc rồi return. Người dùng có thể chọn một setting mà Android không thực hiện như mô tả. Các mục phím tắt desktop cũng chưa được lọc theo nền tảng.

**Hướng sửa:** chỉ render setting có tác dụng trên Android; dùng ngôn ngữ màn hình/app thay cho cửa sổ/dock. Theme và cỡ chữ vẫn dùng hệ token hiện tại.

### A08 · P2 · Popup thông báo có nguy cơ tràn trái màn hình

**Suy luận từ source, chưa tái hiện độc lập:** `.bell-panel` width 380px, right:0, neo trong `.bell-menu` (`chatmin.css:1492`, `Titlebar.tsx:109–115`). Nút bell tại snapshot 420px có x=244, width=40. Với containing block này, panel dự kiến bắt đầu khoảng x=-96px. Không có rule mobile giới hạn panel này trong viewport.

**Hướng sửa:** sheet hoặc màn thông báo trong mobile shell; nếu vẫn dùng popup thì neo vào viewport và giới hạn cả chiều rộng lẫn chiều cao khi có bàn phím.

### A09 · P2 · Hướng dẫn còn nhắc đến thao tác desktop đã bị ẩn

**Quan sát screenshot `02-empty-workspace.png`:** màn trống hướng dẫn “Chọn một chat ở sidebar, hoặc nhấn … để nhảy tới chat bất kỳ”, nhưng `<kbd>` đã bị ẩn bởi `.mobile kbd`. Kết quả là câu thiếu đối tượng sau chữ “nhấn”; danh sách hội thoại cũng không hiện trong snapshot này.

**Nguồn:** `Conversation.tsx:57–59`, `chatmin.css:1537`.

**Hướng sửa:** Android mở vào danh sách hội thoại. Empty state dùng hành động cụ thể như “Thêm tài khoản” hoặc “Tìm hội thoại”, không hướng dẫn sidebar/phím tắt.

## Các điểm cần kiểm tra tiếp, chưa kết luận lỗi

- Nhấn giữ message: toolbar hover bị ẩn hoàn toàn trên mobile; app dựa vào `onContextMenu` (`Message.tsx:78–89`). Cần kiểm tra text selection, link, ảnh và menu thực tế trên Android; không khẳng định nhấn giữ bị hỏng chỉ từ source.
- Cuộn danh sách: `.reorder-row` có `touch-action:none` (`chatmin.css:822`) và danh sách dùng drag reorder. Cần kiểm tra scroll bằng ngón tay và xung đột kéo/scroll, rồi mới kết luận tác động.
- Keyboard: đã quan sát WebView resize xuống khoảng 420 × 574 khi bàn phím hiện trong wizard. Chưa đủ bằng chứng cho composer, reply/edit, emoji sheet và xoay ngang; không mặc định `100dvh` đã giải quyết mọi trường hợp.
- Insets: screenshot dọc hiện tại có status/navigation bar tách khỏi nội dung, chưa thấy bị đè lên clock. Chưa thử gesture/3-button navigation, cutout khác, xoay ngang hoặc targetSdk cao hơn.
- Chưa kiểm tra toàn bộ theme, text scaling hệ thống, screen reader, hiệu năng cuộn hoặc xác thực Google Chat hoàn chỉnh.

## Thứ tự sửa đề nghị

1. Mobile shell và navigation/Back; bỏ tab strip desktop khỏi trải nghiệm điện thoại.
2. Chat app bar, tên chat và health banner; bảo đảm vùng chạm thực tế.
3. Composer và keyboard; action sheet cho các công cụ phụ.
4. Danh sách, thông báo, thread/chi tiết, message long-press.
5. Settings/onboarding theo nền tảng; kiểm chứng xác thực Android riêng.

Giữ theme, semantic tokens, model tin nhắn và backend hiện có. Không cần thay framework để giải quyết các vấn đề bố cục này. Sau sửa cần QA trên APK thật ở 360/390/420dp, có/không bàn phím, Back hệ thống, offline/reconnecting và thread.

## Artifact và thay đổi

- Chỉ thêm báo cáo và hai screenshot không chứa nội dung chat.
- `01-current-screen.png`: Google Chat setup trên bản cài thực tế.
- `02-empty-workspace.png`: workspace trống vẫn mang tab strip và hướng dẫn desktop.
- Không sửa source app, không build/cài bản mới, không commit/push. File `docs/audits/message-search-mobile.png` có sẵn được giữ nguyên.
