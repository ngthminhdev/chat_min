# Spike nền tảng — ChatMin

Kết quả chạy `spike/*.js` thật. Không ghi nội dung tin nhắn (dữ liệu công ty).

## Google Chat — 2026-10-22 ✅ khả thi

Tài khoản Workspace `vortechinc.io`, Cloud project `chatmin` (org vortechinc.io), OAuth consent
**Internal**, client **Desktop app**. Scope: `chat.spaces.readonly`, `chat.messages`.

| Khả năng | Kết quả | Ghi chú |
|---|---|---|
| Auth (user OAuth) | ✅ | Admin không chặn (không gặp `admin_policy_enforced`). Có refresh token. |
| List chat | ✅ | `spaces.list` trả 20/trang, gồm cả `SPACE` và `DIRECT_MESSAGE`. |
| Đọc tin | ✅ | `messages.list` có `sender.displayName`, text, createTime. |
| Gửi tin | ⏸ chưa test | Cần đặt `GCHAT_SPACE` = một space test. |
| Realtime | ✅ (polling) | Poll 5s bắt đủ 3 tin mới trong 60s. Push thật: Workspace Events API + Pub/Sub (chưa thử). |

Lưu ý cho lúc code:
- DM không có `displayName` → phải gọi `spaces.members.list` (hoặc People API) để lấy tên người kia.
- Polling theo từng space không scale với 20+ space → cần Workspace Events API, hoặc poll
  `spaces.list` theo `lastActiveTime` rồi chỉ poll space vừa đổi.
- Chưa test: unread count (Chat API không có trực tiếp — có `spaces.spaceReadState` cần scope
  `chat.users.readstate`), reaction, thread, file đính kèm.
- Bẫy setup: Console mới tải JSON client **không có `client_secret`** và không có `redirect_uris`;
  `@google-cloud/local-auth` mở trình duyệt mặc định → `gchat.js login` tự làm loopback flow, mở Chrome.

## Telegram — 2026-10-22 ✅ khả thi (realtime chưa xác nhận)

User account qua MTProto (GramJS 2.26), `api_id`/`api_hash` từ my.telegram.org, session string
lưu `spike/.secrets/tg.session`.

| Khả năng | Kết quả | Ghi chú |
|---|---|---|
| Auth (phone + OTP) | ✅ | Login 1 lần, sau đó session dùng lại không cần OTP. |
| List chat | ✅ | `getDialogs` phân biệt user/group/channel, có unread count sẵn. |
| Đọc tin | ✅ | Tin cuối mỗi dialog đi kèm. |
| Gửi tin | ✅ | Gửi vào Saved Messages OK. |
| Realtime | ⏸ chưa xác nhận | Nghe `NewMessage` 60s: 0 event, và user xác nhận không có tin thật nào tới → đúng, nhưng đường nhận chưa được chứng minh. Kiểm lại ở prototype đầu tiên. |

Lưu ý cho lúc code:
- Unread count có sẵn trong dialog (khác Google Chat) → badge sidebar dễ.
- Channel tách riêng group — UI cần phân biệt (channel thường chỉ đọc).
- Log `[INFO] Running gramJS` vẫn in dù `setLogLevel('error')` — chỉ là cosmetic.

## Messenger — tra cứu 2026-10-22 → webview trước

- **API chính thức:** Messenger Platform chỉ cho Page / IG Professional. Không có đường cho tài khoản cá nhân.
- **messenger.com đã đóng (~15/04/2026)**, redirect về `facebook.com/messages`. App desktop
  Messenger Mac/Win cũng đã khai tử cuối 2025.
  ([TechCrunch](https://www.techcrunch.com/2026/02/19/meta-is-shutting-down-messengers-standalone-website/))
- **E2EE mặc định cho DM (từ 12/2023):** session trình duyệt mới phải khôi phục lịch sử bằng PIN 6 số
  hoặc key iCloud/Google Drive → webview phải giữ data store bền (không xoá storage).
- **Thư viện không chính thức:**
  - `mautrix-meta` (Go, AGPL-3.0, release hằng tháng, v26.10 ngày 16/10/2026): text, media,
    reaction, edit, backfill, realtime. Đây là thư viện duy nhất hỗ trợ rõ ràng chat E2EE.
  - `@dongdev/fca-unofficial` (Node) không nhắc E2EE, nhiều khả năng bỏ sót DM mã hoá
    (suy luận, chưa kiểm).
  - Rủi ro checkpoint/khoá tài khoản.
- **Webview (theo recipe Ferdium):** bỏ token Electron khỏi UA; badge lấy từ tiêu đề `(N)` +
  DOM (`mwthreadlist-item`, aria "Unread"); notification bằng shim `window.Notification`.
- **Kết luận:** V-sau dùng **tab webview** `facebook.com/messages`. Có thể làm sidecar
  `mautrix-meta` (opt-in) sau nếu cần UI thống nhất.

## Zalo — tra cứu 2026-10-22 → webview trước

- **API chính thức:** OA API chỉ cho Official Account; Zalo Bot là danh tính bot riêng. Social API
  không xác minh được scope hiện tại; coi như chỉ login/profile.
- **Thư viện không chính thức:** `zca-js` (TS, MIT, v2.2.0 ngày 09/2026, còn active), login bằng
  QR/cookie, có realtime `listen`, gửi text/sticker/file, reaction, danh sách bạn/nhóm, lịch sử
  nhóm. **Không thấy API lịch sử chat 1:1.** README cảnh báo có thể bị khoá tài khoản.
- **Webview:** `chat.zalo.me` login bằng QR từ app điện thoại. Ferdium lấy badge từ class DOM
  `fa-1`…`fa-5_Plus`, không cần đổi UA.
- **Rủi ro (suy luận):** mỗi tài khoản chỉ được một web listener, nên chạy zca-js song song với
  tab web sẽ đá nhau.
- **Kết luận:** dùng **tab webview** trước; `zca-js` qua sidecar Node để làm UI thống nhất sau.

## Hệ quả kiến trúc

Lai: UI thống nhất cho TG + GChat (có API), tab webview cho Messenger + Zalo. Design cần thêm màn
"tab webview" (chưa có trong prototype).

Chưa xác minh: WKWebView có chặn UA trên facebook.com/messages không; WKWebView có expose
Web Notification không (nhiều khả năng không, cần shim).
