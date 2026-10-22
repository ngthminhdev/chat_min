# Composer and button interaction follow-up

Scope: follow-up to the user's bilingual AI suggestion screenshot. Preserve the existing visual identity and previous edits. Messenger/Zalo excluded. Changes are uncommitted.

## Changes

- Suggestions now have a stable header, adjacent refresh/close actions, equal columns when the composer is wide, and one column with bounded internal scrolling when narrow. Full bilingual copy remains available.
- Loading has a skeleton/spinner and an announcement. Refresh keeps existing choices available and preserves button focus. Error/empty states retain retry and close controls.
- Closing or selecting invalidates pending suggestion results. Choosing fills the composer, returns focus and preserves an existing draft for undo. It does not send.
- Draft translation checks the current draft before applying a late result, avoiding overwrite of newly typed content.
- AI/sticker buttons expose expanded state; header controls expose their active state. Sticker has a visible close action, initial focus, Escape and focus return. Clicking its trigger again closes it.
- Selected icon buttons use a subtle keyline rather than the heavy underline. Shared short color transitions and icon press feedback preserve the hit target. Reduced motion disables CSS animation/transitions and icon press movement; new suggestion/sticker motion uses zero duration.
- Conversation header actions stay together on a narrow viewport, preventing one orphan icon row.
- Tooltips clear on keyboard, pointer leave, focus leave, scroll, resize and window blur. Keyboard dismissal also clears after focus restoration during a popover exit.

## Browser verification

Local Vite app at `http://localhost:1424`, browser demo mode. Deferred in-memory AI fixtures used; no real AI calls or messages sent. Reload removed overrides.

Before editing, reproduced both regressions: closing a pending suggestion panel allowed the late response to reopen it; translating draft A then typing draft B allowed the result to overwrite B.

After editing, checked:

- Close before response: panel remains closed and AI trigger receives focus.
- Refresh with three existing suggestions: choices stay available; retry stays focused and busy.
- Select during refresh: chosen reply fills the composer; original draft can be restored; late response does not reopen the panel.
- Edit during translation: new draft stays intact and an explanatory toast appears.
- Error -> retry -> empty state: recovery/close remain available; Escape returns focus.
- Sticker open/toggle/close/Escape and tooltip cleanup after exit.
- Desktop three equal option columns (282px each, 115px high at the inspected 1510px viewport); 900px and 390px stacked layout, no document horizontal overflow. Narrow body scrolls internally while header controls remain visible.
- Normal held pointer press scales only the icon to 0.92 and translates it 1px; the 30x30 button rectangle stays unchanged. Reduced motion returns scale/translate to none and transitions to 0s.
- Visually inspected final desktop and 390px screenshots saved outside the repository.

## Checks and limits

- `npm test`: 11/11 passed.
- `npm run build`: TypeScript and Vite passed. Existing static/dynamic import warning for `bridge.ts` remains.
- `git diff --check`: passed.
- Native Tauri/WebKit, real provider responses and live send operations were not exercised in this pass. Browser fixtures verify frontend interaction and request lifecycle behavior.

Artifacts:

- `/Users/qc-bright/.codex/visualizations/2026/10/22/01a164a9-6a53-7d42-a5cf-80b7b5547fa2/chatmin-suggestions-after.png`
- `/Users/qc-bright/.codex/visualizations/2026/10/22/01a164a9-6a53-7d42-a5cf-80b7b5547fa2/chatmin-suggestions-mobile-after.png`
