// Run against the Vite demo. Uses global Playwright or PLAYWRIGHT_MODULE, like phone-shots.mjs.
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";

const require = createRequire(import.meta.url);
const { webkit } = require(process.env.PLAYWRIGHT_MODULE || `${execFileSync("npm", ["root", "-g"]).toString().trim()}/playwright`);
const browser = await webkit.launch({
  ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}),
});
try {
  const page = await browser.newPage();
  await page.goto(process.env.BASE_URL || "http://127.0.0.1:1424");
  await page.locator(".titlebar").waitFor();
  const palettes = await page.evaluate(async () => {
    const { readIslandAppearance } = await import("/src/lib/island-appearance.ts");
    const out = {};
    for (const id of ["night-owl", "light", "rose-milk", "catppuccin-mocha"]) {
      document.body.dataset.theme = id;
      document.body.classList.toggle("light", ["light", "rose-milk"].includes(id));
      out[id] = readIslandAppearance();
    }
    return out;
  });
  for (const [theme, palette] of Object.entries(palettes)) {
    for (const key of ["background", "foreground", "secondary", "accent", "border"]) {
      assert.ok(palette[key].length === 3 && palette[key].every((v) => Number.isFinite(v) && v >= 0 && v <= 1), `${theme}/${key}`);
    }
  }
  assert.equal(palettes.light.light, true);
  assert.equal(palettes["night-owl"].light, false);
  assert.notDeepEqual(palettes.light.background, palettes["night-owl"].background);
  assert.notDeepEqual(palettes["rose-milk"].accent, palettes["night-owl"].accent);
  if (process.env.OUT) writeFileSync(process.env.OUT, JSON.stringify(palettes, null, 2));
  console.log("PASS: native island uses actual semantic colors from four dark/light themes");
} finally {
  await browser.close();
}
