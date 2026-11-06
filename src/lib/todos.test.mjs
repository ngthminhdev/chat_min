import { test } from "node:test";
import assert from "node:assert/strict";
import { reminderFor, summarizeTodos, toDateField, fromDateField } from "./todos.ts";

test("local date fields preserve minutes and reject rolled-over dates", () => {
  const time = new Date(2026, 10, 6, 9, 15).getTime();
  assert.equal(toDateField(time), "2026-11-06T09:15");
  assert.equal(fromDateField("2026-11-06T09:15"), time);
  assert.equal(fromDateField("2026-02-31T09:15"), null);
});

test("overdue and due today are disjoint and completion excludes suggestions", () => {
  const now = new Date(2026, 10, 6, 12).getTime();
  assert.deepEqual(summarizeTodos([
    { status: "open", dueAt: now - 1 }, { status: "open", dueAt: now + 1 },
    { status: "open", dueAt: null }, { status: "done", completedAt: now - 500 },
    { status: "done", completedAt: new Date(2026, 9, 26).getTime() },
    { status: "suggested", dueAt: now - 500 },
  ], now), { open: 3, overdue: 1, today: 1, recentDone: 1 });
});

test("accepting a suggestion sets a future reminder within the deadline", () => {
  const now = 3_600_000;
  assert.equal(reminderFor(now + 3_600_000, now), now + 1_800_000);
  assert.equal(reminderFor(now + 60_000, now), now + 60_000);
  assert.equal(reminderFor(now - 1, now), null);
  assert.equal(reminderFor(null, now), null);
});
