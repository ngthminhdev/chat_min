# ChatMin V1 — technical design (2026-10-22)

User giao toàn quyền quyết định ("bạn tự làm đi"). Các quyết định dưới đây là của Claude.

## Phạm vi V1

Telegram + Google Chat, nhiều account mỗi nền tảng. UI bám prototype `design/prototype/`
(3 vòng đã duyệt). Messenger/Zalo (tab webview) để sau V1.

Có trong V1: wizard thêm account thật (TG: số điện thoại → OTP → 2FA, hoặc QR; GChat: OAuth
loopback), sidebar theo account + lọc, tab, hội thoại (text, trả lời, reaction, sửa, xoá, ảnh,
file, link, ngăn ngày, vạch chưa đọc, đang gõ), composer (gửi, trả lời, sửa bằng ↑, emoji,
đính kèm file), inspector (info, thành viên, file, ảnh, ghim, thread GChat), ⌘K, ⌘⇧F search
toàn cục (FTS), All inboxes, Settings (appearance, accounts, notifications, shortcuts),
statusbar sync, thông báo macOS, badge dock, trạng thái offline/hết phiên.

Không có trong V1: sticker/voice (nút mờ theo capability như design), bảng debug ⌘⇧D (chỉ
dành cho prototype), gửi tin thoại, gọi điện.

## Kiến trúc

```
React (src/)  ──invoke/events──  Rust core (src-tauri/)
                                   ├─ store.rs   SQLite + FTS5 (cache, search)
                                   ├─ tg.rs      TDLib (tdlib-rs 1.4, TDLib 1.8.61)
                                   ├─ gchat.rs   Chat REST API + OAuth (reqwest)
                                   └─ lib.rs     commands, event bus, notifications
```

- **Model chung** (`model.rs`): `Account`, `Chat`, `Message` — mỗi connector chuẩn hoá về đây.
  ID dạng chuỗi; khoá chính là `(account_id, chat_id)` và `(account_id, chat_id, msg_id)`.
- **Telegram = TDLib.** Mỗi account là một TDLib client (`create_client`), DB riêng ở
  `<appdata>/tg/<account>/`. Một thread `receive()` duy nhất phân phối update theo client id.
  TDLib tự xử lý gap/reconnect; ta chỉ dịch update → model → SQLite → event cho FE.
- **Google Chat = REST.** Token refresh lưu `<appdata>/secrets/gchat-<account>.json` (0600).
  Realtime = **polling thông minh**: `spaces.list` mỗi 10s, chỉ fetch tin của space có
  `lastActiveTime` đổi; space đang mở poll 3s. Workspace Events + Pub/Sub cần Cloud Pub/Sub và
  endpoint công khai — không hợp app desktop, bỏ.
- **Lưu trữ:** SQLite (rusqlite bundled) ở `<appdata>/chatmin.db`, không mã hoá (FileVault).
  `messages_fts` (FTS5, `remove_diacritics 2`) cho ⌘⇧F không dấu.
- **Cấu hình nhà phát triển:** `<appdata>/config.json` = `{tg_api_id, tg_api_hash,
  gchat_client_id, gchat_client_secret}`. Thiếu thì wizard hỏi.
- **FE:** React 18 + Vite + TS + zustand + motion + lucide-react (giống `elastic_min`).
  5 file design system symlink vào `src/styles/`; CSS của prototype (`chatmin.css`,
  `round2.css`) port sang `src/styles/chatmin.css`.
- **Chế độ demo:** chạy `vite` ngoài Tauri thì `bridge.ts` trả dữ liệu mẫu — để kiểm UI bằng
  trình duyệt.

## Capability

Giữ bảng `PLATFORMS[*].caps` của prototype (`src/lib/platforms.ts`). GChat: `pin: false`
(API không có ghim), `typing: false` (API không có typing event).

## Lỗi

- Mất mạng → account `offline`/`reconnecting` (TDLib `updateConnectionState`; GChat lỗi mạng
  khi poll). Composer khoá, nháp giữ nguyên.
- 401 / `invalid_grant` / TDLib `authorizationStateClosed` → `expired`, nút Đăng nhập lại.
- 429 / TDLib `FLOOD_WAIT_n` → `rate` có đếm ngược.
- Gửi lỗi → bubble `failed` + Thử lại.

## Kiểm tra

- Rust: test cho dịch model + FTS (`cargo test`).
- FE: `node --test` cho logic thuần (format, nhóm tin).
- UI: chế độ demo + Playwright, ảnh để ngoài project. App thật: user login thật.
