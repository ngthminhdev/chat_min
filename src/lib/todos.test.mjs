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

test("AI Todo uses nearby messages in the selected thread and keeps quoted context", async () => {
  const { todoTranscript, aiTodoDraft } = await import("./todos.ts");
  const msg = (id, sort, threadId, extra = {}) => ({
    id, sort, threadId, accountId: "a", chatId: "c", kind: "text", ts: 0, senderName: "Lan", text: id, ...extra,
  });
  const selected = msg("target", 3, "t", { replyText: "The release is on Friday", outgoing: true });
  const transcript = todoTranscript(selected, [
    msg("prior", 1, "t"), msg("other thread", 2, "other"), selected,
    msg("deleted", 4, "t", { deleted: true }), msg("follow-up https://example.test/ticket", 5, "t"),
  ], true);
  assert.deepEqual(transcript.map(line => line.text), ["prior", "target", "follow-up https://example.test/ticket"]);
  assert.equal(transcript[1].selected, true);
  assert.equal(transcript[1].author, "Me");
  assert.equal(transcript[1].quote, "The release is on Friday");
  const draft = aiTodoDraft({ title: "Review release", notes: "• Check status", deadline: "2026-02-31", link: "https://unseen.test/" }, transcript);
  assert.equal(draft.dueAt, null);
  assert.equal(draft.link, "");
  assert.equal(aiTodoDraft({ title: "Review release", notes: "", deadline: "2026-11-30", link: "https://example.test/ticket" }, transcript).link, "https://example.test/ticket");
  const { toDateField } = await import("./todos.ts");
  for (const deadline of ["2026-11-07T18:00:00", "2026-11-07T18:00:00Z", "2026-11-07 18:00"])
    assert.equal(toDateField(aiTodoDraft({ title: "x", notes: "", deadline, link: "" }, transcript).dueAt), "2026-11-07T18:00");
  assert.equal(toDateField(aiTodoDraft({ title: "x", notes: "", deadline: "2026-11-07", link: "" }, transcript).dueAt), "2026-11-07T18:00");
});
