# ChatMin interaction polish

User requests another UI/UX and button animation pass, using the AI suggestion screenshot as the concrete example. Keep the existing visual identity and prior changes; Messenger/Zalo remain excluded. Do not commit/push.

## Confirmed defects before edits

- Suggestion cards use a wrapping flex row with a separate trailing action span. Long bilingual suggestions produce a 2+1 layout with controls far from the third option.
- Browser reproduction with deferred local `api.aiRun`: close the panel while loading, resolve the request, and it opens again. Closing also loses focus.
- Selected composer actions use a heavy bottom inset that resembles a pressed/focused state. Press feedback is inconsistent. The spinner override appears after the reduced-motion rule.

## Work

1. Extract the suggestion presentation into a compact section with a stable header/action pair, equal grid columns on wide composer containers and one column with bounded scrolling on smaller containers. Keep full bilingual content available.
2. Guard suggestion and draft-translation lifecycles against late results. Retain current suggestions during refresh. Close/selection invalidates pending results; selecting an option fills the composer, preserves an existing draft for undo, and restores focus.
3. Give AI/sticker/header buttons truthful expanded/pressed/busy states. Add local Escape handling and a visible sticker close control. Keep existing shortcuts, including the user's current translation shortcut.
4. Add consistent short color and press feedback without moving hit targets. Keep selected and keyboard focus distinct; honor reduced motion, including CSS spinners.
5. Browser QA with local fixtures: long bilingual suggestions, loading/refresh/error/empty, close-before-response, choose-while-refreshing, draft edits during translation, keyboard/focus, enabled/disabled/pressed states, narrow viewport and reduced motion. No real AI call or sending messages. Reload removes fixture overrides.
6. Run existing unit tests, build and diff checks, then save screenshots outside the repo and document results/limits.
