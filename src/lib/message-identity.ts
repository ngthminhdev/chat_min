import type { Msg } from "./types";

/** UI-only identity; provider IDs remain authoritative for every API operation. */
export const messageRenderKey = (m: Msg) => m.uiKey ?? m.id;

/** Recover the provider ID lineage before replaying echoes that beat the send response. */
export function correlateAcknowledgement(response: Msg, changes: { oldId: string; msg: Msg }[]): Msg {
  const ids = new Set([response.id, ...(response.uiPreviousIds ?? [])]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const change of changes) {
      if (!ids.has(change.oldId) && !ids.has(change.msg.id)) continue;
      for (const id of [change.oldId, change.msg.id]) if (!ids.has(id)) { ids.add(id); grew = true; }
    }
  }
  const related = changes.filter(change => ids.has(change.oldId) && ids.has(change.msg.id));
  const retired = new Set(related.map(change => change.oldId));
  const final = retired.has(response.id) ? related.find(change => !retired.has(change.msg.id))?.msg ?? response : response;
  return { ...final, uiPreviousIds: [...ids].filter(id => id !== final.id) };
}

// Provider snapshots are JSON values. Keep React's row identity when a refresh
// only deserializes the same data, including nested media/reactions/link cards.
function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const left = a as Record<string, unknown>, right = b as Record<string, unknown>;
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length && keys.every(k => Object.prototype.hasOwnProperty.call(right, k) && sameValue(left[k], right[k]));
}

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
    // `oldId` is retired even when it never reached the list: the send promise can resolve
    // with the provider's temporary id after the id-change event already replaced it
    uiPreviousIds: [...new Set([...(previous?.uiPreviousIds ?? []), ...(m.uiPreviousIds ?? []),
      ...(previous && previous.id !== m.id ? [previous.id] : []), ...(oldId && oldId !== m.id ? [oldId] : [])])],
    status: current?.status === "seen" && m.status === "sent" ? "seen" : m.status,
  };
  const i = list.findIndex(x => x.id === m.id);
  if (!old && i >= 0) {
    if (sameValue(current, merged)) return list;
    const next = list.slice();
    next[i] = merged;
    return next;
  }
  const next = list.filter(x => x !== old && x !== current);
  if (next.length && next[next.length - 1].sort > merged.sort) return [...next, merged].sort((a, b) => a.sort - b.sort);
  return [...next, merged];
}
