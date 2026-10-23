import { useLayoutEffect, useRef } from "react";
import type { Msg } from "../lib/types";
import { messageRenderKey } from "../lib/message-identity";

/** History and reopening render immediately. Only arrivals in this mounted list enter. */
export function useMessageArrivals(list: Msg[] | undefined, fresh: Record<string, true>) {
  const ready = useRef(list !== undefined);
  const seen = useRef(new Set(list?.map(messageRenderKey)));
  useLayoutEffect(() => {
    if (!list) return;
    ready.current = true;
    for (const m of list) seen.current.add(messageRenderKey(m));
  });
  return (m: Msg) => ready.current && !!fresh[m.id] && !seen.current.has(messageRenderKey(m));
}
