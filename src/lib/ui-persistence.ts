/** Reference checks keep incoming sync/typing events out of synchronous UI storage. */
const FIELDS = [
  'tabs', 'active', 'drafts', 'collapsed', 'leftCollapsed', 'rightCollapsed', 'prefs', 'notif',
  'threadTabs', 'lastTopic', 'folders', 'favorites', 'accountOrder', 'trAuto', 'aiLang',
  'plainSend', 'hidden', 'chatOrder', 'inboxSeen', 'inboxRead',
] as const;
export function persistedUiChanged(current: object, previous: object): boolean {
  const a = current as Record<string, unknown>, b = previous as Record<string, unknown>;
  return FIELDS.some((field) => a[field] !== b[field]);
}
