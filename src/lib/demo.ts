// In-memory backend for `vite` in a plain browser: the prototype's sample data behind the
// same commands as Rust, so the UI can be reviewed without real accounts. Never bundled
// into the Tauri app path (bridge.ts only imports it outside Tauri).
import type { Account, AppState, Chat, CoreEvent, Member, Msg } from "./types";

const listeners = new Set<(e: CoreEvent) => void>();
const emit = (e: CoreEvent) => listeners.forEach((l) => l(e));
export function onEvent(cb: (e: CoreEvent) => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

const at = (daysAgo: number, hhmm: string) => {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  const [h, m] = hhmm.split(":").map(Number);
  d.setHours(h, m, 0, 0);
  return d.getTime();
};

const accounts: Account[] = [
  { id: "tg-demo", platform: "telegram", name: "Cá nhân", color: "blue", handle: "+84 90 ••• 2468", selfId: "1" },
  { id: "gc-demo", platform: "gchat", name: "QC Corp", color: "purple", handle: "trivo@qccorp.io", selfId: "users/1" },
];

const chat = (c: Partial<Chat> & Pick<Chat, "accountId" | "id" | "kind" | "title">): Chat => ({
  description: "", lastTs: 0, preview: "", previewFrom: "", unread: 0, mention: false, muted: false, memberCount: 0,
  order: 0, pinned: false, canSend: true, threaded: false, created: "", photo: "", photoRef: "", ...c,
});

let seq = 0;
const msgs: Record<string, Msg[]> = {};
function m(accountId: string, chatId: string, from: string, ts: number, text: string, extra: Partial<Msg> = {}): Msg {
  const id = accountId === "tg-demo" ? String(++seq * 1048576) : `${chatId}/messages/m${++seq}`;
  const msg: Msg = {
    accountId, chatId, id, sort: accountId === "tg-demo" ? seq * 1048576 : ts, senderId: from, senderName: from === "me" ? "Trí Võ" : from, senderPhoto: "",
    outgoing: from === "me", ts, edited: false, deleted: false, kind: "text", text, media: null, link: null, replyTo: "", replyName: "",
    replyText: "", reactions: [], threadId: "", threadReply: false, status: from === "me" ? "seen" : "", error: "", pinned: false,
    mentionsMe: false, rev: "", ...extra,
  };
  (msgs[`${accountId}|${chatId}`] ??= []).push(msg);
  return msg;
}
const reply = (to: Msg): Partial<Msg> => ({ replyTo: to.id, replyName: to.outgoing ? "Bạn" : to.senderName, replyText: to.text.replace(/[`@{}]/g, "") });
const file = (name: string, size: number): Partial<Msg> => ({
  kind: "media", media: { kind: "file", name, size, mime: "", width: 0, height: 0, fileRef: "f", localPath: "", thumb: "", url: "" },
});

// ── Telegram · Cá nhân
const T = "tg-demo";
const pr = m(T, "-1001839204417", "Huy Đặng", at(1, "17:43"), "Ai review giúp PR này với, migration budgets thêm cột `rollover_cents` nha", {
  link: { site: "github.com", title: "feat(budgets): support monthly rollover #318", desc: "Adds rollover_cents to budgets, backfills from transactions, guarded by BUDGET_ROLLOVER flag.", url: "https://github.com/minewallet/api/pull/318" },
});
m(T, "-1001839204417", "me", at(1, "18:05"), "Mình xem rồi, ổn. Có 1 chỗ backfill nên chạy theo batch 5k rows, tránh lock bảng `transactions` lâu", { reactions: [{ emoji: "👍", count: 2, mine: false }], pinned: true, ...reply(pr) });
m(T, "-1001839204417", "Linh Nguyễn", at(1, "18:20"), "Ok merge sau khi CI xanh. Mai Anh test lại flow tạo budget trên staging giúp chị nhé", { edited: true, reactions: [{ emoji: "🫡", count: 1, mine: false }] });
m(T, "-1001839204417", "Mai Anh Trịnh", at(0, "09:12"), "", file("budget-rollover-testcases.xlsx", 48_000));
m(T, "-1001839204417", "Mai Anh Trịnh", at(0, "09:12"), "Có 2 case fail khi đổi timezone sang UTC+7 vào ngày cuối tháng, chi tiết ở sheet thứ 2 ạ");
const pprof = m(T, "-1001839204417", "Quân Lê", at(0, "09:30"), "CPU profile của job weekly report. `json.Marshal` chiếm phần lớn thời gian, nghi do reflect trên slice `[]Transaction` lớn", file("pprof-weekly-report-2026-10-22.pb.gz", 2_300_000));
const mine = m(T, "-1001839204417", "me", at(0, "09:41"), "Thử cache encoder theo struct trước, hoặc gen bằng easyjson. Đừng đổi sang lib JSON khác vội", reply(pprof));
m(T, "-1001839204417", "me", at(0, "09:44"), "Dashboard latency đây: https://grafana.qccorp.io/d/api-latency?var-svc=report-worker", { status: "failed", error: "Không gửi được — mất kết nối tới Telegram" });
m(T, "-1001839204417", "Linh Nguyễn", at(0, "10:02"), "Đồng ý với Trí, profile lại với GOGC=200 trước đã. Nếu vẫn vậy thì gen encoder.", { reactions: [{ emoji: "💯", count: 1, mine: false }], ...reply(mine) });
m(T, "-1001839204417", "Huy Đặng", at(0, "10:05"), "Kế hoạch deploy thứ Sáu nhé mọi người:\n\n1) 14:00 freeze nhánh main, chỉ nhận hotfix có ticket. 2) 14:30 chạy migration `0042_budget_rollover` trên staging. 3) 16:00 deploy prod theo canary 10% → 50% → 100%, mỗi bước theo dõi 15 phút trên Grafana.\n\nAi thấy thiếu gì thì bổ sung trước 12h mai.");
m(T, "-1001839204417", "Huy Đặng", at(0, "10:06"), "@{Trí Võ} check giúp anh phần rollback nhé, nhất là bước tắt flag", { mentionsMe: true });
m(T, "-1001839204417", "Mai Anh Trịnh", at(0, "10:11"), "Staging đang trả 502 ở /v1/budgets, có ai vừa đụng gì không ạ 😅");

m(T, "-1002214558830", "Tuấn Bùi", at(0, "08:02"), "Điểm tập trung: bờ Hồ, đối diện Tháp Rùa, 4h45 sáng thứ Bảy. Xe 16 chỗ đón ở đó luôn");
m(T, "-1002214558830", "Tuấn Bùi", at(0, "08:03"), "Bài hôm nay nhé mọi người\n```cpp\nclass Solution {\npublic:\n    static constexpr int dayPassed[] = {0, 0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334};\n\n    int convert(string& date) {\n        int month = (date[0] - '0') * 10 + date[1] - '0';\n        return dayPassed[month] + (date[3] - '0') * 10 + date[4] - '0'; // 1-based\n    }\n};\n```");
m(T, "-1002214558830", "Hà My", at(0, "08:10"), "Mọi người chuyển quỹ 1.500.000đ trước thứ Hai nha, ai chuyển rồi thả tim giúp em", { reactions: [{ emoji: "❤️", count: 6, mine: true }] });
m(T, "-1002214558830", "me", at(0, "08:15"), "Đã chuyển nha My");
m(T, "-1002214558830", "Duy Phạm", at(0, "09:58"), "Homestay ở Đồng Văn còn 2 phòng thôi, chốt luôn không mọi người?");
// media: an inline SVG "photo" and a video poster, so the phone layout can be checked offline
m(T, "-1002214558830", "Duy Phạm", at(0, "09:59"), "", { kind: "media", albumId: "a1", media: { kind: "image", name: "IMG_2041.jpg", size: 1_840_000, mime: "image/jpeg", width: 1200, height: 800, fileRef: "f", localPath: "data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A//www.w3.org/2000/svg%22%20viewBox%3D%220%200%201200%20800%22%3E%3Cdefs%3E%3ClinearGradient%20id%3D%22g%22%20x1%3D%220%22%20y1%3D%220%22%20x2%3D%220%22%20y2%3D%221%22%3E%3Cstop%20offset%3D%220%22%20stop-color%3D%22%234a8fd8%22/%3E%3Cstop%20offset%3D%221%22%20stop-color%3D%22%23dbe9f7%22/%3E%3C/linearGradient%3E%3C/defs%3E%3Crect%20width%3D%221200%22%20height%3D%22800%22%20fill%3D%22url%28%23g%29%22/%3E%3Cpath%20d%3D%22M0%20620%20L260%20380%20L420%20500%20L640%20300%20L860%20520%20L1000%20420%20L1200%20560%20L1200%20800%20L0%20800Z%22%20fill%3D%22%231d2a3a%22/%3E%3Ccircle%20cx%3D%22930%22%20cy%3D%22190%22%20r%3D%2270%22%20fill%3D%22%23f6d365%22/%3E%3Ctext%20x%3D%2240%22%20y%3D%22760%22%20font-family%3D%22sans-serif%22%20font-size%3D%2240%22%20fill%3D%22%23fff%22%20opacity%3D%22.7%22%3E%C4%90%C3%A8o%20M%C3%A3%20P%C3%AD%20L%C3%A8ng%3C/text%3E%3C/svg%3E", thumb: "", url: "" } });
m(T, "-1002214558830", "Duy Phạm", at(0, "09:59") + 1000, "", { kind: "media", albumId: "a1", media: { kind: "image", name: "IMG_2042.jpg", size: 1_840_000, mime: "image/jpeg", width: 1200, height: 800, fileRef: "f", localPath: "data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A//www.w3.org/2000/svg%22%20viewBox%3D%220%200%201200%20800%22%3E%3Cdefs%3E%3ClinearGradient%20id%3D%22g%22%20x1%3D%220%22%20y1%3D%220%22%20x2%3D%220%22%20y2%3D%221%22%3E%3Cstop%20offset%3D%220%22%20stop-color%3D%22%234a8fd8%22/%3E%3Cstop%20offset%3D%221%22%20stop-color%3D%22%23dbe9f7%22/%3E%3C/linearGradient%3E%3C/defs%3E%3Crect%20width%3D%221200%22%20height%3D%22800%22%20fill%3D%22url%28%23g%29%22/%3E%3Cpath%20d%3D%22M0%20620%20L260%20380%20L420%20500%20L640%20300%20L860%20520%20L1000%20420%20L1200%20560%20L1200%20800%20L0%20800Z%22%20fill%3D%22%231d2a3a%22/%3E%3Ccircle%20cx%3D%22930%22%20cy%3D%22190%22%20r%3D%2270%22%20fill%3D%22%23f6d365%22/%3E%3Ctext%20x%3D%2240%22%20y%3D%22760%22%20font-family%3D%22sans-serif%22%20font-size%3D%2240%22%20fill%3D%22%23fff%22%20opacity%3D%22.7%22%3E%C4%90%C3%A8o%20M%C3%A3%20P%C3%AD%20L%C3%A8ng%3C/text%3E%3C/svg%3E", thumb: "", url: "" } });
m(T, "-1002214558830", "Duy Phạm", at(0, "09:59") + 2000, "3 tấm đèo nè", { kind: "media", albumId: "a1", media: { kind: "image", name: "IMG_2043.jpg", size: 1_840_000, mime: "image/jpeg", width: 1200, height: 800, fileRef: "f", localPath: "data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A//www.w3.org/2000/svg%22%20viewBox%3D%220%200%201200%20800%22%3E%3Cdefs%3E%3ClinearGradient%20id%3D%22g%22%20x1%3D%220%22%20y1%3D%220%22%20x2%3D%220%22%20y2%3D%221%22%3E%3Cstop%20offset%3D%220%22%20stop-color%3D%22%234a8fd8%22/%3E%3Cstop%20offset%3D%221%22%20stop-color%3D%22%23dbe9f7%22/%3E%3C/linearGradient%3E%3C/defs%3E%3Crect%20width%3D%221200%22%20height%3D%22800%22%20fill%3D%22url%28%23g%29%22/%3E%3Cpath%20d%3D%22M0%20620%20L260%20380%20L420%20500%20L640%20300%20L860%20520%20L1000%20420%20L1200%20560%20L1200%20800%20L0%20800Z%22%20fill%3D%22%231d2a3a%22/%3E%3Ccircle%20cx%3D%22930%22%20cy%3D%22190%22%20r%3D%2270%22%20fill%3D%22%23f6d365%22/%3E%3Ctext%20x%3D%2240%22%20y%3D%22760%22%20font-family%3D%22sans-serif%22%20font-size%3D%2240%22%20fill%3D%22%23fff%22%20opacity%3D%22.7%22%3E%C4%90%C3%A8o%20M%C3%A3%20P%C3%AD%20L%C3%A8ng%3C/text%3E%3C/svg%3E", thumb: "", url: "" } });
m(T, "-1002214558830", "me", at(0, "09:59") + 20000, "", { kind: "media", media: { kind: "image", name: "IMG_2050.jpg", size: 1_840_000, mime: "image/jpeg", width: 800, height: 1700, fileRef: "f", localPath: "data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A//www.w3.org/2000/svg%22%20viewBox%3D%220%200%201200%20800%22%20preserveAspectRatio%3D%22none%22%3E%3Cdefs%3E%3ClinearGradient%20id%3D%22g%22%20x1%3D%220%22%20y1%3D%220%22%20x2%3D%220%22%20y2%3D%221%22%3E%3Cstop%20offset%3D%220%22%20stop-color%3D%22%234a8fd8%22/%3E%3Cstop%20offset%3D%221%22%20stop-color%3D%22%23dbe9f7%22/%3E%3C/linearGradient%3E%3C/defs%3E%3Crect%20width%3D%221200%22%20height%3D%22800%22%20fill%3D%22url%28%23g%29%22/%3E%3Cpath%20d%3D%22M0%20620%20L260%20380%20L420%20500%20L640%20300%20L860%20520%20L1000%20420%20L1200%20560%20L1200%20800%20L0%20800Z%22%20fill%3D%22%231d2a3a%22/%3E%3Ccircle%20cx%3D%22930%22%20cy%3D%22190%22%20r%3D%2270%22%20fill%3D%22%23f6d365%22/%3E%3Ctext%20x%3D%2240%22%20y%3D%22760%22%20font-family%3D%22sans-serif%22%20font-size%3D%2240%22%20fill%3D%22%23fff%22%20opacity%3D%22.7%22%3E%C4%90%C3%A8o%20M%C3%A3%20P%C3%AD%20L%C3%A8ng%3C/text%3E%3C/svg%3E", thumb: "", url: "" } });
m(T, "-1002214558830", "Duy Phạm", at(0, "10:00"), "View từ homestay nè, chốt chưa 😍", { kind: "media", media: { kind: "video", name: "flycam.mp4", size: 24_500_000, mime: "video/mp4", width: 1200, height: 800, fileRef: "", localPath: "", thumb: "data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A//www.w3.org/2000/svg%22%20viewBox%3D%220%200%201200%20800%22%3E%3Cdefs%3E%3ClinearGradient%20id%3D%22g%22%20x1%3D%220%22%20y1%3D%220%22%20x2%3D%220%22%20y2%3D%221%22%3E%3Cstop%20offset%3D%220%22%20stop-color%3D%22%236b4f8a%22/%3E%3Cstop%20offset%3D%221%22%20stop-color%3D%22%232a2440%22/%3E%3C/linearGradient%3E%3C/defs%3E%3Crect%20width%3D%221200%22%20height%3D%22800%22%20fill%3D%22url%28%23g%29%22/%3E%3Cpath%20d%3D%22M0%20620%20L260%20380%20L420%20500%20L640%20300%20L860%20520%20L1000%20420%20L1200%20560%20L1200%20800%20L0%20800Z%22%20fill%3D%22%231d2a3a%22/%3E%3Ccircle%20cx%3D%22930%22%20cy%3D%22190%22%20r%3D%2270%22%20fill%3D%22%23f6d365%22/%3E%3Ctext%20x%3D%2240%22%20y%3D%22760%22%20font-family%3D%22sans-serif%22%20font-size%3D%2240%22%20fill%3D%22%23fff%22%20opacity%3D%22.7%22%3EFlycam%20%C4%90%E1%BB%93ng%20V%C4%83n%3C/text%3E%3C/svg%3E", url: "" } });
m(T, "402918331", "Linh Nguyễn", at(0, "09:05"), "Chiều nay 1:1 dời sang 16h được không em?");
m(T, "402918331", "me", at(0, "09:07"), "Được chị");
m(T, "188230017", "Mẹ", at(1, "20:31"), "Cuối tuần về ăn cơm không con");
m(T, "188230017", "me", at(1, "20:40"), "Dạ chủ nhật con về ạ", { reactions: [{ emoji: "❤️", count: 1, mine: false }] });
m(T, "-1001120457788", "Kenji Watanabe", at(0, "10:09"), "Anyone tried the new iterator funcs in prod yet? Curious about allocation behavior with range-over-func.");
m(T, "-1001120457788", "Phong Vũ", at(0, "10:12"), "Bên mình dùng cho stream đọc từ Kafka, ổn, nhưng nhớ benchmark trước nha");

// ── Google Chat · QC Corp
const G = "gc-demo";
const rot = m(G, "spaces/AAAA8xQm2Lk", "Sarah Chen", at(0, "08:55"), "Heads-up: rotating the staging Postgres credentials at 14:00 ICT. Services pulling from Vault pick it up automatically; anything with a hard-coded DSN will break.", { reactions: [{ emoji: "👀", count: 4, mine: false }], threadId: "spaces/AAAA8xQm2Lk/threads/t1" });
m(G, "spaces/AAAA8xQm2Lk", "Sarah Chen", at(0, "08:56"), "Config mới cho staging:\n```\n{\n  \"db\": { \"host\": \"pg-staging.internal\", \"port\": 5432, \"ssl\": true },\n  \"pool\": { \"min\": 2, \"max\": 10 },\n  \"rotateEvery\": \"30d\"\n}\n```");
m(G, "spaces/AAAA8xQm2Lk", "Minh Trần", at(0, "09:02"), "payments-worker vẫn đọc DSN từ env file, em chuyển sang Vault agent trước 13h ạ", { threadId: rot.threadId, threadReply: true });
m(G, "spaces/AAAA8xQm2Lk", "Sarah Chen", at(0, "09:05"), "Thanks Minh 🙏", { threadId: rot.threadId, threadReply: true });
m(G, "spaces/AAAA8xQm2Lk", "me", at(0, "09:20"), "Build Tools pipeline đã đọc từ Vault rồi, không ảnh hưởng.", { threadId: rot.threadId, threadReply: true, status: "sent" });
m(G, "spaces/AAAA8xQm2Lk", "Đức Hoàng", at(0, "09:40"), "Consumer lag on `ledger-events` is back under 2k after the partition bump. Closing INC-4821.", { reactions: [{ emoji: "✅", count: 6, mine: false }], threadId: "spaces/AAAA8xQm2Lk/threads/t2" });
m(G, "spaces/AAAA8xQm2Lk", "Lan Phạm", at(0, "10:20"), "@{Trí Võ} can you own the Loki retention change? Debug logs 30d → 14d, info stays 30d.", { mentionsMe: true, threadId: "spaces/AAAA8xQm2Lk/threads/t3" });
m(G, "spaces/AAAA8xQm2Lk", "Sarah Chen", at(0, "10:24"), "RFC for the Promtail → Grafana Alloy migration is up, comments by Monday please: [RFC-112](https://docs.google.com/document/d/rfc-112)", { threadId: "spaces/AAAA8xQm2Lk/threads/t4" });
const dmRoot = m(G, "spaces/AAAAm1nhTr4", "Minh Trần", at(0, "09:10"), "Anh ơi, Vault agent sidecar có cần thêm policy cho namespace payments không ạ?", {threadId:"spaces/AAAAm1nhTr4/threads/policy"});
m(G, "spaces/AAAAm1nhTr4", "me", at(0, "09:16"), "Cần, copy policy của ledger-svc rồi đổi path là được", { status: "sent", replyTo:dmRoot.id, threadId:"spaces/AAAAm1nhTr4/threads/answer" });
m(G, "spaces/AAAAm1nhTr4", "Minh Trần", at(0, "09:18"), "Em cập nhật policy rồi ạ", {threadId:dmRoot.threadId,threadReply:true});
m(G, "spaces/AAAAr3lQ4tr", "Đức Hoàng", at(1, "16:00"), "Go/no-go for v4.18 is Friday 15:30. Checklist link in the pinned message.");
m(G, "spaces/AAAAaLlh4nD", "Lan Phạm", at(0, "08:30"), "Văn phòng tầng 12 bảo trì điều hoà sáng thứ Bảy 24/10, mọi người mang laptop về nhé.");

// forum topics of Vietnam Gophers
const GO = "-1001120457788";
const topics = [
  { id: "1", name: "General", color: 0x6fb9f0, unread: 0, mention: false, pinned: true, closed: false, general: true },
  { id: "7", name: "Hỏi đáp", color: 0xffd67e, unread: 12, mention: true, pinned: false, closed: false, general: false },
  { id: "12", name: "Việc làm", color: 0x8eee98, unread: 3, mention: false, pinned: false, closed: false, general: false },
  { id: "19", name: "Show & tell", color: 0xff93b2, unread: 0, mention: false, pinned: false, closed: true, general: false },
];
for (const [t, who, hhmm, text] of [
  ["7", "An Phạm", "08:10", "Ai dùng sqlc với pgx v5 rồi cho hỏi transaction nested xử lý sao ạ?"],
  ["7", "Bảo Lê", "08:14", "Dùng `pgx.BeginFunc` rồi truyền `Queries.WithTx(tx)` là gọn nhất."],
  ["7", "me", "08:20", "Mình thêm: nhớ set `default_query_exec_mode` nếu đi qua pgbouncer."],
  ["12", "HR Tiki", "09:02", "[Tuyển] Senior Go Engineer — remote, 3.5–5k USD. Inbox mình nhé."],
  ["1", "Admin", "07:00", "Chào mừng 12 thành viên mới tuần này 👋"],
] as const) m(T, GO, who, at(0, hhmm), text, { threadId: t });

const chats: Chat[] = [
  chat({ accountId: T, id: "-1001839204417", kind: "group", title: "Backend Go — Mine Wallet", pinned: true, memberCount: 12, unread: 4, mention: true, description: "Team backend Mine Wallet: Go/Gin, PostgreSQL, Redis. PR review, deploy staging, incident.", created: "03/2024" }),
  chat({ accountId: T, id: "-1002214558830", kind: "group", title: "Hội anh em đi Hà Giang tháng 11 — chốt lịch, chốt xe, chốt homestay nhé mọi người", memberCount: 9, unread: 23, description: "Đi 4 ngày 3 đêm, xuất phát sáng thứ Bảy 14/11." }),
  chat({ accountId: T, id: "402918331", kind: "dm", title: "Linh Nguyễn" }),
  chat({ accountId: T, id: "-1001120457788", kind: "group", title: "Vietnam Gophers", memberCount: 2847, muted: true, unread: 128, forum: true, description: "Cộng đồng Go tại Việt Nam." }),
  chat({ accountId: T, id: "188230017", kind: "dm", title: "Mẹ" }),
  chat({ accountId: T, id: "5530021984", kind: "dm", title: "Duy Phạm" }),
  chat({ accountId: G, id: "spaces/AAAA8xQm2Lk", kind: "space", title: "eng-platform", memberCount: 48, unread: 7, mention: true, threaded: true, description: "Platform engineering: infra, CI/CD, observability (Loki, Prometheus, Grafana), Kafka, Postgres.", created: "01/2025" }),
  chat({ accountId: G, id: "spaces/AAAAm1nhTr4", kind: "dm", title: "Minh Trần", threaded:true }),
  chat({ accountId: G, id: "spaces/AAAAr3lQ4tr", kind: "space", title: "release-train-2026-q4", memberCount: 23, threaded: true, created: "10/2026" }),
  chat({ accountId: G, id: "spaces/AAAAaLlh4nD", kind: "space", title: "all-hands-announcements", memberCount: 312, muted: true, unread: 2, threaded: true, created: "02/2023" }),
];
chats.forEach((c, i) => {
  const list = (msgs[`${c.accountId}|${c.id}`] ?? []).filter((x) => !x.threadReply);
  const last = list[list.length - 1];
  if (last) {
    c.lastTs = last.ts;
    c.preview = last.text.replace(/[`{}]/g, "").replace(/\[([^\]]+)\]\([^)]+\)/g, "$1") || last.media?.name || "";
    c.previewFrom = last.outgoing ? "Bạn" : last.senderName.split(" ")[0];
  }
  c.order = 100 - i;
});

const health = { "tg-demo": { health: "ok" as const, text: "", until: 0 }, "gc-demo": { health: "ok" as const, text: "", until: 0 } };
const ai = { format: "openai", endpoint: "https://openrouter.ai/api/v1", model: "anthropic/claude-haiku", guide: "" };
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const k = (a: unknown, c: unknown) => `${a}|${c}`;

export async function call(cmd: string, a: Record<string, any>): Promise<unknown> {
  switch (cmd) {
    case "app_state": {
      const empty = new URLSearchParams(location.search).has("empty");
      return { accounts: empty ? [] : accounts, health, chats: empty ? [] : chats, tgConfigured: true, gchatConfigured: true, mutedThreads: [] } satisfies AppState;
    }
    case "messages": {
      await wait(250);
      const list = msgs[k(a.accountId, a.chatId)] ?? [];
      const older = a.before ? list.filter((x) => x.sort < a.before) : list;
      return older.slice(-a.limit);
    }
    case "cached_messages":
      return [[], []];
    case "thread_mute":
      return;
    case "storage":
      return { downloadDir: "~/Downloads/ChatMin", cacheMb: 2048, keepDays: 30, tgBytes: 1.3e9, localBytes: 188e6 };
    case "storage_set":
      return;
    case "storage_clean":
      return 0;
    case "inbox": {
      const dm = new Set(chats.filter((c) => c.kind === "dm").map((c) => k(c.accountId, c.id)));
      return Object.entries(msgs).flatMap(([key, l]) => l.filter((x) => !x.outgoing && (x.mentionsMe || dm.has(key))))
        .sort((x, y) => y.ts - x.ts).slice(0, a.limit);
    }
    case "reactions":
      return null;
    case "web_show":
    case "web_hide":
    case "web_reload":
      return;
    case "web_add":
      throw new Error("Messenger / Zalo chỉ chạy trong app ChatMin, không có trong bản demo trình duyệt");
    case "stickers":
      return [{ id: "recent", title: "Gần đây", stickers: ["👍", "😂", "🔥", "🙏", "🎉", "😅", "🫡", "❤️", "👀", "🤝"].map((e, i) => ({ id: i + 1, thumb: "", thumbKind: "img", emoji: e, width: 512, height: 512 })) }];
    case "send_sticker":
      return call("send", { accountId: a.accountId, chatId: a.chatId, text: a.emoji });
    case "save_temp":
      return `/tmp/${a.name}`;
    case "topics":
      return topics.map((t) => {
        const last = (msgs[k(a.accountId, a.chatId)] ?? []).filter((x) => x.threadId === t.id).pop();
        return { ...t, accountId: a.accountId, chatId: a.chatId, lastTs: last?.ts ?? 0, preview: last?.text.replace(/`/g, "") ?? "", previewFrom: last ? (last.outgoing ? "Bạn" : last.senderName.split(" ")[0]) : "" };
      });
    case "topic_history":
      await wait(250);
      return (msgs[k(a.accountId, a.chatId)] ?? []).filter((x) => x.threadId === a.topic);
    case "thread":
      return (msgs[k(a.accountId, a.chatId)] ?? []).filter((x) => x.threadId === a.threadId);
    case "pinned":
      return (msgs[k(a.accountId, a.chatId)] ?? []).filter((x) => x.pinned);
    case "members":
      await wait(200);
      return ["Trí Võ", "Linh Nguyễn", "Huy Đặng", "Quân Lê", "Mai Anh Trịnh", "Phong Vũ"].map(
        (name, i): Member => ({ id: String(i), name, status: i % 2 ? "online" : "last seen recently", role: i === 1 ? "Admin" : "" }),
      );
    case "send": {
      await wait(500);
      const x = m(a.accountId, a.chatId, "me", Date.now(), a.text, { status: "sent", threadId: a.threadId ?? "", threadReply: !!a.threadId });
      const quoted = a.replyTo ? (msgs[k(a.accountId, a.chatId)] ?? []).find((m) => m.id === a.replyTo) : undefined;
      if (quoted) Object.assign(x, {replyTo:quoted.id,replyName:quoted.outgoing ? "Bạn" : quoted.senderName,replyText:quoted.text});
      if (/fail|lỗi/i.test(a.text)) throw new Error("Không gửi được — mất kết nối (demo)");
      // a DM answers back so live arrival + typing can be seen
      if (a.chatId === "402918331") {
        setTimeout(() => emit({ type: "typing", accountId: a.accountId, chatId: a.chatId, who: "Linh Nguyễn", on: true }), 800);
        setTimeout(() => {
          const r = m(a.accountId, a.chatId, "Linh Nguyễn", Date.now(), "Ok em 👍");
          emit({ type: "message", msg: r, isNew: true });
          const c = chats.find((c) => c.id === a.chatId)!;
          Object.assign(c, { lastTs: r.ts, preview: r.text, previewFrom: "Linh" });
          emit({ type: "chat", chat: { ...c } });
        }, 2600);
      }
      return x;
    }
    case "edit":
    case "delete_msg":
    case "react":
    case "pin":
    case "mark_read":
    case "set_open":
    case "set_muted":
    case "account_update":
      if (cmd === "mark_read") {
        const c = chats.find((c) => c.accountId === a.accountId && c.id === a.chatId);
        if (c) Object.assign(c, { unread: 0, mention: false });
      }
      if (cmd === "account_update") {
        Object.assign(accounts.find((x) => x.id === a.id)!, a.name ? { name: a.name } : {}, a.color ? { color: a.color } : {});
        emit({ type: "accounts", accounts: accounts.map((x) => ({ ...x })) });
      }
      return;
    case "search": {
      const q = String(a.query).normalize("NFD").replace(/\p{M}/gu, "").replace(/đ/g, "d").toLowerCase();
      return Object.values(msgs)
        .flat()
        .filter((x) => (!a.accountId || x.accountId === a.accountId) && (!a.chatId || x.chatId === a.chatId) && `${x.text} ${x.media?.name ?? ""}`.normalize("NFD").replace(/\p{M}/gu, "").replace(/đ/g, "d").toLowerCase().includes(q))
        .sort((x, y) => y.ts - x.ts)
        .slice(0, a.limit);
    }
    case "download":
      throw new Error("Demo không có file thật");
    case "forward": {
      const src = msgs[k(a.accountId, a.fromChatId)]?.find((x) => x.id === a.msgId);
      return call("send", { accountId: a.accountId, chatId: a.chatId, text: `↪ ${src?.senderName ?? ""}: ${src?.text ?? ""}` });
    }
    case "delete_chat":
      await wait(200);
      emit({ type: "chatRemoved", accountId: a.accountId, chatId: a.chatId });
      return;
    case "ai_config":
      return { ...ai, hasKey: true };
    case "ai_config_set":
      Object.assign(ai, { format: a.format, endpoint: a.endpoint, model: a.model, guide: a.guide });
      return;
    case "ai_run": {
      await wait(700);
      const texts = a.texts as string[];
      if (a.task === "suggest")
        return [
          { reply: "Sounds good, I'll take a look this afternoon.", meaning: "Nghe ổn, chiều nay mình xem nhé." },
          { reply: "Could you share the failing cases first?", meaning: "Gửi mình mấy case fail trước được không?" },
          { reply: "Let's sync tomorrow morning on this.", meaning: "Sáng mai mình bàn chuyện này nhé." },
        ];
      if (a.task === "summarize")
        return ["• Huy chốt lịch deploy thứ Sáu: freeze 14:00, migration 14:30, canary 16:00.\n• Staging đang trả 502 ở /v1/budgets, chưa rõ nguyên nhân.\n• Quân profile job weekly report: json.Marshal chiếm phần lớn CPU.\nCần bạn:\n• Trí check giúp phần rollback, nhất là bước tắt flag."];
      return texts.map((t) => `[${a.task === "translate_to" ? a.to : a.me}] ${t}`);
    }
    default:
      throw new Error(`demo: ${cmd} chưa có`);
  }
}
