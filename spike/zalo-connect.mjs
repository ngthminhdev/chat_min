// Local connection probe. Never sends messages or prints credentials/message bodies.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Zalo, LoginQRCallbackEventType as QR } from 'zca-js';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '.secrets', 'zalo');
const sessionPath = path.join(dir, 'session.json');
const qrPath = path.join(dir, 'login-qr.png');
const args = process.argv.slice(2);
if (args.includes('--help')) {
  console.log('node spike/zalo-connect.mjs [--qr | --resume] [--seconds=120]');
  console.log('Default: reuse session if present; otherwise QR login. No messages are sent.');
  process.exit(0);
}
const seconds = Number(args.find((x) => x.startsWith('--seconds='))?.split('=')[1] ?? 120);
if (!Number.isInteger(seconds) || seconds < 10 || seconds > 600 || args.some((x) => !['--qr', '--resume'].includes(x) && !/^--seconds=\d+$/.test(x)) || (args.includes('--qr') && args.includes('--resume'))) {
  console.error('Invalid arguments. Use --help. Duration: 10–600 seconds.');
  process.exit(2);
}
if (args.includes('--resume') && !fs.existsSync(sessionPath)) {
  console.error('No saved session. Run with --qr first.');
  process.exit(2);
}
process.umask(0o077);
fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
fs.chmodSync(dir, 0o700);
const log = (event, fields = {}) => console.log(JSON.stringify({ time: new Date().toISOString(), event, ...fields }));
const counts = { incoming: 0, outgoing: 0, connections: 0, disconnections: 0, errors: 0 };
let api;
let timer;
let finished = false;
let stage = 'login';
function finish(reason, code = 0) {
  if (finished) return;
  finished = true;
  clearTimeout(timer);
  log('summary', { reason, ...counts, realtimeMessageVerified: counts.incoming > 0 });
  try { api?.listener.stop(); } catch { /* already closed */ }
  fs.rmSync(qrPath, { force: true });
  process.exit(code);
}
process.on('SIGINT', () => finish('interrupted', 130));
process.on('SIGTERM', () => finish('terminated', 143));
timer = setTimeout(() => finish('login_timeout', 1), 180_000);

try {
  const zalo = new Zalo({ logging: false, checkUpdate: false, selfListen: true });
  const resume = !args.includes('--qr') && fs.existsSync(sessionPath);
  log('login_start', { mode: resume ? 'saved_session' : 'qr' });
  api = resume
    ? await zalo.login(JSON.parse(fs.readFileSync(sessionPath, 'utf8')))
    : await zalo.loginQR({ qrPath }, (event) => {
      if (event.type === QR.QRCodeGenerated) {
        fs.writeFileSync(qrPath, Buffer.from(event.data.image, 'base64'), { mode: 0o600 });
        log('qr_ready', { path: qrPath });
      } else if (event.type === QR.QRCodeScanned) {
        log('qr_scanned', { action: 'Confirm login on your phone' });
      } else if (event.type === QR.QRCodeExpired || event.type === QR.QRCodeDeclined) {
        event.actions.abort();
        finish(event.type === QR.QRCodeExpired ? 'qr_expired' : 'qr_declined', 1);
      }
    });
  stage = 'profile';
  const info = await api.fetchAccountInfo();
  if (!info?.profile) throw new Error('Profile unavailable');
  log('profile_ok');
  const ctx = api.getContext();
  const credentials = { cookie: ctx.cookie.toJSON()?.cookies, imei: ctx.imei, userAgent: ctx.userAgent };
  if (!credentials.cookie?.length || !credentials.imei || !credentials.userAgent) throw new Error('Session incomplete');
  const temporary = sessionPath + '.tmp';
  fs.writeFileSync(temporary, JSON.stringify(credentials), { mode: 0o600 });
  fs.renameSync(temporary, sessionPath);
  fs.chmodSync(sessionPath, 0o600);
  fs.rmSync(qrPath, { force: true });
  log('session_saved');
  clearTimeout(timer);
  stage = 'listener';
  api.listener.on('connected', () => {
    counts.connections++;
    log('listener_connected');
  });
  api.listener.on('disconnected', () => {
    counts.disconnections++;
    log('listener_disconnected');
  });
  api.listener.on('error', () => {
    counts.errors++;
    log('listener_error');
  });
  api.listener.on('message', (message) => {
    counts[message.isSelf ? 'outgoing' : 'incoming']++;
    log('message_received', { outgoing: !!message.isSelf, threadType: message.type });
  });
  timer = setTimeout(() => finish('observation_complete', counts.connections > 0 && counts.errors === 0 && counts.disconnections === 0 ? 0 : 1), seconds * 1000);
  log('observation_start', { seconds });
  await api.listener.start();
} catch {
  // SDK errors may contain server responses/cookies; deliberately do not dump them.
  log('probe_failed', { stage, action: stage === 'login' ? 'Check phone approval/network; use --qr if saved session expired' : 'Check connection and rerun' });
  finish('failed', 1);
}
