import { test } from "node:test";
import assert from "node:assert/strict";

const msg = (id, extra = {}) => ({ id, sort: 1, text: "hello", ...extra });

test("server acknowledgement retains the optimistic bubble identity", async () => {
  const { reconcileMessage, messageRenderKey } = await import("./message-identity.ts");
  const pending = msg("local-1");
  const list = reconcileMessage([pending], msg("123", { status: "sent" }), "local-1");
  assert.equal(list.length, 1);
  assert.equal(list[0].id, "123");
  assert.equal(list[0].status, "sent");
  assert.equal(messageRenderKey(list[0]), messageRenderKey(pending));
});

test("event before response is reconciled to one bubble without losing local identity", async () => {
  const { reconcileMessage, messageRenderKey } = await import("./message-identity.ts");
  const pending = msg("local-2");
  const echo = msg("124", { sort: 4, status: "seen" });
  const list = reconcileMessage([msg("older"), pending, echo], msg("124", { sort: 4, status: "sent" }), "local-2");
  assert.deepEqual(list.map(m => m.id), ["older", "124"]);
  assert.equal(messageRenderKey(list[1]), "local-2");
  assert.equal(list[1].status, "seen", "ack must not downgrade an already seen echo");
});

test("provider ID changes and later edits preserve the same render identity", async () => {
  const { reconcileMessage, messageRenderKey } = await import("./message-identity.ts");
  const first = reconcileMessage([msg("local-3")], msg("-400"), "local-3");
  const second = reconcileMessage(first, msg("125"), "-400");
  const edited = reconcileMessage(second, msg("125", { text: "edited" }));
  assert.equal(edited.length, 1);
  assert.equal(edited[0].text, "edited");
  assert.equal(messageRenderKey(edited[0]), "local-3");
});

test("a late acknowledgement after ID-change does not resurrect a temporary provider ID", async () => {
  const { reconcileMessage } = await import("./message-identity.ts");
  const pending = msg("local-4");
  const temp = reconcileMessage([pending], msg("-500"), "local-4");
  const final = reconcileMessage(temp, msg("126", { sort: 8 }), "-500");
  const late = reconcileMessage(final, msg("-500"), "local-4");
  assert.deepEqual(late.map(m => m.id), ["126"]);
});

test("native ID-change before the send response merges the still-pending local bubble", async () => {
  const { reconcileMessage, messageRenderKey } = await import("./message-identity.ts");
  const pending = msg("local-5");
  const native = [pending, msg("-600")];
  const changed = reconcileMessage(native, msg("127", { sort: 8, status: "seen" }), "-600");
  const acknowledged = reconcileMessage(changed, msg("-600", { status: "sent" }), "local-5");
  assert.deepEqual(acknowledged.map(m => m.id), ["127"]);
  assert.equal(messageRenderKey(acknowledged[0]), "local-5");
  assert.equal(acknowledged[0].status, "seen");
});
