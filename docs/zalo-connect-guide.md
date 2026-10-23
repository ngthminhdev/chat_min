# Test kết nối Zalo cá nhân

Probe độc lập bằng `zca-js@2.2.0`; chưa nối vào UI ChatMin.
Không gửi tin, không đánh dấu đã đọc, không tải danh bạ/lịch sử.
Chỉ gọi thông tin tài khoản để xác nhận login và nghe sự kiện trong thời gian giới hạn.

## Chuẩn bị

- Zalo trên điện thoại đang đăng nhập; nên dùng tài khoản thử nghiệm.
- Đóng các tab Zalo Web: thư viện chỉ hỗ trợ một web listener trên mỗi tài khoản.
- Đây là thư viện không chính thức, có rủi ro tài khoản bị hạn chế/khóa.
- Cần Node.js >=18 và dependencies trong `spike/` (`npm ci --ignore-scripts`).

## 1. Đăng nhập QR

Tại thư mục repository:

```sh
node spike/zalo-connect.mjs --qr --seconds=120
```

Khi có `qr_ready`, mở ảnh `spike/.secrets/zalo/login-qr.png`.
Dùng chức năng quét QR trong Zalo điện thoại, kiểm tra yêu cầu và xác nhận đăng nhập.
QR hết hạn sau khoảng 100 giây: chạy lại lệnh để có mã mới.

Các mốc cần thấy: `qr_scanned`, `profile_ok`, `session_saved`, `listener_connected`.
`listener_connected` chỉ chứng minh socket đã mở; chưa chứng minh nhận tin thật.

## 2. Kiểm tra nhận tin

Trong 120 giây nghe sự kiện, nhờ tài khoản khác gửi một tin vào tài khoản đang test.
Có thể thử cả DM và nhóm đã có sẵn. Script không tự gửi tin hay trả lời.
Log chỉ chứa thời gian, loại sự kiện, hướng tin, loại hội thoại và số lượng.
`message_received` với `outgoing: false` chứng minh nhận được sự kiện tin đến.

Kết thúc có `summary`. `realtimeMessageVerified: false` nghĩa là chưa nhận tin đến,
không đủ để kết luận realtime lỗi nếu chưa có người gửi tin trong khoảng nghe.
Exit 0 chứng minh có kết nối socket và không ghi nhận lỗi/ngắt trong cửa sổ quan sát;
không chứng minh đã nhận tin thật, lấy được lịch sử hay kết nối ổn định dài hạn.

## 3. Kiểm tra session sau khi tắt tiến trình

```sh
node spike/zalo-connect.mjs --resume --seconds=60
```

Cần thấy `login_start` với `saved_session`, `profile_ok`, `listener_connected` mà không quét QR.
Gửi thêm tin từ tài khoản khác để kiểm tra nhận realtime sau resume.
Nếu lỗi, script không tự đăng nhập QR lại để tránh che việc resume thất bại.

## Session và dừng test

Session lưu ở `spike/.secrets/zalo/session.json`, quyền file 0600/thư mục 0700,
đã được `.gitignore` bỏ qua. Đây là JSON chứa thông tin đăng nhập, chưa mã hóa at rest;
không gửi file này cho người khác. Script tắt logging của SDK và không in response/profile.
QR được xóa khi login thành công hoặc probe kết thúc bình thường. Ctrl+C để dừng.

Xóa session cục bộ:

```sh
rm -f spike/.secrets/zalo/session.json spike/.secrets/zalo/login-qr.png
```

Xóa file không thu hồi phiên phía Zalo. Để thu hồi, vào phần thiết bị/phiên đăng nhập
trong Zalo điện thoại và đăng xuất phiên web vừa tạo.

## Ngoài phạm vi test này

Gửi tin, danh sách hội thoại, lịch sử DM/nhóm, ảnh/file, reconnect dài hạn và sleep/wake
cần test riêng trước khi quyết định tích hợp vào ChatMin.

Nguồn: https://github.com/RFS-ADRENO/zca-js và ví dụ `examples/login.ts` trong repository đó.

## 4. Probe danh sách và lịch sử (đã chạy ngày 23/10/2026)

```sh
node spike/zalo-discovery.mjs
```

Không chạy đồng thời với `zalo-connect.mjs` hay Zalo Web. Probe dùng session đã có,
chỉ đọc tối đa 100 bạn bè ở trang 1, danh sách nhóm, hội thoại ghim, metadata của 2 nhóm,
10 tin lịch sử cho mỗi nhóm mẫu và tối đa 2 lượt yêu cầu tin cũ cho mỗi loại DM/nhóm.
Không in tên, ID, nội dung hay credential. Báo cáo chỉ chứa số lượng/trạng thái ở
`spike/zalo-discovery-result.json`. Exit 0 nghĩa là probe chạy hết, từng check có thể vẫn lỗi.

Kết quả thực tế đã lặp lại để xác nhận:

| Hạng mục | Kết quả |
|---|---|
| Session login | Thành công |
| Trang bạn bè mẫu | 100 bản ghi; đây không phải tổng số bạn hay danh sách hội thoại |
| Danh sách nhóm | 63 nhóm |
| Hội thoại ghim | 2; không phải toàn bộ inbox |
| Metadata nhóm mẫu | Thành công cho 2 nhóm |
| REST lịch sử nhóm | HTTP 404 ở cả 2 nhóm mẫu qua `getGroupChatHistory` |
| WebSocket handshake | Thành công, nhận cipher key (không ghi giá trị key) |
| WebSocket tin cũ cá nhân | 2 tin duy nhất, 1 hội thoại, cả 2 là outgoing |
| Lượt phân trang cá nhân thứ hai | 1 tin trùng, không bổ sung tin mới |
| WebSocket tin cũ nhóm | Phản hồi rỗng |

`requestOldMessages(ThreadType.User, lastMsgId)` có trả dữ liệu thực tế, nên không thể
kết luận thư viện hoàn toàn không có khả năng đọc tin cũ cá nhân. Tuy nhiên phương thức
này không nhận chat ID; kết quả hiện tại chưa chứng minh tải lịch sử tùy ý theo chat,
phân trang đầy đủ hoặc phục hồi toàn bộ inbox.

HTTP 404 được xác nhận từ lỗi phản hồi HTTP trong SDK, không phải do bước chuẩn hóa
message của probe. Chưa xác định endpoint này bị ngừng chung hay phụ thuộc service host/
phiên bản/tài khoản; không đổi endpoint hoặc patch thư viện khi chưa có thêm bằng chứng.

Hướng MVP khả thi để đánh giá tiếp: danh bạ/nhóm + cache tin nhận từ thời điểm kết nối,
đối soát tin cũ ở mức server trả về. Chỉ quảng bá khả năng đồng bộ lịch sử đầy đủ sau khi
có bằng chứng. Bước test tiếp theo có thể là gửi một tin đến Cloud của tôi hoặc một
hội thoại do người dùng chọn; cần chỉ định đích và nội dung trước khi thực hiện gửi.
