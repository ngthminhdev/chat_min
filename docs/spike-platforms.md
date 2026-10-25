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

## Messenger — tra cứu lại 2026-10-24 → vẫn webview; UI thống nhất chỉ khả thi qua sidecar

Hiện trạng code: `web.rs` mở `https://www.messenger.com/` (vẫn trả 200, redirect phía JS về
`facebook.com/messages`) — nên đổi URL thẳng. Android: chỉ mở app/trình duyệt ngoài.

Đường đi để có UI thống nhất (đọc/gửi trong ChatMin, không webview):

| Hướng | Ngôn ngữ / license | E2EE DM (mặc định từ 12/2023) | Độ chín | Chi phí |
|---|---|---|---|---|
| `mautrix-meta` `pkg/messagix` + `whatsmeow` (Go, AGPL-3.0) | Go 1.26 (máy có 1.25.5) | Có — E2EE Messenger chạy qua hạ tầng WhatsApp, bridge dùng `whatsmeow` + `libsignal`; v26.10 (16/10/2026) backfill lịch sử E2EE bằng PIN backup | Cao: release hằng tháng, Beeper dùng; đã có lần vỡ khi Meta đổi server (v0.2608.1) | Cao: `pkg/connector` ~25 file / ~250 KB là phần glue Matrix, phải viết lại glue riêng (login cookie, sự kiện, media, E2EE device). `cmd/lscli` chỉ là decoder payload, không phải client mẫu |
| `bhhoang/fbapi-unofficial` (Node, MIT) | Node 22 | Có 1:1 (Noise + Signal tự cài), `listenMqtt` nhận tin đã giải mã, `restoreE2EEBackup` bằng mã khôi phục; **không** nhóm E2EE | Thấp: fork 0 star, 1 người, không npm; vỡ khi `LS_VERSION_ID`/`DOC_ID` đổi | Thấp (1–2 ngày spike qua sidecar Node stdio JSON) nhưng phải ship Node runtime |
| `mewisme/meta.go` (Go, AGPL-3.0) | Go | Có (khai báo) | Rất thấp: 0 star, 1 tác giả, commit từ 09/2026, chưa có tag release | Chưa đáng thử |
| Chạy nguyên `mautrix-meta` + homeserver Matrix nhỏ, ChatMin làm Matrix client | Go + Rust | Có | Cao nhưng kéo cả Matrix stack | Quá nặng cho app cá nhân |
| Rust crate | — | — | Không có gì sống (crate `fb_messenger` 2021 chỉ gửi) | — |

Rủi ro chung mọi hướng không chính thức: Meta có thể checkpoint/khoá tài khoản (docs mautrix cảnh báo
rõ, khuyên bật 2FA); login bằng cookie `c_user`/`xs`/`datr`/`sb` lấy từ trình duyệt; mọi lib đều
vỡ khi Meta đổi protocol. API chính thức vẫn chỉ Page/IG Pro; API interop DMA chỉ EU.

**Kết luận:** giữ webview (sửa URL → `facebook.com/messages`, thêm shim notification nếu cần).
Nếu muốn UI thống nhất: spike `fbapi-unofficial` bằng tài khoản phụ 1–2 ngày để đo độ ổn định;
làm thật thì sidecar Go trên `pkg/messagix` + `whatsmeow` (cần nâng Go 1.26, chấp nhận AGPL +
công viết glue vài tuần). Không khuyến nghị dùng tài khoản chính để thử.

Nguồn: mau.fi/blog/2026-10-mautrix-release, github.com/mautrix/meta (ROADMAP.md, go.mod,
cmd/lscli), docs.mau.fi/bridges/go/meta/authentication.html, github.com/bhhoang/fbapi-unofficial,
github.com/mewisme/meta.go, techcrunch.com 2026-02-19, news.ycombinator.com/item?id=47052007.
