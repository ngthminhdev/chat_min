// Progress note (+ images) to my own Telegram Saved Messages, via the spike login session.
// usage: node --env-file=spike/.env spike/notify-me.cjs "text" [img.png ...]
const fs = require("node:fs");
const SPIKE = "/Users/qc-bright/Project/chat_min/spike";
const { TelegramClient } = require(`${SPIKE}/node_modules/telegram`);
const { StringSession } = require(`${SPIKE}/node_modules/telegram/sessions`);
const { CustomFile } = require(`${SPIKE}/node_modules/telegram/client/uploads`);

const [text, ...files] = process.argv.slice(2);
const session = fs.readFileSync(`${SPIKE}/.secrets/tg.session`, "utf8").trim();
const client = new TelegramClient(new StringSession(session), Number(process.env.TG_API_ID), process.env.TG_API_HASH, { connectionRetries: 3 });
client.setLogLevel("error");
(async () => {
  await client.connect();
  if (files.length) {
    const uploads = files.map((f) => new CustomFile(require("node:path").basename(f), fs.statSync(f).size, f));
    await client.sendFile("me", { file: uploads, caption: text, forceDocument: false });
  } else await client.sendMessage("me", { message: text });
  console.log("sent");
  await client.disconnect();
  process.exit(0);
})().catch((e) => { console.error("✗", e.message); process.exit(1); });
