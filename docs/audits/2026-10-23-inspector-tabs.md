# Inspector tab follow-up

User screenshot: an isolated second-row "Luồng trả lời" tab with a heavy rounded bottom edge.

Reproduced in browser demo at 410px inspector width: the first four tabs shared y=105, while the thread tab wrapped to y=137. Selected tabs combined the inherited rounded border/background with the previous pass's 2px inset shadow.

Changes:

- Removed the inset shadow from shared selected mini-tabs.
- Inspector tabs use a flat treatment and a narrow accent indicator, on one horizontally scrollable row.
- When content overflows, previous/next controls appear; selected tabs remain fully visible during selection and resize. Edge masks avoid abrupt clipped text.
- Added ArrowLeft/ArrowRight/Home/End navigation, a single tab stop, and tab/tabpanel labels and controls.
- Unsupported selected sections fall back to information. Inspector content transitions honor reduced motion.

Verification:

- Browser: End selects/reveals the last tab, Home selects the first, arrow keys switch both ways, next control selects and focuses the next tab; exactly one tab has tabindex=0.
- One row and fully visible selected tab at 280px; overflow controls disappear when the panel is widened to fit all labels. Checked 410px layout visually.
- Changing from space to direct chat produces a valid selected section.
- Checked reduced-motion switching, and saved the final browser screenshot outside the repository.
- `npm run build` and `git diff --check` passed. The existing bridge static/dynamic import warning remains.
- Installed native macOS application was not rebuilt or verified; checks used local Vite/browser demo. No messages or real AI calls sent.

Screenshot: `/Users/qc-bright/.codex/visualizations/2026/10/22/01a164a9-6a53-7d42-a5cf-80b7b5547fa2/chatmin-inspector-tabs-after.png`.
