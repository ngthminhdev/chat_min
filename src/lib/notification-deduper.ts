/** Claim an incoming event once, including events suppressed while the chat is visible. */
export function createNotificationDeduper(limit = 4096) {
  const seen = new Set<string>();
  return (accountId: string, chatId: string, messageId: string) => {
    const id = JSON.stringify([accountId, chatId, messageId]);
    if (seen.has(id)) return false;
    seen.add(id);
    if (seen.size > limit) seen.delete(seen.values().next().value!);
    return true;
  };
}
