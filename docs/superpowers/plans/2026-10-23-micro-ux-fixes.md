# ChatMin micro UX fixes

Approved scope: audit items 2–12 in `docs/audits/2026-10-23-micro-ux.md`. Messenger/Zalo behavior and onboarding guidance are excluded by the user. Keep existing design tokens and all unrelated work. No commit/push.

User expanded scope during implementation: audit and fix colors, contrast and icon buttons. Add app-local semantic ink and control styles, measure text at 4.5:1 and control boundaries/focus at 3:1 on the palette surfaces, and inspect real dark/light UI states. Do not edit symlinked shared design-system files.

## Implementation

1. Add regression tests for media classification without thumbnails, emoji search/navigation at grid edges, and distinct visible theme names. Run `npm test` and confirm the new cases fail before implementing helpers.
2. Add `src/lib/micro-ux.ts` for media section classification, file action labels and a named/searchable emoji catalog with grid navigation. Use it in Inspector, Message and Overlays. Keep the quick reactions and add an expanded search view.
3. Preserve `syncing` in Settings; standardize ordinary UI copy in Vietnamese across Settings, navigation, dialogs, account controls, topics/threads and files. Keep English technical API fields, provider names and message content intact. Remove the always-visible chat ID from Statusbar; keep it in Inspector with copy action.
4. Classify image/video independently of thumbnails. Label loaded-history counts explicitly. Make recent file rows open the selected file. Unify accessible and visible file action labels; keep save-to-Downloads separate. Include current writing language in the composer button name.
5. Make platform buttons expose selected state. Distinguish theme variant names while preserving IDs. Add focused app-local CSS for picker/search and media thumbnails.
6. Run `npm test`, `npm run build`, `git diff --check`; browser-check keyboard picker navigation/search/focus return, Settings copy, media grouping, file controls, wizard selection, and a narrow viewport. Store QA screenshots outside the repository. Update the audit with delivered scope and verification limits.

## Validation constraints

Browser uses the in-memory demo backend. Do not send to real accounts or call paid AI. Native file opening, OS picker and real provider reactions remain explicitly unverified unless exercised separately. Do not infer native success from browser demo behavior.
