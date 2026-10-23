// Read-only feasibility probe. Reports counts/shapes only, never raw account data.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Zalo, ThreadType } from 'zca-js';

const root = path.dirname(fileURLToPath(import.meta.url));
const sessionPath = path.join(root, '.secrets/zalo/session.json');
const reportPath = path.join(root, 'zalo-discovery-result.json');
if (process.argv.includes('--help')) {
  console.log('node spike/zalo-discovery.mjs — saved-session login, contacts/groups, two bounded history pages per type; no sends/read receipts.');
  process.exit(0);
}
if (process.argv.length > 2) throw new Error('Use --help; this probe accepts no options.');
if (!fs.existsSync(sessionPath)) {
  console.error('No session. Run zalo-connect.mjs --qr first.');
  process.exit(2);
}
process.umask(0o077);
const report = { startedAt: new Date().toISOString(), sdk: 'zca-js@2.2.0', readOnly: true, checks: {}, history: {} };
const log = (event, fields = {}) => console.log(JSON.stringify({ event, ...fields }));
let api;
let finished = false;
let socketTimer;
const pending = new Map();
const seen = { user: new Set(), group: new Set() };
const threads = { user: new Set(), group: new Set() };
const userPages = [];
const groupPages = [];
function finish(reason, code = 0) {
  if (finished) return;
  finished = true;
  clearTimeout(socketTimer);
  clearTimeout(overallTimer);
  try { api?.listener.stop(); } catch { /* already closed */ }
  report.finishedAt = new Date().toISOString();
  report.reason = reason;
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
  log('report_saved', { path: reportPath, reason });
  process.exit(code);
}
const overallTimer = setTimeout(() => finish('overall_timeout', 1), 90_000);
process.on('SIGINT', () => finish('interrupted', 130));
process.on('SIGTERM', () => finish('terminated', 143));
async function check(name, action, summarize) {
  try {
    const value = await action();
    const result = { status: 'ok', ...summarize(value) };
    report.checks[name] = result;
    log(name, result);
    return value;
  } catch (error) {
    // Do not expose SDK messages or HTTP response bodies.
    const code = error?.code == null ? null : Number(error.code);
    const httpStatus = /^Request failed with status code (\d{3})$/.exec(String(error?.message))?.[1];
    report.checks[name] = { status: 'failed', ...(code !== null && Number.isFinite(code) ? { code } : {}), ...(httpStatus ? { httpStatus: Number(httpStatus) } : {}) };
    log(name, report.checks[name]);
    return null;
  }
}
function summarizeMessages(messages) {
  if (!Array.isArray(messages)) throw new Error('Unexpected message response');
  return {
    count: messages.length,
    outgoing: messages.filter((m) => m.isSelf).length,
    incoming: messages.filter((m) => !m.isSelf).length,
    distinctThreads: new Set(messages.map((m) => m.threadId)).size,
    hasMessageIds: messages.every((m) => !!m.data?.msgId),
    hasThreadIds: messages.every((m) => !!m.threadId),
    hasTimestamps: messages.every((m) => Number.isFinite(Number(m.data?.ts)) && Number(m.data.ts) > 0),
  };
}
function requestPage(type, cursor = null) {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => { pending.delete(type); resolve(null); }, 12_000);
    pending.set(type, (messages) => { clearTimeout(timeout); pending.delete(type); resolve(messages); });
    api.listener.requestOldMessages(type, cursor);
  });
}

try {
  api = await new Zalo({ logging: false, checkUpdate: false, selfListen: true }).login(JSON.parse(fs.readFileSync(sessionPath, 'utf8')));
  log('session_login_ok');
  report.checks.login = { status: 'ok' };
  await check('friends_sample', () => api.getAllFriends(100, 1), (v) => {
    if (!Array.isArray(v)) throw new Error('Unexpected friends shape');
    return { count: v.length, requestedLimit: 100, representsConversations: false };
  });
  const groups = await check('groups', () => api.getAllGroups(), (v) => {
    if (!v?.gridVerMap) throw new Error('Unexpected groups shape');
    return { count: Object.keys(v.gridVerMap).length };
  });
  await check('pinned_conversations', () => api.getPinConversations(), (v) => {
    if (!Array.isArray(v?.conversations)) throw new Error('Unexpected pins shape');
    return { count: v.conversations.length, completeInbox: false };
  });
  const groupIds = Object.keys(groups?.gridVerMap ?? {}).slice(0, 2);
  if (groupIds.length) {
    await check('group_metadata_sample', () => api.getGroupInfo(groupIds), (v) => ({ count: Object.keys(v.gridInfoMap ?? {}).length }));
    for (let i = 0; i < groupIds.length; i++) {
      await check(`group_history_sample_${i + 1}`, () => api.getGroupChatHistory(groupIds[i], 10), (v) => ({ ...summarizeMessages(v.groupMsgs), more: v.more }));
    }
  }
  const ready = new Promise((resolve) => {
    socketTimer = setTimeout(() => resolve(false), 15_000);
    api.listener.once('cipher_key', () => { clearTimeout(socketTimer); resolve(true); });
  });
  api.listener.on('error', () => { report.checks.socketError = { status: 'failed' }; log('socket_error'); });
  api.listener.on('disconnected', (code) => { report.checks.disconnected = { status: 'failed', code }; log('socket_disconnected', { code }); });
  api.listener.on('old_messages', (messages, type) => pending.get(type)?.(messages));
  api.listener.start({ retryOnClose: false });
  if (!(await ready)) { report.checks.socket = { status: 'timeout' }; finish('socket_not_ready', 1); }
  report.checks.socket = { status: 'ok' };
  log('socket_ready');
  for (const [label, type, pages] of [['user', ThreadType.User, userPages], ['group', ThreadType.Group, groupPages]]) {
    let cursor = null;
    for (let page = 1; page <= 2; page++) {
      const messages = await requestPage(type, cursor);
      if (messages === null) { pages.push({ page, status: 'timeout' }); log(`${label}_history`, { page, status: 'timeout' }); break; }
      let newMessages = 0;
      for (const m of messages) {
        const key = `${m.threadId}:${m.data?.msgId}`;
        if (!seen[label].has(key)) { seen[label].add(key); newMessages++; }
        threads[label].add(m.threadId);
      }
      const result = { page, status: 'ok', ...summarizeMessages(messages), newMessages };
      pages.push(result);
      log(`${label}_history`, result);
      const ids = messages.map((m) => String(m.data?.msgId ?? '')).filter((id) => /^\d+$/.test(id));
      const oldest = ids.reduce((min, id) => min === null || BigInt(id) < BigInt(min) ? id : min, null);
      if (!messages.length || !newMessages || !oldest || oldest === cursor) break;
      cursor = oldest;
    }
    report.history[label] = { pages, uniqueMessages: seen[label].size, distinctThreads: threads[label].size, completeHistoryVerified: false };
  }
  finish('probe_complete');
} catch {
  log('probe_failed');
  finish('failed', 1);
}
