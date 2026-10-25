# Notch glass, avatars, and brand colors

User supplied two visual references and requested this style with real avatars and original platform colors. Existing authorization is to implement autonomously and update installed ChatMin.

Use the existing native AppKit panel. Keep its physical-notch/screen-edge anchor, fullscreen behavior, grouping, target snapshots and exclusive delivery. Refine the compact shell into a black notch-connected contour with a fine accent glow. Expanded body has native blur, theme tint, separators and a small outlined footer pill. Accent follows the ChatMin theme; platform brand artwork never inherits tint.

Wire sender_photo into native notification metadata. Prefer sender image; private chats can fall back to chat photo/photo_ref. Resolve local paths, TDLib IDs and HTTPS images away from the main thread. Display immediately with initials while loading, update only the matching visible avatar afterwards, and reject stale completions after a newer group message, dismissal, or mode change. Reuse the existing Telegram downloader; cache remote thumbnails under the existing prunable Google Chat cache. Bound downloaded bytes and time; coalesce same-image downloads. Never fetch from native drawing code.

Use the existing brand SVG artwork rasterized for AppKit and the real ChatMin icon for local test/account alerts. Initials remain the fallback when no image exists or decoding fails. UI and notification settings retain their current behavior.

External-display follow-up: choose the screen under the pointer for each new delivery, with first-screen fallback. Pin the display by its native screen ID during subsequent hover/expand/theme/avatar updates. If removed, choose the remaining display under the pointer. With no notch, render a compact black pill directly at the top center without a hardware neck; preserve the screen-edge anchor for all modes. Skip frame interpolation when moving to a different display. Test negative origins and clamshell/no built-in display.
