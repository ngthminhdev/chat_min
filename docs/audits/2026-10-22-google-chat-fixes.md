# Google Chat send, DM threads and message actions

## Findings and fixes

- Ordinary sends always used `messageReplyOption=REPLY_MESSAGE_FALLBACK_TO_NEW_THREAD`, including sends without a thread ID. Ordinary sends now omit that option; explicit thread replies include `thread.name` and use `REPLY_MESSAGE_OR_FAIL` so they cannot silently post to the main conversation.
- DM threads were disabled by the `kind == "space"` check. Threading now follows Google's `spaceThreadingState`; human DMs are enabled unless explicitly unthreaded. Bot DMs are not enabled by default.
- Quote decoding only copied the original message ID, leaving sender/text blank. Decode snapshot fields, resolve originals from the current page/cache, and fetch a bounded number of missing originals. Keep quote metadata on the response to a send. The renderer also resolves an original already loaded in the frontend.
- Message context menus were only attached to the ellipsis button. Right click and Shift+F10 now open message actions, including reply/reaction/thread/copy and the existing permitted edit/delete actions.
- Toolbar was positioned relative to the entire row, putting actions on the opposite side of short bubbles. It now lives inside the content-width message column, aligned to the bubble edge.
- Threads still open in dedicated tabs. Links say “Mở thread” and the tab view says “Thread trong tab riêng”. Thread keys include account/chat identity. Opening a reply resolves its root, and thread fetch failures now show an error/retry control.

## Verification

- Four new Rust regression tests failed before fixes and passed afterward: ordinary send URL, explicit thread destination, DM thread detection, quote snapshot sender/text.
- `cargo test --manifest-path src-tauri/Cargo.toml --lib`: 11 passed after fixes, including existing storage, Telegram and AI tests.
- `npm run build`: passed. Existing mixed static/dynamic import warning for `bridge.ts` remains.
- Browser demo: DM displays Threads and a reply count; quote renders the original author/text even when message fields are empty and the original is cached.
- Right click opens the menu; reaction opens the emoji picker and applies a reaction; reply focuses the composer with the correct original.
- Sent a demo quote and checked the author/text survive server-response replacement.
- Opened a DM thread in a new tab, sent a demo reply and inspected the bridge arguments: correct account, DM chat ID and `spaces/AAAAm1nhTr4/threads/policy` thread ID.
- Measured toolbar/bubble edges: incoming toolbar starts at the incoming bubble's left edge; outgoing toolbar ends at the outgoing bubble's right edge.

No test message was sent to a real Google account. The Rust tests verify request construction and parsing; actual Google authorization, account permissions and live API delivery remain to be checked with the user's intended recipient/message.

## Sources

- [Google Chat message creation and reply options](https://developers.google.com/workspace/chat/api/reference/rest/v1/spaces.messages/create)
- [Quoted message metadata](https://developers.google.com/workspace/chat/api/reference/rest/v1/spaces.messages#QuotedMessageMetadata)
- [Space threading state](https://developers.google.com/workspace/chat/api/reference/rest/v1/spaces#SpaceThreadingState)
- [Google announcement: inline threading in direct messages](https://workspaceupdates.googleblog.com/2025/11/inline-threading-direct-messages-google-chat.html)

Screenshot: `google-chat-dm-thread-fixed.png`.
