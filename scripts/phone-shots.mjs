// Phone-size screenshots of the vite demo (`npx vite --port 1424` first).
// usage: W=390 H=844 OUT=/tmp/shots node scripts/phone-shots.mjs [step...]   (no args = all)
// needs Chrome + a global playwright: `npm i -g playwright`
import { createRequire } from "node:module";
import { execSync } from "node:child_process";
const { chromium, devices } = createRequire(import.meta.url)(execSync("npm root -g").toString().trim() + "/playwright");
import { mkdirSync } from "node:fs";

const W = Number(process.env.W || 390), H = Number(process.env.H || 844);
const OUT = process.env.OUT || `docs/audits/phone-shots-${W}x${H}`;
mkdirSync(OUT, { recursive: true });
const only = new Set(process.argv.slice(2));
const want = (n) => !only.size || only.has(n);

const browser = await chromium.launch({ channel: "chrome", headless: true });
const ctx = await browser.newContext({ ...devices["Pixel 7"], viewport: { width: W, height: H }, deviceScaleFactor: 2, colorScheme: "dark" });
const page = await ctx.newPage();
const errors = [];
page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") errors.push(`${m.type()}: ${m.text()}`); });
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
const shot = async (n) => { if (want(n)) { await page.waitForTimeout(450); await page.screenshot({ path: `${OUT}/${n}.png` }); console.log("shot", n); } };
const back = () => page.evaluate(() => window.__chatminBack?.()).then(() => page.waitForTimeout(350));
const overflow = async (label) => {
  const r = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: innerWidth, wide: [...document.querySelectorAll("body *")].filter((e) => e.getBoundingClientRect().right > innerWidth + 1 && getComputedStyle(e).position !== "fixed").slice(0, 5).map((e) => e.className || e.tagName) }));
  if (r.sw > r.iw || r.wide.length) console.log(`OVERFLOW @${label}:`, JSON.stringify(r));
};

await page.goto("http://localhost:1424/?mobile", { waitUntil: "networkidle" });
await shot("01-list"); await overflow("list");
await page.locator(".inbox-row").filter({ hasText: "Hà Giang" }).first().click();
await page.waitForTimeout(600);
await shot("02-chat-media"); await overflow("chat");
// viewer
await page.locator(".img-msg:not(.video)").first().click();
await shot("03-viewer");
await back();
// long-press menu (contextmenu) on a text bubble
await page.locator(".msg .bubble").nth(1).click({ button: "right" });
await shot("04-longpress-sheet");
const more = page.locator(".quick-more");
if (await more.count()) { await more.click(); await page.waitForTimeout(500); await shot("05-emoji-sheet"); await back(); } else await back();
// conversation sheet + composer sheet
await page.locator(".conv-head .mobile-action-menu > summary").click();
await shot("06-conv-sheet"); await back();
await page.locator(".composer .mobile-action-menu > summary").click();
await shot("07-composer-sheet"); await back();
await page.locator(".main-composer textarea").fill("Xin chào, đây là tin thử");
await shot("08-composer-typed");
await page.locator(".main-composer textarea").fill("");
await back();
await shot("09-list-after-back");
await page.locator('.mobile-header [aria-label="Thông báo"]').click();
await shot("10-notifications"); await back();
await page.locator('.mobile-header [aria-label="Cài đặt"]').click();
await shot("11-settings"); await back();
await page.locator(".inbox-row").filter({ hasText: "eng-platform" }).first().click();
await page.waitForTimeout(500);
await shot("12-gchat");
const t = page.locator(".thread-link").first();
if (await t.count()) { await t.click(); await shot("13-thread"); await back(); }
await page.locator(".conv-head .mobile-action-menu > summary").click();
await page.locator('.mobile-action-items [aria-label="Thông tin chat"]').click();
await shot("14-details"); await back();
await page.emulateMedia({ colorScheme: "light" });
await back();
await shot("15-list-light");
console.log(errors.length ? "CONSOLE:\n" + errors.join("\n") : "no console errors");
await browser.close();
