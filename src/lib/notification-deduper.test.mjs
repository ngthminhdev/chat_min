import { test } from "node:test";
import assert from "node:assert/strict";
import { createNotificationDeduper } from "./notification-deduper.ts";

test("repeated final-message events are claimed once", () => {
  const claim = createNotificationDeduper();
  assert.equal(claim("a", "chat", "last"), true);
  for (let i = 0; i < 20; i++) assert.equal(claim("a", "chat", "last"), false);
  assert.equal(claim("a", "chat", "genuinely-new"), true);
});

test("a message seen while focused stays consumed after switching away", () => {
  const claim = createNotificationDeduper();
  claim("a", "chat", "read-in-active-tab");
  assert.equal(claim("a", "chat", "read-in-active-tab"), false);
});

test("identical message ids in different accounts and chats are independent", () => {
  const claim = createNotificationDeduper();
  assert.equal(claim("a", "chat", "1"), true);
  assert.equal(claim("b", "chat", "1"), true);
  assert.equal(claim("a", "other-chat", "1"), true);
  assert.equal(claim("b", "chat", "1"), false);
});
