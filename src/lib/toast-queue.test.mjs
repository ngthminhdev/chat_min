import { test } from "node:test";
import assert from "node:assert/strict";

test("routine feedback cannot evict an error from a full toast stack", async () => {
  const { queueToast } = await import("./toast-queue.ts");
  const errors = [1, 2, 3].map(id => ({ id, icon: "circle-alert" }));
  assert.deepEqual(queueToast(errors, { id: 4, icon: "check" }), errors);
  const mixed = [{ id: 1, icon: "check" }, { id: 2, icon: "circle-alert" }, { id: 3, icon: "check" }];
  assert.deepEqual(queueToast(mixed, { id: 4, icon: "check" }).map(x=>x.id), [2, 3, 4]);
});

test("error bursts stay bounded and retain the newest errors", async () => {
  const { queueToast } = await import("./toast-queue.ts");
  const errors = [1, 2, 3].map(id => ({ id, icon: "circle-alert" }));
  assert.deepEqual(queueToast(errors, { id: 4, icon: "circle-alert" }).map(x=>x.id), [2, 3, 4]);
});
