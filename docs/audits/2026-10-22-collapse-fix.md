# Expand/collapse follow-up — 22/10/2026

## Lỗi thực tế

Lần audit đầu chưa kiểm tra đầy đủ sidebar thu gọn trên desktop. Khi collapse, cột còn 48px nhưng filter vẫn hiện và account/chat rows vẫn rộng khoảng 160px, bị workspace che mất. Đây là lỗi bố cục thật, không thể coi là một trạng thái collapse dùng được.

## Sửa

- Sidebar desktop thu gọn thành rail 48px với nút inbox, icon nhận diện account và avatar chat 40px. Ẩn filter, tiêu đề section, text chat, drag handle và thread preview trong rail.
- Chat đang chọn có nền/viền; chat chưa đọc có chấm; hover/focus có tên chat qua tooltip và accessible name. Nút inbox/account vẫn có accessible name khi phần chữ được ẩn.
- Mở lại sidebar khôi phục bố cục đầy đủ, giữ nguyên trạng thái đóng/mở của các account và section.
- Ở <=760px vẫn dùng danh sách phủ toàn vùng; đóng sidebar trả lại chat, không ép rail vào cửa sổ quá hẹp.
- Ẩn đúng resize handle của inspector khi inspector là overlay ở <=1180px. Trước đó một media rule có specificity cao hơn vẫn bật handle này.

## Kiểm tra bằng trình duyệt demo

- 12/12 tổ hợp: sidebar mở/đóng × inspector mở/đóng tại 1280px, 900px, 390px. Kết quả chi tiết: `panel-regression-results.json`.
- Kiểm tra `aria-pressed`, body class, kích thước/visibility thật của panel và hàng trong rail; đợi geometry ổn định sau transition.
- Rail sau sửa: sidebar 48px, account/chat rows 40px, filter ẩn, không có hàng tràn ra ngoài rail. Trước sửa: hàng khoảng 160px và filter còn hiện.
- 1280px: cả hai panel đóng thì workspace 1232px; sidebar mở/inspector đóng thì workspace 958px; cả hai mở thì workspace 548px.
- 900px: mở inspector 360px dạng overlay không làm workspace nhỏ thêm; resize handle bị ẩn.
- Đóng/mở account thật sự ẩn/hiện chat. Thu gọn rồi mở toàn sidebar vẫn giữ account đã đóng.
- Đóng/mở section ghim thật sự bỏ/khôi phục chat ghim sau animation; đóng/mở quick thread preview hoạt động.
- Chọn avatar Linh Nguyễn khi rail đang thu gọn mở đúng chat và không tự bung sidebar.
- `⌘B` và `⌘I` điều khiển đúng panel.
- Inbox/Settings giữ rail 48px; inspector không xuất hiện; nút inspector bị disable trên trang Settings.

## Bằng chứng

- `sidebar-collapsed-fixed.png`
- `sidebar-expanded-fixed.png`
- Bản sao trước sửa lần này: `panel-collapse-before/`.

Đây là kiểm tra UI trên backend demo trong trình duyệt. Không bao gồm đăng nhập hoặc gửi tin bằng account thật qua Tauri.
