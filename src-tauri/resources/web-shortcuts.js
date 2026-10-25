// Runs in every provider frame. The shell owns navigation; the site owns text editing.
(() => {
  const commands = new Set(['k', 'f', 'n', ',', '[', ']', 'w', 'e', 'b', 'r']);
  document.addEventListener('keydown', (e) => {
    if (e.isComposing || e.altKey || (!e.metaKey && !e.ctrlKey)) return;
    const key = e.code === 'BracketLeft' ? '[' : e.code === 'BracketRight' ? ']' : e.key;
    // Provider history is rendered by the site, so its in-conversation Find stays local.
    // Shift+Cmd/Ctrl+F remains ChatMin's global search.
    if (key.toLowerCase() === 'f' && !e.shiftKey) return;
    const target = e.target;
    const inField = !!(target?.isContentEditable || target?.closest?.('input, textarea, select, [contenteditable]:not([contenteditable="false"])'));
    const navigation = commands.has(key.toLowerCase()) || /^[1-9]$/.test(key) || (key === 'Tab' && e.ctrlKey && !e.metaKey);
    const outsideField = !inField && ['ArrowUp', 'ArrowDown', 'Backspace'].includes(key);
    if (!navigation && !outsideField) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    // A fast paste after Cmd+K must not land in the conversation we are leaving.
    if (['k', 'n', ',', 'e', 'backspace'].includes(key.toLowerCase()) || (key.toLowerCase() === 'f' && e.shiftKey)) target?.blur?.();
    // Send only command metadata, never input content or the keyboard event itself.
    const shortcut = { key, metaKey: e.metaKey, ctrlKey: e.ctrlKey, shiftKey: e.shiftKey, altKey: e.altKey, inField };
    try { window.open('chatmin://shortcut/' + encodeURIComponent(JSON.stringify(shortcut))); } catch (_) {}
  }, true);
})();
