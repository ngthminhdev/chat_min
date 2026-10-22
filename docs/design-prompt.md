# Prompt thiết kế ChatMin — All-in-One Messenger

Dùng cho tool design (Open Design / Claude Design). Tool KHÔNG đọc được `~/Project`, nên phải
đính kèm design system + ảnh chụp app anh em.

## Chuẩn bị (đính kèm cùng prompt)

**Design system** — từ `~/Project/design-systems/`:
- Claude Design: tạo design system từ repo `design-systems` (link GitHub) hoặc upload các file dưới.
- Open Design: import/upload các file dưới vào project.

| File | Vì sao |
|---|---|
| `README.md` | Signature + luật bất biến |
| `TOKENS.md`, `tokens.css`, `themes.css` | Màu, spacing, radius thật |
| `COMPONENTS.md`, `base.css`, `layout.css`, `components.css` | Shell + primitive |
| `ICONS.md`, `SHORTCUTS.md` | Icon + phím tắt |
| `index.html` | Showcase sống |
| `fonts/exo2-*.woff2` | Font UI |

**Ảnh chụp** — tín hiệu mạnh nhất với tool visual. Chụp 3–4 màn hình app đang chạy:
- `requests_min` hoặc `elastic_min`: shell 3 cột + tab có conn-dot
- `db_min`: màn New Connection (wizard)
- màn Settings của một app bất kỳ
- `reply_min/design/hero-workflow.html` (mở bằng browser): app chat-adjacent gần nhất

**Cách chạy:** làm theo vòng. Vòng 1 chỉ màn hero (#3) → duyệt → vòng 2 các màn còn lại.

---

## PROMPT

Thiết kế **ChatMin** — desktop app macOS (Tauri) dạng All-in-One Messenger: gom nhiều tài khoản
chat vào một cửa sổ. Giai đoạn 1: **Telegram + Google Chat**; sau này thêm Messenger, Zalo…

ChatMin thuộc một họ app desktop của tôi (design system + ảnh chụp đính kèm). Nó phải trông như
anh em ruột với các app đó — một **công cụ làm việc gọn, keyboard-first** — không phải Telegram
clone, không phải chatbot AI, không phải web app.

### Khung & nền tảng

- **Cửa sổ desktop cố định**, thiết kế ở 1440×900, tối thiểu 1100×700. KHÔNG làm responsive
  mobile/tablet, KHÔNG landing page.
- Dark mặc định (nền slate-navy `#1c2433`), có light mode (accent tím `#7A3EED`).
- Bám đúng design system đính kèm: token màu, radius, font (Exo 2 cho UI, Google Sans Code cho
  ID/giờ/status/phím tắt), icon lucide nét mảnh. Không thêm màu, font, radius mới.

### Signature của họ app (phải giữ)

- Titlebar 42px: chừa traffic-light bên trái, ô tìm kiếm ⌘K ở giữa, tool bên phải.
- Ba cột ngăn bằng hairline 1px: sidebar │ workspace │ inspector, độ rộng theo `--left-w` /
  `--right-w` trong `tokens.css` (322px / 410px), kéo resize được.
- Tab bo góc trên kiểu browser; tab active có vệt màu nhẹ phía trên + gạch dưới 2px.
- Statusbar 28px font mono ở đáy.
- Overlay (palette, menu, toast) dạng kính mờ.
- Một accent duy nhất; xanh lá/cam/đỏ/tím chỉ dùng cho trạng thái.
- Không Material, không bóng đổ nặng, không gradient trang trí, không dashboard card.

### Ánh xạ messenger vào khung có sẵn

| Messenger | Đặt ở đâu |
|---|---|
| Tài khoản (1 Telegram, 1 GChat, …) | Như một "connection": mỗi account có **màu nhận diện riêng** (chấm tròn 7px) + tên |
| Danh sách hội thoại | Sidebar, nhóm theo account, có mục gộp "All inboxes" |
| Hội thoại đang mở | Tab: 1 tab = 1 hội thoại; chấm màu = account sở hữu; gạch dưới tab active mang màu account |
| Tin chưa đọc / nháp chưa gửi | Chấm cam trên tab + badge số trong sidebar |
| Thông tin chat (thành viên, file, ảnh, pinned) | Inspector bên phải, chia tab nhỏ |
| Trạng thái sync từng account, tổng unread | Statusbar |
| Nhảy tới chat / lệnh | Command palette ⌘K |
| Thêm tài khoản | Wizard nhiều bước giống màn New Connection của `db_min` |

Logo nền tảng chỉ là glyph nhỏ (≤14px) cạnh tên account. KHÔNG dùng màu thương hiệu
Telegram/Google làm accent hay chrome. Nhận diện account = màu + tên, không bao giờ chỉ màu.

### Màn cần thiết kế

1. **Welcome**: chưa có account, empty state + CTA "Add account".
2. **Add account wizard**
   - B1 chọn nền tảng: Telegram, Google Chat; Messenger/Zalo hiện "coming soon".
   - B2 xác thực: Telegram = số điện thoại → OTP → (mật khẩu 2FA) hoặc QR; Google Chat = OAuth
     qua trình duyệt, màn chờ "đang đợi bạn đăng nhập trong browser".
   - B3 checklist: xác thực → tải danh sách chat → sync tin gần đây (mỗi dòng có trạng thái).
3. **Main shell — màn hero**: 2 account (1 Telegram, 1 GChat), sidebar đầy hội thoại,
   3 tab đang mở thuộc 2 account khác nhau, inspector đang mở.
4. **Conversation view**: tin văn bản, ảnh, file, link preview, reply/quote, reaction, tin đã
   sửa/đã xoá, ngăn theo ngày, vạch "tin chưa đọc", đang gõ…, trạng thái gửi (đang gửi / đã gửi /
   đã xem / lỗi + thử lại). Google Chat có **thread trong space**: thể hiện thread mà không
   phá layout chung (gợi ý: mở thread ở inspector).
5. **Composer**: ô nhập tự giãn, đính kèm, emoji, thanh "đang trả lời…", nháp giữ riêng từng tab.
6. **Unified inbox**: gộp mọi account theo thời gian, lọc theo account / chưa đọc / được mention.
7. **Tìm kiếm**: ⌘K tìm chat & người; ⌘⇧F tìm nội dung tin nhắn xuyên account.
8. **Settings**: theo màn Settings chuẩn của họ app (cột giữa 720px, các card); thêm card
   Accounts (danh sách, đổi màu, đăng nhập lại, xoá) và Notifications.
9. **Trạng thái lỗi/biên**: account offline, đang kết nối lại, phiên hết hạn (cần đăng nhập
   lại), bị rate-limit, danh sách rỗng, đang tải, gửi lỗi.

### Mở rộng nền tảng

Mỗi nền tảng hỗ trợ tính năng khác nhau (reaction, sửa tin, thread, sticker, voice…). Thiết kế
theo **khả năng**: tính năng không hỗ trợ thì ẩn hoặc làm mờ kèm tooltip giải thích — KHÔNG làm
layout riêng cho từng nền tảng. Ghi chú rõ chỗ nào phụ thuộc khả năng nền tảng.

### Phím tắt (hiển thị dạng pill mono trong menu/tooltip)

⌘K palette · ⌘1…9 chuyển account · ⌘[ / ⌘] chuyển tab · ⌘↑ / ⌘↓ chat chưa đọc trước/sau ·
⌘E đổi tên account · ⌘⌫ xoá account (luôn có hộp xác nhận) · Esc huỷ trả lời.

### Dữ liệu mẫu

Tiếng Việt + tiếng Anh lẫn lộn, tên/tin nhắn như thật (nhóm công việc, team dev, bạn bè, space
GChat của công ty). Có tin rất dài, tên rất dài bị cắt, nhóm 200+ thành viên, chat 0 tin.

### Kết quả

Prototype các màn trên, xem được trong dark + light + 1–2 theme khác của design system.
Component nào design system chưa có (bubble tin nhắn đầy đủ, reaction, ngăn ngày, đang gõ,
thread…) thì dựng từ token sẵn có và liệt kê riêng ở cuối để tôi đưa vào design system sau.

---

## PROMPT — VÒNG 2

Vòng 1 (màn hero) đã duyệt. Giữ nguyên mọi thứ đang chạy, không refactor lại vòng 1.

### Sửa từ vòng 1 (đã chụp Chrome 1440×900 + 1100×700, dark + light, console sạch)

- **Độ rộng pane:** brief vòng 1 sai (258/328 lấy từ README cũ). Dùng đúng `--left-w: 322px` /
  `--right-w: 410px` của `tokens.css`, xoá override.
- **Cỡ chữ bubble:** về 13px (1rem) như cả họ app; người dùng chỉnh qua setting
  "Interface font size".
- **Nút đóng tab hiện thành ô vuông** (mọi tab, cả dark lẫn light): `.tab-close` là `<button>`
  nhưng không reset `border`/`background`/`padding`, nên chrome nút native lộ ra. Reset về
  trong suốt để nó là target 17px mờ như layout.css định nghĩa, chỉ nền `--pane-3` khi hover.
- **Tab bar tràn ở 1100px:** tab thứ 3 bị cắt, nút "+ Chat" mất hẳn. Tab co lại (title truncate,
  `.tab-conn` truncate trước) rồi mới cuộn ngang; "+ Chat" luôn thấy được.
- **Composer rỗng quá cao** (~140px): khi rỗng chỉ 1 dòng nhập + hàng công cụ; label
  "Gửi từ …" gộp vào hàng công cụ. Tự giãn khi gõ như cũ.
- **Command palette:** item cuối danh sách bị footer che một nửa — thêm padding đáy cho vùng cuộn.
- `vendor/` là bản copy — ghi rõ trong `NEW-COMPONENTS.md` rằng khi code thật sẽ symlink từ
  design-systems, không sửa bản copy.

### Màn mới

1. **Welcome**: chưa có account → empty state + CTA "Add account" (⌘N).
2. **Add account wizard** — layout giống màn New Connection của `db_min`:
   - B1 chọn nền tảng: Telegram, Google Chat; Messenger, Zalo ở trạng thái "coming soon".
   - B2 xác thực:
     - Telegram: số điện thoại → OTP (đếm ngược gửi lại) → mật khẩu 2FA nếu có; tab phụ đăng nhập QR.
     - Google Chat: nút "Đăng nhập bằng Google" → màn chờ "đang đợi bạn đăng nhập trong browser"
       (có Huỷ / Mở lại link).
   - B3 checklist: xác thực → tải danh sách chat → sync tin gần đây; mỗi dòng có idle/đang chạy/
     ok/lỗi + log mono. Có nhánh lỗi (OTP sai, OAuth bị từ chối).
   - Bước cuối: đặt tên + chọn màu account.
3. **Unified inbox**: mở từ mục "All inboxes". Gộp mọi account theo thời gian, mỗi dòng có chấm
   màu account; lọc theo account / chưa đọc / được mention; chọn dòng thì mở tab hội thoại tương ứng.
4. **Settings**: theo màn Settings chuẩn (cột 720px, card). Appearance giữ thứ tự chuẩn, sau đó:
   - **Accounts**: danh sách, đổi tên/màu, đăng nhập lại, xoá (có xác nhận).
   - **Notifications**: bật/tắt theo account, chỉ mention, im lặng theo giờ, xem trước nội dung.
   - **Shortcuts**: lưới phím tắt.
5. **Trạng thái lỗi/biên**, thể hiện ngay trong shell, không làm màn riêng:
   - account offline / đang kết nối lại: chấm trạng thái ở sidebar + statusbar, banner mỏng trong tab;
   - phiên hết hạn: banner + nút "Đăng nhập lại" mở lại bước B2 của wizard;
   - bị rate-limit: thông báo có đếm ngược, composer tạm khoá;
   - đang tải danh sách / tin nhắn: dùng section veil chuẩn của design system;
   - danh sách rỗng, kết quả tìm kiếm rỗng.

### Để review

- Thêm menu debug nhỏ (ẩn sau ⌘⇧D) để bật từng state ở mục 5 và chuyển nhanh giữa Welcome /
  wizard / shell — để tôi duyệt không cần dựng lại dữ liệu.
- Bỏ mọi toast "vòng 2".
- **Mở prototype trên trình duyệt, bấm thử từng luồng, kiểm tra console không lỗi**, chụp ảnh
  từng màn ở dark + light trước khi báo xong. Báo rõ chỗ nào chưa kiểm được.
- Cập nhật `NEW-COMPONENTS.md` với component mới của vòng này.

---

## PROMPT — VÒNG 3 (polish)

Vòng 2 đủ màn. Vòng này chỉ sửa, không thêm màn, không refactor.

### Sửa

1. **Composer rỗng vẫn cao ~140px** (yêu cầu vòng 2 chưa làm): khi rỗng = 1 dòng nhập + hàng
   công cụ; label "Gửi từ …" và chip nền tảng gộp vào hàng công cụ.
2. **Tab bar vẫn tràn ngay ở 1440px**: tab thứ 4 và nút "+" bị cắt ở mép phải. Tab co lại
   (`.tab-conn` truncate trước, rồi title) với min-width, sau đó mới cuộn ngang; "+" luôn thấy được.
3. **Unified inbox và Settings nằm trong shell**: giữ sidebar + statusbar, nội dung mở trong
   workspace như một tab (giống Settings ở các app anh em), không chiếm toàn cửa sổ.
   Wizard thì được phép chiếm toàn cửa sổ.
4. **Wizard**:
   - "Quay lại" cùng hàng với nút chính (Quay lại trái, nút chính phải).
   - Thanh 4 bước canh theo đúng độ rộng 2 cột card bên dưới.
   - Bỏ đoạn văn marketing "Đúng account. Đúng ngữ cảnh." — cột phải chỉ giữ card tóm tắt account
     và ghi chú mô phỏng.
5. **Settings → Accounts quá dày**: mỗi account 1 dòng (dot · tên · nền tảng · định danh mono ·
   trạng thái · menu …). Đổi màu qua popover khi bấm vào dot, không trải 8 chip màu cho mọi account.
6. **Statusbar lộ ID nội bộ** `demo/account-<timestamp>` khi đang ở account mới: hiển thị chat ID
   như account gốc, hoặc để trống ngoài hội thoại.
7. `NEW-COMPONENTS.md` còn tham chiếu `review/RESULTS.md` (đã xoá) — bỏ tham chiếu, đưa tóm tắt
   kết quả kiểm vào ngay mục "Kiểm tra".

### Kiểm tra

- Chạy browser check như vòng 2 nhưng **KHÔNG lưu ảnh hay script vào project** — ảnh để ở thư mục
  tạm ngoài project, xem xong bỏ.
- Báo cáo ngắn: mỗi mục 1–7 ở trên đã sửa ra sao, kiểm bằng gì, ở 1440×900 và 1100×700, dark + light.
