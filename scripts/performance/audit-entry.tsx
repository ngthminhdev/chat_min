// UI/UX audit benchmark: the real <App/> with a fake provider API (no account, no network,
// nothing is ever sent). Runs unchanged against older builds so before/after use one script:
// scenarios a build doesn't support yet report ok:false instead of aborting the run.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import App from '../../src/App';
import * as store from '../../src/store';
import { api } from '../../src/lib/bridge';
import { DateTimeModal } from '../../src/ui/DateTimeModal';
import * as WizardView from '../../src/views/Wizard';
import '../../src/styles/tokens.css';
import '../../src/styles/themes.css';
import '../../src/styles/base.css';
import '../../src/styles/layout.css';
import '../../src/styles/components.css';
import '../../src/styles/chatmin.css';

const { useApp } = store;
const S = store as any;
document.head.insertAdjacentHTML('beforeend', '<style>#root{height:100vh}</style>');
const params = new URLSearchParams(location.search);
const provider = params.get('provider') === 'gchat' ? 'gchat' : 'telegram';
const LIVE_MS = Number(params.get('live') || 120);
const A = provider === 'gchat' ? 'gc-perf' : 'tg-perf';
const kA = provider === 'gchat' ? `${A}|spaces/A` : `${A}|1`;
const kB = provider === 'gchat' ? `${A}|spaces/B` : `${A}|2`;
const kC = provider === 'gchat' ? `${A}|spaces/C` : `${A}|3`;
const kF = `${A}|-100900`;
const BIG_THREAD = 'spaces/A/threads/big';
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// ── fixture ────────────────────────────────────────────────────────────────
const msg = (k: string, i: number, extra: Record<string, unknown> = {}) => {
  const [accountId, chatId] = k.split('|');
  return { accountId, chatId, id: `${chatId}-${i}`, sort: i + 1, ts: 1_700_000_000_000 + i * 60_000, senderId: 'peer' + (i % 4), senderName: 'Person ' + (i % 4), senderPhoto: '', outgoing: false, edited: false, deleted: false, kind: 'text',
    text: i % 9 === 0 ? `Example ${i}\n\`\`\`\nfunc handle(w http.ResponseWriter) {\n  rows, err := db.Query("SELECT 1")\n}\n\`\`\`` : `Message ${i} with *bold* and https://example.com/p/${i} ordinary text for the timeline.`,
    media: null, link: null, replyTo: '', replyName: '', replyText: '', reactions: [], threadId: '', threadReply: false, status: 'sent', error: '', pinned: false, mentionsMe: false, rev: '1', ...extra };
};
const chat = (k: string, title: string, kind: string, extra: Record<string, unknown> = {}) => {
  const [accountId, id] = k.split('|');
  return { accountId, id, kind, description: '', lastTs: 1_700_000_000_000, preview: 'Preview of ' + title, previewFrom: '', mention: false, muted: false, memberCount: 4, order: 0, pinned: false, created: '', title, photo: '', photoRef: '', canSend: true, unread: 0, threaded: false, ...extra };
};
const chats: Record<string, any> = {};
const pages: Record<string, any[]> = {};
chats[kA] = chat(kA, 'Perf A', provider === 'gchat' ? 'space' : 'group', { threaded: provider === 'gchat', order: 1000, lastTs: 1_800_000_000_000 });
chats[kB] = chat(kB, 'Perf B', 'dm', { order: 999, lastTs: 1_799_999_000_000 });
chats[kC] = chat(kC, 'Perf C', provider === 'gchat' ? 'space' : 'group', { threaded: provider === 'gchat', order: 998, lastTs: 1_799_998_000_000 });
pages[kA] = Array.from({ length: 1000 }, (_, i) => msg(kA, i, provider === 'gchat' ? { threadId: `spaces/A/threads/t${i}` } : {}));
pages[kB] = Array.from({ length: 1000 }, (_, i) => msg(kB, i));
pages[kC] = Array.from({ length: 300 }, (_, i) => msg(kC, i));
// the big Google Chat thread: root + 300 replies, of which the "server" thread page returns the newest 20
const bigRoot = msg(kA, 2000, { id: 'big-root', sort: 1500, text: 'Thread with 300 replies', threadId: BIG_THREAD });
const bigReplies = Array.from({ length: 300 }, (_, i) => msg(kA, 3000 + i, { id: `big-r${i}`, sort: 1501 + i, text: `Reply ${i} in the big thread`, threadId: BIG_THREAD, threadReply: true }));
if (provider === 'gchat') pages[kA] = [...pages[kA], bigRoot, ...bigReplies.slice(-20)].sort((a, b) => a.sort - b.sort);
// Telegram forum: topic 7 has 1000 messages, ids 5000..5999
const topicMsgs = Array.from({ length: 1000 }, (_, i) => msg(kF, i, { id: String(5000 + i), sort: 5000 + i, text: `Topic message ${5000 + i}`, threadId: '7' }));
const topics = [{ accountId: A, chatId: '-100900', id: '7', name: 'Dev', color: 0, unread: 0, mention: false, lastTs: 2, preview: '', previewFrom: '', pinned: false, closed: false, general: false },
  { accountId: A, chatId: '-100900', id: '3', name: 'Ops', color: 0, unread: 0, mention: false, lastTs: 1, preview: '', previewFrom: '', pinned: false, closed: false, general: false }];
if (provider === 'telegram') { chats[kF] = chat(kF, 'Forum', 'group', { forum: true, order: 997, lastTs: 1_799_997_000_000 }); pages[kF] = topicMsgs.slice(-50); }
for (let i = 0; i < 220; i++) {
  const k = `${A}|f${i}`;
  chats[k] = chat(k, `Perf filler ${i}`, i % 2 ? 'dm' : provider === 'gchat' ? 'space' : 'group', { order: 900 - i, lastTs: 1_700_000_000_000 + (220 - i) * 1000, unread: i % 3 === 2 ? 0 : 1 + (i % 7), mention: i % 5 === 0 });
  pages[k] = Array.from({ length: 30 }, (_, j) => msg(k, j));
}

// ── fake provider API (records every call) ──────────────────────────────────
const calls: any[] = [];
const rec = (name: string, args: unknown[]) => calls.push([name, ...args]);
let sendAttempts = 0;
const live = (k: string, before: number, limit: number) => {
  const list = pages[k] ?? [];
  const older = before > 0 ? list.filter(m => m.sort < before) : list;
  return structuredClone(older.slice(-limit));
};
const fakeContext = (k: string, id: string, thread: string, connectTo: number) => {
  const all = provider === 'gchat' && thread === BIG_THREAD ? [bigRoot, ...bigReplies] : thread === '7' ? topicMsgs : pages[k] ?? [];
  const i = all.findIndex(m => m.id === id);
  if (i < 0) return [];
  return structuredClone(all.filter((m, j) => j >= i - 20 && (connectTo > m.sort || (connectTo <= 0 && j <= i + 40))));
};
// the real native log, kept before the fake API replaces it: the native audit app reports here
const nativeLog = api.logJs;
Object.assign(api, {
  uiState: async () => null, uiStateSet: async () => {}, logJs: async () => {}, setOpen: async () => {}, markRead: async (...a: unknown[]) => { rec('markRead', a); return true; },
  appState: async () => ({ accounts: useApp.getState().accounts, chats: Object.values(chats), health: {}, tgConfigured: true, gchatConfigured: true, mutedThreads: [] }),
  inbox: async () => [], presence: async () => [], members: async () => [], seenBy: async () => [], pinned: async () => [], reactions: async () => null,
  cachedMessages: async (_a: string, c: string, limit: number) => { rec('cachedMessages', [c]); await sleep(5); const k = `${A}|${c}`; return [live(k, 0, limit), []]; },
  messages: async (_a: string, c: string, before: number, limit: number) => { rec('messages', [c, before]); if (failChats.has(c)) { await sleep(30); throw 'network unreachable (fake)'; } await sleep(slowChats.has(c) ? 2500 : LIVE_MS); const k = `${A}|${c}`; const page = live(k, before, limit); if (before === 0 && page.length) page.push({ ...page.at(-1), id: `${c}-live`, sort: page.at(-1).sort + 0.5, text: 'Arrived with the live page' }); return page; },
  primaryMessages: async (_a: string, c: string, before: number, limit: number) => { const k = `${A}|${c}`; const list = (pages[k] ?? []).filter(m => !m.threadReply && (before <= 0 || m.sort < before)).slice(-limit); return { messages: structuredClone(list), before: list[0]?.sort ?? before, hasMore: list.length >= limit }; },
  thread: async (_a: string, _c: string, t: string, token: string) => { rec('thread', [t, token]); await sleep(LIVE_MS); return t === BIG_THREAD ? { messages: structuredClone(token ? [] : bigReplies.slice(-20)), nextPageToken: token ? '' : 'older' } : { messages: [], nextPageToken: '' }; },
  threadRoot: async (_a: string, _c: string, t: string) => t === BIG_THREAD ? [structuredClone(bigRoot)] : [],
  threadList: async (...a: any[]) => { rec('threadList', a); await sleep(a[4] ? LIVE_MS : 5); return { threads: [], hasMore: !a[4] }; }, // like a real cache: local pages may have more, the remote walk ends
  threadCount: async () => ({ count: 0, exact: false }),
  topics: async (...a: unknown[]) => { rec('topics', a); await sleep(300); return structuredClone(topics); },
  topicHistory: async (_a: string, _c: string, t: string, before: number, limit: number) => { rec('topicHistory', [t, before, limit]); await sleep(LIVE_MS); const list = topicMsgs.filter(m => before <= 0 || m.sort < before); return structuredClone(list.slice(-limit)); },
  messageContext: async (_a: string, c: string, id: string, thread = '', connectTo = 0) => { rec('messageContext', [c, id, thread, connectTo]); await sleep(10); return fakeContext(`${A}|${c}`, id, thread, connectTo); },
  search: async (q: string) => { rec('search', [q]); await sleep(searchDelay); return structuredClone(searchHits.filter(m => !searchFilter || String(m.text).includes(q))); },
  members: async () => { rec('members', []); if (membersFail-- > 0) throw 'members unavailable (fake)'; return Array.from({ length: 6 }, (_, i) => ({ id: 'u' + i, name: 'Member ' + i, status: '', role: '' })); },
  webShow: async (...a: unknown[]) => { rec('webShow', a); if (webFail-- > 0) throw 'webview failed to open (fake)'; },
  todoList: async () => structuredClone(todos), todoTakeOpen: async () => null,
  webHide: async () => {}, webReload: async (...a: unknown[]) => { rec('webReload', a); },
  clipboardFiles: async () => ['/tmp/chatmin-fake/photo.png'],
  // native shell: the real stage_files drops paths that don't exist; the fake file is staged as is
  stageFiles: async (paths: string[]) => paths.map(path => ({ path, name: path.split('/').pop() ?? path, size: 2048 })),
  send: async (a: any) => { rec('send', [a]); sendAttempts++; await sleep(20); if (sendAttempts % 2 === 1) throw 'upload failed: connection reset (fake API)'; return { ...msg(`${a.accountId}|${a.chatId}`, 90_000 + sendAttempts), id: 'sent-' + sendAttempts, outgoing: true, text: a.text, threadId: a.threadId ?? '', threadReply: !!a.threadId && provider === 'gchat' }; },
  deleteMsg: async () => {},
});
let searchHits: any[] = [];
let todos: any[] = [];
let searchDelay = 0, searchFilter = false, membersFail = 0, webFail = 0;
const slowChats = new Set<string>(), failChats = new Set<string>();

useApp.setState({ accounts: [{ id: A, platform: provider, name: 'Perf', color: 'blue', handle: '', selfId: 'self' }] as any, booted: true, chats, msgs: { [kA]: structuredClone(pages[kA]), [kB]: structuredClone(pages[kB]) },
  active: kA, tabs: [kA, kB], older: { [kA]: 'done', [kB]: 'done' }, rightCollapsed: true, route: 'shell' } as any);
const root = createRoot(document.getElementById('root')!);
flushSync(() => root.render(<App />));

// ── measurement helpers ─────────────────────────────────────────────────────
const frame = () => new Promise<number>(r => requestAnimationFrame(r));
const frames = async (n: number) => { for (let i = 0; i < n; i++) await frame(); };
const stats = (xs: number[]) => { const a = [...xs].sort((x, y) => x - y); const q = (p: number) => a.length ? Math.round(a[Math.min(a.length - 1, Math.floor(a.length * p))] * 10) / 10 : null; return { n: a.length, p50: q(0.5), p95: q(0.95), max: a.length ? Math.round(a.at(-1)! * 10) / 10 : null, over25: a.filter(x => x > 25).length }; };
function probe() { const gaps: number[] = []; let last = performance.now(), id = 0, on = true; const tick = (t: number) => { gaps.push(t - last); last = t; if (on) id = requestAnimationFrame(tick); }; id = requestAnimationFrame(tick); return { stop() { on = false; cancelAnimationFrame(id); return stats(gaps); } }; }
async function waitFor(cond: () => unknown, timeout = 4000) { const t0 = performance.now(); while (performance.now() - t0 < timeout) { if (cond()) return performance.now() - t0; await frame(); } return null; }
const scroller = () => document.querySelector<HTMLElement>('.virtual-scroller');
const inView = (el: Element | null) => { const s = scroller(); if (!el || !s) return false; const r = el.getBoundingClientRect(), v = s.getBoundingClientRect(); return r.height > 0 && r.bottom > v.top && r.top < v.bottom; };
const firstVisible = () => { const s = scroller(); if (!s) return null; const v = s.getBoundingClientRect(); return [...s.querySelectorAll<HTMLElement>('.msg')].find(n => { const r = n.getBoundingClientRect(); return r.top >= v.top && r.bottom <= v.bottom; }) ?? null; };
const contentVisible = () => !document.querySelector('.timeline-skeleton') && [...document.querySelectorAll('.virtual-scroller .msg')].some(inView);
/** a message of chat `k` is on screen (not just whatever chat was showing before the click) */
const contentOf = (k: string) => () => useApp.getState().active === k && !document.querySelector('.timeline-skeleton') && [...document.querySelectorAll(`.virtual-scroller .msg[id^="m-${CSS.escape(k.split('|')[1])}-"]`)].some(inView);
const typeable = () => { const ta = document.querySelector<HTMLTextAreaElement>('.composer textarea'); return !!ta && !ta.disabled && document.activeElement === ta; };
const row = (title: string) => [...document.querySelectorAll<HTMLButtonElement>('.sidebar .chat-row')].find(b => b.querySelector('.name')?.textContent === title);
const tabEl = (k: string) => document.querySelector<HTMLElement>(`[role="tab"][data-tab-key="${CSS.escape(k)}"]`);
const setInput = (el: HTMLInputElement | HTMLTextAreaElement, value: string) => { const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value); el.dispatchEvent(new Event('input', { bubbles: true })); };
const mounted = () => document.querySelectorAll('.virtual-scroller .msg').length;
const sidebarRows = () => document.querySelectorAll('.sidebar .chat-row').length;
const callsOf = (name: string) => calls.filter(c => c[0] === name).map(c => c.slice(1));
async function scenario(name: string, fn: () => Promise<Record<string, unknown>>) {
  try { return { name, ok: true, ...(await Promise.race([fn(), sleep(25_000).then(() => { throw Error('scenario timed out after 25 s'); })])) }; } catch (e) { return { name, ok: false, error: String((e as Error)?.message ?? e) }; }
}
const ensure = (v: unknown, m: string) => { if (!v) throw Error(m); };
async function openTab(k: string) { const el = tabEl(k); if (el) el.click(); else void S.openChat(k); await waitFor(() => useApp.getState().active === k); await frames(4); }
async function scrollUpBy(px: number) { const s = scroller()!; s.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: -px })); s.scrollTop -= px; s.dispatchEvent(new Event('scroll')); await frames(6); }

// ── scenarios ───────────────────────────────────────────────────────────────
(window as any).runAudit = async () => {
  const out: any[] = [];
  await waitFor(contentVisible, 6000); await frames(10);

  out.push(await scenario('openCachedChat', async () => {
    const r = row('Perf C'); ensure(r, 'row Perf C');
    const p = probe(); const t0 = performance.now(); r!.click(); const commit = performance.now() - t0;
    const visible = await waitFor(contentOf(kC)); const typing = await waitFor(typeable); const gaps = p.stop();
    return { clickCommitMs: Math.round(commit * 10) / 10, clickToVisibleMs: visible && Math.round(visible + commit), clickToTypeableMs: typing && Math.round(typing + commit), frames: gaps, mountedRows: mounted() };
  }));

  out.push(await scenario('rapidTabSwitch', async () => {
    const order = [kA, kB, kC, kA, kB, kC, kA, kB, kC, kA];
    const p = probe(); const t0 = performance.now();
    for (const k of order) { tabEl(k)?.click(); await frame(); }
    const settled = await waitFor(contentOf(kA));
    return { switches: order.length, totalMs: Math.round(performance.now() - t0), settledMs: settled && Math.round(settled), frames: p.stop(), finalActiveCorrect: useApp.getState().active === kA };
  }));

  out.push(await scenario('scroll1000', async () => {
    await openTab(kA); useApp.setState((s: any) => ({ toLatest: s.toLatest + 1 })); await frames(10);
    const s = scroller()!; const p = probe(); let maxMounted = 0;
    for (let i = 0; i < 90; i++) { s.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: -120 })); s.scrollTop -= 120; await frame(); maxMounted = Math.max(maxMounted, mounted()); }
    return { frames: p.stop(), mountedRows: mounted(), maxMountedRows: maxMounted };
  }));

  out.push(await scenario('prependAndIncomingWhileReading', async () => {
    const a = firstVisible()!; ensure(a, 'anchor'); const id = a.id, top = a.getBoundingClientRect().top;
    const older = Array.from({ length: 50 }, (_, i) => msg(kA, -100 + i, { id: `older-${i}`, sort: -100 + i }));
    useApp.setState((s: any) => ({ msgs: { ...s.msgs, [kA]: [...older, ...s.msgs[kA]] } })); await frames(12);
    const prependDelta = document.getElementById(id)!.getBoundingClientRect().top - top;
    useApp.setState((s: any) => ({ msgs: { ...s.msgs, [kA]: [...s.msgs[kA], msg(kA, 50_000, { id: 'arrival-1', sort: 50_000 })] } })); await frames(12);
    const incomingDelta = document.getElementById(id)!.getBoundingClientRect().top - top;
    return { prependAnchorDeltaPx: Math.round(prependDelta * 10) / 10, incomingAnchorDeltaPx: Math.round(incomingDelta * 10) / 10, newCounterShown: !!document.querySelector('.jump-bottom.has-new') };
  }));

  out.push(await scenario('anchorRestoreChat', async () => {
    await openTab(kA); await scrollUpBy(2400); await scrollUpBy(1200);
    const a = firstVisible()!; ensure(a, 'anchor'); const id = a.id, top = a.getBoundingClientRect().top - scroller()!.getBoundingClientRect().top;
    await openTab(kB); await frames(8); await openTab(kA); await waitFor(() => document.getElementById(id) && inView(document.getElementById(id)), 1500); await frames(10);
    const el = document.getElementById(id); const s = scroller()!;
    return { anchorId: id, restored: !!el && inView(el), anchorDeltaPx: el ? Math.round((el.getBoundingClientRect().top - s.getBoundingClientRect().top - top) * 10) / 10 : null, distanceFromBottomPx: Math.round(s.scrollHeight - s.clientHeight - s.scrollTop) };
  }));

  out.push(await scenario('jumpToLatestAfterRestore', async () => {
    useApp.setState((s: any) => ({ toLatest: s.toLatest + 1 })); await frames(12); const s = scroller()!;
    return { atBottom: s.scrollHeight - s.clientHeight - s.scrollTop < 4 };
  }));

  out.push(await scenario('typingWhileIncoming', async () => {
    await openTab(kB); useApp.setState((s: any) => ({ toLatest: s.toLatest + 1 })); await frames(8);
    const ta = document.querySelector<HTMLTextAreaElement>('.composer textarea')!; ta.focus();
    const p = probe(); let text = ''; const t0 = performance.now(); const commits: number[] = [];
    for (let i = 0; i < 120; i++) {
      text += 'x'; const c0 = performance.now(); setInput(ta, text); commits.push(performance.now() - c0);
      if (i % 12 === 0) useApp.setState((s: any) => ({ msgs: { ...s.msgs, [kB]: [...s.msgs[kB], msg(kB, 60_000 + i, { id: 'in-' + i, sort: 60_000 + i })] } }));
      await sleep(8);
    }
    await frames(4); const gaps = p.stop(); const s = scroller()!;
    const ok = ta.value === text; setInput(ta, '');
    return { keystrokes: 120, totalMs: Math.round(performance.now() - t0), keystrokeCommit: stats(commits), frames: gaps, composerValueIntact: ok, followsNewest: s.scrollHeight - s.clientHeight - s.scrollTop < 90 };
  }));

  out.push(await scenario('sidebarFilters', async () => {
    const tab = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('.sidebar .mini-tabs [role="tab"]')].find(b => b.textContent?.includes(label))!;
    const measure = async (label: string) => {
      const p = probe(); const t0 = performance.now(); tab(label).click(); const commit = performance.now() - t0;
      const l0 = performance.now(); void document.querySelector('.sidebar')!.getBoundingClientRect().height; void document.body.offsetHeight; const styleLayout = performance.now() - l0;
      // first paint after the click: style/layout of the new rows plus anything scheduled for that frame
      await frame(); const firstFrame = performance.now() - t0;
      await frames(29); return { clickCommitMs: Math.round(commit * 10) / 10, styleLayoutMs: Math.round(styleLayout * 10) / 10, clickToNextFrameMs: Math.round(firstFrame), frames: p.stop(), mountedRows: sidebarRows() };
    };
    const base = { allRows: sidebarRows() };
    // three rounds: the first switch also pays one-time style/JIT costs, later rounds show steady state
    const rounds: any[] = [];
    for (let r = 0; r < 3; r++) rounds.push({ unread: await measure('Chưa đọc'), mention: await measure('Nhắc tên'), all: await measure('Tất cả') });
    const { unread, mention, all } = rounds[0];
    const steady = (k: string) => ({ maxGapMs: Math.max(...rounds.slice(1).map(x => x[k].frames.max)), clickToNextFrameMs: Math.max(...rounds.slice(1).map(x => x[k].clickToNextFrameMs)), mountedRows: rounds[2][k].mountedRows });
    const input = document.querySelector<HTMLInputElement>('.side-search')!; const p = probe(); const commits: number[] = [];
    for (const v of ['P', 'Pe', 'Per', 'Perf', 'Perf ', 'Perf f', 'Perf fi', 'Perf fil']) { const c0 = performance.now(); setInput(input, v); commits.push(performance.now() - c0); await frames(2); }
    await frames(10); const searchRows = sidebarRows(); const searchFrames = p.stop(); setInput(input, ''); await frames(6);
    return { ...base, unread, mention, all, steady: { unread: steady('unread'), mention: steady('mention'), all: steady('all') }, search: { keystrokeCommit: stats(commits), frames: searchFrames, mountedRows: searchRows } };
  }));

  out.push(await scenario('sidebarSingleUpdates', async () => {
    const k = `${A}|f4`; const time = (fn: () => void) => { const t0 = performance.now(); flushSync(fn); return performance.now() - t0; };
    const draft: number[] = [], typing: number[] = [], badge: number[] = [];
    for (let i = 0; i < 20; i++) draft.push(time(() => useApp.setState((s: any) => ({ drafts: { ...s.drafts, [k]: 'draft '.repeat(1 + i % 3) + i } }))));
    for (let i = 0; i < 20; i++) typing.push(time(() => useApp.setState((s: any) => ({ typing: { ...s.typing, [k]: i % 2 ? { who: 'Person', until: Date.now() + 6000 } : { who: '', until: 0 } } }))));
    for (let i = 0; i < 20; i++) badge.push(time(() => useApp.setState((s: any) => ({ chats: { ...s.chats, [k]: { ...s.chats[k], unread: 1 + i } } }))));
    return { draftCommitMs: stats(draft), typingCommitMs: stats(typing), unreadBadgeCommitMs: stats(badge) };
  }));

  out.push(await scenario('composerStatePerTab', async () => {
    await openTab(kA); const ta = document.querySelector<HTMLTextAreaElement>('.composer textarea')!;
    setInput(ta, 'Nháp giữ lại cho tab A');
    const dt = new DataTransfer(); dt.items.add(new File(['x'], 'photo.png', { type: 'image/png' }));
    ta.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt }));
    await waitFor(() => document.querySelector('.attach-chip'), 2000);
    const mode = document.querySelector<HTMLButtonElement>('.attach-mode'); mode?.click();
    document.querySelector<HTMLButtonElement>('button[aria-label="Gửi văn bản thuần"]')?.click(); await frames(4);
    const before = { draft: ta.value, files: document.querySelectorAll('.attach-chip').length, asFile: mode ? mode.getAttribute('aria-pressed') : null, plain: document.querySelector('button[aria-label="Gửi văn bản thuần"]')?.getAttribute('aria-pressed') };
    await openTab(kB); await openTab(kA); await frames(6);
    const ta2 = document.querySelector<HTMLTextAreaElement>('.composer textarea')!;
    const after = { draft: ta2.value, files: document.querySelectorAll('.attach-chip').length, asFile: document.querySelector('.attach-mode')?.getAttribute('aria-pressed') ?? null, plain: document.querySelector('button[aria-label="Gửi văn bản thuần"]')?.getAttribute('aria-pressed') };
    return { before, after, preserved: JSON.stringify(before) === JSON.stringify(after) && before.files === 1 };
  }));

  out.push(await scenario('retryFailedUpload', async () => {
    const ta = document.querySelector<HTMLTextAreaElement>('.composer textarea')!; ta.focus();
    if (!ta.value) setInput(ta, 'Caption for the retried file');
    if (!document.querySelector('.attach-chip')) {
      const dt = new DataTransfer(); dt.items.add(new File(['x'], 'photo.png', { type: 'image/png' }));
      ta.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt }));
      await waitFor(() => document.querySelector('.attach-chip'), 2000);
    }
    const sendsBefore = callsOf('send').length;
    ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    const failed = await waitFor(() => [...document.querySelectorAll('.fail-row button')].length, 3000); ensure(failed !== null, 'no failed bubble');
    const btn = [...document.querySelectorAll<HTMLButtonElement>('.fail-row button')].at(-1)!; btn.click();
    await waitFor(() => callsOf('send').length >= sendsBefore + 2, 3000); await frames(4);
    const [first, second] = callsOf('send').slice(sendsBefore).map(c => c[0]);
    return { firstAttempt: first, retryAttempt: second, identical: JSON.stringify(first) === JSON.stringify(second), keptFile: !!second?.file, keptCaption: second?.text === first?.text && !!first?.text };
  }));

  out.push(await scenario('inspectorOpen', async () => {
    const remoteBefore = callsOf('threadList').filter(a => a[4]).length;
    const btn = document.querySelector<HTMLButtonElement>('button[aria-label="Thông tin chat"]')!;
    const p = probe(); const t0 = performance.now(); btn.click(); const commit = performance.now() - t0;
    const shown = await waitFor(() => { const el = document.querySelector('.inspector'); return el && el.getBoundingClientRect().width > 200 && el.querySelector('.inspector-surface'); }); await frames(10); const gaps = p.stop();
    btn.click(); await frames(6);
    return { clickCommitMs: Math.round(commit * 10) / 10, clickToContentMs: shown && Math.round(shown + commit), frames: gaps, remoteThreadListWhileOpen: callsOf('threadList').filter(a => a[4]).length - remoteBefore };
  }));

  if (provider === 'gchat') {
    out.push(await scenario('gchatCacheFirst', async () => {
      useApp.setState((s: any) => { const msgs = { ...s.msgs }; delete msgs[kC]; return { msgs, rightCollapsed: true, tabs: s.tabs.filter((t: string) => t !== kC) }; });
      const remoteBefore = callsOf('threadList').filter(a => a[4]).length;
      const t0 = performance.now(); row('Perf C')!.click();
      const first = await waitFor(contentOf(kC), 6000);
      const refreshed = await waitFor(() => useApp.getState().msgs[kC]?.some((m: any) => m.id === 'spaces/C-live'), 8000);
      return { liveLatencyMs: LIVE_MS, firstContentMs: first && Math.round(first), refreshDoneMs: refreshed && Math.round(performance.now() - t0), remoteThreadListWithInspectorClosed: callsOf('threadList').filter(a => a[4]).length - remoteBefore };
    }));
    out.push(await scenario('openThread', async () => {
      await openTab(kA); const t0 = performance.now();
      S.openThreadTab(kA, structuredClone(bigRoot));
      const t = await waitFor(() => document.querySelector('.thread-content') && contentVisible(), 6000);
      return { clickToVisibleMs: t && Math.round(t), mountedRows: mounted(), active: useApp.getState().active };
    }));
    out.push(await scenario('anchorRestoreThread', async () => {
      const tab = useApp.getState().active as string; await frames(10); await scrollUpBy(600);
      const a = firstVisible()!; ensure(a, 'anchor'); const id = a.id, top = a.getBoundingClientRect().top - scroller()!.getBoundingClientRect().top;
      await openTab(kB); await frames(6); await openTab(tab); await waitFor(() => document.getElementById(id) && inView(document.getElementById(id)), 2500); await frames(10);
      const el = document.getElementById(id);
      return { restored: !!el && inView(el), anchorDeltaPx: el ? Math.round((el.getBoundingClientRect().top - scroller()!.getBoundingClientRect().top - top) * 10) / 10 : null };
    }));
    out.push(await scenario('searchOldCachedReply', async () => {
      searchHits = [structuredClone(bigReplies[40])];
      useApp.setState({ route: 'search', searchQuery: 'Reply 40', searchScope: '', searchAccount: '' } as any);
      const hit = await waitFor(() => document.querySelector('.message-search-hit'), 3000); ensure(hit !== null, 'no hit');
      const t0 = performance.now(); document.querySelector<HTMLButtonElement>('.message-search-hit')!.click();
      const shown = await waitFor(() => inView(document.getElementById('m-big-r40')), 5000);
      const el = document.getElementById('m-big-r40');
      return { clickToTargetMs: shown && Math.round(performance.now() - t0), activeTab: useApp.getState().active, openedThreadTab: String(useApp.getState().active).startsWith('thread:'), targetVisible: inView(el), highlighted: !!el?.closest('.flash') };
    }));
  } else {
    out.push(await scenario('forumRace', async () => {
      useApp.setState((s: any) => ({ topics: {}, lastTopic: {}, route: 'shell' }));
      const t0 = performance.now(); row('Forum')!.click();
      // feedback within two frames of the click, then a newer choice before the topic list (300 ms) arrives
      const feedback = await waitFor(() => useApp.getState().active === kF || document.querySelector('.forum-landing'), 34);
      await frames(2); row('Perf B')!.click();
      await sleep(700); await frames(4);
      return { clickFeedbackMs: feedback === null ? null : Math.round(feedback), totalMs: Math.round(performance.now() - t0), activeAfter: useApp.getState().active, newerChoiceKept: useApp.getState().active === kB };
    }));
    out.push(await scenario('openTopic', async () => {
      const t0 = performance.now(); S.openTopicTab(kF, topics[0]);
      const t = await waitFor(() => document.querySelector('.thread-content') && contentVisible(), 6000);
      return { clickToVisibleMs: t && Math.round(t), forumPageWaited: callsOf('messages').some(c => c[0] === '-100900'), mountedRows: mounted(), active: useApp.getState().active };
    }));
    out.push(await scenario('topicPaging', async () => {
      await frames(10); const before = callsOf('topicHistory').length;
      const btn = await waitFor(() => [...document.querySelectorAll<HTMLButtonElement>('.thread-content .history-start button')].length, 1500);
      if (btn !== null) document.querySelector<HTMLButtonElement>('.thread-content .history-start button')!.click(); else { await scrollUpBy(100000); }
      await waitFor(() => callsOf('topicHistory').length > before, 1500); await frames(20);
      const loaded = (useApp.getState().msgs[kF] ?? []).filter((m: any) => m.threadId === '7').length;
      return { olderRequest: callsOf('topicHistory').slice(before)[0] ?? null, topicMessagesLoaded: loaded, pagedPast50: loaded > 50, loadMoreButton: btn !== null, state: useApp.getState().older[useApp.getState().active as string] };
    }));
    out.push(await scenario('anchorRestoreTopic', async () => {
      const tab = useApp.getState().active as string; await frames(6); await scrollUpBy(500);
      const a = firstVisible()!; ensure(a, 'anchor'); const id = a.id, top = a.getBoundingClientRect().top - scroller()!.getBoundingClientRect().top;
      await openTab(kB); await frames(6); await openTab(tab); await waitFor(() => document.getElementById(id) && inView(document.getElementById(id)), 2500); await frames(10);
      const el = document.getElementById(id);
      return { restored: !!el && inView(el), anchorDeltaPx: el ? Math.round((el.getBoundingClientRect().top - scroller()!.getBoundingClientRect().top - top) * 10) / 10 : null };
    }));
    out.push(await scenario('searchOldTopicMessage', async () => {
      searchHits = [structuredClone(topicMsgs[100])];
      useApp.setState({ route: 'search', searchQuery: 'Topic message 5100', searchScope: '', searchAccount: '' } as any);
      const hit = await waitFor(() => document.querySelector('.message-search-hit'), 3000); ensure(hit !== null, 'no hit');
      const t0 = performance.now(); document.querySelector<HTMLButtonElement>('.message-search-hit')!.click();
      const shown = await waitFor(() => inView(document.getElementById('m-5100')), 5000);
      const el = document.getElementById('m-5100');
      return { clickToTargetMs: shown && Math.round(performance.now() - t0), activeTab: useApp.getState().active, openedTopicTab: useApp.getState().active === `thread:${kF}:7`, targetVisible: inView(el), highlighted: !!el?.closest('.flash') };
    }));
  }
  out.push(await scenario('leftDock', async () => leftDock()));
  return { provider, liveLatencyMs: LIVE_MS, viewport: [innerWidth, innerHeight], scenarios: out };
};
(window as any).auditReady = true;

// Todo date picker keyboard check, driven with real key presses from run-audit.mjs.
const pickerHost = document.createElement('div'); document.body.appendChild(pickerHost);
const pickerRoot = createRoot(pickerHost);
(window as any).datePicker = { applied: [] as string[], closed: 0 };
(window as any).datePickerOpen = () => {
  const dp = (window as any).datePicker;
  let trigger = document.getElementById('dtp-trigger') as HTMLButtonElement | null;
  if (!trigger) { trigger = document.createElement('button'); trigger.id = 'dtp-trigger'; trigger.textContent = 'Hạn chót'; document.body.appendChild(trigger); }
  trigger.focus();
  const close = () => { dp.closed++; flushSync(() => pickerRoot.render(<></>)); };
  flushSync(() => pickerRoot.render(<form onSubmit={(e) => { e.preventDefault(); dp.formSubmitted = (dp.formSubmitted ?? 0) + 1; }}>
    <DateTimeModal title="Hạn chót" value="2026-11-10T18:00" onApply={(v) => { dp.applied.push(v); close(); }} onClose={close} />
  </form>));
};

// LeftDock: clicking a row lands on the previewed message, in its thread/topic, from every group.
async function leftDock() {
  const st = () => useApp.getState() as any;
  const filler = `${A}|f1`;
  const rowIn = (group: string, k: string) => document.querySelector<HTMLButtonElement>(`${group} .chat-row[data-chat-id="${CSS.escape(k.split('|')[1])}"]`)
    ?? [...document.querySelectorAll<HTMLButtonElement>(`${group} .chat-row`)].find(b => b.querySelector('.name')?.textContent === st().chats[k]?.title) ?? null;
  const landed = async (tab: string, id: string) => {
    const t = await waitFor(() => st().active === tab && inView(document.getElementById('m-' + id)) && document.getElementById('m-' + id)?.closest('.flash'), 5000);
    const el = document.getElementById('m-' + id);
    return { ok: t !== null, ms: t && Math.round(t), tab: st().active, inView: inView(el), highlighted: !!el?.closest('.flash') };
  };
  const click = async (el: HTMLButtonElement | null, label: string) => { ensure(el, 'row missing: ' + label); useApp.setState({ route: 'shell' } as any); el!.click(); };
  const contextMenuOpenMain = async (el: HTMLButtonElement | null) => {
    ensure(el, 'row for context menu');
    el!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 50, clientY: 200 }));
    await frames(3);
    const item = [...document.querySelectorAll<HTMLElement>('[role="menu"] button, [role="menuitem"]')].find(b => b.textContent?.includes('Mở hội thoại chính'));
    if (!item) { useApp.setState({ pop: null } as any); return { menuItem: false }; }
    item.click(); await frames(8);
    return { menuItem: true };
  };
  const fillerBadge = () => document.querySelector(`.chat-row[data-chat-id="${CSS.escape(filler.split('|')[1])}"] .badge`)?.textContent ?? null;
  useApp.setState({ filter: 'all', query: '', route: 'shell' } as any); await frames(4);
  const res: any = {};
  if (provider === 'gchat') {
    const kReply = kA, kMain = kC, T = BIG_THREAD;
    useApp.setState((s: any) => ({
      favorites: [kReply], folders: [{ id: 'fold', name: 'Dự án', color: 'blue', icon: 'icon:folder', chats: [kMain] }],
      chats: { ...s.chats,
        [kReply]: { ...s.chats[kReply], unread: 2, lastTs: 1_900_000_000_000, previewMsg: 'big-r299', previewThread: T, previewKind: 'reply', previewContext: 'Thread with 300 replies', previewFrom: 'Person', preview: 'Reply 299 in the big thread' },
        [kMain]: { ...s.chats[kMain], unread: 1, lastTs: 1_899_000_000_000, previewMsg: 'spaces/C-150', previewThread: '', previewKind: 'main', previewFrom: 'Person', preview: 'Message 150' } },
      threadSeen: {},
    }));
    await frames(6);
    const badgeBefore = fillerBadge();
    res.label = document.querySelector(`.fav-group:not(.latest-group) .chat-row[data-chat-id="${CSS.escape(kReply.split('|')[1])}"] .preview-context`)?.textContent ?? null;
    res.dataAttrs = (() => { const b = rowIn('.fav-group:not(.latest-group)', kReply); return b ? { ...b.dataset } : null; })();
    const threadTab = `thread:${kReply}:${T}`;
    await click(rowIn('.fav-group:not(.latest-group)', kReply), 'Ghim'); res.pinnedReply = await landed(threadTab, 'big-r299');
    await click(rowIn('.latest-group', kMain), 'Mới nhất'); res.latestMainNotLoaded = await landed(kMain, 'spaces/C-150');
    await click(rowIn('.folder-group', kMain), 'folder'); res.folderMainTabOpen = await landed(kMain, 'spaces/C-150');
    await click(rowIn('.fav-group:not(.latest-group)', kReply), 'Ghim again'); res.targetTabAlreadyOpen = await landed(threadTab, 'big-r299');
    // opening it read the chat (correct): a new message makes it unread again for the filter step
    useApp.setState((s: any) => ({ chats: { ...s.chats, [kMain]: { ...s.chats[kMain], unread: 1 } } })); await frames(2);
    const tabUnread = [...document.querySelectorAll<HTMLButtonElement>('.sidebar .mini-tabs [role="tab"]')].find(b => b.textContent?.includes('Chưa đọc'))!;
    tabUnread.click(); await frames(6);
    await click(rowIn('.folder-group', kMain), 'Chưa đọc'); res.unreadFilterMain = await landed(kMain, 'spaces/C-150');
    tabUnread.parentElement!.querySelector<HTMLButtonElement>('[role="tab"]')!.click(); await frames(6);
    // two rows in quick succession: the newer click wins
    rowIn('.latest-group', kMain)!.click(); await frame(); rowIn('.fav-group:not(.latest-group)', kReply)!.click();
    res.rapidTwoRows = await landed(threadTab, 'big-r299');
    await sleep(400); res.rapidStillOnNewer = st().active === threadTab;
    res.otherBadgeUnchanged = fillerBadge() === badgeBefore && badgeBefore !== null;
    res.otherThreadsSeen = Object.keys(st().threadSeen).filter((x: string) => !x.endsWith('#' + T));
    res.openMain = await contextMenuOpenMain(rowIn('.fav-group:not(.latest-group)', kReply)); res.openMain.active = st().active; res.openMain.ok = st().active === kReply;
  } else {
    const T = '7';
    useApp.setState((s: any) => ({
      favorites: [kB], folders: [{ id: 'fold', name: 'Dự án', color: 'blue', icon: 'icon:folder', chats: [kF] }],
      lastTopic: { ...s.lastTopic, [kF]: '3' },
      threadTabs: { ...s.threadTabs, [`thread:${kF}:3`]: { chatKey: kF, threadId: '3', rootId: '', title: 'Ops', topic: true } },
      chats: { ...s.chats,
        [kF]: { ...s.chats[kF], unread: 4, lastTs: 1_900_000_000_000, previewMsg: '5100', previewThread: T, previewKind: 'topic', previewContext: 'Dev', previewFrom: 'Person', preview: 'Topic message 5100' },
        [kB]: { ...s.chats[kB], previewMsg: '2-999', previewKind: 'main' } },
    }));
    await frames(6);
    const badgeBefore = fillerBadge();
    res.label = document.querySelector(`.latest-group .chat-row[data-chat-id="${CSS.escape(kF.split('|')[1])}"] .preview-context`)?.textContent ?? null;
    res.dataAttrs = (() => { const b = rowIn('.latest-group', kF); return b ? { ...b.dataset } : null; })();
    const topicTab = `thread:${kF}:${T}`;
    await click(rowIn('.latest-group', kF), 'Mới nhất'); res.latestTopicOtherThanLast = await landed(topicTab, '5100');
    await click(rowIn('.fav-group:not(.latest-group)', kB), 'Ghim'); const t = await waitFor(() => st().active === kB && contentVisible(), 4000); res.pinnedPlainChatOpensNormally = { ok: t !== null, tab: st().active, jumpTo: st().jumpTo, skeleton: !!document.querySelector('.timeline-skeleton'), mounted: mounted(), firstId: document.querySelector('.virtual-scroller .msg')?.id ?? null };
    await click(rowIn('.folder-group', kF), 'folder'); res.folderTopicTabOpen = await landed(topicTab, '5100');
    useApp.setState((s: any) => ({ chats: { ...s.chats, [kF]: { ...s.chats[kF], unread: 2 } } })); await frames(2);
    const tabUnread = [...document.querySelectorAll<HTMLButtonElement>('.sidebar .mini-tabs [role="tab"]')].find(b => b.textContent?.includes('Chưa đọc'))!;
    tabUnread.click(); await frames(6);
    await click(rowIn('.acc-group:not(.folder-group), .latest-group', kF) ?? rowIn('.folder-group', kF), 'Chưa đọc'); res.unreadFilterTopic = await landed(topicTab, '5100');
    tabUnread.parentElement!.querySelector<HTMLButtonElement>('[role="tab"]')!.click(); await frames(6);
    rowIn('.latest-group', kF)!.click(); await frame(); rowIn('.fav-group:not(.latest-group)', kB)!.click();
    await waitFor(() => st().active === kB, 3000); await sleep(500); res.rapidTwoRows = { ok: st().active === kB, tab: st().active };
    res.otherBadgeUnchanged = fillerBadge() === badgeBefore && badgeBefore !== null;
    res.openMain = await contextMenuOpenMain(rowIn('.folder-group', kF)); res.openMain.active = st().active; res.openMain.ok = st().active === kF;
  }
  res.allOk = Object.values(res).every((v: any) => typeof v !== 'object' || v === null || !('ok' in v) || v.ok) && !!res.label && res.otherBadgeUnchanged;
  return res;
}

// Native audit app (tauri.audit.conf.json): run by itself and write the result to the app's
// js.log, then continue with the next provider. Same scenarios as the Playwright runner.
if (params.has('auto')) {
  void (async () => {
    await sleep(1500);
    const result: any = await (window as any).runAudit();
    result.p2 = await p2();
    result.p2.native = await nativeInputChecks();
    result.environment = { shell: 'Tauri WKWebView (native macOS app, fake provider API)', userAgent: navigator.userAgent, devicePixelRatio, viewport: [innerWidth, innerHeight] };
    // frame cadence of this display, to read the gaps against (60 Hz ≈ 16.7 ms, 120 Hz ≈ 8.3 ms)
    const gaps: number[] = []; let last = performance.now();
    for (let i = 0; i < 120; i++) { const t = await frame(); gaps.push(t - last); last = t; }
    result.idleFrameGap = stats(gaps);
    await nativeLog('AUDIT-RESULT ' + JSON.stringify(result));
    const next = params.get('next');
    if (next) location.search = `?provider=${next}&auto=1&live=${LIVE_MS}${params.get('then') ? `&next=${params.get('then')}` : ''}`;
    else await nativeLog('AUDIT-DONE');
  })();
}

// ── P2 checks: one function per item, each returns what it saw (runs on old builds too) ──
async function p2() {
  const st = () => useApp.getState() as any;
  const out: any = {};
  const step = async (name: string, fn: () => Promise<any>) => { try { out[name] = await Promise.race([fn(), sleep(20_000).then(() => ({ error: 'timeout' }))]); } catch (e) { out[name] = { error: String((e as Error)?.message ?? e) }; } };
  useApp.setState({ route: 'shell', filter: 'all', query: '', rightCollapsed: true, windowPresence: { foreground: true, revision: 1e9 } } as any);

  await step('tabsDistinguishable', async () => {
    if (provider === 'gchat') S.openThreadTab(kA, structuredClone(bigRoot)); else S.openTopicTab(kF, topics[0]);
    await frames(10);
    const t = document.querySelector<HTMLElement>('.tab[data-tab-key^="thread:"]');
    const chat = document.querySelector<HTMLElement>(`.tab[data-tab-key="${CSS.escape(kB)}"]`);
    return { threadOrTopicTab: t ? { className: t.className, ariaLabel: t.getAttribute('aria-label'), conn: t.querySelector('.tab-conn')?.textContent, title: t.querySelector('.tab-title')?.textContent, icon: !!t.querySelector('.tab-kind') } : null,
      chatTab: chat ? { ariaLabel: chat.getAttribute('aria-label'), conn: chat.querySelector('.tab-conn')?.textContent } : null,
      ok: !!t && /tab-(thread|topic)/.test(t.className) && /(Luồng|Chủ đề) trong /.test(t.getAttribute('aria-label') ?? '') };
  });

  await step('readFollowsVisibleThread', async () => {
    if (provider !== 'gchat') return { skipped: 'Google Chat thread case' };
    const tab = `thread:${kA}:${BIG_THREAD}`; await S.openChat(tab); await frames(12);
    useApp.setState((s: any) => ({ toLatest: s.toLatest + 1 })); await frames(12);
    const id = `${kA}#${BIG_THREAD}`; const seenAtBottom = st().threadSeen[id];
    await scrollUpBy(900); await frames(6);
    const reply = msg(kA, 9000, { id: 'late-reply', sort: 9999, text: 'Reply arriving while reading above', threadId: BIG_THREAD, threadReply: true });
    useApp.setState((s: any) => ({ msgs: { ...s.msgs, [kA]: [...s.msgs[kA], reply] }, fresh: { ...s.fresh, 'late-reply': true } })); await frames(12);
    const whileAbove = st().threadSeen[id];
    useApp.setState((s: any) => ({ toLatest: s.toLatest + 1 })); await frames(20);
    const s2 = scroller()!; s2.dispatchEvent(new Event('scroll')); await frames(8);
    const afterBottom = st().threadSeen[id];
    return { seenAtBottom, whileReadingAbove: whileAbove, afterBackAtBottom: afterBottom, ok: whileAbove !== 9999 && afterBottom === 9999 };
  });

  await step('offlineComposing', async () => {
    await openTab(kB);
    useApp.setState((s: any) => ({ health: { ...s.health, [A]: { health: 'offline', text: 'Mất kết nối', until: 0 } } })); await frames(6);
    const ta = document.querySelector<HTMLTextAreaElement>('.composer textarea')!;
    const editable = !ta.disabled; if (editable) setInput(ta, 'soạn khi mất mạng'); await frames(3);
    const send = document.querySelector<HTMLButtonElement>('.composer-send');
    const r = { textareaEditable: editable, draftKept: ta.value === 'soạn khi mất mạng', sendDisabled: !!send?.disabled, sendTip: send?.getAttribute('data-tip') ?? null, statusLine: document.querySelector('.composer-send-state')?.textContent ?? null };
    setInput(ta, ''); useApp.setState((s: any) => ({ health: { ...s.health, [A]: { health: 'ok', text: '', until: 0 } } })); await frames(4);
    return { ...r, ok: r.textareaEditable && r.draftKept && r.sendDisabled && /mất kết nối/.test(r.sendTip ?? '') };
  });

  await step('cacheStatusInline', async () => {
    const slow = `${A}|f7`, bad = `${A}|f9`; slowChats.add('f7'); failChats.add('f9');
    useApp.setState((s: any) => { const msgs = { ...s.msgs }; delete msgs[slow]; delete msgs[bad]; return { msgs }; });
    void S.openChat(slow); const shown = await waitFor(() => document.querySelector('.history-status[role="status"]'), 2000);
    const statusText = document.querySelector('.history-status')?.textContent ?? null;
    void S.openChat(bad); const err = await waitFor(() => document.querySelector('.history-status.error'), 2000);
    const errText = document.querySelector('.history-status.error')?.textContent ?? null;
    const before = callsOf('messages').filter(c => c[0] === 'f9').length;
    document.querySelector<HTMLButtonElement>('.history-status.error button')?.click(); await sleep(100);
    const retried = callsOf('messages').filter(c => c[0] === 'f9').length > before;
    slowChats.clear(); failChats.clear();
    return { refreshingNote: shown !== null, statusText, errorInline: err !== null, errText, retryInPlace: retried, cachedRowsStillShown: mounted() > 0, ok: shown !== null && err !== null && retried };
  });

  await step('searchStableWhileEditing', async () => {
    searchHits = bigReplies.slice(0, 30).map(m => structuredClone(m)); searchFilter = true; searchDelay = 400;
    useApp.setState({ route: 'search', searchQuery: 'Reply', searchScope: '', searchAccount: '' } as any);
    await waitFor(() => document.querySelectorAll('.message-search-hit').length > 0, 3000);
    const first = document.querySelectorAll('.message-search-hit').length;
    useApp.setState({ searchQuery: 'Reply 1' } as any); await sleep(150);
    const during = { hits: document.querySelectorAll('.message-search-hit').length, stale: document.querySelectorAll('.message-search-hit.stale').length, status: document.querySelector('.message-search-count')?.textContent };
    await waitFor(() => !document.querySelector('.message-search-hit.stale') && document.querySelector('.message-search-count')?.textContent?.includes('kết quả'), 3000);
    const after = document.querySelectorAll('.message-search-hit').length;
    const scope = document.querySelector('.message-search-head p')?.textContent ?? '';
    useApp.setState({ route: 'shell' } as any); searchDelay = 0; searchFilter = false; await frames(6);
    const placeholder = document.querySelector<HTMLInputElement>('.side-search')?.placeholder;
    return { firstHits: first, duringEdit: during, finalHits: after, scopeText: scope, sidebarFilterPlaceholder: placeholder,
      ok: during.hits > 0 && during.stale > 0 && /lịch sử đã lưu trên máy/.test(scope) && /tên hội thoại/.test(placeholder ?? '') };
  });

  await step('inspectorScopeAndRetry', async () => {
    await openTab(kB); membersFail = 1;
    useApp.setState((s: any) => ({ chats: { ...s.chats, [kB]: { ...s.chats[kB], kind: 'group', memberCount: 40 } }, rightCollapsed: false, inspTab: 'members' })); await frames(12);
    await waitFor(() => document.querySelector('.inspector [role="alert"], .inspector .insp-empty'), 2000);
    const errorText = document.querySelector('.inspector .insp-empty')?.textContent ?? null;
    const retry = [...document.querySelectorAll<HTMLButtonElement>('.inspector .insp-empty button')].find(b => b.textContent?.includes('Thử lại'));
    retry?.click(); await waitFor(() => document.querySelector('.inspector .member-row'), 2000);
    const membersScope = document.querySelector('.inspector .history-scope')?.textContent ?? null;
    // the panel swap animates out first: wait for the new panel, not a frame count (120 Hz is faster)
    useApp.setState({ inspTab: 'files' } as any); await waitFor(() => /tệp/.test(document.querySelector('.inspector .history-scope')?.textContent ?? ''), 2000);
    const filesScope = document.querySelector('.inspector .history-scope')?.textContent ?? null;
    useApp.setState({ inspTab: 'media' } as any); await waitFor(() => /ảnh/.test(document.querySelector('.inspector .history-scope')?.textContent ?? ''), 2000);
    const mediaScope = document.querySelector('.inspector .history-scope')?.textContent ?? null;
    const tabs = [...document.querySelectorAll('.inspector-tabbar [role="tab"]')].map(t => t.textContent);
    useApp.setState((s: any) => ({ rightCollapsed: true, chats: { ...s.chats, [kB]: { ...s.chats[kB], kind: 'dm' } } })); await frames(4);
    return { errorText, retryButton: !!retry, membersScope, filesScope, mediaScope, tabs, ok: !!retry && /do nền tảng trả về/.test(membersScope ?? '') && /cuộn lên/.test(filesScope ?? '') && /cuộn lên/.test(mediaScope ?? '') };
  });

  await step('settingsNavigation', async () => {
    useApp.setState({ route: 'settings' } as any);
    await waitFor(() => document.querySelector('.settings-nav button'), 2000);
    const buttons = [...document.querySelectorAll<HTMLButtonElement>('.settings-nav button')];
    const labels = buttons.map(b => b.textContent);
    const target = buttons.at(-1); target?.click(); await sleep(700);
    const focused = document.activeElement as HTMLElement | null;
    const r = { groups: labels, lastJumpFocusesHeading: focused?.tagName === 'H3', headingText: focused?.textContent ?? null, headingVisible: focused ? focused.getBoundingClientRect().top >= 0 && focused.getBoundingClientRect().top < innerHeight : false };
    return { ...r, ok: labels.length >= 5 && r.lastJumpFocusesHeading && r.headingVisible };
  });

  await step('wizardErrorVsBackgroundSync', async () => {
    const Sync = (WizardView as any).SyncStep;
    if (!Sync) return { note: 'SyncStep không tách riêng ở bản này: lỗi và đang chạy lâu dùng chung nút “Tiếp tục, đồng bộ nền”', ok: false };
    const host = document.createElement('div'); document.body.appendChild(host); const r = createRoot(host);
    const show = async (checks: string[], lateMs: number) => { useApp.setState((s: any) => ({ sync: { ...s.sync, 'acc-w': { checks, log: ['Xác thực OK', checks.includes('err') ? 'Tải danh sách hội thoại: lỗi 503 (fake)' : 'Đang tải…'] } } })); flushSync(() => r.render(<Sync accountId="acc-w" next={() => {}} lateMs={lateMs} />)); await sleep(lateMs + 80);
      return { state: host.querySelector('.wizard-sync-state')?.className ?? null, role: host.querySelector('.wizard-sync-state')?.getAttribute('role') ?? null, text: host.querySelector('.wizard-sync-state')?.textContent ?? null, button: host.querySelector('.tool-btn.primary')?.textContent ?? null }; };
    const failed = await show(['ok', 'err', 'idle'], 50); flushSync(() => r.render(<></>));
    const running = await show(['ok', 'run', 'idle'], 50); flushSync(() => r.render(<></>));
    const done = await show(['ok', 'ok', 'ok'], 50); r.unmount(); host.remove();
    return { failed, running, done, ok: /err/.test(failed.state ?? '') && failed.role === 'alert' && failed.button !== running.button && /run/.test(running.state ?? '') && /ok/.test(done.state ?? '') };
  });

  await step('zaloLimitedHistory', async () => {
    const Z = 'zalo-perf', kz = `${Z}|z1`;
    useApp.setState((s: any) => ({ accounts: [...s.accounts.filter((a: any) => a.id !== Z), { id: Z, platform: 'zalo', name: 'Zalo', color: 'green', handle: '', selfId: 'self' }],
      chats: { ...s.chats, [kz]: chat(kz, 'Zalo friend', 'dm', { order: 1, lastTs: 1 }) }, msgs: { ...s.msgs, [kz]: Array.from({ length: 6 }, (_, i) => msg(kz, i)) }, older: { ...s.older, [kz]: 'done' }, route: 'shell' }));
    await S.openChat(kz); useApp.setState((s: any) => ({ older: { ...s.older, [kz]: 'done' } })); await frames(12);
    const done = document.querySelector('.history-start')?.textContent ?? null;
    const banner = !!document.querySelector('.zalo-history-note');
    useApp.setState((s: any) => ({ older: { ...s.older, [kz]: 'idle' } })); await frames(8);
    const idle = document.querySelector('.history-start')?.textContent ?? null;
    return { endOfHistory: done, whileMoreMayExist: idle, permanentBanner: banner, ok: /Hết phần lịch sử ChatMin có/.test(done ?? '') && /không trả đủ/.test(idle ?? '') && !banner };
  });

  await step('messengerWebviewRetry', async () => {
    const W = 'msg-perf', kw = `${W}|web`; webFail = 1;
    useApp.setState((s: any) => ({ accounts: [...s.accounts.filter((a: any) => a.id !== W), { id: W, platform: 'messenger', name: 'Messenger', color: 'blue', handle: '', selfId: '' }],
      chats: { ...s.chats, [kw]: chat(kw, 'Messenger', 'web', { description: 'https://www.messenger.com/', order: 1, lastTs: 1 }) }, route: 'shell' }));
    await S.openChat(kw); await frames(10);
    const err = await waitFor(() => document.querySelector('.web-host [role="alert"]'), 3000);
    const errText = document.querySelector('.web-host [role="alert"]')?.textContent ?? null;
    const shows = callsOf('webShow').length;
    [...document.querySelectorAll<HTMLButtonElement>('.web-host button')].find(b => b.textContent?.includes('Thử lại'))?.click(); await frames(10);
    const retried = callsOf('webShow').length > shows; const cleared = !document.querySelector('.web-host [role="alert"]');
    const slow = await waitFor(() => document.querySelector('.web-slow'), 14_000);
    const r = { errorInPlace: err !== null, errText, retryReopens: retried, errorClearedAfterRetry: cleared, slowHintAfter12s: slow !== null, slowText: document.querySelector('.web-slow')?.textContent ?? null };
    await openTab(kB);
    return { ...r, ok: r.errorInPlace && r.retryReopens && r.errorClearedAfterRetry && r.slowHintAfter12s };
  });
  await step('todoSourceOpensMessage', async () => {
    const target = provider === 'gchat' ? bigReplies[40] : topicMsgs[100];
    const tab = provider === 'gchat' ? `thread:${kA}:${BIG_THREAD}` : `thread:${kF}:7`;
    todos = [{ id: 1, status: 'open', title: 'Việc từ tin nhắn cũ', notes: '', link: '', dueAt: null, remindAt: null, createdAt: 1, completedAt: null, remindedAt: null,
      source: { accountId: A, chatId: target.chatId, messageId: target.id, threadId: target.threadId, label: provider === 'gchat' ? 'Perf A · luồng' : 'Forum · # Dev', excerpt: target.text, sentAt: target.ts, preview: false } }];
    useApp.setState((s: any) => ({ route: 'todo', topics: { ...s.topics, [kF]: structuredClone(topics) } }));
    const shown = await waitFor(() => document.querySelector('.todo-source summary'), 3000);
    if (shown === null) return { error: 'todo source not rendered' };
    document.querySelector<HTMLElement>('.todo-source summary')!.click(); await frames(3);
    const btn = [...document.querySelectorAll<HTMLButtonElement>('.todo-source button')].find(b => b.textContent?.includes('Mở nguồn'));
    const t0 = performance.now(); btn?.click();
    const landed = await waitFor(() => st().active === tab && inView(document.getElementById('m-' + target.id)) && document.getElementById('m-' + target.id)?.closest('.flash'), 5000);
    const el = document.getElementById('m-' + target.id);
    return { activeTab: st().active, rightTab: st().active === tab, targetInView: inView(el), highlighted: !!el?.closest('.flash'), ms: landed && Math.round(performance.now() - t0), ok: landed !== null };
  });
  useApp.setState({ route: 'shell' } as any); await frames(4);
  return out;
}
(window as any).runP2 = p2;

/** Narrow window (run by run-audit.mjs at 1000 px): Tìm, Luồng/Chủ đề, Thông tin first and compact. */
(window as any).runNarrow = async () => {
  useApp.setState({ route: 'shell', rightCollapsed: true } as any);
  if (provider === 'gchat') await S.openChat(kA);
  else {
    // the forum's own timeline (no topic to land in), whose header carries the “Chủ đề” button
    useApp.setState((s: any) => ({ topics: { ...s.topics, [kF]: [] }, lastTopic: { ...s.lastTopic, [kF]: '' } }));
    await S.openChat(kF);
  }
  await frames(12);
  const buttons = [...document.querySelectorAll<HTMLElement>('.conv-actions button')].filter(b => b.getClientRects().length);
  // reading order: row by vertical centre (buttons of different heights share a row), then left to right
  const order = buttons.map(b => { const r = b.getBoundingClientRect(); return { label: b.getAttribute('aria-label'), left: r.left, row: Math.round((r.top + r.height / 2) / 40) }; })
    .sort((a, b) => a.row - b.row || a.left - b.left).map(b => b.label);
  const prio = [provider === 'gchat' ? 'Luồng trả lời' : 'Chủ đề', 'Tìm trong chat này', 'Thông tin chat'];
  const firstThree = order.slice(0, 3);
  const label = document.querySelector<HTMLElement>('.conv-threads .conv-threads-label');
  const rects = buttons.map(b => { const r = b.getBoundingClientRect(); return [b.getAttribute('aria-label'), Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)]; });
  return { width: innerWidth, rects, visualOrder: order, priorityFirst: prio.every(p => firstThree.includes(p)), threadsLabelHidden: !label || getComputedStyle(label).display === 'none', ok: prio.every(p => firstThree.includes(p)) && (!label || getComputedStyle(label).display === 'none') };
};
(window as any).showSettings = () => { useApp.setState({ route: 'settings' } as any); };

// Sidebar behaviour that must not change: pin group order, section order, drag-sort, keyboard.
(window as any).sidebarSetup = async () => {
  useApp.setState((s: any) => ({ route: 'shell', filter: 'all', query: '', favorites: [`${A}|f3`, kB], folders: [], chatOrder: {}, collapsed: {},
    chats: { ...s.chats, [`${A}|f3`]: { ...s.chats[`${A}|f3`], unread: 2 } } }));
  await frames(8);
  return true;
};
(window as any).sidebarRead = () => {
  const st = useApp.getState() as any;
  const fav = [...document.querySelectorAll('.fav-group:not(.latest-group) .chat-row .name')].map(n => n.textContent);
  const firstAccount = document.querySelector('.acc-group:not(.folder-group)');
  const sections = [...(firstAccount?.querySelectorAll('.sec-head > span:first-of-type') ?? [])].map(n => n.textContent);
  const firstSectionRows = [...(firstAccount?.querySelector('.sec-body')?.querySelectorAll('.chat-row .name') ?? [])].map(n => n.textContent);
  const activeChat = st.active ? st.chats[st.active] ?? st.chats[st.threadTabs[st.active]?.chatKey ?? ''] : null;
  return { active: st.active, activeTitle: activeChat?.title ?? null, route: st.route, filter: st.filter, favorites: st.favorites, favoriteRows: fav, sections, firstSectionRows, chatOrder: st.chatOrder,
    focused: document.activeElement?.classList.contains('chat-row') ? document.activeElement.querySelector('.name')?.textContent : document.activeElement?.className };
};
(window as any).setFilter = async (f: string) => { useApp.setState({ filter: f } as any); await frames(6); };

// Native-only: checks that need real input, answered by scripts/performance/native-driver.py
let needSeq = 0;
const need = async (action: string, until: () => unknown, timeout = 6000) => { await nativeLog(`AUDIT-NEED ${provider}-${++needSeq} ${action}`); return waitFor(until, timeout); };
async function nativeInputChecks() {
  const out: any = {};
  const read = (window as any).sidebarRead as () => any;
  // narrow window: a real window resize to 1000 px
  await need('resize 1000 800', () => innerWidth === 1000, 5000); await frames(10);
  out.narrowWindow = { width: innerWidth, ...(await (window as any).runNarrow()) };
  await need('resize 1280 900', () => innerWidth === 1280, 5000); await frames(10);
  // sidebar: Enter, Tab / Option+Tab, ⌘↓, drag (also while filtered)
  await (window as any).sidebarSetup();
  const rows = () => [...document.querySelectorAll<HTMLButtonElement>('.acc-group:not(.folder-group) .sec-body .chat-row')];
  const firstName = rows()[0]?.querySelector('.name')?.textContent, secondName = rows()[1]?.querySelector('.name')?.textContent;
  rows()[0]?.focus();
  await need('key enter', () => read().activeTitle === firstName);
  const enterOpens = read().activeTitle === firstName;
  await sleep(400); rows()[0]?.focus();
  await need('key tab', () => document.activeElement !== rows()[0], 1500); const plainTab = read().focused;
  rows()[0]?.focus();
  await need('key option-tab', () => document.activeElement !== rows()[0], 1500); const optionTab = read().focused;
  const jumps: string[] = [];
  for (let i = 0; i < 3; i++) { (document.activeElement as HTMLElement | null)?.blur?.(); const before = read().active; await need('key cmd-down', () => read().active !== before, 3000); await sleep(300); jumps.push(read().active); }
  await (window as any).sidebarSetup(); await frames(6);
  const rr = [...document.querySelectorAll<HTMLElement>('.acc-group:not(.folder-group) .sec-body .reorder-row')];
  const dragged = rr[2]?.querySelector('.name')?.textContent; const a1 = rr[0].getBoundingClientRect(), a3 = rr[2].getBoundingClientRect();
  await need(`drag ${a3.left + 120} ${a3.top + a3.height / 2} ${a3.left + 120} ${a1.top + 4}`, () => Object.keys(read().chatOrder).length > 0, 5000); await sleep(400);
  const afterDrag = read();
  await (window as any).setFilter('unread');
  const orderBefore = JSON.stringify(read().chatOrder);
  const fr = [...document.querySelectorAll<HTMLElement>('.acc-group:not(.folder-group) .sec-body .reorder-row')]; const f1 = fr[0].getBoundingClientRect(), f3 = fr[2].getBoundingClientRect();
  await need(`drag ${f3.left + 120} ${f3.top + f3.height / 2} ${f3.left + 120} ${f1.top + 4}`, () => false, 1500); await sleep(400);
  const filteredOrderUnchanged = JSON.stringify(read().chatOrder) === orderBefore;
  await (window as any).setFilter('all'); const roundTrip = read();
  out.sidebarBehaviour = { enterOpens, plainTab, optionTab, expectedNextRow: secondName, unreadJumps: jumps, dragged, rowsAfterDrag: afterDrag.firstSectionRows.slice(0, 3), movedToTop: afterDrag.firstSectionRows[0] === dragged, filteredOrderUnchanged, favoriteRows: roundTrip.favoriteRows, sections: roundTrip.sections,
    // WKWebView in the app moves focus to buttons with plain Tab; WebKit/Safari needs Option+Tab
    ok: enterOpens && (plainTab === secondName || optionTab === secondName) && jumps.every(Boolean) && new Set(jumps).size === 3 && afterDrag.firstSectionRows[0] === dragged && filteredOrderUnchanged };
  // Todo date picker with real keys
  const dp = (window as any).datePicker; dp.applied = []; dp.closed = 0;
  (window as any).datePickerOpen(); await frames(3);
  const initialFocus = (document.activeElement as HTMLElement | null)?.getAttribute('aria-label');
  await need('key right', () => (document.activeElement as HTMLElement | null)?.getAttribute('aria-label')?.startsWith('11 '), 2000);
  const afterRight = (document.activeElement as HTMLElement | null)?.getAttribute('aria-label');
  await need('key enter', () => dp.applied.length === 1, 2000);
  (window as any).datePickerOpen(); await frames(3); document.querySelector<HTMLButtonElement>('.dtp .prompt-dialog-foot button')?.focus();
  await need('key enter', () => dp.closed === 2, 2000); const cancelApplied = dp.applied.length;
  (window as any).datePickerOpen(); await frames(3);
  await need('key escape', () => dp.closed === 3, 2000);
  const focusBack = document.activeElement?.textContent;
  out.datePicker = { initialFocus, afterRight, appliedOnEnter: dp.applied[0] ?? null, enterOnCancelApplied: cancelApplied > 1, focusBackAfterEscape: focusBack, ok: !!initialFocus && !!afterRight?.startsWith('11 ') && (dp.applied[0] ?? '').startsWith('2026-11-11') && cancelApplied === 1 && dp.closed === 3 && focusBack === 'Hạn chót' };
  return out;
}
