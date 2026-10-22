# ChatMin — handoff (2026-10-22)

## Dự án

ChatMin: desktop app Tauri (macOS trước), All-in-One Messenger. Giai đoạn 1: Telegram + Google
Chat; sau đó Messenger, Zalo. Thuộc họ "_min apps" của tôi (`~/Project/*_min`), dùng chung
design system `~/Project/design-systems/` (tokens/themes/base/layout/components.css; app thật
symlink 5 file vào `src/styles/` như `elastic_min`, `reply_min`).

## Đã xong

**Design — xong 3 vòng, đã duyệt.**
- Brief + prompt từng vòng: `docs/design-prompt.md`.
- Prototype nằm trong Open Design (CHƯA export về repo):
  `~/Library/Application Support/Open Design/namespaces/release-stable/data/projects/5c9ccd86-53e9-4932-9f2e-b5f83477de6f/`
  - `index.html` (entry), `app.js` + `round2.js` (dữ liệu mẫu, route, bảng capability
    `PLATFORMS[*].caps`), `chatmin.css` + `round2.css` (component mới), `vendor/` (bản copy
    design system — không sửa), `NEW-COMPONENTS.md` (component mới + ma trận capability + kết quả kiểm).
  - Đủ màn: hero shell 3 cột, conversation (bubble/reply/reaction/thread GChat ở inspector),
    composer, ⌘K/⌘⇧F, Welcome, Add account wizard 4 bước, All inboxes + Settings (tab trong
    workspace), state offline/reconnect/hết phiên/rate-limit/loading/empty, debug ⌘⇧D.
  - Đã kiểm Chrome 1440×900 + 1100×700, dark + light, 0 lỗi console.
  - Còn nit nhỏ, để lúc code: 4 tab thì `.tab-conn` cắt thành "· Q…" → ẩn khi tab hẹp.
- Pane width đúng là `--left-w: 322px` / `--right-w: 410px` (tokens.css).
  `design-systems/README.md` còn ghi 258/328 (cũ, sai) — chưa sửa.

**Spike API — ĐÃ CHẠY 2026-10-22, cả hai khả thi.** Kết quả chi tiết: `docs/spike-platforms.md`.
- Google Chat: auth / list / đọc / realtime (polling) ✅; gửi chưa test (cần `GCHAT_SPACE` = space test).
  Cloud project `chatmin` (org vortechinc.io), consent Internal, client Desktop `1072274940233-…`.
  Admin không chặn. `gchat.js login` đã viết lại: tự loopback + mở Chrome (bỏ `local-auth` vì mở
  Edge mặc định và đòi `redirect_uris`). JSON client tải về từ Console mới KHÔNG có `client_secret`.
  ⚠️ Secret `…BN1fN` đã lộ trong chat → spike xong thì rotate (Clients → Add secret, xoá cái cũ).
- Telegram (@ngthminhdev): auth / list + unread / đọc / gửi Saved Messages ✅; realtime chưa
  chứng minh (60s không có tin thật nào tới) → kiểm lại ở prototype đầu.
- Messenger + Zalo: đã tra cứu → chỉ làm được bằng tab webview (chi tiết + nguồn trong spike-platforms.md).

Thư mục `spike/`:
- `tg.js` — Telegram user account qua GramJS (`telegram` npm, MTProto).
  `login` (interactive: phone → OTP → 2FA, lưu `.secrets/tg.session`),
  `test` (getMe, 10 dialog + unread, gửi vào Saved Messages, nghe NewMessage 60s).
- `gchat.js` — Google Chat API bằng user OAuth (`@googleapis/chat`, `@google-cloud/local-auth`).
  `login` (browser consent, lưu `.secrets/gchat-token.json`),
  `test` (list spaces, 5 tin gần nhất, gửi chỉ khi đặt `GCHAT_SPACE`, polling 5s × 60s).
- `.env` (trống, user tự điền), `.env.example`, `.gitignore` (`.secrets/`, `.env`, `node_modules/`).
- Chạy: `cd spike && node --env-file=.env tg.js login|test`, tương tự `gchat.js`.

## Đang làm: brainstorm technical design (superpowers:brainstorming)

Đã chốt với user:
- **V1 = gần full design**: reaction, thread, gửi media, search ⌘⇧F toàn cục, nhiều account/nền tảng.
  V1 chỉ TG + GChat; Messenger/Zalo (tab webview) để sau V1.
- **Lưu trữ**: cache SQLite + FTS trên máy, KHÔNG mã hoá (user chỉ dùng local, dựa FileVault).
- Stack theo họ `_min`: Tauri 2 + Rust (tokio/reqwest) + React/Vite/TS + zustand + lucide.
  GChat gọi REST bằng Rust.

Đang chờ user chọn **runtime Telegram**: A. TDLib qua `tdlib-rs` (đề xuất — đủ tính năng, tự xử lý
gap/reconnect; cần spike lại bằng Rust) / B. GramJS sidecar Node (đã spike) / C. grammers (Rust thuần).

Còn lại của brainstorm: realtime GChat (polling thông minh vs Workspace Events + Pub/Sub), kiến
trúc connector, data flow, lỗi, test → trình bày từng phần → spec ở
`docs/superpowers/specs/2026-10-22-chatmin-design.md` (KHÔNG tự commit) → writing-plans.

## Việc tiếp theo (cũ — bước 1–3 đã xong, xem trên)

1. **User chuẩn bị credential** (Claude không tự làm được):
   - Telegram: `api_id`/`api_hash` từ my.telegram.org → điền `.env` → user tự chạy
     `tg.js login` trong terminal của mình (cần nhập OTP).
   - Google Chat: BẮT BUỘC tài khoản Google Workspace Business/Enterprise. Cloud project → bật
     Chat API → điền Configuration (tên/icon/mô tả app) → OAuth consent (Internal, hoặc External +
     test user) → OAuth client "Desktop app" → lưu JSON thành `spike/.secrets/gchat-credentials.json`
     → chạy `gchat.js login`.
2. **Chạy `tg.js test` và `gchat.js test`**, ghi kết quả có/không cho: auth, list chat, đọc tin,
   gửi tin, realtime → `docs/spike-platforms.md`.
   Lỗi có thể gặp: Google `admin_policy_enforced` (admin Workspace chặn app OAuth) — đó là một kết quả.
3. **Tra cứu + ghi vào cùng file:** Messenger (Graph API chỉ cho Page) và Zalo (API chỉ cho
   Official Account) — nhiều khả năng chỉ làm được bằng **tab webview** (kiểu Ferdium).
   Nếu đúng → kiến trúc lai: UI thống nhất cho nền tảng có API + tab webview cho phần còn lại →
   cần thêm màn "tab webview" vào design.
4. Quyết định runtime Telegram trong Tauri: TDLib (Rust binding) hay Node sidecar (GramJS).
5. User export handoff từ Open Design vào `chat_min/design/`.
6. Viết spec + plan (superpowers:brainstorming → writing-plans), rồi mới code.

## Luật làm việc với user

- Trả lời tiếng Việt, ngắn gọn.
- KHÔNG `git commit`/`push` trừ khi user bảo rõ.
- Không lưu ảnh chụp/script kiểm tra vào project (lần trước tool design để lại 71 ảnh, user không thích).
- Session/token trong `spike/.secrets/` = toàn quyền tài khoản: không in ra, không commit, không gửi đi đâu.
- Telegram spike chỉ gửi vào Saved Messages; Google Chat chỉ gửi khi user đặt `GCHAT_SPACE`.

## Trạng thái code (2026-10-22 tối) — V1 đã dựng, đang test với account thật

Spec: `docs/superpowers/specs/2026-10-22-chatmin-design.md`. Prototype export: `design/prototype/`.
- Rust (`src-tauri/src`): `tg.rs` (TDLib 1.8.61 static qua tdlib-rs, phiên lưu `<appdata>/tg/<id>/` — login 1 lần),
  `gchat.rs` (REST + OAuth loopback, polling 10s/3s, avatar qua People API), `store.rs` (SQLite + FTS5 không dấu), `lib.rs` (commands).
- FE (`src/`): React + zustand + motion, CSS port từ prototype ở `src/styles/chatmin.css`.
  Sidebar dạng cây account → Ghim/Tin riêng/Nhóm/Space/Kênh; space GChat có tab Tin nhắn | Threads.
- Chạy: `npm run tauri dev`. Demo không cần account: `npm run dev` rồi mở http://localhost:1424 (`?empty` = màn Welcome).
- Test: `cargo test` (5), `npm test` (3). `<appdata>` = `~/Library/Application Support/com.chatmin.app` (config.json 600 có credential dev).
- Account thật đã login (TG + GChat vortechinc.io, People API đã bật). "Spike test" đã xoá.
- Sidebar: Ghim (cục bộ, mọi account, kéo đổi thứ tự) → account (kéo bằng ⋮⋮) → nhánh theo loại → chat → xem nhanh thread.
  Chuột phải chat: mở tab, ghim, xem thread, đánh dấu đọc, tắt thông báo, copy ID.
- Thread GChat mở thành tab workspace riêng (`thread:<threadId>`, `ThreadView.tsx`), không dùng inspector nữa.
- Icon mới theo họ _min: `src/assets/logo.svg` → `src-tauri/icons/`. Bản .app debug: `npx tauri build --debug --bundles app`.
- Chưa làm: Telegram forum topics, forward, sticker/voice gửi, Messenger/Zalo webview.
- Bẫy đã gặp (2 lần): temporary MutexGuard sống tới hết statement — struct literal (`app_state`, màn đen) và
  `if let x = core.store()...` có gọi store trong thân (`mark_read`, treo cả sync). Luôn bind kết quả ra biến trước.

## AI (2026-10-22)
- `src-tauri/src/ai.rs`: two wire formats — OpenAI-compatible `/chat/completions` (default endpoint OpenRouter) and Anthropic `/messages` (default api.anthropic.com). Config in `config.json` → `ai` {format, endpoint, model, key, guide}; key never sent to the FE (`ai_config` returns `hasKey`).
- Tasks (`ai_run`): `translate` (one msg, auto direction me↔to), `translate_to` (draft → to), `translate_many` (JSON array in/out, reading into `me`), `suggest` (3 × {reply, meaning}).
- On api.anthropic.com: `output_config.effort: "low"` + server-side refusal fallback (`fallbacks: "default"`, beta `server-side-fallback-2026-07-01`) for Opus 5 / Fable 5.1 / Sonnet 5.5; any 400 retries once without the extras.
- FE `src/ai.ts`: `tr` (inline translations, not persisted), `trAuto` (whole-chat mode, MessageList effect translates new incoming msgs), `aiLang` (per-chat writing language), prefs `aiMe` / `aiTo`.
- UI: msg hover/menu "Dịch"; header 文A toggle = dịch cả chat; composer ✨ gợi ý (⌘J), 文A dịch nháp (⌘⇧L), tag `EN` chọn ngôn ngữ per chat, "Khôi phục bản gốc"; Settings › AI.
