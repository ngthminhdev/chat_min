import type { Msg } from "./types";

/** UI-only identity; provider IDs remain authoritative for every API operation. */
export const messageRenderKey = (m: Msg) => m.uiKey ?? m.id;

export function reconcileMessage(list: Msg[], m: Msg, oldId?: string): Msg[] {
  const old = oldId ? list.find(x => x.id === oldId || x.uiKey === oldId || x.uiPreviousIds?.includes(oldId)) : undefined;
  const current = list.find(x => x.id === m.id || x.uiPreviousIds?.includes(m.id));
  if (current && current.id !== m.id) {
    if (!old || old === current) return list;
    // The native temporary ID was already retired while our send promise was pending.
    // Transfer the local identity to that final message, never revive the retired ID.
    return list.filter(x => x !== old).map(x => x === current ? {
      ...current, uiKey: messageRenderKey(old),
      uiPreviousIds: [...new Set([...(current.uiPreviousIds ?? []), ...(old.uiPreviousIds ?? []), old.id])],
    } : x);
  }
  const previous = old ?? current;
  // An ID-change event can beat the send promise (or a late history response).
  if (previous?.uiPreviousIds?.includes(m.id)) return list;
  const merged: Msg = {
    ...m,
    uiKey: previous ? messageRenderKey(previous) : messageRenderKey(m),
    uiPreviousIds: [...new Set([...(previous?.uiPreviousIds ?? []), ...(m.uiPreviousIds ?? []),
      ...(previous && previous.id !== m.id ? [previous.id] : [])])],
    status: current?.status === "seen" && m.status === "sent" ? "seen" : m.status,
  };
  const i = list.findIndex(x => x.id === m.id);
  if (!old && i >= 0) {
    const next = list.slice();
    next[i] = merged;
    return next;
  }
  const next = list.filter(x => x !== old && x !== current);
  if (next.length && next[next.length - 1].sort > merged.sort) return [...next, merged].sort((a, b) => a.sort - b.sort);
  return [...next, merged];
}
