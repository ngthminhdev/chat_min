# Zalo location links

The reported “Kids story 유치원” message is a `chat.location.new` payload. Its `href` is empty; latitude and longitude are serialized inside `content.params`. The previous normalizer retained only `content.title`.

Location messages now retain their title and address and show a complete clickable Google Maps URL. Existing HTTP(S) location links are retained; otherwise valid coordinates generate a Maps search URL. Missing, malformed, nonnumeric, and out-of-range coordinates never produce an invented pin. Place IDs are URL encoded when present.

Cached messages recover the same text from their retained wire payload during bounded page hydration, without fetching history or modifying message IDs, read status, or reactions. Shared fixtures exercise the connector and Rust cache repair, including idempotence. Other message types keep their existing normalization.

Maps URL syntax follows [Google's Maps URLs documentation](https://developers.google.com/maps/documentation/urls/get-started).

Validation:

- Regression reproduced before the fix in both connector normalization and cached-page hydration, then passed.
- The original local wire payload produces a full Maps URL and preserves its address.
- Frontend: 128 tests passed; Zalo connector: 54 passed; Rust: 95 passed.
- Formatter regression confirms the complete URL appears as both link label and destination.

- Production TypeScript/Vite and macOS app release build passed. Existing Vite chunk-size/import warnings remain.
- Installed `/Applications/ChatMin.app`; `codesign --verify --deep --strict` passed and the installed binary matches the release artifact, SHA-256 `d2952a25a98c2131ba1a4b305cfa1d67e4753159628dc01820605aed8defe84b`.
- Draft digest unchanged across restart. Previous app backup: `/Users/qc-bright/Library/Caches/chatmin/backups/ChatMin-before-location-fix-1793158534.app`.
- App relaunched successfully. Native inspection of the specific row was interrupted by user interaction; no claim of a live Maps click test is made. The original payload, cache repair, and rendered link were verified separately.
- Independent code review found no actionable correctness or regression issue.

## Recommended link shares

A subsequent report revealed a distinct wire format: `chat.recommended`, `content.action: "recommened.link"`, empty `content.title`, a generic Maps description, a valid short URL in `content.href`, and the actual place name in `params.mediaTitle`. The location-specific repair did not cover this format.

Both incoming normalization and cached-page hydration now preserve the original full HTTP(S) URL, use `mediaTitle` when the title is blank, and retain the description. This applies to ordinary link shares as well as Maps. The action guard excludes recommended call events. Missing/invalid URLs keep their existing fallback text.

- Shared link fixtures reproduced the reported failure in both normalization and cached hydration before the fix, then passed.
- The exact reported local wire payload and all 21 cached recommended link shares retain their original full URLs after normalization.
- Formatter integration verifies an empty-title Maps recommendation renders its complete URL as a clickable link.
- Frontend: 129 passed; connector: 62 passed; Rust: 96 passed.
- Independent follow-up review found no actionable issue.
- Production build and strict code-signature verification passed. Installed binary SHA-256: `95fea100201c7069d05e0035a7474e5629cb43222d97fa67e94123061f9305e1`.
- Backup: `/Users/qc-bright/Library/Caches/chatmin/backups/ChatMin-before-recommended-link-fix-1793159331.app`. ChatMin relaunched after installation.
- Native UI automation repeatedly timed out while opening search, so the exact message row and a live Maps navigation were not visually confirmed. Validation of the reported message uses its actual locally retained wire payload plus formatter/cached-hydration regressions; no outgoing test messages were sent.
