// Run against the Vite browser demo: npm run dev
// Uses a global playwright like phone-shots.mjs, or PLAYWRIGHT_MODULE=/path/to/playwright.
// Optional: BROWSER=chromium BROWSER_EXECUTABLE=/path/to/browser BASE_URL=http://localhost:1424
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";

const require = createRequire(import.meta.url);
const playwright = require(process.env.PLAYWRIGHT_MODULE || `${execFileSync("npm", ["root", "-g"]).toString().trim()}/playwright`);
const engine = process.env.BROWSER || "webkit";
const browser = await playwright[engine].launch({
  ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}),
});
const errors = [];
const page = await browser.newPage({ viewport: { width: 1250, height: 872 } });
page.on("pageerror", (e) => errors.push(e.message));
const input = page.locator("#composer-input");
const settle = () => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const geometry = () => page.evaluate(() => {
  const box = document.querySelector(".msgs"), ta = document.querySelector("#composer-input");
  return { top: box.scrollTop, distance: box.scrollHeight - box.clientHeight - box.scrollTop, height: ta.clientHeight };
});
const track = () => page.evaluate(() => {
  window.composerFrames = [];
  window.trackComposer = true;
  const tick = () => {
    const box = document.querySelector(".msgs");
    window.composerFrames.push({ top: box.scrollTop, distance: box.scrollHeight - box.clientHeight - box.scrollTop });
    if (window.trackComposer) requestAnimationFrame(tick);
  };
  tick();
});
const stop = () => page.evaluate(() => { window.trackComposer = false; return window.composerFrames; });
const long = JSON.stringify({ amount: 50620, status: "Success", service: "Transfer", currency: "PHP", transaction: "239bc3a-608a-5340-9ba2" }).repeat(12);
try {
  await page.goto(process.env.BASE_URL || "http://localhost:1424");
  await page.getByText("Backend Go — Mine Wallet", { exact: true }).first().click();
  await input.waitFor();
  await page.locator(".msgs [id^='m-']").last().waitFor();
  await page.evaluate(() => document.fonts.ready);
  await input.fill("");
  await settle();
  const empty = await geometry();
  await input.fill(long);
  await settle();
  // Wait for the initial history reveal to finish before measuring keystroke drift.
  await page.waitForTimeout(500);
  const capped = await geometry();
  assert.equal(capped.height, 176);
  assert.ok(capped.distance <= 1);
  await track();
  await input.press("End");
  await input.pressSequentially("a".repeat(100), { delay: 20 });
  await settle();
  const bottomFrames = await stop();
  assert.ok(bottomFrames.length > 20, "must sample throughout typing");
  assert.ok(bottomFrames.every((f) => Math.abs(f.distance) <= 1), `bottom drift: ${Math.max(...bottomFrames.map((f) => f.distance))}px`);

  // A deliberate history scroll must stay put while the composer is edited.
  await page.locator(".msgs").hover();
  await page.mouse.wheel(0, -480);
  await page.waitForTimeout(800);
  const history = await geometry();
  assert.ok(history.distance > 80, "fixture must actually be reading history");
  await input.click();
  await track();
  await input.pressSequentially("b".repeat(60), { delay: 20 });
  await settle();
  const historyFrames = await stop();
  assert.ok(historyFrames.every((f) => Math.abs(f.top - history.top) <= 1), "typing moved the history viewport");
  await input.fill("short");
  await settle();
  assert.equal((await geometry()).height, empty.height, "deleting a long draft must shrink back");
  assert.ok(Math.abs((await geometry()).top - history.top) <= 1, "shrinking moved history");

  await input.fill("Một dòng\nHai dòng\nBa dòng\n");
  await settle();
  assert.ok((await geometry()).height > empty.height, "explicit/trailing newlines must grow the input");
  await page.setViewportSize({ width: 1800, height: 872 });
  await input.fill("Đây là bản nháp có dấu để kiểm tra xuống dòng khi đổi chiều rộng cửa sổ. ".repeat(3));
  await settle();
  const beforeWidth = await geometry();
  await page.setViewportSize({ width: 1100, height: 872 });
  await settle();
  const narrow = await geometry();
  assert.ok(narrow.height > beforeWidth.height, "width changes must remeasure the existing draft");
  await input.fill("");
  await settle();
  assert.equal((await geometry()).height, empty.height);
  assert.deepEqual(errors, []);
  console.log(`${engine}: PASS — capped typing 0px drift, history preserved, grow/shrink/newlines/width resize`);
} finally {
  await browser.close();
}
