/* ChatMin prototype — round 1: main shell (hero), conversation view, composer, inspector, ⌘K.
   Plain DOM + template strings; state lives in S, every render reads from it. */

// ── Platform capabilities ────────────────────────────────────────────────────
// CAPABILITY: one layout for every platform. A feature the platform lacks is hidden or dimmed
// with a tooltip — never a platform-specific screen. Add Messenger/Zalo by adding a row here.
const PLATFORMS = {
  telegram: {
    name: 'Telegram', glyph: 'telegram',
    caps: { reply: true, reactions: true, edit: true, delete: true, pin: true, threads: false, stickers: true, voice: true, readReceipts: true, typing: true },
  },
  gchat: {
    name: 'Google Chat', glyph: 'gchat',
    caps: { reply: true, reactions: true, edit: true, delete: true, pin: true, threads: true, stickers: false, voice: false, readReceipts: false, typing: true },
  },
};
const CAP_LABELS = {
  reply: 'Trả lời / trích dẫn', reactions: 'Reaction', edit: 'Sửa tin đã gửi', delete: 'Xoá với mọi người',
  pin: 'Ghim tin', threads: 'Thread trong space', stickers: 'Sticker', voice: 'Tin nhắn thoại',
  readReceipts: 'Trạng thái đã xem', typing: 'Đang gõ…',
};
const CAP_OFF_NOTE = {
  threads: 'Telegram không có thread — dùng Trả lời',
  stickers: 'Google Chat không hỗ trợ sticker',
  voice: 'Google Chat không có tin nhắn thoại',
  readReceipts: 'Google Chat không trả “đã xem” cho space/nhóm',
};

// ── People & sample data (fictional, realistic) ──────────────────────────────
const P = {
  me: { name: 'Trí Võ' },
  linh: { name: 'Linh Nguyễn', on: true }, huy: { name: 'Huy Đặng' }, quan: { name: 'Quân Lê', on: true },
  maianh: { name: 'Mai Anh Trịnh' }, khanh: { name: 'Nguyễn Hoàng Bảo Khánh (Mobile Team — Flutter)' },
  sarah: { name: 'Sarah Chen', on: true }, minh: { name: 'Minh Trần', on: true }, duc: { name: 'Đức Hoàng' },
  lan: { name: 'Lan Phạm' }, tuan: { name: 'Tuấn Bùi' }, hamy: { name: 'Hà My' }, phong: { name: 'Phong Vũ' },
  mom: { name: 'Mẹ' }, duy: { name: 'Duy Phạm' }, raj: { name: 'Raj Patel' }, kenji: { name: 'Kenji Watanabe' },
};

const S = {
  accounts: [
    { id: 'tg', platform: 'telegram', name: 'Cá nhân', handle: '+84 90 ••• 2468', color: 'blue', sync: 'ok', syncText: 'synced 4s' },
    { id: 'gc', platform: 'gchat', name: 'QC Corp', handle: 'trivo@qccorp.io', color: 'purple', sync: 'syncing', syncText: 'syncing 64%' },
  ],
  chats: {},
  tabs: ['backend', 'eng', 'minh'],
  active: 'backend',
  drafts: { minh: 'Anh ơi PR chuyển payments-worker sang Vault agent em đẩy rồi, anh review giúp em trước 13h nhé' },
  replyTo: {}, editing: {},
  inspTab: 'info', thread: null, filter: 'all', collapsed: {}, query: '',
};

const day = (label) => ({ type: 'day', label });
const unread = (count) => ({ type: 'unread', count });
let _id = 0;
const m = (from, time, text, extra = {}) => ({ id: 'm' + (++_id), type: 'text', from, time, text, ...extra });

const CHATS = [
  // ── Telegram · Cá nhân
  {
    id: 'backend', acc: 'tg', kind: 'group', name: 'Backend Go — Mine Wallet', members: ['linh', 'huy', 'quan', 'maianh', 'khanh', 'phong'], memberCount: 12,
    chatId: '-1001839204417', created: '03/2024', unread: 4, mention: true, typing: 'linh',
    desc: 'Team backend Mine Wallet: Go/Gin, PostgreSQL, Redis. PR review, deploy staging, incident.',
    msgs: () => {
      const pr = m('huy', '17:43', 'Ai review giúp PR này với, migration budgets thêm cột `rollover_cents` nha', { link: { site: 'github.com', title: 'feat(budgets): support monthly rollover #318', desc: 'Adds rollover_cents to budgets, backfills from transactions, guarded by BUDGET_ROLLOVER flag.', url: 'https://github.com/minewallet/api/pull/318' } });
      const review = m('me', '18:05', 'Mình xem rồi, ổn. Có 1 chỗ backfill nên chạy theo batch 5k rows, tránh lock bảng `transactions` lâu', { status: 'seen', reactions: [{ e: '👍', n: 2 }], replyTo: pr.id, pinned: true });
      const pprof = m('quan', '09:30', 'CPU profile của job weekly report. `json.Marshal` chiếm phần lớn thời gian, nghi do reflect trên slice `[]Transaction` lớn', { file: { name: 'pprof-weekly-report-2026-10-22.pb.gz', size: '2.3 MB', kind: 'file-archive' } });
      const mine = m('me', '09:41', 'Thử cache encoder theo struct trước, hoặc gen bằng easyjson. Đừng đổi sang lib JSON khác vội', { status: 'seen', replyTo: pprof.id });
      return [
        day('Hôm qua · Thứ Tư 21/10'),
        pr,
        review,
        m('linh', '18:20', 'Ok merge sau khi CI xanh. Mai Anh test lại flow tạo budget trên staging giúp chị nhé', { edited: true, reactions: [{ e: '🫡', n: 1 }] }),
        m('quan', '18:31', '', { type: 'deleted' }),
        day('Hôm nay · Thứ Năm 22/10'),
        m('maianh', '09:12', '', { file: { name: 'budget-rollover-testcases.xlsx', size: '48 KB', kind: 'file-text' } }),
        m('maianh', '09:12', 'Có 2 case fail khi đổi timezone sang UTC+7 vào ngày cuối tháng, chi tiết ở sheet thứ 2 ạ'),
        pprof,
        mine,
        m('me', '09:44', 'Dashboard latency đây: https://grafana.qccorp.io/d/api-latency?var-svc=report-worker', { status: 'failed' }),
        unread(4),
        m('linh', '10:02', 'Đồng ý với Trí, profile lại với GOGC=200 trước đã. Nếu vẫn vậy thì gen encoder.', { replyTo: mine.id, reactions: [{ e: '💯', n: 1 }] }),
        m('huy', '10:05', 'Kế hoạch deploy thứ Sáu nhé mọi người:\n\n1) 14:00 freeze nhánh main, chỉ nhận hotfix có ticket. 2) 14:30 chạy migration `0042_budget_rollover` trên staging, Mai Anh verify lại 2 case timezone. 3) 16:00 nếu staging ổn thì deploy prod theo canary 10% → 50% → 100%, mỗi bước theo dõi 15 phút trên Grafana (p99 latency /v1/budgets, error rate, Kafka lag của ledger-events). 4) Rollback: revert image tag trong Build Tools, migration có down script nhưng KHÔNG chạy down nếu đã có dữ liệu rollover — thay vào đó tắt flag BUDGET_ROLLOVER.\n\nAi thấy thiếu gì thì bổ sung trước 12h mai.'),
        m('huy', '10:06', '@{Trí Võ} check giúp anh phần rollback nhé, nhất là bước tắt flag', { mentionsMe: true }),
        m('maianh', '10:11', 'Staging đang trả 502 ở /v1/budgets, có ai vừa đụng gì không ạ 😅'),
      ];
    },
  },
  {
    id: 'hagiang', acc: 'tg', kind: 'group', name: 'Hội anh em đi Hà Giang tháng 11 — chốt lịch, chốt xe, chốt homestay nhé mọi người', members: ['tuan', 'hamy', 'duy', 'phong'], memberCount: 9,
    chatId: '-1002214558830', created: '09/2026', unread: 23,
    desc: 'Đi 4 ngày 3 đêm, xuất phát sáng thứ Bảy 14/11. Quỹ chung do Hà My giữ.',
    msgs: () => [
      day('Hôm nay · Thứ Năm 22/10'),
      m('tuan', '08:02', 'Điểm tập trung: bờ Hồ, đối diện Tháp Rùa, 4h45 sáng thứ Bảy. Xe 16 chỗ đón ở đó luôn', { image: { src: 'assets/hoan-kiem.jpg', w: 960, h: 645, alt: 'Tháp Rùa giữa hồ Hoàn Kiếm, Hà Nội' } }),
      m('hamy', '08:10', 'Mọi người chuyển quỹ 1.500.000đ trước thứ Hai nha, ai chuyển rồi thả tim giúp em', { reactions: [{ e: '❤️', n: 6, mine: true }] }),
      m('me', '08:15', 'Đã chuyển nha My', { status: 'seen' }),
      unread(23),
      m('duy', '09:58', 'Homestay ở Đồng Văn còn 2 phòng thôi, chốt luôn không mọi người?'),
    ],
    preview: 'Duy: Homestay ở Đồng Văn còn 2 phòng thôi, chốt luôn không mọi người?', time: '09:58',
  },
  {
    id: 'linh', acc: 'tg', kind: 'dm', person: 'linh', name: 'Linh Nguyễn', chatId: '402918331', typing: 'linh',
    msgs: () => [day('Hôm nay · Thứ Năm 22/10'), m('linh', '09:05', 'Chiều nay 1:1 dời sang 16h được không em?'), m('me', '09:07', 'Được chị', { status: 'seen' })],
  },
  {
    id: 'gophers', acc: 'tg', kind: 'group', name: 'Vietnam Gophers', memberCount: 2847, members: ['raj', 'kenji', 'phong', 'khanh'], muted: true, unread: 128,
    chatId: '-1001120457788', created: '06/2019', desc: 'Cộng đồng Go tại Việt Nam. Hỏi đáp, chia sẻ, tuyển dụng (tag #hiring).',
    msgs: () => [day('Hôm nay · Thứ Năm 22/10'), unread(128), m('kenji', '10:09', 'Anyone tried the new iterator funcs in prod yet? Curious about allocation behavior with range-over-func.'), m('phong', '10:12', 'Bên mình dùng cho stream đọc từ Kafka, ổn, nhưng nhớ benchmark trước nha')],
  },
  {
    id: 'mom', acc: 'tg', kind: 'dm', person: 'mom', name: 'Mẹ', chatId: '188230017',
    msgs: () => [day('Hôm qua · Thứ Tư 21/10'), m('mom', '20:31', 'Cuối tuần về ăn cơm không con'), m('me', '20:40', 'Dạ chủ nhật con về ạ', { status: 'seen', reactions: [{ e: '❤️', n: 1 }] })],
  },
  { id: 'duy', acc: 'tg', kind: 'dm', person: 'duy', name: 'Duy Phạm', chatId: '5530021984', msgs: () => [], preview: 'Chưa có tin nhắn', time: '' },

  // ── Google Chat · QC Corp
  {
    id: 'eng', acc: 'gc', kind: 'space', name: 'eng-platform', memberCount: 48, members: ['sarah', 'minh', 'duc', 'lan', 'raj'], unread: 7, mention: true,
    chatId: 'spaces/AAAA8xQm2Lk', created: '01/2025', desc: 'Platform engineering: infra, CI/CD, observability (Loki, Prometheus, Grafana), Kafka, Postgres.',
    msgs: () => {
      const rot = m('sarah', '08:55', 'Heads-up: rotating the staging Postgres credentials at 14:00 ICT. Services pulling from Vault pick it up automatically; anything with a hard-coded DSN will break.', {
        reactions: [{ e: '👀', n: 4 }],
        thread: [m('minh', '09:02', 'payments-worker vẫn đọc DSN từ env file, em chuyển sang Vault agent trước 13h ạ'), m('sarah', '09:05', 'Thanks Minh 🙏'), m('me', '09:20', 'Build Tools pipeline đã đọc từ Vault rồi, không ảnh hưởng.')],
      });
      return [
        day('Hôm nay · Thứ Năm 22/10'),
        rot,
        m('duc', '09:40', 'Consumer lag on `ledger-events` is back under 2k after the partition bump. Closing INC-4821.', { reactions: [{ e: '✅', n: 6 }], thread: [m('raj', '09:44', 'Nice. Can we keep the lag alert at 5k for another week?')] }),
        unread(7),
        m('lan', '10:20', '@{Trí Võ} can you own the Loki retention change? Debug logs 30d → 14d, info stays 30d.', { mentionsMe: true, thread: [] }),
        m('sarah', '10:24', 'RFC for the Promtail → Grafana Alloy migration is up, comments by Monday please.', { link: { site: 'docs.google.com', title: 'RFC-112: Promtail → Grafana Alloy', desc: 'Scope, rollout per cluster, label compatibility, and rollback plan.', url: 'https://docs.google.com/document/d/rfc-112' } }),
      ];
    },
  },
  {
    id: 'minh', acc: 'gc', kind: 'dm', person: 'minh', name: 'Minh Trần', chatId: 'spaces/AAAAm1nhTr4',
    msgs: () => [day('Hôm nay · Thứ Năm 22/10'), m('minh', '09:10', 'Anh ơi, Vault agent sidecar có cần thêm policy cho namespace payments không ạ?'), m('me', '09:16', 'Cần, copy policy của ledger-svc rồi đổi path là được', { status: 'sent' })],
  },
  {
    id: 'release', acc: 'gc', kind: 'space', name: 'release-train-2026-q4', memberCount: 23, members: ['sarah', 'duc', 'kenji'],
    chatId: 'spaces/AAAAr3lQ4tr', created: '10/2026', desc: 'Lịch release Q4, freeze window, checklist go/no-go.',
    msgs: () => [day('Hôm qua · Thứ Tư 21/10'), m('duc', '16:00', 'Go/no-go for v4.18 is Friday 15:30. Checklist link in the pinned message.')],
  },
  {
    id: 'sarah', acc: 'gc', kind: 'dm', person: 'sarah', name: 'Sarah Chen', chatId: 'spaces/AAAAs4r4hCh',
    msgs: () => [day('Thứ Hai 19/10'), m('sarah', '11:20', 'Can you share the Build Tools audit log export format?'), m('me', '11:41', 'Sure — JSON lines, one deploy per line. Sending a sample tomorrow.', { status: 'sent' })],
  },
  {
    id: 'allhands', acc: 'gc', kind: 'space', name: 'all-hands-announcements', memberCount: 312, members: ['lan', 'sarah'], muted: true, unread: 2,
    chatId: 'spaces/AAAAaLlh4nD', created: '02/2023', desc: 'Thông báo toàn công ty. Chỉ admin được đăng.',
    msgs: () => [day('Hôm nay · Thứ Năm 22/10'), unread(2), m('lan', '08:30', 'Văn phòng tầng 12 bảo trì điều hoà sáng thứ Bảy 24/10, mọi người mang laptop về nhé.')],
  },
];
for (const c of CHATS) { c.messages = c.msgs(); delete c.msgs; S.chats[c.id] = c; }

// ── Helpers ──────────────────────────────────────────────────────────────────
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const icon = (n, cls = '') => `<svg class="od-icon ic ${cls}" aria-hidden="true"><use href="#i-${n}"/></svg>`;
const glyph = (p) => `<svg class="od-icon glyph" aria-hidden="true"><use href="#g-${PLATFORMS[p].glyph}"/></svg>`;
const acc = (id) => S.accounts.find((a) => a.id === id);
const caps = (chat) => PLATFORMS[acc(chat.acc).platform].caps;
const connVar = (a) => `--conn: var(--conn-${a.color})`;
const norm = (s) => s.normalize('NFD').replace(/\p{M}/gu, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase();
const initials = (name, lead) => name.replace(/\(.*\)/, '').trim().split(/\s+/).slice(lead ? 0 : -2, lead ? 2 : undefined).map((w) => w[0]).join('').toUpperCase();
const nowHM = () => new Date().toTimeString().slice(0, 5);
const fmtCount = (n) => n.toLocaleString('en-US');
const realMsgs = (c) => c.messages.filter((x) => x.from);
const personName = (id) => (id === 'me' ? 'Bạn' : P[id].name);

function avatar(chat, size = '') {
  if (chat.kind === 'dm') return `<span class="avatar ${size}">${esc(initials(chat.name))}${P[chat.person]?.on ? '<i class="presence" aria-label="đang online"></i>' : ''}</span>`;
  if (chat.kind === 'space') return `<span class="avatar group ${size}">${icon('hash')}</span>`;
  return `<span class="avatar group ${size}">${esc(initials(chat.name, true))}</span>`;
}
const personAvatar = (id, size = '') => `<span class="avatar ${size}" title="${esc(P[id].name)}">${esc(initials(P[id].name))}</span>`;

function fmt(text) {
  return esc(text).split(/\n\n+/).map((para) => '<p>' + para
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/(https?:\/\/[^\s<]+)/g, '<a class="msg-link" href="$1" target="_blank" rel="noopener">$1</a>')
    .replace(/@\{([^}]+)\}/g, (_, n) => `<span class="mention${n === P.me.name ? ' me' : ''}">@${n}</span>`)
    .replace(/\n/g, '<br>') + '</p>').join('');
}
const plain = (msg) => msg.type === 'deleted' ? 'Tin nhắn đã bị xoá' : (msg.text || (msg.file ? msg.file.name : msg.image ? 'Ảnh' : '')).replace(/@\{([^}]+)\}/g, '@$1').replace(/`/g, '');

function lastInfo(chat) {
  const last = realMsgs(chat).at(-1);
  if (!last) return { preview: chat.preview || 'Chưa có tin nhắn', time: chat.time ?? '' };
  const who = last.from === 'me' ? 'Bạn: ' : chat.kind !== 'dm' ? P[last.from].name.split(' ').at(-1) + ': ' : '';
  return { preview: who + plain(last), time: last.time };
}

// ── Sidebar ──────────────────────────────────────────────────────────────────
function renderSidebar() {
  const sb = $('#sidebar');
  const keepFocus = document.activeElement?.id === 'side-filter';
  const totalUnread = Object.values(S.chats).filter((c) => !c.muted).reduce((s, c) => s + (c.unread || 0), 0);
  const q = norm(S.query);
  const pass = (c) => (!q || norm(c.name).includes(q)) && (S.filter === 'all' || (S.filter === 'unread' ? c.unread : c.mention));

  let groups = '';
  S.accounts.forEach((a, i) => {
    const chats = Object.values(S.chats).filter((c) => c.acc === a.id && pass(c));
    const accUnread = chats.filter((c) => !c.muted).reduce((s, c) => s + (c.unread || 0), 0);
    const state = a.sync === 'ok' ? '' : `<span class="acc-state ${a.sync === 'syncing' ? 'soft-orange' : 'soft-red'}">${icon(a.sync === 'syncing' ? 'refresh-cw' : 'wifi-off')}${a.sync === 'syncing' ? 'sync' : 'offline'}</span>`;
    groups += `<div class="acc-group${S.collapsed[a.id] ? ' collapsed' : ''}" style="${connVar(a)}">
      <button class="acc-head" data-collapse="${a.id}" aria-expanded="${!S.collapsed[a.id]}" data-tip="${esc(PLATFORMS[a.platform].name)} · ${esc(a.handle)}" data-kbd="⌘${i + 1}">
        ${icon('chevron-down', 'chev')}<span class="conn-dot"></span>${glyph(a.platform)}
        <span class="acc-name">${esc(a.name)}<small>${esc(PLATFORMS[a.platform].name)}</small></span>
        ${state || (accUnread ? `<span class="badge">${accUnread}</span>` : '')}
      </button>
      <div class="acc-chats">${chats.map(chatRow).join('') || `<div class="side-empty">Không có hội thoại khớp bộ lọc</div>`}</div>
    </div>`;
  });

  sb.innerHTML = `
    <div class="sidebar-top">
      <div class="side-search-wrap">${icon('search')}<input class="side-search" id="side-filter" placeholder="Lọc hội thoại" aria-label="Lọc hội thoại" value="${esc(S.query)}" /></div>
    </div>
    <div class="mini-tabs" role="tablist" aria-label="Bộ lọc">
      ${[['all', 'Tất cả'], ['unread', 'Chưa đọc'], ['mention', '@ Nhắc tên']].map(([k, l]) => `<button role="tab" aria-selected="${S.filter === k}" class="${S.filter === k ? 'active' : ''}" data-filter="${k}">${l}</button>`).join('')}
    </div>
    <div class="side-scroll">
      <button class="nav-item all-inbox" id="all-inbox" data-tip="Unified inbox — gộp mọi account theo thời gian">${icon('inbox')}<span>All inboxes</span>${totalUnread ? `<span class="badge unread">${totalUnread}</span>` : ''}</button>
      ${S.accounts.length ? groups : `<div class="side-empty">Chưa có account nào.<br>Bấm ${icon('user-plus')} để thêm.</div>`}
    </div>`;
  if (keepFocus) { const f = $('#side-filter'); f.focus(); f.setSelectionRange(f.value.length, f.value.length); }
  window.CM2?.decorateSidebar();
}

function chatRow(c) {
  const a = acc(c.acc);
  const { preview, time } = lastInfo(c);
  const draft = S.drafts[c.id];
  let pv = esc(preview);
  if (draft && c.id !== S.active) pv = `<span class="draft-label">Nháp:</span> ${esc(draft)}`;
  else if (c.typing && caps(c).typing) pv = `<span class="typing-label">${c.kind === 'dm' ? '' : esc(P[c.typing].name.split(' ').at(-1)) + ' '}đang gõ…</span>`;
  const badge = c.unread ? `<span class="badge ${c.muted ? 'idle' : 'unread'}">${c.unread > 99 ? '99+' : c.unread}</span>` : '';
  return `<button class="chat-row${c.id === S.active ? ' active' : ''}${c.unread ? ' unread' : ''}" data-open="${c.id}" style="${connVar(a)}" aria-label="${esc(c.name)} — ${esc(a.name)}${c.unread ? `, ${c.unread} chưa đọc` : ''}">
    ${avatar(c)}
    <span class="od-stack" style="--od-gap:2px">
      <span class="line"><span class="name">${esc(c.name)}</span>${c.muted ? icon('bell-off', 'muted-ic') : ''}<span class="time">${esc(time)}</span></span>
      <span class="line"><span class="preview">${pv}</span>${c.mention ? icon('at-sign', 'mention-ic') : ''}${badge}</span>
    </span>
  </button>`;
}

// ── Tabs ─────────────────────────────────────────────────────────────────────
function renderTabs() {
  $('#tabs').innerHTML = S.tabs.map((id) => {
    const c = S.chats[id]; const a = acc(c.acc);
    const dot = (c.unread && id !== S.active) || S.drafts[id];
    const why = S.drafts[id] ? 'có nháp chưa gửi' : 'có tin chưa đọc';
    return `<div class="tab${id === S.active ? ' active' : ''}" role="tab" tabindex="0" aria-selected="${id === S.active}" data-tab="${id}" style="${connVar(a)}">
      <span class="conn-dot" aria-hidden="true"></span>
      ${dot ? `<span class="tab-dirty-dot" role="img" aria-label="${why}" data-tip="${why}"></span>` : ''}
      <span class="tab-title">${esc(c.name)}</span>
      <span class="tab-conn">${esc(a.name)}</span>
      <button class="tab-close" data-close="${id}" aria-label="Đóng tab ${esc(c.name)}" data-tip="Đóng tab" data-kbd="⌘W">×</button>
    </div>`;
  }).join('') + `<button class="tab-add" id="tab-add" data-tip="Mở chat" data-kbd="⌘K">${icon('plus')}Chat</button>`;
  $('#tabs .tab.active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

// ── Conversation ─────────────────────────────────────────────────────────────
function renderConv() {
  const el = $('#content');
  const c = S.chats[S.active];
  if (!c) {
    el.className = 'content empty'; el.removeAttribute('style');
    el.innerHTML = `<div class="conv-empty"><span class="ring">${icon('messages-square')}</span><strong>Không có hội thoại nào đang mở</strong><p>Chọn một chat ở sidebar, hoặc nhấn <kbd class="kbd">⌘K</kbd> để nhảy tới chat bất kỳ.</p></div>`;
    return;
  }
  const a = acc(c.acc); const cp = caps(c);
  el.className = 'content'; el.setAttribute('style', connVar(a));
  const sub = c.kind === 'dm' ? (P[c.person]?.on ? 'online' : 'last seen recently') : `${c.kind === 'space' ? 'space' : 'nhóm'} · ${fmtCount(c.memberCount)} thành viên`;
  el.innerHTML = `
    <div class="conv-head">
      ${avatar(c)}
      <div class="title"><strong>${esc(c.name)}</strong><span>${esc(sub)}</span></div>
      <button class="tool-btn icon-only" data-act="search-in" aria-label="Tìm trong chat này" data-tip="Tìm trong chat này" data-kbd="⌘F">${icon('search')}</button>
      <button class="tool-btn icon-only" data-act="pins" aria-label="Tin đã ghim" data-tip="Tin đã ghim">${icon('pin')}</button>
      <button class="tool-btn icon-only" data-act="toggle-insp" aria-label="Thông tin chat" data-tip="Thông tin chat" data-kbd="⌘I">${icon('info')}</button>
    </div>
    <div class="msgs" id="msgs" aria-live="polite"><div class="msgs-inner" id="msgs-inner"></div></div>
    <div class="composer" id="composer"></div>`;
  renderMsgs(true);
  renderComposer();
  window.CM2?.decorateChat();
}

function renderMsgs(toBottom) {
  const c = S.chats[S.active]; const box = $('#msgs'); if (!box) return;
  const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
  const list = c.messages;
  let out = '';
  if (!realMsgs(c).length) {
    out = `<div class="conv-empty"><span class="ring">${icon('message-square-text')}</span><strong>Chưa có tin nhắn với ${esc(c.name)}</strong><p>Đây là đầu cuộc trò chuyện. Gửi lời chào đầu tiên. Nháp được lưu riêng cho tab này.</p></div>`;
  } else {
    list.forEach((x, i) => {
      if (x.type === 'day') { out += `<div class="day-sep" role="separator"><span>${esc(x.label)}</span></div>`; return; }
      if (x.type === 'unread') { out += `<div class="unread-sep" role="separator"><span>${x.count} tin chưa đọc</span></div>`; return; }
      const prev = list[i - 1], next = list[i + 1];
      const first = !prev || prev.from !== x.from;
      const last = !next || next.from !== x.from;
      out += msgHTML(c, x, first, last);
    });
    if (c.typing && caps(c).typing) out += `<div class="typing">${personAvatar(c.typing)}<span class="dots" aria-hidden="true"><i></i><i></i><i></i></span><span>${esc(P[c.typing].name)} đang gõ…</span></div>`;
  }
  $('#msgs-inner').innerHTML = out;
  if (toBottom || nearBottom) box.scrollTop = box.scrollHeight;
}

function msgHTML(c, x, first, last) {
  const mine = x.from === 'me'; const cap = caps(c);
  const cls = `msg${mine ? ' me' : ''}${first ? ' first' : ''}${last ? ' last' : ''}${x.mentionsMe ? ' mentions-me' : ''}`;
  const side = mine ? '' : first ? personAvatar(x.from) : '<span class="avatar-gap"></span>';
  const name = !mine && first && c.kind !== 'dm' ? `<span class="sender">${esc(P[x.from].name)}</span>` : '';

  let status = '';
  if (mine && x.type !== 'deleted') {
    if (x.status === 'sending') status = `<span data-tip="Đang gửi">${icon('clock')}</span>`;
    else if (x.status === 'failed') status = `<span class="failed" data-tip="Gửi lỗi">${icon('circle-alert')}</span>`;
    else if (x.status === 'seen' && cap.readReceipts) status = `<span class="seen" data-tip="Đã xem">${icon('check-check')}</span>`;
    else status = `<span data-tip="${cap.readReceipts ? 'Đã gửi' : 'Đã gửi · ' + CAP_OFF_NOTE.readReceipts}">${icon('check')}</span>`;
  }
  const meta = `<span class="msg-meta">${x.edited ? '<span class="edited">đã sửa</span>' : ''}<time>${esc(x.time)}</time>${status}</span>`;

  if (x.type === 'deleted') {
    return `<div class="${cls}" id="${x.id}">${side}<div class="msg-col"><div class="bubble deleted">${icon('trash-2')}<span>Tin nhắn đã bị xoá</span>${meta}</div></div></div>`;
  }

  const q = x.replyTo && c.messages.find((y) => y.id === x.replyTo);
  const quote = q ? `<button class="quote" data-jump="${q.id}" aria-label="Tới tin được trả lời"><b>${esc(personName(q.from))}</b><span>${esc(plain(q))}</span></button>` : '';
  const img = x.image ? `<figure class="img-msg"><img class="od-media" src="${x.image.src}" width="${x.image.w}" height="${x.image.h}" alt="${esc(x.image.alt)}" style="--od-ratio:${x.image.w}/${x.image.h}" /></figure>` : '';
  const file = x.file ? `<div class="file-card"><span class="file-ic">${icon(x.file.kind || 'file-text')}</span><span style="min-width:0"><strong>${esc(x.file.name)}</strong><small>${esc(x.file.size)}</small></span><button class="tool-btn icon-only" data-act="download" aria-label="Tải ${esc(x.file.name)}" data-tip="Tải về">${icon('download')}</button></div>` : '';
  const link = x.link ? `<a class="link-card" href="${esc(x.link.url)}" target="_blank" rel="noopener"><span class="site">${esc(x.link.site)}</span><strong>${esc(x.link.title)}</strong><span>${esc(x.link.desc)}</span></a>` : '';
  const text = x.text ? fmt(x.text) : '';

  const reacts = cap.reactions && x.reactions?.length ? `<div class="reactions">${x.reactions.map((r, i) => `<button class="reaction${r.mine ? ' mine' : ''}" data-react-toggle="${x.id}:${i}" aria-pressed="${!!r.mine}"><span class="e">${r.e}</span>${r.n}</button>`).join('')}</div>` : '';
  // CAPABILITY threads: thread summary + "reply in thread" only render where the platform has threads.
  const thr = cap.threads && c.kind === 'space' && x.thread ? threadLink(c, x) : '';
  const fail = x.status === 'failed' ? `<div class="fail-row">Không gửi được — mất kết nối tới Telegram<button class="tool-btn" data-retry="${x.id}">${icon('rotate-cw')}Thử lại</button></div>` : '';

  const actions = `<div class="msg-actions" role="toolbar" aria-label="Thao tác tin nhắn">
    <button data-reply="${x.id}" aria-label="Trả lời" data-tip="Trả lời" data-kbd="R">${icon('reply')}</button>
    ${cap.reactions ? `<button data-react="${x.id}" aria-label="Thả reaction" data-tip="Reaction">${icon('smile')}</button>` : ''}
    ${cap.threads && c.kind === 'space' ? `<button data-thread="${x.id}" aria-label="Trả lời trong thread" data-tip="Trả lời trong thread">${icon('message-circle-reply')}</button>` : ''}
    <button data-more="${x.id}" aria-label="Thêm" data-tip="Thêm">${icon('ellipsis')}</button>
  </div>`;

  return `<div class="${cls}" id="${x.id}">${side}<div class="msg-col">
    ${name}<div class="bubble">${quote}${img}${file}${text}${link}</div>${meta}${reacts}${thr}${fail}
  </div>${actions}</div>`;
}

function threadLink(c, x) {
  const n = x.thread.length;
  const open = S.thread && S.thread.msg === x.id;
  if (!n) return `<button class="thread-link${open ? ' open' : ''}" data-thread="${x.id}">${icon('message-circle-reply')}Trả lời trong thread</button>`;
  const faces = [...new Set(x.thread.map((r) => r.from))].slice(0, 3).map((f) => personAvatar(f)).join('');
  return `<button class="thread-link${open ? ' open' : ''}" data-thread="${x.id}"><span class="faces">${faces}</span>${n} trả lời<small>lần cuối ${esc(x.thread.at(-1).time)}</small></button>`;
}

// ── Composer ─────────────────────────────────────────────────────────────────
function renderComposer() {
  const c = S.chats[S.active]; const cap = caps(c); const box = $('#composer'); if (!box) return;
  const rid = S.replyTo[c.id], eid = S.editing[c.id];
  const referenceId = eid || rid;
  const ref = referenceId ? c.messages.find((message) => message.id === referenceId && message.from) : null;
  const bar = ref ? `<div class="reply-bar">${icon(eid ? 'pencil' : 'reply')}<span class="what"><b>${eid ? 'Đang sửa tin nhắn' : 'Đang trả lời ' + esc(personName(ref.from))}</b><span>${esc(plain(ref))}</span></span>
      <span class="esc"><kbd class="kbd">Esc</kbd><button class="tool-btn icon-only" data-act="cancel-reply" aria-label="Huỷ">${icon('x')}</button></span></div>` : '';
  const off = (k) => cap[k] ? '' : ` is-off" aria-disabled="true" data-off="${k}`;
  box.innerHTML = `<div class="composer-inner">${bar}
    <div class="composer-box main-composer">
      <textarea id="composer-input" rows="1" placeholder="Viết tin nhắn…" aria-label="Soạn tin nhắn"></textarea>
      <div class="composer-tools">
      <label class="composer-label" for="composer-input"><span class="conn-dot" style="${connVar(acc(c.acc))}"></span><span class="composer-from"><span class="composer-from-prefix">Gửi từ </span>${esc(acc(c.acc).name)}</span><span class="composer-platform">${esc(PLATFORMS[acc(c.acc).platform].name)}</span></label>
      <span class="composer-sep" aria-hidden="true"></span>
      <button class="tool-btn icon-only" data-act="attach" aria-label="Đính kèm file" data-tip="Đính kèm file" data-kbd="⌘U">${icon('paperclip')}</button>
      <button class="tool-btn icon-only" data-act="emoji" aria-label="Emoji" data-tip="Emoji">${icon('smile')}</button>
      <button class="tool-btn icon-only${off('stickers')}" data-act="sticker" aria-label="Sticker" data-tip="${cap.stickers ? 'Sticker' : CAP_OFF_NOTE.stickers}">${icon('sticker')}</button>
      <button class="tool-btn icon-only${off('voice')}" data-act="voice" aria-label="Tin nhắn thoại" data-tip="${cap.voice ? 'Giữ để ghi âm' : CAP_OFF_NOTE.voice}">${icon('mic')}</button>
      <span class="composer-key">↵ gửi · ⇧↵ xuống dòng</span>
      <button class="tool-btn primary" data-act="send" aria-label="Gửi" data-tip="Gửi" data-kbd="↵">Gửi ${icon('send')}</button>
      </div>
    </div>
    <div class="composer-hint"><span>${ref ? 'Esc để huỷ trả lời / sửa' : ''}</span><span class="draft-saved" id="draft-note">${S.drafts[c.id] ? 'Nháp đã lưu cho tab này' : ''}</span></div>
  </div>`;
  const ta = $('#composer-input');
  ta.value = S.drafts[c.id] || '';
  grow(ta);
  window.CM2?.decorateChat();
}
function grow(ta) { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 176) + 'px'; }
function focusComposer() { const ta = $('#composer-input'); if (ta) { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); } }

function send() {
  if (window.CM2?.sendBlocked()) return;
  const c = S.chats[S.active]; const ta = $('#composer-input'); const t = ta.value.trim(); if (!t) return;
  const cap = caps(c);
  if (S.editing[c.id]) {
    const x = c.messages.find((y) => y.id === S.editing[c.id]); x.text = t; x.edited = true; S.editing[c.id] = null;
  } else {
    const x = { id: 'm' + (++_id), type: 'text', from: 'me', time: nowHM(), text: t, status: 'sending', replyTo: S.replyTo[c.id] || null };
    c.messages = c.messages.filter((y) => y.type !== 'unread');
    c.messages.push(x); c.unread = 0; c.mention = false;
    // prototype: a message containing "fail"/"lỗi" demonstrates the failed → retry path
    setTimeout(() => { x.status = /fail|lỗi/i.test(t) ? 'failed' : 'sent'; refreshMsgs(c);
      if (x.status === 'sent' && cap.readReceipts) setTimeout(() => { x.status = 'seen'; refreshMsgs(c); }, 1800);
    }, 700);
  }
  S.replyTo[c.id] = null; S.drafts[c.id] = '';
  renderMsgs(true); renderComposer(); renderSidebar(); renderTabs(); renderStatus(); focusComposer();
}
function refreshMsgs(c) { if (S.active === c.id) renderMsgs(false); renderSidebar(); }

// ── Inspector ────────────────────────────────────────────────────────────────
function renderInspector() {
  const el = $('#inspector'); const c = S.chats[S.active];
  if (!c) { el.innerHTML = ''; return; }
  const a = acc(c.acc);
  const head = `<div class="inspector-head"><div class="h"><strong>${S.thread && S.thread.chat === c.id ? 'Thread' : 'Chi tiết hội thoại'}</strong><span><span class="conn-dot" style="${connVar(a)}"></span>${glyph(a.platform)}<em>${esc(a.name)} · ${esc(PLATFORMS[a.platform].name)}</em></span></div>
    <button class="tool-btn icon-only lg" data-act="toggle-insp" aria-label="Đóng inspector" data-tip="Đóng inspector" data-kbd="⌘I">${icon('x')}</button></div>`;

  if (S.thread && S.thread.chat === c.id) { el.innerHTML = head + threadPanel(c); return; }

  const files = realMsgs(c).filter((x) => x.file);
  const imgs = realMsgs(c).filter((x) => x.image);
  const pins = realMsgs(c).filter((x) => x.pinned);
  const tabs = [['info', 'Info'], ['members', 'Người', c.kind === 'dm' ? null : c.memberCount], ['files', 'File', files.length], ['media', 'Ảnh', imgs.length], ['pinned', 'Ghim', pins.length]];
  const tablist = `<div class="mini-tabs" role="tablist" aria-label="Thông tin chat">${tabs.map(([k, l, n]) => `<button role="tab" aria-selected="${S.inspTab === k}" class="${S.inspTab === k ? 'active' : ''}" data-insp="${k}">${l}${n ? `<small>${n > 999 ? Math.round(n / 100) / 10 + 'k' : n}</small>` : ''}</button>`).join('')}</div>`;

  let body = '';
  if (S.inspTab === 'info') {
    const pl = PLATFORMS[a.platform];
    body = `<div class="insp-hero">${avatar(c, 'lg')}<strong>${esc(c.name)}</strong><span>${c.kind === 'dm' ? (P[c.person]?.on ? 'online' : 'last seen recently') : `${c.kind === 'space' ? 'Space' : 'Nhóm'} · ${fmtCount(c.memberCount)} thành viên`}</span></div>
      ${c.desc ? `<p class="insp-desc">${esc(c.desc)}</p>` : ''}
      <div class="insp-section">Chi tiết</div>
      <div class="kv"><span>Account</span><span class="seg" style="min-width:0"><span class="conn-dot" style="${connVar(a)}"></span><span class="od-truncate">${esc(a.name)} · ${esc(a.handle)}</span></span></div>
      <div class="kv"><span>Chat ID</span><code>${esc(c.chatId)}</code></div>
      ${c.created ? `<div class="kv"><span>Tạo</span><code>${esc(c.created)}</code></div>` : ''}
      <div class="kv"><span>Thông báo</span><label class="switch"><input type="checkbox" data-act="mute" ${c.muted ? '' : 'checked'} aria-label="Bật thông báo" /><span></span></label></div>
      ${pins.length ? `<div class="insp-section"><span>Tin đã ghim</span><button class="inspector-link" data-insp="pinned">Xem tất cả</button></div>${pins.slice(0, 2).map((message) => `<button class="pin-row" data-jump="${message.id}">${icon('pin')}<span><small>${esc(personName(message.from))}</small><span>${esc(plain(message))}</span></span></button>`).join('')}` : ''}
      ${files.length ? `<div class="insp-section"><span>File gần đây</span><button class="inspector-link" data-insp="files">${files.length} file</button></div>${files.slice(-2).reverse().map((message) => `<button class="recent-file" data-insp="files">${icon(message.file.kind || 'file-text')}<span class="od-field"><b>${esc(message.file.name)}</b><small>${esc(message.file.size)} · ${esc(message.time)}</small></span>${icon('chevron-right')}</button>`).join('')}` : ''}
      <details class="capabilities"><summary>Khả năng · ${esc(pl.name)}</summary>
      ${Object.entries(pl.caps).map(([k, v]) => `<div class="cap-row ${v ? 'yes' : 'no'}">${icon(v ? 'check' : 'x')}<span>${CAP_LABELS[k]}${!v && CAP_OFF_NOTE[k] ? `<small>${CAP_OFF_NOTE[k]}</small>` : ''}</span></div>`).join('')}</details>`;
  } else if (S.inspTab === 'members') {
    if (c.kind === 'dm') body = `<div class="insp-empty">${icon('users')}Chat 1-1 với ${esc(c.name)}</div>`;
    else {
      const rows = ['me', ...c.members].map((id, i) => `<div class="member-row">${personAvatar(id, 'sm')}<span class="who"><b>${esc(id === 'me' ? P.me.name + ' (bạn)' : P[id].name)}</b><small class="${P[id].on || id === 'me' ? 'on' : ''}">${P[id].on || id === 'me' ? 'online' : 'last seen recently'}</small></span>${i === 1 ? '<span class="badge blue">Admin</span>' : ''}</div>`).join('');
      const rest = c.memberCount - c.members.length - 1;
      body = `<div class="side-search-wrap" style="margin-bottom:8px">${icon('search')}<input class="side-search" placeholder="Tìm thành viên" aria-label="Tìm thành viên" /></div>${rows}
        ${rest > 0 ? `<button class="tool-btn more-row" data-act="more-members">Tải thêm · còn ${fmtCount(rest)} thành viên</button>` : ''}`;
    }
  } else if (S.inspTab === 'files') {
    body = files.length ? files.map((x) => `<div class="file-row"><span class="file-ic">${icon(x.file.kind || 'file-text')}</span><span style="min-width:0"><b>${esc(x.file.name)}</b><small>${esc(x.file.size)} · ${esc(P[x.from].name)} · ${esc(x.time)}</small></span><button class="tool-btn icon-only" data-act="download" aria-label="Tải ${esc(x.file.name)}" data-tip="Tải về">${icon('download')}</button></div>`).join('')
      : `<div class="insp-empty">${icon('file-text')}Chưa có file nào trong chat này</div>`;
  } else if (S.inspTab === 'media') {
    body = imgs.length ? `<div class="media-grid">${imgs.map((x) => `<figure><img class="od-media" src="${x.image.src}" width="${x.image.w}" height="${x.image.h}" alt="${esc(x.image.alt)}" /><figcaption>${esc(P[x.from].name.split(' ').at(-1))} · ${esc(x.time)}</figcaption></figure>`).join('')}</div>`
      : `<div class="insp-empty">${icon('image')}Chưa có ảnh trong chat này</div>`;
  } else {
    body = pins.length ? pins.map((x) => `<button class="pin-row" data-jump="${x.id}">${icon('pin')}<span style="min-width:0"><small>${esc(personName(x.from))} · ${esc(x.time)}</small><span>${esc(plain(x))}</span></span></button>`).join('')
      : `<div class="insp-empty">${icon('pin')}Chưa ghim tin nào.<br>Di chuột lên tin → ${icon('ellipsis')} → Ghim.</div>`;
  }
  el.innerHTML = head + tablist + `<div class="inspector-scroll">${body}</div>`;
}

function threadPanel(c) {
  const root = c.messages.find((y) => y.id === S.thread.msg);
  const cm = (x, cls = '') => `<div class="cmsg ${cls}">${personAvatar(x.from, 'sm')}<div style="min-width:0"><div class="hd"><b>${esc(x.from === 'me' ? P.me.name : P[x.from].name)}</b><time>${esc(x.time)}</time></div><div class="tx">${fmt(x.text)}</div></div></div>`;
  return `<div class="thread-head"><button class="tool-btn" data-act="close-thread">${icon('chevron-right')}Đóng thread</button><span class="od-truncate">Thread trong #${esc(c.name)}</span></div>
    <div class="thread-view">
      <div class="thread-scroll" id="thread-scroll">${cm(root, 'root')}<div class="thread-count">${root.thread.length} trả lời</div>${root.thread.map((x) => cm(x)).join('') || '<div class="insp-empty">Chưa có trả lời. Bắt đầu thread bên dưới.</div>'}</div>
      <div class="thread-compose"><div class="composer-box"><textarea id="thread-input" rows="1" placeholder="Trả lời trong thread…" aria-label="Trả lời trong thread"></textarea><button class="tool-btn primary" data-act="thread-send" aria-label="Gửi trả lời">${icon('send')}</button></div></div>
    </div>`;
}

// ── Statusbar ────────────────────────────────────────────────────────────────
function renderStatus() {
  const total = Object.values(S.chats).filter((c) => !c.muted).reduce((s, c) => s + (c.unread || 0), 0);
  const drafts = Object.values(S.drafts).filter(Boolean).length;
  // chat ID only while a conversation is on screen — Inbox/Settings/wizard leave it blank
  const c = (window.CM2?.route() ?? 'shell') === 'shell' ? S.chats[S.active] : null;
  $('#statusbar').innerHTML = `<div>${S.accounts.map((a) => `<span class="acc-status" style="${connVar(a)}"><span class="conn-dot"></span>${esc(a.name)}
      ${a.sync === 'ok' ? `<span class="ok">${icon('check')} ${esc(a.syncText)}</span>` : `<span class="warn">${icon('refresh-cw', 'spin')} ${esc(a.syncText)}</span>`}</span>`).join('')}</div>
    <div class="right-status">${c ? `<span>${esc(c.chatId)}</span>` : ''}<span>${total} chưa đọc</span><span>${drafts} nháp</span><span><kbd class="kbd">⌘K</kbd> lệnh</span></div>`;
  window.CM2?.decorateStatus();
}

function renderAll() {
  if (window.CM2?.renderRoute()) return;
  if (S.active && !S.chats[S.active]) S.active = S.tabs[0] || null;
  const c = S.chats[S.active];
  if (c && c.unread) { c.unread = 0; c.mention = false; }
  if (S.thread && S.thread.chat !== S.active) S.thread = null;
  renderSidebar(); renderTabs(); renderConv(); renderInspector(); renderStatus();
}

// ── Actions ──────────────────────────────────────────────────────────────────
function openChat(id) {
  window.CM2?.showShell();
  if (!S.tabs.includes(id)) { const i = S.tabs.indexOf(S.active); S.tabs.splice(i + 1, 0, id); }
  S.active = id; S.inspTab = 'info'; renderAll(); focusComposer();
}
function closeTab(id) {
  const i = S.tabs.indexOf(id); S.tabs.splice(i, 1);
  if (S.active === id) S.active = S.tabs[Math.min(i, S.tabs.length - 1)] || null;
  renderAll();
}
function cycleTab(d) { if (!S.tabs.length) return; const i = S.tabs.indexOf(S.active); openChat(S.tabs[(i + d + S.tabs.length) % S.tabs.length]); }
function jumpUnread(d) {
  const order = S.accounts.flatMap((a) => Object.values(S.chats).filter((c) => c.acc === a.id));
  const i = order.findIndex((c) => c.id === S.active);
  for (let k = 1; k <= order.length; k++) { const c = order[(i + d * k + order.length * k) % order.length]; if (c.unread) return openChat(c.id); }
  toast('Không còn chat chưa đọc');
}
function jumpTo(mid) {
  const el = document.getElementById(mid); if (!el) return;
  el.scrollIntoView({ block: 'center', behavior: 'smooth' }); el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash');
}
function msgById(mid) { const c = S.chats[S.active]; return c.messages.find((y) => y.id === mid); }

let toastT;
function toast(text, ic = 'check') {
  const r = $('#overlay-root'); r.querySelector('.toast')?.remove();
  r.insertAdjacentHTML('beforeend', `<div class="toast" role="status">${icon(ic)}<div class="toast-body">${esc(text)}</div></div>`);
  clearTimeout(toastT); toastT = setTimeout(() => r.querySelector('.toast')?.remove(), 2600);
}

// popovers: one at a time
function closePop() { document.querySelectorAll('.emoji-pop, .index-context-menu').forEach((n) => n.remove()); }
function placePop(node, anchor) {
  document.body.appendChild(node);
  const r = anchor.getBoundingClientRect(); const w = node.offsetWidth, h = node.offsetHeight;
  let x = Math.min(r.left, innerWidth - w - 12), y = r.bottom + 6;
  if (y + h > innerHeight - 36) y = r.top - h - 6;
  node.style.left = Math.max(12, x) + 'px'; node.style.top = Math.max(48, y) + 'px';
  node.querySelector('button')?.focus();
}
const EMOJI = ['👍', '❤️', '😂', '😮', '😢', '🙏', '🔥', '👀', '✅', '💯', '🫡', '🎉', '🤔', '😅', '🚀', '👏'];
function emojiPop(anchor, onPick) {
  closePop();
  const n = document.createElement('div'); n.className = 'emoji-pop'; n.setAttribute('role', 'menu');
  n.innerHTML = EMOJI.map((e) => `<button role="menuitem" aria-label="${e}">${e}</button>`).join('');
  n.addEventListener('click', (ev) => { const b = ev.target.closest('button'); if (b) { onPick(b.textContent); closePop(); } });
  placePop(n, anchor);
}
function toggleReaction(x, e) {
  x.reactions ||= [];
  const r = x.reactions.find((y) => y.e === e);
  if (!r) x.reactions.push({ e, n: 1, mine: true });
  else if (r.mine) { r.n--; r.mine = false; if (!r.n) x.reactions.splice(x.reactions.indexOf(r), 1); }
  else { r.n++; r.mine = true; }
  renderMsgs(false);
}
function moreMenu(anchor, x) {
  closePop();
  const c = S.chats[S.active]; const cap = caps(c); const mine = x.from === 'me';
  const items = [
    ['reply', 'Trả lời', 'R', () => setReply(x.id)],
    ['copy', 'Sao chép văn bản', '⌘C', () => { navigator.clipboard?.writeText(plain(x)); toast('Đã sao chép'); }],
    ['forward', 'Chuyển tiếp…', '', () => openPalette('chats', 'Chuyển tiếp tới…')],
    cap.pin && ['pin', x.pinned ? 'Bỏ ghim' : 'Ghim', '', () => { x.pinned = !x.pinned; renderInspector(); toast(x.pinned ? 'Đã ghim tin nhắn' : 'Đã bỏ ghim'); }],
    mine && cap.edit && x.text && ['pencil', 'Sửa', '↑', () => { S.editing[c.id] = x.id; S.replyTo[c.id] = null; S.drafts[c.id] = x.text; renderComposer(); focusComposer(); }],
    mine && cap.delete && ['trash-2', 'Xoá với mọi người', '⌫', () => confirmDialog('Xoá tin nhắn này với mọi người?', `“${plain(x).slice(0, 80)}” sẽ bị xoá khỏi ${PLATFORMS[acc(c.acc).platform].name} cho tất cả thành viên.`, 'Xoá', () => { x.type = 'deleted'; renderMsgs(false); renderSidebar(); }), true],
  ].filter(Boolean);
  const n = document.createElement('div'); n.className = 'index-context-menu'; n.setAttribute('role', 'menu');
  n.innerHTML = items.map(([ic, l, k, , d], i) => `<button class="context-item${d ? ' danger' : ''}" role="menuitem" data-i="${i}">${icon(ic)}<span>${l}</span><kbd>${k}</kbd></button>`).join('');
  n.addEventListener('click', (ev) => { const b = ev.target.closest('[data-i]'); if (b) { closePop(); items[b.dataset.i][3](); } });
  placePop(n, anchor);
}
function setReply(mid) { const c = S.chats[S.active]; S.replyTo[c.id] = mid; S.editing[c.id] = null; renderComposer(); focusComposer(); }

function confirmDialog(title, msg, okLabel, onOk) {
  const r = $('#overlay-root');
  r.insertAdjacentHTML('beforeend', `<div class="modal" id="dlg"><div class="prompt-dialog" role="alertdialog" aria-modal="true" aria-labelledby="dlg-t"><h3 id="dlg-t">${esc(title)}</h3><p class="prompt-dialog-msg">${esc(msg)}</p>
    <div class="prompt-dialog-foot"><button class="tool-btn" data-dlg="cancel">Huỷ <kbd class="kbd">Esc</kbd></button><button class="tool-btn danger" data-dlg="ok">${esc(okLabel)}</button></div></div></div>`);
  const d = $('#dlg'); d.querySelector('[data-dlg="cancel"]').focus();
  d.addEventListener('click', (e) => { const b = e.target.closest('[data-dlg]'); if (e.target === d || b) { d.remove(); if (b?.dataset.dlg === 'ok') onOk(); } });
}
function promptDialog(title, value, onOk) {
  const r = $('#overlay-root');
  r.insertAdjacentHTML('beforeend', `<div class="modal" id="dlg"><form class="prompt-dialog" role="dialog" aria-modal="true" aria-labelledby="dlg-t"><h3 id="dlg-t">${esc(title)}</h3><input type="text" id="dlg-in" value="${esc(value)}" aria-label="${esc(title)}" />
    <div class="prompt-dialog-foot"><button type="button" class="tool-btn" data-dlg="cancel">Huỷ</button><button type="submit" class="tool-btn primary">Lưu</button></div></form></div>`);
  const d = $('#dlg'); const inp = $('#dlg-in'); inp.focus(); inp.select();
  d.addEventListener('click', (e) => { if (e.target === d || e.target.closest('[data-dlg="cancel"]')) d.remove(); });
  d.querySelector('form').addEventListener('submit', (e) => { e.preventDefault(); const v = inp.value.trim(); d.remove(); if (v) onOk(v); });
}

function activeAccount() { return acc(S.chats[S.active]?.acc) || S.accounts[0]; }
function renameAccount() {
  const a = activeAccount(); if (!a) return;
  promptDialog(`Đổi tên account ${PLATFORMS[a.platform].name}`, a.name, (v) => { a.name = v; renderAll(); toast(`Đã đổi tên thành “${v}”`); });
}
function deleteAccount() {
  const a = activeAccount(); if (!a) return;
  confirmDialog(`Xoá account “${a.name}”?`, `ChatMin sẽ đăng xuất ${a.handle} và xoá cache tin nhắn trên máy này. Tài khoản ${PLATFORMS[a.platform].name} của bạn không bị ảnh hưởng.`, 'Xoá account', () => {
    for (const id of Object.keys(S.chats)) if (S.chats[id].acc === a.id) { delete S.chats[id]; S.tabs = S.tabs.filter((t) => t !== id); }
    S.accounts = S.accounts.filter((x) => x !== a); S.active = S.tabs[0] || null; renderAll(); toast(`Đã xoá account ${a.name}`);
  });
}

// ── Command palette (⌘K chats & commands · ⌘⇧F message search) ──────────────
let pal = null;
function openPalette(mode = 'chats', placeholder) {
  closePop(); $('#palette-root')?.remove();
  pal = { mode, sel: 0, items: [] };
  $('#overlay-root').insertAdjacentHTML('beforeend', `<div class="command" id="palette-root"><div class="palette" role="dialog" aria-modal="true" aria-label="Command palette">
    <input id="pal-in" placeholder="${esc(placeholder || (mode === 'msgs' ? 'Tìm nội dung tin nhắn trong mọi account…' : 'Nhảy tới chat, người, hoặc gõ lệnh…'))}" aria-label="Tìm" autocomplete="off" />
    <div class="palette-mode"><span class="${mode === 'chats' ? 'on' : ''}">Chat & lệnh <kbd class="kbd">⌘K</kbd></span><span class="${mode === 'msgs' ? 'on' : ''}">Tin nhắn <kbd class="kbd">⌘⇧F</kbd></span></div>
    <div class="cmd-list" id="pal-list" role="listbox"></div>
    <div class="palette-foot"><span>↑↓ chọn</span><span>↵ mở</span><span>Esc đóng</span></div></div></div>`);
  const root = $('#palette-root');
  root.addEventListener('click', (e) => { if (e.target === root) closePalette(); const it = e.target.closest('[data-pi]'); if (it) runPal(+it.dataset.pi); });
  const inp = $('#pal-in'); inp.addEventListener('input', palRender); inp.focus(); palRender();
}
function closePalette() { $('#palette-root')?.remove(); pal = null; }
const COMMANDS = [
  ['user-plus', 'Thêm account', '⌘N', () => window.CM2.startWizard()],
  ['message-square-text', 'Tìm trong tin nhắn', '⌘⇧F', () => openPalette('msgs')],
  ['pencil', 'Đổi tên account hiện tại', '⌘E', renameAccount],
  ['palette', 'Đổi theme', '', () => { $('#appearance-menu').open = true; $('#theme-select').focus(); }],
  ['panel-right', 'Ẩn/hiện inspector', '⌘I', () => toggleInspector()],
  ['trash-2', 'Xoá account hiện tại…', '⌘⌫', deleteAccount],
];
function palRender() {
  const q = norm($('#pal-in').value.trim());
  const list = $('#pal-list'); let html = ''; pal.items = [];
  const push = (h, run) => { html += h.replace('%I', pal.items.length); pal.items.push(run); };
  if (pal.mode === 'chats') {
    const chats = Object.values(S.chats).filter((c) => !q || norm(c.name).includes(q) || norm(acc(c.acc).name).includes(q));
    html += `<div class="cmd-group">${q ? 'Chat' : 'Gần đây'}</div>`;
    chats.slice(0, q ? 12 : 6).forEach((c) => { const a = acc(c.acc);
      push(`<div class="cmd" role="option" data-pi="%I">${avatar(c, 'sm')}<span class="cmd-main"><span>${esc(c.name)}</span>${c.unread ? `<span class="badge ${c.muted ? 'idle' : 'unread'}">${c.unread}</span>` : ''}</span><span class="cmd-acc" style="${connVar(a)}"><span class="conn-dot"></span>${glyph(a.platform)}${esc(a.name)}</span></div>`, () => openChat(c.id)); });
    if (!chats.length) html += `<div class="empty-note">Không có chat nào khớp “${esc($('#pal-in').value)}”</div>`;
    const cmds = COMMANDS.filter(([, l]) => !q || norm(l).includes(q));
    if (cmds.length) html += `<div class="cmd-group">Lệnh</div>`;
    cmds.forEach(([ic, l, k, run]) => push(`<div class="cmd" role="option" data-pi="%I">${icon(ic)}<span class="cmd-main"><span>${l}</span></span>${k ? `<kbd class="kbd">${k}</kbd>` : '<span></span>'}</div>`, run));
  } else {
    if (q.length < 2) html = `<div class="empty-note">Gõ ít nhất 2 ký tự — tìm xuyên ${S.accounts.length} account, không dấu cũng được</div>`;
    else {
      const hits = [];
      for (const c of Object.values(S.chats)) for (const x of realMsgs(c)) { const t = plain(x); if (x.type !== 'deleted' && norm(t).includes(q)) hits.push([c, x, t]); }
      html += `<div class="cmd-group">${hits.length} kết quả</div>`;
      hits.slice(0, 30).forEach(([c, x, t]) => { const a = acc(c.acc);
        const i = norm(t).indexOf(q); const snip = esc(t.slice(Math.max(0, i - 30), i)) + '<mark>' + esc(t.slice(i, i + q.length)) + '</mark>' + esc(t.slice(i + q.length, i + q.length + 80));
        push(`<div class="cmd msg-hit" role="option" data-pi="%I">${personAvatar(x.from === 'me' ? 'me' : x.from, 'sm')}<span style="min-width:0"><span class="cmd-main"><span><b>${esc(personName(x.from))}</b> · ${esc(c.name)}</span></span><span class="snip">${i > 30 ? '…' : ''}${snip}</span></span><span class="cmd-acc" style="${connVar(a)}"><span class="conn-dot"></span>${esc(x.time)}</span></div>`, () => { openChat(c.id); setTimeout(() => jumpTo(x.id), 60); }); });
      if (!hits.length) html += `<div class="empty-note">Không thấy tin nào chứa “${esc($('#pal-in').value)}”</div>`;
    }
  }
  list.innerHTML = html; pal.sel = Math.min(pal.sel, Math.max(0, pal.items.length - 1)); palSel();
}
function palSel() { document.querySelectorAll('#pal-list [data-pi]').forEach((n) => { const on = +n.dataset.pi === pal.sel; n.classList.toggle('active', on); n.setAttribute('aria-selected', on); if (on) n.scrollIntoView({ block: 'nearest' }); }); }
function runPal(i) { const run = pal.items[i]; closePalette(); run?.(); }

function toggleInspector(force) {
  const off = force ?? !document.body.classList.contains('right-collapsed');
  document.body.classList.toggle('right-collapsed', off);
  $('#btn-right').classList.toggle('active', !off); $('#btn-right').setAttribute('aria-pressed', !off);
}

// ── Events ───────────────────────────────────────────────────────────────────
document.addEventListener('click', (e) => {
  const t = e.target.closest('button, [data-tab], a.link-card'); if (!t) { closePop(); return; }
  if (!t.closest('.emoji-pop, .index-context-menu')) closePop();
  const d = t.dataset;
  if (d.close) { e.stopPropagation(); return closeTab(d.close); }
  if (d.tab) return openChat(d.tab);
  if (d.open) return openChat(d.open);
  if (d.filter) { S.filter = d.filter; return renderSidebar(); }
  if (d.collapse) { S.collapsed[d.collapse] = !S.collapsed[d.collapse]; return renderSidebar(); }
  if (d.insp) { S.inspTab = d.insp; return renderInspector(); }
  if (d.reply) return setReply(d.reply);
  if (d.react) return emojiPop(t, (em) => toggleReaction(msgById(d.react), em));
  if (d.reactToggle) { const [mid, i] = d.reactToggle.split(':'); const x = msgById(mid); return toggleReaction(x, x.reactions[i].e); }
  if (d.more) return moreMenu(t, msgById(d.more));
  if (d.jump) return jumpTo(d.jump);
  if (d.thread) { S.thread = { chat: S.active, msg: d.thread }; toggleInspector(false); renderInspector(); renderMsgs(false); return $('#thread-input')?.focus(); }
  if (d.retry) { const x = msgById(d.retry); x.status = 'sending'; renderMsgs(false); setTimeout(() => { x.status = 'sent'; refreshMsgs(S.chats[S.active]); toast('Đã gửi lại'); }, 800); return; }
  if (d.off) return toast(CAP_OFF_NOTE[d.off], 'info');
  switch (d.act || t.id) {
    case 'send': return send();
    case 'attach': return $('#file-input').click();
    case 'emoji': return emojiPop(t, (em) => { const ta = $('#composer-input'); const p = ta.selectionStart ?? ta.value.length; ta.value = ta.value.slice(0, p) + em + ta.value.slice(p); ta.dispatchEvent(new Event('input')); focusComposer(); });
    case 'sticker': return toast('Sticker chưa có dữ liệu trong prototype', 'info');
    case 'voice': return toast('Giữ nút để ghi âm (prototype)', 'info');
    case 'cancel-reply': { const c = S.chats[S.active]; if (S.editing[c.id]) S.drafts[c.id] = ''; S.replyTo[c.id] = S.editing[c.id] = null; renderComposer(); return focusComposer(); }
    case 'toggle-insp': return toggleInspector();
    case 'pins': S.inspTab = 'pinned'; S.thread = null; toggleInspector(false); return renderInspector();
    case 'search-in': return openPalette('msgs', `Tìm trong ${S.chats[S.active].name}…`);
    case 'close-thread': S.thread = null; renderInspector(); return renderMsgs(false);
    case 'thread-send': return threadSend();
    case 'download': return toast('Đang tải về ~/Downloads', 'download');
    case 'more-members': return toast('Tải thêm 50 thành viên…', 'users');
    case 'open-palette': case 'tab-add': return openPalette('chats');
    case 'btn-msg-search': return openPalette('msgs');
    case 'btn-add-account': return window.CM2.startWizard();
    case 'btn-settings': return window.CM2.navigate('settings');
    case 'btn-left': { const off = document.body.classList.toggle('left-collapsed'); t.classList.toggle('active', !off); return t.setAttribute('aria-pressed', !off); }
    case 'btn-right': return toggleInspector();
    case 'all-inbox': return window.CM2.navigate('inbox');
  }
});
document.addEventListener('auxclick', (e) => { const t = e.target.closest('[data-tab]'); if (e.button === 1 && t) closeTab(t.dataset.tab); });
document.addEventListener('change', (e) => {
  if (e.target.dataset.act === 'mute') { const c = S.chats[S.active]; c.muted = !e.target.checked; renderSidebar(); renderStatus(); toast(c.muted ? 'Đã tắt thông báo' : 'Đã bật thông báo', c.muted ? 'bell-off' : 'bell'); }
});

document.addEventListener('input', (e) => {
  if (e.target.id === 'composer-input') {
    const c = S.chats[S.active]; grow(e.target);
    if (!S.editing[c.id]) S.drafts[c.id] = e.target.value;
    $('#draft-note').textContent = e.target.value.trim() && !S.editing[c.id] ? 'Nháp đã lưu cho tab này' : '';
    renderTabs(); renderStatus();
  } else if (e.target.id === 'side-filter') { S.query = e.target.value; renderSidebar(); }
  else if (e.target.id === 'thread-input') grow(e.target);
});

$('#file-input').addEventListener('change', (e) => {
  const f = e.target.files[0]; if (!f) return; const c = S.chats[S.active];
  const size = f.size > 1e6 ? (f.size / 1e6).toFixed(1) + ' MB' : Math.max(1, Math.round(f.size / 1e3)) + ' KB';
  const x = { id: 'm' + (++_id), type: 'text', from: 'me', time: nowHM(), text: '', file: { name: f.name, size }, status: 'sending' };
  c.messages.push(x); renderMsgs(true); renderSidebar();
  setTimeout(() => { x.status = 'sent'; refreshMsgs(c); }, 900); e.target.value = '';
});

function threadSend() {
  const ta = $('#thread-input'); const t = ta.value.trim(); if (!t) return;
  const root = S.chats[S.thread.chat].messages.find((y) => y.id === S.thread.msg);
  root.thread.push({ id: 'm' + (++_id), from: 'me', time: nowHM(), text: t });
  renderInspector(); renderMsgs(false); const sc = $('#thread-scroll'); sc.scrollTop = sc.scrollHeight; $('#thread-input').focus();
}

document.addEventListener('keydown', (e) => {
  const mod = e.metaKey || e.ctrlKey; const k = e.key;
  const inField = e.target.matches('input, textarea, select');
  if (pal) {
    if (k === 'Escape') { e.preventDefault(); return closePalette(); }
    if (k === 'ArrowDown' || k === 'ArrowUp') { e.preventDefault(); pal.sel = (pal.sel + (k === 'ArrowDown' ? 1 : -1) + pal.items.length) % Math.max(1, pal.items.length); return palSel(); }
    if (k === 'Enter') { e.preventDefault(); return runPal(pal.sel); }
  }
  if (k === 'Escape') {
    if ($('#dlg')) return $('#dlg').remove();
    if (document.querySelector('.emoji-pop, .index-context-menu')) return closePop();
    const c = S.chats[S.active];
    if (c && (S.replyTo[c.id] || S.editing[c.id])) { e.preventDefault(); if (S.editing[c.id]) S.drafts[c.id] = ''; S.replyTo[c.id] = S.editing[c.id] = null; renderComposer(); return focusComposer(); }
    if (S.thread) { S.thread = null; renderInspector(); return renderMsgs(false); }
    return;
  }
  if (e.target.id === 'composer-input' && k === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); return send(); }
  if (e.target.id === 'composer-input' && k === 'ArrowUp' && !e.target.value) {
    const c = S.chats[S.active]; const last = [...c.messages].reverse().find((y) => y.from === 'me' && y.type === 'text' && y.text);
    if (last && caps(c).edit) { e.preventDefault(); S.editing[c.id] = last.id; S.drafts[c.id] = last.text; renderComposer(); return focusComposer(); }
  }
  if (e.target.id === 'thread-input' && k === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); return threadSend(); }
  if (e.target.matches('[data-tab]') && (k === 'Enter' || k === ' ')) { e.preventDefault(); return openChat(e.target.dataset.tab); }
  if (!mod) return;
  if (k === 'k' && !e.shiftKey) { e.preventDefault(); return pal ? closePalette() : openPalette('chats'); }
  if ((k === 'f' || k === 'F') && e.shiftKey) { e.preventDefault(); return openPalette('msgs'); }
  if (k === '[' || k === ']') { e.preventDefault(); return cycleTab(k === ']' ? 1 : -1); }
  if (k === 'ArrowUp' || k === 'ArrowDown') { e.preventDefault(); return jumpUnread(k === 'ArrowDown' ? 1 : -1); }
  if (/^[1-9]$/.test(k)) { const a = S.accounts[+k - 1]; if (a) { e.preventDefault(); const c = Object.values(S.chats).find((x) => x.acc === a.id); if (c) openChat(c.id); } return; }
  if (k === 'e') { e.preventDefault(); return renameAccount(); }
  if (k === 'Backspace' && !inField) { e.preventDefault(); return deleteAccount(); }
  if (k === 'w') { e.preventDefault(); if (S.active) closeTab(S.active); return; }
  if (k === 'i') { e.preventDefault(); return toggleInspector(); }
  if (k === 'b') { e.preventDefault(); return $('#btn-left').click(); }
});

// tooltips: [data-tip] + optional [data-kbd] pill
const tip = $('#tip');
function showTip(el) {
  const t = el.closest('[data-tip]'); if (!t) return;
  tip.innerHTML = `<span>${esc(t.dataset.tip)}</span>${t.dataset.kbd ? `<kbd class="kbd">${esc(t.dataset.kbd)}</kbd>` : ''}`;
  const r = t.getBoundingClientRect(); tip.classList.add('on');
  const w = tip.offsetWidth, h = tip.offsetHeight;
  let y = r.bottom + 6; if (y + h > innerHeight - 32) y = r.top - h - 6;
  tip.style.left = Math.max(8, Math.min(r.left + r.width / 2 - w / 2, innerWidth - w - 8)) + 'px'; tip.style.top = y + 'px';
}
document.addEventListener('mouseover', (e) => (e.target.closest('[data-tip]') ? showTip(e.target) : tip.classList.remove('on')));
document.addEventListener('focusin', (e) => (e.target.matches('[data-tip]') && e.target.matches(':focus-visible') ? showTip(e.target) : tip.classList.remove('on')));
document.addEventListener('scroll', () => tip.classList.remove('on'), true);

// resize docks (live: --left-w / --right-w on body)
document.querySelectorAll('[data-resize]').forEach((h) => h.addEventListener('pointerdown', (e) => {
  const side = h.dataset.resize; h.setPointerCapture(e.pointerId); document.body.classList.add('resizing');
  const move = (ev) => {
    const w = side === 'left' ? Math.min(420, Math.max(220, ev.clientX)) : Math.min(480, Math.max(280, innerWidth - ev.clientX));
    document.body.style.setProperty(side === 'left' ? '--left-w' : '--right-w', w + 'px');
  };
  const up = () => { document.body.classList.remove('resizing'); h.removeEventListener('pointermove', move); h.removeEventListener('pointerup', up); };
  h.addEventListener('pointermove', move); h.addEventListener('pointerup', up);
}));

// themes: light-base palettes also get body.light (mirrors design-systems/index.html)
const LIGHT = ['light', 'soft-light', 'rose-milk', 'sakura-pastel', 'bearded-solarized-light'];
$('#theme-select').addEventListener('change', (e) => {
  const v = e.target.value;
  if (v) document.body.dataset.theme = v; else delete document.body.dataset.theme;
  document.body.classList.toggle('light', LIGHT.includes(v));
  $('#appearance-menu').open = false;
});

document.addEventListener('click', (event) => {
  if (!event.target.closest('#appearance-menu')) $('#appearance-menu').open = false;
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && $('#appearance-menu').open) {
    $('#appearance-menu').open = false;
    $('#appearance-menu summary').focus();
  }
});

renderAll();
