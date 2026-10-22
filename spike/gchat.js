// Google Chat spike: Chat API with user OAuth (Workspace account only).
//   node --env-file=.env gchat.js login   # opens browser for consent, run once
//   node --env-file=.env gchat.js test    # spaces, recent messages, send, poll 60s
const fs = require('node:fs');
const http = require('node:http');
const { execFile } = require('node:child_process');
const { auth, OAuth2Client } = require('google-auth-library');
const { chat } = require('@googleapis/chat');

const CREDS = `${__dirname}/.secrets/gchat-credentials.json`; // OAuth client, type "Desktop app"
const TOKEN = `${__dirname}/.secrets/gchat-token.json`;
const SCOPES = [
  'https://www.googleapis.com/auth/chat.spaces.readonly',
  'https://www.googleapis.com/auth/chat.messages', // read + create
];

async function login() {
  // own loopback flow instead of local-auth: it opens the default browser (Edge here), we want Chrome
  const { client_id, client_secret } = JSON.parse(fs.readFileSync(CREDS, 'utf8')).installed;
  const client = new OAuth2Client({ clientId: client_id, clientSecret: client_secret });
  const code = await new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const q = new URL(req.url, 'http://localhost').searchParams;
      if (!q.has('code') && !q.has('error')) return res.end();
      res.end(q.has('code') ? 'ChatMin: login OK, back to terminal.' : `ChatMin: ${q.get('error')}`);
      server.close();
      q.has('code') ? resolve(q.get('code')) : reject(new Error(q.get('error')));
    });
    server.listen(0, '127.0.0.1', () => {
      client.redirectUri = `http://127.0.0.1:${server.address().port}`;
      const url = client.generateAuthUrl({ access_type: 'offline', prompt: 'consent', scope: SCOPES });
      console.log(`Open in Chrome (log in with your Workspace account):\n${url}\n`);
      execFile('open', ['-a', 'Google Chrome', url]);
    });
  });
  const { tokens } = await client.getToken({ code, redirect_uri: client.redirectUri });
  client.credentials = tokens;
  fs.writeFileSync(TOKEN, JSON.stringify({
    type: 'authorized_user', client_id, client_secret, refresh_token: client.credentials.refresh_token,
  }), { mode: 0o600 });
  console.log('Saved token');
}

async function test() {
  if (!fs.existsSync(TOKEN)) throw new Error('No token yet: run `gchat.js login` first');
  const api = chat({ version: 'v1', auth: auth.fromJSON(JSON.parse(fs.readFileSync(TOKEN, 'utf8'))) });

  const { data } = await api.spaces.list({ pageSize: 20 });
  const spaces = data.spaces ?? [];
  console.log(`✓ spaces (${spaces.length}):`);
  for (const s of spaces) console.log(`  ${s.name} [${s.spaceType}] ${s.displayName ?? '(DM)'}`);

  const parent = process.env.GCHAT_SPACE || spaces[0]?.name;
  if (!parent) return console.log('No spaces visible — nothing more to test');

  const recent = await api.spaces.messages.list({ parent, pageSize: 5, orderBy: 'createTime desc' });
  console.log(`✓ messages in ${parent}:`);
  for (const m of recent.data.messages ?? []) {
    console.log(`  ${m.createTime} ${m.sender?.displayName ?? m.sender?.name}: ${(m.text ?? '').slice(0, 60)}`);
  }

  // ponytail: only sends when GCHAT_SPACE is set explicitly, never to an arbitrary first space
  if (process.env.GCHAT_SPACE) {
    const sent = await api.spaces.messages.create({ parent, requestBody: { text: `chat_min spike ${new Date().toISOString()}` } });
    console.log(`✓ send: ${sent.data.name}`);
  } else console.log('- send skipped (set GCHAT_SPACE to a test space/DM to enable)');

  // ponytail: polling as the realtime baseline; Workspace Events API + Pub/Sub is the push upgrade
  let since = new Date().toISOString();
  console.log(`… polling ${parent} every 5s for 60s — post something there`);
  const end = Date.now() + 60_000;
  while (Date.now() < end) {
    await new Promise((r) => setTimeout(r, 5000));
    const r = await api.spaces.messages.list({ parent, filter: `createTime > "${since}"`, orderBy: 'createTime asc' });
    for (const m of r.data.messages ?? []) {
      console.log(`✓ poll: ${m.sender?.displayName ?? m.sender?.name}: ${(m.text ?? '').slice(0, 60)}`);
      since = m.createTime;
    }
  }
}

({ login, test })[process.argv[2] ?? 'test']().catch((e) => {
  console.error('✗', e.response?.data?.error?.message ?? e.message);
  process.exit(1);
});
