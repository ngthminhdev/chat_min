import { test } from "node:test";
import assert from "node:assert/strict";
import { THEMES } from "./themes.ts";

test("media sections do not depend on whether a video has a thumbnail", async () => {
  const { mediaSection } = await import("./micro-ux.ts");
  assert.equal(mediaSection({ kind: "video", thumb: "" }), "media");
  assert.equal(mediaSection({ kind: "video", thumb: "preview.jpg" }), "media");
  assert.equal(mediaSection({ kind: "image" }), "media");
  assert.equal(mediaSection({ kind: "voice" }), "files");
  assert.equal(mediaSection({ kind: "file" }), "files");
  assert.equal(mediaSection({ kind: "sticker" }), null);
  assert.equal(mediaSection(null), null);
});

test("emoji grid navigation wraps and stays valid in a partial last row", async () => {
  const { nextEmojiIndex } = await import("./micro-ux.ts");
  assert.equal(nextEmojiIndex(0, "ArrowRight", 16), 1);
  assert.equal(nextEmojiIndex(0, "ArrowLeft", 16), 15);
  assert.equal(nextEmojiIndex(2, "ArrowDown", 16), 10);
  assert.equal(nextEmojiIndex(10, "ArrowDown", 16), 2);
  assert.equal(nextEmojiIndex(2, "ArrowUp", 11), 10);
  assert.equal(nextEmojiIndex(7, "ArrowDown", 11), 7);
  assert.equal(nextEmojiIndex(5, "Home", 11), 0);
  assert.equal(nextEmojiIndex(5, "End", 11), 10);
  assert.equal(nextEmojiIndex(0, "ArrowDown", 0), -1);
  for (let count = 1; count <= 65; count++) {
    for (let i = 0; i < count; i++) {
      for (const key of ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"]) {
        const n = nextEmojiIndex(i, key, count);
        assert.ok(n >= 0 && n < count, `${key}: ${i}/${count} -> ${n}`);
      }
    }
  }
});

test("expanded emoji search supports Vietnamese without accents and named quick reactions", async () => {
  const { EMOJI, searchEmoji } = await import("./micro-ux.ts");
  assert.ok(EMOJI.length > 16);
  assert.equal(new Set(EMOJI.map(([emoji]) => emoji)).size, EMOJI.length);
  assert.ok(EMOJI.every(([, label]) => label.trim()));
  assert.ok(searchEmoji("cam on").some(([emoji]) => emoji === "🙏"));
  assert.ok(searchEmoji("🎉").some(([emoji]) => emoji === "🎉"));
  assert.deepEqual(searchEmoji("nothing-matches-this"), []);
});

test("file action labels distinguish cache download, local opening and external links", async () => {
  const { fileActionLabel } = await import("./micro-ux.ts");
  assert.equal(fileActionLabel({ name: "report.pdf", url: "", kind: "file" }, false), "Tải và mở report.pdf");
  assert.equal(fileActionLabel({ name: "report.pdf", url: "", kind: "file" }, true), "Mở report.pdf");
  assert.equal(fileActionLabel({ name: "report.pdf", url: "https://drive.google.com/x", kind: "file" }, false), "Mở report.pdf trên Google Drive");
  assert.equal(fileActionLabel({ name: "voice.ogg", url: "", kind: "voice" }, false), "Tải và phát tin nhắn thoại");
});

test("visible theme variants have distinct names without removing saved IDs", () => {
  const visible = THEMES.filter((t) => !["dark", "default-dark"].includes(t.id));
  assert.equal(new Set(visible.map((t) => t.label)).size, visible.length);
  for (const id of ["bearded-solarized-dark", "bearded-solarized", "slate-neutral-dark-schematic", "slate-neutral-dark"]) {
    assert.ok(THEMES.some((t) => t.id === id));
  }
});
