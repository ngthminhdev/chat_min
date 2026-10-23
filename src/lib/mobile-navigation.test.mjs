import { test } from "node:test";
import assert from "node:assert/strict";

const root = { route: "shell", active: "tg|1", leftCollapsed: false, rightCollapsed: true, accounts: [{}], threadTabs: {} };

test("Android Back unwinds overlays before leaving a conversation", async () => {
  const { getMobileBackTarget } = await import("./mobile-navigation.ts");
  const chat = { ...root, leftCollapsed: true, rightCollapsed: false };
  assert.equal(getMobileBackTarget({ ...chat, viewer: {}, dialog: {}, pop: {} }), "viewer");
  assert.equal(getMobileBackTarget({ ...chat, dialog: {}, forward: {} }), "dialog");
  assert.equal(getMobileBackTarget({ ...chat, forward: {}, pop: {} }), "forward");
  assert.equal(getMobileBackTarget({ ...chat, pop: {}, palette: {} }), "pop");
  assert.equal(getMobileBackTarget({ ...chat, palette: {} }), "palette");
  assert.equal(getMobileBackTarget(chat), "details");
});

test("Android Back returns from pages, threads and chats, then yields at the list root", async () => {
  const { getMobileBackTarget } = await import("./mobile-navigation.ts");
  assert.equal(getMobileBackTarget({ ...root, route: "settings" }), "page");
  assert.equal(getMobileBackTarget({ ...root, route: "search", leftCollapsed: true }), "page");
  assert.equal(getMobileBackTarget({ ...root, route: "wizard" }), "wizard");
  assert.equal(getMobileBackTarget({ ...root, active: "thread:tg|1:2", leftCollapsed: true, threadTabs: { "thread:tg|1:2": { chatKey: "tg|1" } } }), "thread");
  assert.equal(getMobileBackTarget({ ...root, leftCollapsed: true }), "list");
  assert.equal(getMobileBackTarget(root), "root");
  assert.equal(getMobileBackTarget({ ...root, route: "welcome", active: null }), "root");
});

test("the list, settings and details never mark background conversation messages read", async () => {
  const { mobileConversationVisible } = await import("./mobile-navigation.ts");
  assert.equal(mobileConversationVisible(root), false);
  assert.equal(mobileConversationVisible({ ...root, leftCollapsed: true }), true);
  assert.equal(mobileConversationVisible({ ...root, leftCollapsed: true, route: "settings" }), false);
  assert.equal(mobileConversationVisible({ ...root, leftCollapsed: true, rightCollapsed: false }), false);
});

test("mobile Enter inserts a newline, desktop Enter sends, and IME composition never submits", async () => {
  const { enterSubmits } = await import("./mobile-navigation.ts");
  assert.equal(enterSubmits(true, false, false), false);
  assert.equal(enterSubmits(false, false, false), true);
  assert.equal(enterSubmits(false, true, false), false);
  assert.equal(enterSubmits(false, false, true), false);
  assert.equal(enterSubmits(true, false, true), false);
});
