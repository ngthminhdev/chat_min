# UI/UX motion polish — kết quả sửa ngày 23/10/2026

Đã triển khai các thay đổi cần thiết từ [audit](2026-10-23-ui-ux-motion-audit.md) theo yêu cầu người dùng. Dựa trên source hiện tại ở `61c7a73`; audit ban đầu được ghi tại `b310a2c`. Giữ theme và stack hiện có, không thêm dependency, không commit/push. Messenger/Zalo không thuộc phạm vi.

## Những gì đã sửa

| Audit | Kết quả |
|---|---|
| M01 · Typing | Component dùng chung cho sidebar và timeline. Chữ đứng yên, ba chấm nhô lên 2px, lệch pha 120ms, vòng 1,1s. Preview chuyển trạng thái bằng fade ngắn trong cùng hàng; reduced-motion giữ chấm tĩnh. |
| M02 · ACK bubble | Thêm identity hiển thị UI-only, bảo toàn khi local → provider ID → final ID. Reconcile event/response loại bản ghi trùng khi biết mapping; không làm bubble đổi React key sau ACK. Provider ID vẫn dùng cho API, reply/edit/delete. |
| M03 · Reopen | Theo dõi arrival riêng trong message list đang mount. History và tin đã có khi quay lại hiển thị ngay. Không xoá `fresh` đang phục vụ thread unread. Chỉ bubble mới thực sự dùng motion wrapper; history vẫn dùng div thường. |
| M04 · Scroll | Native smooth-scroll giữ quyền điều khiển viewport tới khi kết thúc hoặc bị người dùng huỷ. Sticky restore không ghi đè giữa chừng. Có scrollend và debounce fallback cho WebView cũ. Nhảy notification về newest vẫn tức thì. |
| M05 · Reduced motion | Cả jump-to-message/quote và jump-bottom dùng helper chọn auto/smooth theo media preference. Normal chat và thread dùng cùng cơ chế. Vùng dịch dùng duration 0 khi giảm chuyển động. |
| M06 · Reaction | Transition màu 100ms, press nhẹ trên emoji, chip có vùng bấm cao tối thiểu 26px. Có exit cho từng chip và cả trường hợp xoá reaction cuối; không bật layout animation toàn hàng. |
| M07 · Unread badge | Không nảy khi chỉ mount history/mở section. Chỉ count tăng trên hàng đã hiển thị mới nhận nhấn nhẹ, giảm biên độ và thời gian so với trước. |
| M08 · Translation | Presence boundary ổn định, đóng 100ms trước khi tháo DOM; collapse cả padding/margin/border để tránh bước nhảy còn lại. |
| M09 · Loading | Chỉ hiện spinner sau 140ms nếu vẫn đang tải, không trì hoãn nội dung. Áp dụng normal chat và placeholder thread/topic. |
| M10 · Toast | Lifetime do item quản lý, lỗi có ít nhất 8s đọc; nội dung dài được thêm thời gian, giới hạn tối đa 10s. Pause khi hover/focus, có dismiss/Escape và trả focus. Stack tối đa ba; success không đẩy mất error đang hiện. |
| M11 · Tabs | Roving tabindex, ArrowLeft/Right/Home/End, giữ focus trên thanh tab sau điều hướng. Delete đóng tab đang focus, nút đóng trả focus tới tab kế cận hoặc nút mở chat. Giữ shortcut toàn app hiện có. |
| M12 · Hover preview | Chỉ khởi động từ pointer movement có chủ ý. Kiểm tra lại hover, vị trí hàng, focus và overlay trước khi mở. Huỷ timer/popup khi scroll, navigation, chat reorder/update, thay filter/section, resize hoặc blur. |

## Bằng chứng kiểm tra

### Test hồi quy

Thêm test có bước RED trước khi sửa logic, sau đó GREEN:

- Local → server ACK giữ cùng render identity.
- Native echo đến trước response được reconcile về một bản ghi, không hạ trạng thái seen về sent.
- Chuỗi provider ID-change và edit giữ identity.
- Response trễ không phục hồi provider ID đã bị thay.
- Native ID-change hoàn tất trước send response trong khi local bubble vẫn pending.
- Success không loại error khỏi stack đầy; burst error vẫn bounded và giữ các lỗi mới nhất.

`npm test`: **18/18 pass** sau cùng. `npm run build`: TypeScript và Vite pass. Build có warning static/dynamic import của `bridge.ts` và chunk JavaScript lớn hơn 500kB; không thay đổi cấu trúc bundle trong đợt polish này. `git diff --check` pass.

### Browser / component fixture

Dùng các component và hook thật, dữ liệu demo/fixture trong bộ nhớ; không gọi provider hoặc gửi tin cho tài khoản thật. Fixture tạm đã được xoá sau kiểm tra.

- **Tái hiện scroll trước sửa:** danh sách 80 hàng, cuộn xa đáy, thêm tin, bấm xuống newest. Ở frame đầu, tỉ lệ quãng đường đã đi = **1**: nhảy hết quãng đường ngay.
- **Sau sửa:** cùng kịch bản, tỉ lệ frame đầu = **0**: native smooth-scroll được bắt đầu tại vị trí hiện tại thay vì bị restore ép xuống đáy. Đây là kiểm tra hồi quy, không phải benchmark FPS.
- Jump-to-message kết thúc tại tin giữa lịch sử. Khi tăng chiều cao nội dung phía trên thêm 70px, toạ độ Y của tin được theo dõi giữ nguyên **261.875px**.
- Wheel huỷ được smooth-scroll. Thêm tin sau khi huỷ giữ scrollTop **1882.5px**, đồng thời tăng “tin mới” lên 1, không kéo viewport về đáy.
- **Stable DOM:** sau Add pending → Confirm ACK, node bubble trước/sau giống nhau (`Same bubble after ACK: true`); số entrance giữ ở **1**. Rời chat rồi quay lại qua ArrowRight/Left không làm số entrance tăng.
- Typing có animation `typing-hop`, delays 0/0.12/0.24s; các chấm có transform Y khác nhau trong cùng lần lấy mẫu. Badge lịch sử có animation `none`.
- Tab arrow chọn đúng chat, focus vẫn nằm trên tab; tabIndex lần lượt là -1/0/-1 khi tab giữa được chọn.
- Khi ẩn bản dịch và xoá reaction cuối, node vẫn còn trong frame exit đầu, sau settle mới biến mất.
- Toast được focus vẫn còn sau **8.5s**; Escape đóng toast và trả focus về composer.
- Reduced-motion fixture giả lập media preference cho JS và tắt CSS animation/transition: helper trả `auto`; typing dots có animation/transform `none`. Đây không phải kiểm tra OS/native media preference.
- Iframe viewport **390px**: document/fixture/composer đều rộng 390px, không có overflow ngang ở document trong cấu hình rail collapsed. Không khẳng định toàn bộ giao diện mobile đã được audit lại.
- Smoke test app đầy đủ: sidebar, chuyển chat, composer và chuỗi gửi/nhận demo hoạt động; nhận “Ok em 👍”, không xuất hiện error boundary.
- Independent code review tìm ra trường hợp last reaction unmount presence quá sớm; đã sửa và xác nhận bằng browser. Lượt review cuối không còn phát hiện cần xử lý trong các thay đổi được rà.

Ảnh fixture sau sửa (dữ liệu kiểm thử):

`/Users/qc-bright/.codex/visualizations/2026/10/23/01a1693e-7daf-7fc0-bb40-d0e9d366db80/chatmin-motion-after.png`

## Giới hạn còn lại

- Chưa rebuild hoặc kiểm tra native Tauri/WKWebView với tài khoản thật; chưa profile frame time/FPS. Không suy ra native đạt 60fps từ screenshot hoặc Chromium fixture.
- **Native pre-ACK echo:** test đảm bảo reconcile đúng khi mapping ID đã về. Generic native message event hiện chưa mang correlation với local optimistic send; nếu echo đến trước response, vẫn có khả năng tồn tại cả hai hàng trong khoảng ngắn trước khi reconcile. Đây là hành vi sẵn có; đợt này không sửa backend hoặc ghép message theo text vì có thể ghép nhầm hai lần gửi giống nhau. Không khẳng định đường native này hoàn toàn không có duplicate tạm thời.
- Không rà lại 29 theme, all media/provider permutations, hay hiệu năng danh sách cực dài trong đợt này.

Source, test và tài liệu được để uncommitted để người dùng kiểm tra. Giữ nguyên file untracked có sẵn `docs/audits/message-search-mobile.png`.
