# Android interaction design

Approved direction: the Android audit followed by the user's requests to fix it and make buttons easy to use on a phone. The user subsequently supplied an Android OAuth client JSON and explicitly requested configuration. This extends the implementation to native Android Google authorization; Google Cloud console settings remain documented for the user.

- Keep shared theme tokens and the desktop interface. Android gets a single-screen shell: chronological conversation list, conversation, full-screen details/thread, search and settings.
- Start on the conversation list. Keep account and unread filters reachable without drag gestures. Each screen has one app bar, 48px touch actions and readable titles. Put secondary conversation/composer actions in a labeled bottom sheet with a close button and backdrop.
- Android Back closes IME first, then overlays/sheets, details, subpages/thread, conversation, then backgrounds the root task. Preserve drafts. Opening a conversation must not focus the keyboard automatically. Enter on the software keyboard inserts a newline; Send is explicit.
- Keep Google Chat platform setup accurate: use Android AuthorizationClient, the supplied public client registration, and package/signing certificate identity. Native authorization returns access tokens; only account identity is persisted. Renew silently for the stored account, require explicit reconnect for missing grants, ignore canceled results. Keep desktop loopback OAuth independent. Provide an Android client guide with actual package and signing SHA-1.
- Verify navigation logic with unit tests, layout with demo fixtures at 360/390/420px and desktop, and the packaged APK on the connected Android device. Do not send messages on real accounts during QA.

Files are scoped to the mobile shell, shared action-sheet wrapper, conversation/composer, list/settings/wizard affordances, mobile styles, and a reproducible Android Activity template for native Back/IME handling.
