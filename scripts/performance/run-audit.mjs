// UI/UX audit benchmark runner: builds scripts/performance/audit.html against the source tree it
// lives in, runs it in headless Playwright WebKit at a fixed viewport and writes one JSON per
// provider. Usage: node scripts/performance/run-audit.mjs <label> [telegram|gchat] [liveLatencyMs]
// Needs CHATMIN_PLAYWRIGHT_MODULE (playwright index.mjs) when playwright isn't resolvable here.
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import path from 'node:path';

const require = createRequire(new URL('../../package.json', import.meta.url));
const { build, preview } = require('vite');
const react = require('@vitejs/plugin-react').default;
const { webkit } = await import(process.env.CHATMIN_PLAYWRIGHT_MODULE || 'playwright');
const root = fileURLToPath(new URL('.', import.meta.url));
const label = process.argv[2] || 'run';
if (!/^[a-zA-Z0-9_-]+$/.test(label)) throw Error('invalid label');
const providers = process.argv[3] ? [process.argv[3]] : ['telegram', 'gchat'];
const live = Number(process.argv[4] || 120);
const output = process.env.CHATMIN_AUDIT_OUT || fileURLToPath(new URL('../../docs/audits/2026-11-07-uiux/', import.meta.url));
mkdirSync(output, { recursive: true });
const temporary = mkdtempSync(path.join(tmpdir(), 'chatmin-audit-'));
const port = 1438;
const config = { configFile: false, root, plugins: [react()], resolve: { dedupe: ['react', 'react-dom'] }, define: { __APP_VERSION__: '"audit"' },
  build: { outDir: temporary, emptyOutDir: true, target: 'safari15', rollupOptions: { input: path.join(root, 'audit.html') } }, preview: { port, strictPort: true }, logLevel: 'warn' };
await build(config);
const server = await preview(config);
let browser;
try {
  browser = await webkit.launch({ headless: true, executablePath: process.env.CHATMIN_WEBKIT_EXECUTABLE });
  for (const provider of providers) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const errors = []; let observerWarnings = 0;
    page.on('pageerror', (e) => { if (e.message.includes('ResizeObserver loop')) observerWarnings++; else errors.push(e.message); });
    await page.goto(`http://localhost:${port}/audit.html?provider=${provider}&live=${live}`);
    await page.waitForFunction(() => window.auditReady, null, { timeout: 20000 });
    const result = await page.evaluate(() => window.runAudit());
    // Todo date picker with real key presses (Enter on a focused button must run that button)
    const dp = async (fn) => page.evaluate(fn);
    const active = () => dp(() => ({ cls: document.activeElement?.className ?? '', text: document.activeElement?.textContent ?? '', label: document.activeElement?.getAttribute('aria-label') ?? '' }));
    await dp(() => window.datePickerOpen()); await page.waitForTimeout(50);
    const picker = { initialFocus: await active() };
    await page.keyboard.press('ArrowRight'); await page.waitForTimeout(30);
    picker.afterArrowRight = await active();
    await page.keyboard.press('Enter'); await page.waitForTimeout(30);
    picker.enterOnDay = await dp(() => ({ ...window.datePicker, applied: [...window.datePicker.applied] }));
    picker.focusAfterApply = await active();
    await dp(() => window.datePickerOpen()); await page.waitForTimeout(50);
    await page.focus('.dtp .prompt-dialog-foot button:first-child'); await page.keyboard.press('Enter'); await page.waitForTimeout(30);
    picker.enterOnCancel = await dp(() => ({ ...window.datePicker, applied: [...window.datePicker.applied] }));
    await dp(() => window.datePickerOpen()); await page.waitForTimeout(50);
    await page.keyboard.press('Escape'); await page.waitForTimeout(30);
    picker.escape = await dp(() => ({ ...window.datePicker, applied: [...window.datePicker.applied] }));
    picker.focusAfterEscape = await active();
    const ok = picker.initialFocus.cls.includes('dtp-day') && picker.afterArrowRight.label.startsWith('11 ') && picker.enterOnDay.applied[0]?.startsWith('2026-11-11')
      && picker.enterOnCancel.applied.length === 1 && picker.escape.closed === 3 && picker.focusAfterEscape.text === 'Hạn chót' && !picker.escape.formSubmitted;
    result.datePicker = { ok, ...picker };
    // P2 checks, then screenshots for the visual ones (tabs, narrow header, settings jump links)
    result.p2 = await page.evaluate(() => window.runP2());
    // sidebar behaviour with real mouse and keys: pins, sections, drag-sort, keyboard
    const sb = {};
    await page.evaluate(() => window.sidebarSetup());
    sb.initial = await page.evaluate(() => window.sidebarRead());
    // keyboard: focus the first row of the first account section, Enter opens it, Tab moves on, ⌘↓ jumps to the next unread chat
    const firstRow = page.locator('.acc-group:not(.folder-group) .sec-body .chat-row').first();
    const firstName = await firstRow.locator('.name').textContent();
    await firstRow.focus(); await page.keyboard.press('Enter'); await page.waitForTimeout(250);
    sb.enterOpens = { row: firstName, ...(await page.evaluate(() => window.sidebarRead())) };
    await page.waitForTimeout(400); // the opened chat's composer takes focus first
    const secondName = await page.locator('.acc-group:not(.folder-group) .sec-body .chat-row').nth(1).locator('.name').textContent();
    await firstRow.focus(); await page.waitForTimeout(50);
    const focusedBefore = (await page.evaluate(() => window.sidebarRead())).focused;
    await page.keyboard.press('Tab'); await page.waitForTimeout(50);
    const afterTab = (await page.evaluate(() => window.sidebarRead())).focused;
    // WebKit: plain Tab skips buttons unless they set tabIndex; Option+Tab walks every control
    await firstRow.focus(); await page.waitForTimeout(50); await page.keyboard.press('Alt+Tab'); await page.waitForTimeout(50);
    sb.tabMovesFocus = { expectedNextRow: secondName, focusedBefore, plainTab: afterTab, focused: (await page.evaluate(() => window.sidebarRead())).focused };
    // ⌘↓ outside a text field (in the composer it moves the caret, in both builds)
    const jumps = [];
    for (let i = 0; i < 3; i++) { await page.evaluate(() => document.activeElement?.blur?.()); await page.keyboard.press('Meta+ArrowDown'); await page.waitForTimeout(350); jumps.push((await page.evaluate(() => window.sidebarRead())).active); }
    sb.unreadJumps = jumps;
    // drag-sort in the unfiltered list: the third row of the first section dragged above the first
    await page.evaluate(() => window.sidebarSetup());
    const rows = page.locator('.acc-group:not(.folder-group) .sec-body .reorder-row');
    const r1 = await rows.nth(0).boundingBox(), r3 = await rows.nth(2).boundingBox();
    const dragged = await rows.nth(2).locator('.name').textContent();
    if (r1 && r3) {
      await page.mouse.move(r3.x + 120, r3.y + r3.height / 2); await page.mouse.down();
      for (let y = r3.y + r3.height / 2; y >= r1.y + 4; y -= 6) { await page.mouse.move(r3.x + 120, y); await page.waitForTimeout(16); }
      await page.mouse.up(); await page.waitForTimeout(400);
    }
    sb.dragSort = { dragged, ...(await page.evaluate(() => window.sidebarRead())) };
    sb.dragSort.movedToTop = sb.dragSort.firstSectionRows?.[0] === dragged;
    // while filtered, the same gesture must not rewrite the section order
    await page.evaluate(() => window.setFilter('unread'));
    const orderBefore = JSON.stringify((await page.evaluate(() => window.sidebarRead())).chatOrder);
    const f1 = await rows.nth(0).boundingBox(), f3 = await rows.nth(2).boundingBox();
    if (f1 && f3) {
      await page.mouse.move(f3.x + 120, f3.y + f3.height / 2); await page.mouse.down();
      for (let y = f3.y + f3.height / 2; y >= f1.y + 4; y -= 6) { await page.mouse.move(f3.x + 120, y); await page.waitForTimeout(16); }
      await page.mouse.up(); await page.waitForTimeout(400);
    }
    const filtered = await page.evaluate(() => window.sidebarRead());
    sb.dragWhileFiltered = { orderUnchanged: JSON.stringify(filtered.chatOrder) === orderBefore, favoriteRows: filtered.favoriteRows };
    await page.evaluate(() => window.setFilter('all'));
    sb.afterFilterRoundTrip = await page.evaluate(() => window.sidebarRead());
    sb.ok = sb.initial.favoriteRows.join() === sb.afterFilterRoundTrip.favoriteRows.join() && sb.enterOpens.activeTitle === firstName
      && sb.tabMovesFocus.focused === sb.tabMovesFocus.expectedNextRow && sb.dragSort.movedToTop && sb.dragWhileFiltered.orderUnchanged && sb.unreadJumps.every(Boolean) && new Set(sb.unreadJumps).size === 3
      && sb.initial.sections.join() === sb.afterFilterRoundTrip.sections.join();
    result.p2.sidebarBehaviour = sb;
    await page.evaluate(() => window.useAppForShots?.());
    await page.screenshot({ path: path.join(output, `${label}-${provider}-tabs.png`), clip: { x: 0, y: 0, width: 1280, height: 140 } });
    await page.setViewportSize({ width: 1000, height: 800 }); await page.waitForTimeout(300);
    result.p2.narrowWindow = await page.evaluate(() => window.runNarrow());
    await page.screenshot({ path: path.join(output, `${label}-${provider}-narrow.png`), clip: { x: 0, y: 0, width: 1000, height: 160 } });
    await page.evaluate(() => window.showSettings()); await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(output, `${label}-${provider}-settings.png`), clip: { x: 0, y: 0, width: 1000, height: 260 } });
    await page.setViewportSize({ width: 1280, height: 900 });
    result.label = label; result.pageErrors = errors; result.resizeObserverWarnings = observerWarnings;
    result.environment = { browser: `Playwright WebKit ${browser.version()}`, node: process.version, platform: process.platform, arch: process.arch, buildMode: 'vite production build' };
    writeFileSync(path.join(output, `${label}-${provider}.json`), JSON.stringify(result, null, 2));
    console.log(`  ${result.datePicker.ok ? '✓' : '✗'} datePickerKeyboard`);
    for (const [k, v] of Object.entries(result.p2)) console.log(`  ${v?.ok ? '✓' : v?.skipped ? '·' : '✗'} p2.${k}${v?.error ? ` (${v.error})` : ''}`);
    const brief = result.scenarios.map((s) => `${s.ok ? '✓' : '✗'} ${s.name}${s.ok ? '' : ` (${s.error})`}`).join('\n  ');
    console.log(`[${label}] ${provider}\n  ${brief}\n  page errors: ${errors.length}`);
    await page.close();
  }
} finally {
  await browser?.close();
  server.httpServer.close();
  rmSync(temporary, { recursive: true, force: true });
}
