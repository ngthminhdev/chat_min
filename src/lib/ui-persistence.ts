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

/** Shared whitelist for browser cache, native backup and hydration. */
export function uiSnapshot<T extends object>(state: T): Partial<T> {
  return Object.fromEntries(FIELDS.filter(field => Object.prototype.hasOwnProperty.call(state, field))
    .map(field => [field, (state as Record<string, unknown>)[field]])) as Partial<T>;
}
export function restoreUi<T extends object>(local: T, durable: object | null): T {
  const snapshot = durable && !Array.isArray(durable) ? uiSnapshot(durable) : {};
  const localNewer = ((local as { _savedAt?: number })._savedAt ?? 0) > ((durable as { _savedAt?: number } | null)?._savedAt ?? 0);
  const first = localNewer ? snapshot : local, last = localNewer ? local : snapshot;
  const restored = { ...uiSnapshot(first), ...uiSnapshot(last) } as T;
  if ('prefs' in snapshot) (restored as Record<string, unknown>).prefs = { ...(first as Record<string, object>).prefs, ...(last as Record<string, object>).prefs };
  return restored;
}
/** At most one IPC write in flight; pending edits collapse to the newest snapshot. */
export function createUiWriter<T>(write: (value: T) => Promise<void>) {
  let queued: { value: T } | undefined, running: Promise<void> | undefined;
  return (value: T): Promise<void> => {
    queued = { value };
    if (!running) running = Promise.resolve().then(async () => {
      try { while (queued) { const next = queued; queued = undefined; try { await write(next.value); } catch (error) { if (!queued) throw error; } } }
      finally { running = undefined; }
    });
    return running;
  };
}
