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

## Media viewer + xoá chat (2026-10-22)
- Root cause "click ảnh không làm gì": `opener:allow-open-path` không có scope → plugin chặn mọi path, lỗi bị nuốt. Capability giờ: `opener:default` (http/https/mailto/tel + reveal) + open-path scope `$APPDATA/**`, `$APPCACHE/**`. CSP thêm `media-src … asset:` (thiếu thì `<video>`/`<audio>` bị default-src chặn).
- `components/Viewer.tsx` (store `viewer`): ảnh fit/100% khi click, video có tiếng; Esc đóng. MediaView: video ≤5MB / GIF / video tròn tự tải và phát muted loop inline; voice phát inline `<audio>`; chuột phải ảnh/video/file → Xem / Mở bằng app / Finder / Sao chép tên. GChat attachment `video/*` → kind "video".
- Xoá chat (sidebar chuột phải): Telegram `tg.delete_chat` — private: deleteChatHistory(remove_from_list, revoke tuỳ chọn); basic group: leave + clear; supergroup/channel: leave. Google Chat không xoá được qua API → `hideChat` (store `hidden`, persisted; hiện lại khi lastTs mới hơn).
- Lưu file: `save_file` (lib.rs) chỉ copy file nằm trong data/cache dir; không dest → ~/Downloads, tự đánh số "name (1).ext", mượn đuôi từ file nguồn. FE `saveMedia` (store) — menu chuột phải media/file, Viewer ⌘S / ⌘⇧S, Inspector file row.
- Space dạng thread trống: trang tin gần nhất có thể toàn reply (`threadReply`), tin gốc nằm trang cũ hơn → `fillRoots` (store) tải thread thiếu gốc (tối đa 8, mỗi thread 1 lần); timeline dùng reply sớm nhất làm đại diện nếu vẫn không có gốc. ⌘1…8 = tab N, ⌘9 = tab cuối.

## Round 2026-10-22 (tối)
- Icon nền tảng: logo màu chính thức (Wikimedia Commons) ở `src/assets/brands/*.svg`, render bằng `<img>` trong `Glyph` (tránh trùng id gradient). Path đơn sắc cũ trùng simple-icons 16.35, chỉ là trông nhạt.
- Contrast: `.badge` trung tính nổi hơn, `.badge.unread` nền accent đặc, toast nền đặc + viền trái theo loại, health banner có nền.
- AI tóm tắt: task `summarize` (ai.rs), `src/components/Summary.tsx` (nút ✨ header + card nổi), state `summary[tab]`.
- Chuyển tiếp: `forwardMsg` (store) — cùng account TG → `forward_messages` gốc; khác → gửi lại với dòng "↪ Chuyển tiếp từ …" (+ tải media rồi upload). Palette nhận `forward`.
- Topic Telegram: `Chat.forum` (Supergroup.is_forum, `Acc.forums`), `Msg.thread_id` = forum_topic_id, commands `topics` / `topic_history`, send nhận topic qua `thread_id`. FE: tab topic = ThreadTab `topic: true` (ThreadView hiển thị timeline phẳng).
- Threads/Topics chuyển sang right dock (Inspector tab "threads"); header chỉ còn nút mở. `threadTabKey(chatKey, threadId)` — sửa lỗi highlight thread đang mở.
- Scroll: `components/useStickyScroll.ts` neo theo phần tử đang đọc (không theo scrollHeight) + ResizeObserver; `JumpBottom` luôn hiện khi cuộn xa đáy; spinner tải cũ là overlay sticky.
- Sidebar: hover preview (`HoverPeek`, state `hoverPeek`), kéo đổi thứ tự trong nhánh (`chatOrder[accountId:section]` = prefix cố định, phần còn lại theo hoạt động; menu "Bỏ cố định vị trí"). Nút Sao chép trên toolbar tin.
- Sticker (Telegram): `stickers` (gần đây + 15 bộ), `send_sticker`; picker `ComposerExtras.tsx`. Voice: MediaRecorder → `save_temp` (base64 → cache/outbox) → `send(voice=duration)` → TG `InputMessageVoiceNote`, GChat upload file. `src-tauri/Info.plist` có NSMicrophoneUsageDescription.
- Messenger/Zalo: `web.rs` — child webview (`tauri` feature `unstable`, `Window::add_child`), `data_store_identifier` riêng từng account, UA Safari, unread từ document title "(N) …" → chat giả `id: "web", kind: "web"`. FE `WebConversation` đặt webview theo rect `.web-host`, ẩn khi có overlay (webview native luôn đè HTML). Account id `messenger-<ts>` / `zalo-<ts>`.
- Cài đặt: bản release ở `/Applications/ChatMin.app`; bản debug bundle đã xoá.
- Cửa sổ: `tauri-plugin-window-state` (không lưu VISIBLE) nhớ kích thước/vị trí/maximize/fullscreen; ✕ = ẩn (app vẫn chạy cho thông báo + badge), Dock click = hiện lại (`RunEvent::Reopen`), ⌘Q thoát.

## Nhận tin + thông báo (2026-10-23) — đủ để tắt thông báo Telegram / Google Chat gốc
- Thông báo và badge Dock quyết định ở Rust (`src-tauri/src/notify.rs`), gọi từ `Core::put_msg` / `put_chat` / `web_unread`. JS không còn gửi thông báo (webview của cửa sổ ẩn bị WebKit throttle/suspend). FE chỉ đồng bộ prefs qua `notify_prefs` (App.tsx) và mở chat khi nhận event `open` (click thông báo, `notify::on_click` dùng `on_action` của plugin → `action_id == "tap"`, `extra.chat` = "account|chat").
- Luật (`Notifier::rings`, có test): bỏ qua tin của mình, đã xoá, chat đang mở + cửa sổ focus, tin cũ >10 phút (máy ngủ / app tắt) không báo lẻ mà gom thành 1 thông báo "N tin nhắn trong lúc vắng" (≤12h, click mở chat đầu), giờ im lặng, chỉ-mention. Chat mute: im — trừ Telegram @mention/reply (giống Telegram). Space Google Chat như mặc định "All" của Chat: @mention, tin mở thread, trả lời trong thread mình từng nhắn; không báo mọi reply.
- Telegram mute theo scope ("tắt tiếng mọi kênh/nhóm"): `Update::ScopeNotificationSettings` + `Acc.scope_muted` / `default_mute`; trước đó chat dùng mặc định luôn bị coi là bật tiếng.
- Google Chat: quét spaces ~3s (`tick % 3`), space đang mở ~2s; ~50 lượt đọc/phút (quota project 3000/phút). Lần quét đầu so `lastActiveTime` với tin mới nhất trong cache (không dùng `chat.last_ts` — nó theo lastActiveTime dù chưa tải tin) → space có tin trong lúc tắt app luôn được tải. `fetch_new` theo `nextPageToken` (≤5 trang), chưa hết thì không mark seen. Read state của space còn unread đọc lại mỗi ~60s (đọc trên điện thoại/web mới cập nhật).
- `Info.plist` `NSAppSleepDisabled` (App Nap kéo dài poll khi cửa sổ ẩn). App active (click thông báo, ⌘Tab, Dock) mà cửa sổ ẩn → hiện lại (`show_on_activate`, NSApplicationDidBecomeActiveNotification). Phiên hết hạn → thông báo macOS "cần đăng nhập lại".
- Settings → Thông báo → "Gửi thông báo thử". Log stderr: `[recv] <platform> +<ms> <kind> [muted] [reply] rang=<bool>` (không tên/nội dung), `[notify] shown`.
- Telegram: TDLib chỉ nhận live update của supergroup/channel khi chat "open" → `Tg::watch` mở ngầm ≤30 nhóm/kênh bật tiếng (cập nhật 5 phút; `set_open` không close chat đang watch). Google Chat lỗi tạm thời (500 INTERNAL): bỏ qua space lỗi, thử lại sau 3s, chỉ báo offline sau 3 lần liên tiếp.

## 2026-10-23 (tối) — GIF gửi đi + sheet chuyển tiếp
- GIF gửi đi không chạy: `.gif` đi đường `InputMessageDocument` (đúng, TDLib tự nhận là animation), server trả `MessageAnimation` mime `video/mp4` nhưng TDLib giữ file `.gif` gốc làm bản local → `<video src=x.gif>` lỗi, chỉ thấy poster. `MediaView` giờ render path `.gif` bằng `<img>`.
- Chuyển tiếp: palette chọn chat → state `forward` → `ForwardSheet` (Overlays.tsx): preview tin, chat đích (nút Đổi mở lại palette), chọn Chủ đề (TG forum, `loadTopics`) / Luồng (GChat space, từ `msgs` đã tải — `loadLatest` nếu chưa), ô "Nhắn kèm" gửi trước thành tin riêng (giống Telegram), ⌘↵ gửi, Esc đóng. `forwardMsg(m, to, {comment, threadId})`; Rust `forward` nhận `topic` → `forward_messages(chat, Some(MessageTopicForum))`.
- Chưa verify bằng mắt (không build). Working tree lúc đó còn WIP motion-polish của session khác (Conversation/ThreadView/Sidebar/useStickyScroll/message-identity…) — KHÔNG thuộc 2 commit này.
- Google Chat code block (``` ) hiện thành 1 dòng không fence: `formattedText` của Google phá block — bỏ fence, xoá newline, thêm 4 space đầu (xác nhận bằng GET message qua API). `restore_code_blocks` (gchat.rs) ghép lại từ `text` (có newline, không fence) trước `chat_markup`. Chưa xử lý: block gửi từ web composer mới ra dạng "``` \n```\n\n<nội dung tách đoạn>".
- Perf (cd07fbd): `MessageItem` bỏ selector `find` tin gốc khi quote có sẵn (O(n²) mỗi lần store đổi); rời chat thì `trimLoaded` cắt list còn 2 trang. Cache SQLite không có TTL tin (chỉ media) — 12 MB, chưa cần. Nếu còn lag: làm sliding window 100 tin (cần `loadNewer` + banner tin mới) hoặc virtualization.

## Android (2026-10-24) — chạy được trên máy thật (debug APK arm64)
- Build + cài + mở: `scripts/android-build.sh` (`--no-install` chỉ build). Cần: `brew install --cask android-commandlinetools`, sdkmanager `platforms;android-35 build-tools;35.0.0 ndk;27.2.12479018`, `rustup target add aarch64-linux-android`, JDK 21 (temurin), điện thoại bật USB debugging (`adb devices` = device). Lần đầu: `npx tauri android init` (gen/android gitignored, script tự vá lại sau init).
- TDLib: tdlib-rs có prebuilt `android-aarch64` → không phải tự build. Link static cần `libc++_static` + `libc++abi` của NDK: script copy 2 file vào `src-tauri/target/ndk-libs` và đặt `-L` + `-C link-arg=-lc++abi` (`.cargo/config.toml` cho bước cargo của CLI, env `CARGO_TARGET_AARCH64_LINUX_ANDROID_RUSTFLAGS` cho bước gradle — CLI ghi đè config). KHÔNG trỏ `-L` vào cả sysroot NDK: linker lấy `libc.a` tĩnh → `getauxval` SIGSEGV lúc mở app.
- Gen patches (script làm, idempotent): `targetSdk = 35` + `windowOptOutEdgeToEdgeEnforcement` + bỏ `enableEdgeToEdge()` trong MainActivity (webview nằm dưới status bar), màu status/nav bar `#141821`.
- Code: `cfg(desktop)` cho window-state, child webview Messenger/Zalo (mobile stub báo chưa hỗ trợ), badge Dock, focus window; `mobile_entry_point`; capabilities tách `default.json` (desktop) / `mobile.json`.
- UI phone: `html.mobile` (main.tsx, UA Android/iOS hoặc `?mobile` trên demo browser) → 1 pane: list (sidebar overlay) ↔ conversation (nút ‹ trong `.conv-head` = `leftCollapsed:false`), inspector = sheet full màn, ẩn kbd/footer/hover toolbar, không gọi setEffects. Xem nhanh: `npx vite --port 1424` + `http://localhost:1424/?mobile` (có `&empty` = Welcome); script chụp CDP ở scratchpad (không trong repo).
- Chưa làm trên Android: login Telegram/GChat chưa thử trên máy (GChat OAuth loopback 127.0.0.1 — Chrome trên máy có thể tới được, chưa verify); thông báo mobile (plugin notification có hỗ trợ, chưa test); Messenger/Zalo; release APK (ký). APK debug ký bằng debug key.
- Bubble "đang gửi" treo sau khi gửi Telegram: `MessageSendSucceeded` (P→F) tới trước lời đáp IPC của `send` (P) → `reconcileMessage` giờ ghi `oldId` vào `uiPreviousIds` kể cả khi P chưa có trong list (test "id change before the send promise resolves"). Mô phỏng mọi thứ tự event: 0 lỗi.
- Format Telegram: composer markup (`*b*`, `_i_`, `~s~`, `` `code` ``, ```pre```) giờ thành entities thật qua `to_tg_markdown` + TDLib `parseMarkdown` (`formatted()` trong tg.rs), dùng cho cả send lẫn edit (edit trước gửi text thô). Trước đây client Telegram khác thấy backtick literal.
- "GIF không chạy" (10-24): thực ra là **sticker động** (picker phát WebM, tin chỉ hiện thumbnail — cố ý trong `MessageSticker`). Giờ WebM → `Media{kind:"video", name:"Sticker", mime:"video/webm"}` phát inline; TGS vẫn thumbnail (không có Lottie player). Fix `.gif` → `<img>` trước đó vẫn đúng cho GIF thật gửi đi. Log webview: `~/Library/Caches/com.chatmin.app/js.log` (`log_js`, 1 MB cuộn).
- Mở/Finder file đã gửi: lệnh Rust `open_local` (data/cache dir hoặc `localPath` của tin trong cache); plugin opener scope không cho path ngoài app.

## Android (2026-10-24 đêm) — phone shell của codex + polish, notify, media; chưa test máy thật
- Codex (chưa commit lúc bàn giao) → 2 commit `84001fd` (phone shell: list/chat/details 1 màn, sheet 48px, native Back qua `scripts/android/MainActivity.kt`, `src/mobile.ts`, `src/lib/mobile-navigation.ts`) + `cfed337` (Google sign-in native qua AuthorizationClient, `src-tauri/src/google_android.rs`, `scripts/android/GoogleAuthPlugin.kt`, hướng dẫn `docs/android-google-oauth.md`). Artifact audit/screenshot chỉ lưu local trong `docs/audits/` (gitignored); các báo cáo lịch sử đã được dọn khỏi checkout.
- Claude tiếp (commit `a6dad90`…): icon launcher thật (gen/ vẫn là icon mặc định Tauri → build script copy `src-tauri/icons/android` vào res; background adaptive `#141821`); list lọc bằng 1 hàng chip (trạng thái + tài khoản, `Inbox.tsx`); nhấn giữ tin = bottom sheet có hàng reaction nhanh (`Overlays.tsx` Popover → `.mobile-pop-sheet`, `Pop.menu.quick`); emoji picker/màu tài khoản cũng là sheet; reaction pill 34px có vùng chạm ẩn; mọi tin hiện giờ (desktop chỉ hover); media width cố định (`width:%` làm grid track = intrinsic ảnh → time tràn màn); Viewer vuốt xuống đóng, bỏ nút Finder; chuyển màn/sheet có animation (`mobile.css` cuối file, tôn trọng reduced-motion); wizard card nền tảng xếp hàng; thread back arrow không xoay.
- Bàn phím: `useStickyScroll` observe cả `.msgs` box (adjustResize làm webview co) → vẫn dính tin cuối. Mô phỏng: `scratchpad/kbd.mjs` (viewport 844→500) dist=0.
- Thông báo Android (`notify.rs`): channel `messages` importance High tạo ở setup (`setup_channel`, cfg(mobile)); `show` gắn `channel_id`; `notify_permission(ask)` → JS gọi lúc mở app (`useAndroidNavigation`), Settings hiện nút "Cho phép thông báo" khi `notifyPermission !== "granted"`; `set_foreground` từ `visibilitychange` → `watching()` trên mobile dùng cờ này thay `is_focused` (Android không trả lời). Tap thông báo: `on_action` của plugin chạy cả Android (payload `notification.extra.chat`), chưa verify trên máy.
- Demo browser có thêm tin ảnh (SVG inline) + video (poster) trong nhóm Hà Giang để xem layout media.
- Kiểm tra: `npx vite --port 1424` → `node scripts/phone-shots.mjs` (Chrome + playwright global; `W=360 H=740` cho máy nhỏ; `?mobile&empty` = Welcome). `cargo check --target aarch64-linux-android` cần env `CC_aarch64_linux_android`/`AR_…`/`…_LINKER` trỏ NDK clang (xem lịch sử lệnh trong session này; build script tự lo khi build thật).
- Gửi tiến độ cho user khi họ ngủ: `node --env-file=spike/.env spike/notify-me.cjs "text" [ảnh…]` → Saved Messages Telegram (session spike). Chỉ gửi ở mốc, không spam.
- CHƯA: test trên máy thật (không có adb device đêm nay) — cần kiểm: icon, long-press sheet, viewer, thông báo (quyền + tap mở chat + im lặng khi chat mở), video inline qua asset protocol Android, keyboard thật. APK debug: `scripts/android-build.sh` (`--no-install` chỉ build).
- **Đã test ở mức device (emulator Pixel 7 / Android 15 / WebView 124, 2026-10-25 rạng sáng)** — không có máy thật nên dựng AVD: `sdkmanager "emulator" "system-images;android-35;google_apis;arm64-v8a" "cmdline-tools;latest"` (SDK `~/Library/Android/sdk`, dùng `cmdline-tools/latest/bin/avdmanager` của SDK, bản brew không thấy system image) → `avdmanager create avd -n chatmin -k "system-images;android-35;google_apis;arm64-v8a" -d pixel_7` → `emulator -avd chatmin -no-window -no-audio -gpu swiftshader_indirect` → `adb install -r` APK. Soi DOM/invoke qua CDP: `adb forward tcp:9222 localabstract:webview_devtools_remote_$(adb shell pidof com.chatmin.app)` rồi WebSocket `Runtime.evaluate` (script `cdp.mjs` trong scratchpad; `window.__TAURI_INTERNALS__.invoke('notify_test')` chạy được từ đó). Để test UI chat không cần account: `npx vite --port 1424 --host` + điều hướng webview tới `http://10.0.2.2:1424/?mobile&demo` (`?demo` ép bridge dùng backend demo dù có Tauri IPC — thêm trong `bridge.ts`).
  - PASS trên device: hộp xin quyền thông báo lúc mở app; `notify_test` → thông báo channel `messages` importance HIGH, icon status bar ChatMin (`scripts/android/res/drawable/ic_stat_chatmin.xml`), tap thông báo đưa app lên trước; icon launcher ChatMin trong app drawer; wizard (card nền tảng hàng dọc, TDLib form api_id/api_hash); bàn phím thật: webview co 839→527 và list vẫn dính tin cuối; Back: đóng bàn phím → đóng sheet → về list; nhấn giữ thật → sheet reaction nhanh, tap 👍 → reaction hiện, sheet đóng; viewer mở bằng tap ảnh, vuốt xuống đóng; list/chat/media render đúng.
  - Lỗi phát hiện + sửa nhờ device: Welcome có dải trắng ngang hero (WebView 124, cả swiftshader lẫn GPU host; mọi SVG ở slot 2 của `.welcome-platforms` đều gây) → `will-change: transform` cho `.glyph` ở đó; nhấn giữ bubble chọn text native → `user-select: none` cho bubble/sender.
  - CHƯA test được: login TG/GChat thật, tap thông báo mở đúng chat (cần account), video inline qua asset protocol (demo chỉ có poster), Messenger/Zalo.
- Kiểm thêm trên emulator với APK cuối (`57ea9b4`): tap thông báo → `on_action` plugin chạy trên Android, log `[notify] open ""` (đường mở chat dùng chung với desktop); video mp4 qua asset protocol (`http://asset.localhost/...`, scope `$APPCACHE/**`) phát inline được (`save_temp` → `convertFileSrc` → `<video>` t=0.71s, readyState 4); `streamSrc` Telegram trước đây trả `tgstream://localhost/...` — Android không biết scheme này → đổi thành `http://tgstream.localhost/...` trên Android, request tới được `tg_stream` (log `[tgstream] … Telegram account chưa kết nối` vì chưa login). Còn lại đúng nghĩa cần account thật: login TG/GChat, tap thông báo mở đúng chat, phát video Telegram thật.
- Messenger/Zalo trên Android (`b42a26b`): hàng web account mở màn giải thích + nút "Mở Messenger/Zalo" → `openUrl` → app/trình duyệt hệ thống (verify emulator: Chrome mở; thêm bằng `web_add`, xoá bằng `account_remove` về Welcome). APK debug hiện tại build từ commit này.

## Android (2026-10-24 sáng) — album, ảnh không crop, forum vào topic, thumbnail sai

Test trên máy thật A301SH (Telegram đăng nhập sẵn), APK debug cài qua `scripts/android-build.sh`.

- **Album**: tin ảnh/video có cùng `albumId` (TDLib `media_album_id`, `model.rs`/`tg.rs`) — hoặc ảnh tôi gửi liên tiếp trong 1 phút (ChatMin gửi từng file) — gộp thành 1 grid 2 cột, 1 mốc giờ, caption lấy tin đầu có text. `Conversation.tsx` (`albumNext`) gom run, `MessageItem album=` vẽ `.media-grid.album`. Long-press/reaction trên grid tác động tin đầu (ponytail). Gửi album thật qua `sendMessageAlbum` chưa làm: người nhận trên Telegram vẫn thấy từng ảnh rời.
- **Ảnh đơn**: `fitWidth()` trong `Message.tsx` tính width từ tỉ lệ (max 300px phone / 360px desktop, cao ≤ 420px) → hiện trọn ảnh, không `cover` crop nữa.
- **Viewer phone**: media `width/height: 100%; object-fit: contain`, không tap-zoom (pinch của hệ thống). Đo trên máy: ảnh 420×802 tại (0,56) trong cửa sổ 420×858.
- **Forum**: `openChat` một forum → `forumLanding()` mở tab topic `lastTopic[k]` (persist) hoặc topic có `lastTs` mới nhất; Back từ topic vẫn về forum (General). Thông báo của topic mở đúng topic (`openAt`). Verify máy thật: "Thị trấn Qua Hốc" → "# Chuyện lạ Út Bông".
- **Thumbnail "tạp nham"**: tin vẽ từ cache SQLite mang file id TDLib của phiên trước; phiên mới id đó là file khác (avatar người khác hiện trong ô ảnh) cho tới khi reload thay tin. `cached_messages` (lib.rs `stale_refs`) xoá id số, giữ blur base64 + path local.
- Chưa test: gửi nhiều ảnh từ máy (album heuristic cho tin đi), video Telegram thật qua tgstream.

## Desktop (2026-10-24 trưa) — viewer lướt ảnh, code block, thư mục custom

- **Viewer**: ← → / mũi tên / vuốt ngang đi qua mọi ảnh+video của chat đang mở (`Viewer.tsx` lấy từ `msgs[chat]`), counter "3 / 12". Nền tối mờ phẳng (bỏ blur: trên cửa sổ glass nhìn lởm chởm). Glass: `.service-msg` thành pill gọn.
- **Code block**: `lib/code.ts` (highlight.js core + 20 ngôn ngữ), `format.ts codeBlock()` → `.code-block` có nhãn ngôn ngữ + nút copy (click delegate ở `App.tsx`). Telegram đưa ngôn ngữ lên fence (`tg.rs` PreCode); Google Chat không có → auto-detect khi relevance ≥ 8 và ≥ 3 dòng. Màu token dùng `--purple/--green/--orange/--blue-2` của theme.
- **Thư mục** (`components/Folders.tsx`): state `folders: Folder[]` trong store, persist. Mỗi thư mục là 1 nhóm thu/mở trong sidebar dưới "Mới nhất", cùng kiểu header với nhóm tài khoản (chevron, chấm màu, icon emoji/ảnh/folder, badge, grip kéo đổi chỗ — Reorder axis y). Chuột phải header: đổi tên, màu (pop `color` + `onPick`), icon emoji (pop `emoji`), icon ảnh (`pickFile` → `img:<path>`), thư mục mới, xoá. Menu chat: "Thêm vào/Bỏ khỏi <thư mục>" (1 chat chỉ ở 1 thư mục), "Thư mục mới với hội thoại này…". Chat trong thư mục rời khỏi nhóm tài khoản (như Ghim), vẫn hiện ở "Mới nhất". Chưa có trên mobile. Lần đầu (2026-10-24) đã ghi sẵn 6 thư mục vào localStorage WebKit của bản macOS từ bảng `chats` (script tạm, backup ở scratchpad).
- **Search sidebar**: gõ lọc → mọi nhóm tài khoản/Ghim tự mở; bấm mới đóng.

## Lỗi còn mở — list giật khi gõ nháp dài (desktop, 2026-10-24)

Triệu chứng: nháp ≥ vài dòng (composer đã ở max 176px), mỗi phím list nhảy lên đúng 142px rồi tụt về đáy. Log `~/Library/Caches/com.chatmin.app/js.log` (các dòng `[scroll]`): sau khi composer 34→176 (ô chat 1002→860) thì `scrollTop` tự về 4825 = max của ô chat lúc còn 1002 — WebKit kẹp scrollTop trong nhịp layout mà textarea tạm về `height:auto` (1 dòng) để đo. Đã thử: (1) ô "đang gõ" cố định (`.typing-slot`), (2) bỏ delete `from_cache` của TDLib (đúng là lỗi thật, tin mới nhất từng nhấp nháy — đã sửa), (3) khoá chiều cao `.composer` khi đo (`83416a4`) — vẫn còn `unstick dist=142`. Hướng tiếp: đo bằng phần tử mirror ẩn (cùng font/width) thay vì đổi height textarea; hoặc lưu/khôi phục `scrollTop` của `.msgs` quanh phép đo; hoặc CSS `field-sizing: content` khi WKWebView hỗ trợ. Log chẩn đoán (`restick`/`resize`/`anchor`, throttle) vẫn bật trong `useStickyScroll.ts`.

## Desktop (2026-10-24 chiều) — ai react / ai đã xem, gửi văn bản thuần (CHƯA BUILD, CHƯA COMMIT)
- **Ai react / ai đã xem**: lệnh `msg_people` (lib.rs) → `tg.people` (getMessageAddedReactions + getMessageViewers; viewers chỉ có với tin mình gửi trong nhóm ≤ 100 người, chat 1-1 TDLib báo lỗi → rỗng, tick ✓✓ đã đủ) / `gchat.people` (GET …/reactions; Google Chat không có API "ai đã đọc" → `viewers` rỗng). UI (Message.tsx): rê chuột lên chip reaction → tooltip tên; rê lên ✓✓ → "Đã xem · tên…"; menu tin nhắn có "Ai đã xem / thả biểu cảm" (dùng cho phone, không có hover). Cache theo id + reactions + status (`peopleOf`).
- **Gửi văn bản thuần**: nút `Tx` (remove-formatting) cạnh nút ngôn ngữ, `plainSend` persisted. `send`/`edit` nhận `plain`: Telegram bỏ parseMarkdown (chỉ còn mention entities); Google Chat chèn U+200B sau `* _ ~ \`` (`tg::soft_markup`, bỏ qua `_` trong URL). `render()` (tg.rs) cũng chèn U+200B sau ký tự markup là chữ thường trong tin nhận về → `2*3*4` của người khác không còn in đậm. format.ts: marker + U+200B không thành markup; `plain()` bỏ U+200B. Test: `cargo test soft_markup`, `npm test`.
- Chưa test tooltip trong headless (Playwright không kích :hover cho tooltip của app); menu list + toggle + persist đã check qua demo.
- **Tin Google Chat đã xoá**: Google trả về (showDeleted=true) chỉ id + createTime, không sender/thread → từng hiện tombstone "?" ở list chính dù là reply trong thread. Giờ `Core::put_msg` gặp `deleted` → `delete_msgs` (ẩn như Google), `history`/`thread` lọc bỏ, store.rs xoá rows cũ lúc mở DB. Chưa chắc chắn: số "N trả lời" đôi khi thấp hơn Google vài tin (88 vs 92) — có thể do lag poll, chưa điều tra.
