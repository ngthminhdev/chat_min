# Window background transparency

The desktop background is shared by the chat area, left dock, right dock and window chrome. Individual content surfaces retain opaque theme colors. No ancestor opacity is applied to text, images, or controls.

Settings → Giao diện → Nền cửa sổ provides solid, native frosted glass and clear desktop modes. Background transparency ranges from 0–100%, persists locally, and defaults to glass at 35%. Native macOS glass uses UnderWindowBackground with an active material; clear and solid modes remove the native effect. Invalid stored preferences are normalized. A reduced-transparency media preference selects solid mode without overwriting the user's saved choice.

Both docks have transparent shells. Account/favorites groups share one reading surface with no separate backgrounds on names or previews. Message sender, body and timestamp share one bubble surface; reactions, thread reply links and action controls stay outside that surface. The selected Inspector content has one unified surface, and the composer has one outline. Floating menus remain opaque. On compact windows, the right dock reserves space instead of overlapping message content; on phone widths it replaces the workspace while open.

Validation performed:

- Node tests cover old/invalid preferences, transparency bounds including 100%, and the reduced-transparency override.
- Browser checks cover all three modes, persistence after reload, light/dark themes, and 100% transparency.
- Computed styles confirm both dock backgrounds are fully transparent, the shared window tint reaches alpha 0, and message/composer surfaces remain opaque with content opacity 1.
- At 863px, the workspace right edge equals the Inspector left edge after the compact-layout fix.
- A release macOS app was launched and its appearance controls switched between native glass and clear desktop mode. Window-only screenshots flatten transparent regions against white; they do not establish a visual comparison against the desktop behind the app.

The browser demo cannot display the desktop behind a native window. Native OS accessibility material behavior still depends on macOS settings. Existing Vite warnings concern mixed imports of bridge.ts and bundle size.
