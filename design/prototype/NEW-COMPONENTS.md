# ChatMin: component mới (ứng viên cho design system)

## Hero refinement

- Hội thoại: tên người gửi nằm ngoài bubble, avatar đầu nhóm tin, giờ và trạng thái ở dòng riêng. Bubble dùng nền nhẹ, không viền; giữ nguyên nội dung, reaction và reply.
- Composer: khi rỗng chỉ còn 1 dòng nhập và 1 hàng công cụ (~91px cả khung). Label "Gửi từ …" và chip nền tảng nằm đầu hàng công cụ; khi workspace hẹp (≤1280px) chip và chữ "Gửi từ" ẩn trước, luôn giữ dot và tên account. Nháp vẫn theo tab. Các capability không hỗ trợ giữ trạng thái vô hiệu hóa kèm giải thích.
- Inspector: thông tin cơ bản, tin ghim và file gần đây hiển thị trước; bảng capability nằm trong disclosure. File mở tab Files để đọc đầy đủ tên.
- Theme: menu Giao diện trong titlebar, giữ sáu theme hiện có; mở được từ command palette, đóng bằng Escape hoặc click bên ngoài.
- Desktop: giữ inspector ở mức tối thiểu 1100px, không chuyển thành layout mobile. Token vendor, font và màu account không thay đổi.
- Component bổ sung: `.appearance-menu`, `.appearance-panel`, `.composer-label`, `.composer-tools`, `.recent-file`, `.capabilities`.

Component ứng dụng nằm trong `chatmin.css` và `round2.css`, dùng token sẵn có: `--pane*`, `--line*`, `--text*`, `--accent*`, `--conn-*`, `--radius-*`, `--fs-*`, `--motion-*`, cùng `color-mix()`.

| Class | Mô tả | Gợi ý đưa vào |
|---|---|---|
| `.acc-head` | Header nhóm account trong sidebar: chevron, `.conn-dot`, glyph nền tảng, tên, badge hoặc trạng thái sync | `components.css` → Navigation |
| `.chat-row` | Dòng hội thoại 2 dòng (avatar · tên · giờ mono / preview · @ · badge). Có rail trái mang `--conn` khi active | Navigation |
| `.badge.unread` | Badge unread fill `--accent-secondary`. Muted dùng `.badge.idle` | Badges |
| `.avatar` (`.group`, `.sm`, `.lg`, `.presence`) | Avatar chữ cái đầu: tròn = người, vuông bo 8px = nhóm/space | Mới: Avatar |
| `.day-sep`, `.unread-sep` | Ngăn theo ngày (pill mono) và vạch "N tin chưa đọc" (`--orange`) | Mới: Message list |
| `.msg` + `.bubble` (`.me`, `.first`/`.last`, `.mentions-me`, `.deleted`) | Bubble tin nhắn, gộp theo người gửi. Tin của mình dùng `--accent-soft` | Mới: Message |
| `.msg-meta` | Giờ mono, "đã sửa", trạng thái gửi: clock = đang gửi, check = đã gửi, check-check (`--blue-2`) = đã xem, alert (`--red`) = lỗi | Message |
| `.fail-row` | Lý do gửi lỗi kèm nút "Thử lại" | Message |
| `.quote` | Trích dẫn tin được trả lời trong bubble. Bấm để nhảy tới tin gốc | Message |
| `.img-msg`, `.file-card`, `.link-card` | Ảnh (giữ tỉ lệ gốc), file (icon, tên cắt, size mono, tải), link preview (không dùng viền màu bên trái) | Message |
| `.reactions` / `.reaction(.mine)` | Chip reaction: emoji + số mono, của mình thì tô `--accent-soft` | Message |
| `.thread-link(.open)` | Tóm tắt thread dưới tin GChat: các avatar, "N trả lời", giờ lần cuối | Message |
| `.msg-actions` | Thanh thao tác kính mờ khi hover hoặc focus: trả lời · reaction · thread · thêm | Overlays |
| `.typing` | "X đang gõ…" với 3 chấm nhấp nháy (tắt khi reduced-motion) | Message |
| `.composer`, `.composer-box`, `.reply-bar`, `.composer-hint` | Ô soạn 1 dòng, tự giãn tối đa 176px. Thanh trả lời/sửa có Esc. Dòng gợi ý chỉ hiện khi có nội dung ("Nháp đã lưu", Esc) | Mới: Composer |
| `.composer-label`, `.composer-from`, `.composer-platform`, `.composer-sep` | Account gửi trong hàng công cụ: dot + tên (cắt cuối cùng) + chip nền tảng mono, ngăn với các nút bằng hairline | Composer |
| Tab co giãn (`.tabs .tab`, `.tab-conn`, `.tab-add` sticky) | Tab co trước khi cuộn: `.tab-conn` nhường chỗ trước, rồi tới title, sàn 132px của design system. "+" ghim mép phải, `scroll-padding` để tab active không nằm dưới "+" | `layout.css` → Tabs |
| `.page-tab` | Tab trang (All inboxes, Settings) trong workspace: icon + tiêu đề, đóng bằng × hoặc ⌘W | Tabs |
| `.tip` | Tooltip kính mờ, kèm pill `.kbd` (data-tip / data-kbd) | Overlays |
| `.emoji-pop` | Popover emoji 8 cột trên nền kính | Overlays |
| `.cap-row` | Một dòng trong ma trận khả năng nền tảng (check/x + ghi chú mono) | Inspector |
| `.member-row`, `.file-row`, `.pin-row`, `.media-grid` | Các list trong tab inspector | Inspector |
| `.thread-head`, `.thread-view`, `.cmsg` | Chế độ thread trong inspector: tin gốc, các trả lời, ô soạn mini | Inspector |
| `.acc-chip` | Chip account (dot + glyph + tên) ở header hội thoại | Badges |
| `.cmd.msg-hit`, `.palette-mode`, `.palette-foot` | Dòng kết quả tìm tin nhắn trong palette, dòng chuyển chế độ ⌘K / ⌘⇧F, footer phím tắt | Overlays |

## Chỗ phụ thuộc khả năng nền tảng

Toàn bộ nằm ở bảng `PLATFORMS[*].caps` trong `app.js`. Thêm nền tảng mới chỉ cần thêm một dòng ở đó, không làm layout riêng.

| Capability | Telegram | Google Chat | Khi nền tảng không hỗ trợ |
|---|---|---|---|
| `threads` | không | có | Không hiện `.thread-link` và nút thread trong `.msg-actions` |
| `stickers` | có | không | Nút sticker ở composer làm mờ (`.is-off`) + tooltip giải thích |
| `voice` | có | không | Nút mic ở composer làm mờ + tooltip |
| `readReceipts` | có | không | Chỉ hiện check "đã gửi", tooltip giải thích không có "đã xem" |
| `reactions`, `edit`, `delete`, `pin`, `reply`, `typing` | có | có | Ẩn mục tương ứng trong menu hoặc thanh thao tác |

Inspector → Info → "Khả năng" liệt kê đúng bảng trên cho từng chat.

## Lệch so với token gốc

- Vòng 2 đã bỏ override 258/328. Pane lấy trực tiếp `--left-w: 322px` / `--right-w: 410px` từ `vendor/tokens.css`; kéo resize vẫn thay đổi độ rộng trong phiên.
- Bubble dùng `1rem`, mặc định 13px, thay đổi theo `--ui-font-size` qua Settings → Appearance → Interface font size.
- Đèn traffic-light chỉ để mô phỏng OS, dùng `--conn-red/amber/green`. Bản Tauri thật do macOS vẽ nên bỏ đi.

## Vendor và tích hợp code thật

`vendor/` là bản copy của design system để prototype mở độc lập. **Không sửa bản copy này.** Khi tích hợp vào code thật, symlink từ `design-systems` và dùng token/component tại nguồn. Vòng 2 không sửa file nào trong `vendor/`.

## Vòng 2

Entry vẫn là `index.html`. Welcome và wizard chiếm toàn cửa sổ. All inboxes và Settings mở như một tab trong workspace, giữ sidebar và statusbar; inspector tắt qua `body.inspector-unavailable` có sẵn của design system. `round2.js` chứa các màn và trạng thái mới, `round2.css` chứa style ứng dụng; `app.js` chỉ bổ sung hook route/state, điều hướng các nút có sẵn và cho account mới tham gia sidebar/phím tắt. Hero không được viết lại.

| Component | Chức năng | Primitive kế thừa |
|---|---|---|
| `.welcome-view` | Empty state chưa có account, CTA Add account và ⌘N | Icon sprite, ToolButton |
| `.wizard-steps`, `.wizard-wrap` | Bốn bước nền tảng, xác thực, sync, tên/màu. Thanh bước canh đúng mép trái/phải của 2 cột card | `.create-layout`, `.create-card`, `.card-step`, `.engine-card` từ New Connection của db_min |
| `.wizard-actions`, `.wizard-sim-note` | Một hàng hành động mỗi bước: Quay lại bên trái, nút chính bên phải. Cột phải chỉ có card tóm tắt account và ghi chú mô phỏng | ToolButton, `.create-card` |
| `.wizard-error`, `.field-error` | Lỗi phone/OTP/2FA/OAuth, lỗi ngay tại field | `.field`, `.field-label`, `.field-hint` |
| `.oauth-wait`, `.simulation-actions` | Chờ browser mô phỏng, mở lại/huỷ, phản hồi cho phép/từ chối | ToolButton, trạng thái có nhãn |
| `.qr-placeholder` | Hướng dẫn luồng QR có nhãn mô phỏng, không tạo QR đăng nhập thật | Icon phone từ sprite |
| Checklist sync | idle/run/ok/err, log mono, thử lại sau lỗi tải danh sách | `.check-list`, `.check-badge`, `.check-output` |
| `.account-colors`, `.color-choice` | Chọn một trong tám màu connection, có check và aria-pressed. Dùng ở bước Tên & màu của wizard và trong popover màu ở Settings | `--conn-*`, `.conn-dot` |
| `.account-row`, `.account-dot`, `.account-status`, `.account-pop` | Settings → Accounts: mỗi account một dòng (dot · tên · nền tảng · định danh mono · trạng thái · menu …). Bấm dot mở popover màu; menu … gồm Đổi tên, Đăng nhập lại, Xoá account (có xác nhận) | `.index-context-menu`, `.context-item`, `placePop()` |
| `.inbox-shell`, `.inbox-row` | Gộp theo thời gian, lọc account/unread/mention/tìm kiếm; mở tab gốc. Mở như tab trang trong shell | Avatar, dot, badge |
| Settings (Appearance/Accounts/Notifications/Shortcuts) | Mở như tab trang trong shell; preview thông báo theo tuỳ chọn | `.settings-shell` 720px, `.settings-card`, `.settings-row`, `.switch` |
| `.health-banner`, `.account-health` | Offline/reconnecting/expired/rate-limit trong shell | Token trạng thái, ToolButton |
| Loading | Veil danh sách và tin nhắn | `.section-veil` nguyên bản vendor |
| `.debug-panel` | Review states sau ⌘⇧D, không xuất hiện mặc định | `--glass`, token overlay |

Appearance giữ thứ tự: Theme → Interface font size → Interface font family → Editor font family → Compact density → Vim mode. Vim mode hiện disabled với giải thích vì ChatMin không có code editor; không giả lập tính năng Vim cho composer. Font size tăng/giảm 0.5px, bấm giá trị để reset 13px. Giao diện lưu localStorage; account và tin nhắn mẫu tồn tại trong phiên.

Thông báo chỉ áp dụng vào bản xem trước của prototype, chưa tích hợp notification hệ điều hành. Im lặng theo giờ xét giờ máy, hỗ trợ khung giờ qua nửa đêm. QR/OAuth, OTP/2FA và sync đều mô phỏng, không gọi Telegram/Google, không gửi SMS và không lưu mật khẩu. OTP demo `123456`, 2FA demo `chatmin`; countdown OTP 30s, rate-limit 15s.

Debug giữ dữ liệu khi chuyển Welcome/wizard/shell. Welcome từ debug chỉ giả lập trạng thái trống; xoá account cuối trong Settings mới là trạng thái thật không có account. Có thể kích hoạt lỗi sync, bật/tắt 2FA, loading, empty, offline, reconnecting, hết phiên và rate-limit. Nút Đặt lại trạng thái không xoá account/tin/nháp.

## Kiểm tra

Kiểm tra bằng Playwright 1.63 với Chromium headless, thao tác như người dùng thật (click, gõ phím, phím tắt). Script và ảnh chụp để ngoài project, xem xong thì xoá. Chưa chạy Safari/WKWebView (WebView của Tauri), chưa chạy Tokyo Night / Rosé Pine / Catppuccin / Soft Light. Contrast mới đánh giá bằng mắt, chưa đo.

**Vòng 3** (dark + light, 1440×900 và 1100×700, 40/40 kiểm tra đạt, 0 lỗi console/pageerror):

- Composer rỗng: cả khung 91px, ô nhập 25px; 3 dòng giãn lên 67px. Hàng công cụ không tràn ở cả hai kích thước.
- Tab bar: 4 tab ở 1440 vừa khít, không cuộn. 5 tab thì cuộn ngang, mỗi tab giữ sàn 132px. Nút "+" luôn nằm trong strip và bấm được.
- All inboxes / Settings: nằm trong workspace, sidebar 322px, có statusbar, inspector ẩn, không tràn ngang. ⌘W hoặc bấm tab chat đều quay về hội thoại.
- Wizard: mép thanh bước trùng mép 2 cột card (1440: 194/1246; 1100: 24/1076). Đo 5 bước: nút chính luôn sát mép phải; 4 bước có Quay lại thì nút này ở bên trái, cùng hàng. Không còn đoạn văn marketing.
- Settings → Accounts: mỗi hàng cao 48px. Popover màu đủ 8 màu, đổi màu cập nhật sidebar. Menu … gồm 3 mục, xoá có hộp xác nhận.
- Statusbar: Inbox/Settings không hiện chat ID. Account mới hiện ID dạng số như Telegram thật, không còn `demo/account-…`.
- Lỗi phát hiện khi xem ảnh và đã sửa:
  - Tab bị cuộn lọt ra cạnh nút "+".
  - Tab active bị nút "+" che.
  - Tên account trong composer bị cắt trước chip nền tảng ở 1100px.

**Vòng 2**: browser check 70 ảnh, 0 lỗi console. Sửa nút đóng tab dính style mặc định của `<button>`, dòng log lỗi sync không đỏ, select trong debug bị cắt chữ. DOM check (LinkeDOM) 25 nhóm đạt.
