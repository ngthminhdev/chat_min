// Telegram spike: user-account MTProto via GramJS.
//   node --env-file=.env tg.js login   # interactive, run in your own terminal once
//   node --env-file=.env tg.js test    # non-interactive: dialogs, send to Saved Messages, listen 60s
const fs = require('node:fs');
const readline = require('node:readline/promises');
const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const { NewMessage } = require('telegram/events');

const SESSION_FILE = `${__dirname}/.secrets/tg.session`;
const apiId = Number(process.env.TG_API_ID);
const apiHash = process.env.TG_API_HASH;
if (!apiId || !apiHash) throw new Error('Set TG_API_ID and TG_API_HASH in .env (from my.telegram.org)');

const saved = fs.existsSync(SESSION_FILE) ? fs.readFileSync(SESSION_FILE, 'utf8').trim() : '';
const client = new TelegramClient(new StringSession(saved), apiId, apiHash, { connectionRetries: 3 });
client.setLogLevel('error');

async function login() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  await client.start({
    phoneNumber: () => rl.question('Phone (+84…): '),
    phoneCode: () => rl.question('Code from Telegram app: '),
    password: () => rl.question('2FA password (blank if none): '),
    onError: (e) => console.error('login error:', e.message),
  });
  rl.close();
  // session string = full account access; keep it out of git (.secrets/ is ignored)
  fs.writeFileSync(SESSION_FILE, client.session.save(), { mode: 0o600 });
  console.log('Logged in as', (await client.getMe()).username || (await client.getMe()).firstName);
}

async function test() {
  if (!saved) throw new Error('No session yet: run `tg.js login` first');
  await client.connect();
  const me = await client.getMe();
  console.log(`✓ auth: ${me.firstName} (@${me.username ?? '-'})`);

  const dialogs = await client.getDialogs({ limit: 10 });
  console.log(`✓ dialogs (${dialogs.length}):`);
  for (const d of dialogs) {
    const kind = d.isUser ? 'user' : d.isGroup ? 'group' : 'channel';
    const last = (d.message?.message ?? '').replace(/\s+/g, ' ').slice(0, 50);
    console.log(`  [${kind}] ${d.title} · unread ${d.unreadCount} · ${last}`);
  }

  const sent = await client.sendMessage('me', { message: `chat_min spike ${new Date().toISOString()}` });
  console.log(`✓ send: Saved Messages id=${sent.id}`);

  client.addEventHandler(async (ev) => {
    const chat = await ev.message.getChat();
    console.log(`✓ realtime: [${chat?.title ?? chat?.firstName ?? '?'}] ${ev.message.message?.slice(0, 60)}`);
  }, new NewMessage({}));
  console.log('… listening 60s — send yourself a message from your phone');
  await new Promise((r) => setTimeout(r, 60_000));
  await client.disconnect();
  process.exit(0);
}

({ login, test })[process.argv[2] ?? 'test']().catch((e) => { console.error('✗', e.message); process.exit(1); });
