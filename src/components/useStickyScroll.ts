import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useApp } from "../store";

/**
 * Scroll behaviour for a message list:
 * - at the bottom it stays at the bottom (new messages, images finishing loading);
 * - scrolled up, the message being read stays put whatever is inserted or resized above
 *   it (older pages, fetched thread starters, late images) — anchored to an element,
 *   not to scrollHeight, so inserts in the middle don't jump either;
 * - `away` / `fresh` drive the "jump to bottom" button.
 * `lastId` is the newest message: when it changes while scrolled up, `fresh` counts it.
 */
export function useStickyScroll(box: React.RefObject<HTMLDivElement | null>, lastId: string | undefined, onTop?: () => void) {
  const stick = useRef(true);
  const anchor = useRef<{ id: string; top: number } | null>(null);
  const prevLast = useRef(lastId);
  const [away, setAway] = useState(false);
  const [fresh, setFresh] = useState(0);

  const capture = () => {
    const el = box.current;
    if (!el) return;
    const top = el.getBoundingClientRect().top;
    for (const node of el.querySelectorAll<HTMLElement>("[id^='m-']")) {
      const r = node.getBoundingClientRect();
      if (r.bottom > top) {
        anchor.current = { id: node.id, top: r.top - top };
        return;
      }
    }
  };

  const restore = () => {
    const el = box.current;
    if (!el) return;
    if (stick.current) {
      el.scrollTop = el.scrollHeight;
      return;
    }
    const a = anchor.current;
    const node = a && document.getElementById(a.id);
    if (!a || !node) return;
    const delta = node.getBoundingClientRect().top - el.getBoundingClientRect().top - a.top;
    if (Math.abs(delta) > 0.5) el.scrollTop += delta;
  };

  // every render that changed the list: re-anchor, and count arrivals at the bottom
  useLayoutEffect(() => {
    restore();
    if (lastId !== prevLast.current && prevLast.current && !stick.current) setFresh((n) => n + 1);
    prevLast.current = lastId;
  });

  // content resizing on its own (images, link cards, translations)
  useEffect(() => {
    const inner = box.current?.firstElementChild;
    if (!inner) return;
    const ro = new ResizeObserver(() => restore());
    ro.observe(inner);
    return () => ro.disconnect();
  }, [box.current]);

  const onScroll = () => {
    const el = box.current;
    if (!el) return;
    const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
    stick.current = dist < 80;
    setAway(dist > 400);
    if (stick.current) setFresh(0);
    capture();
    if (el.scrollTop < 200) onTop?.();
  };

  const toBottom = () => {
    const el = box.current;
    if (!el) return;
    stick.current = true;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    setFresh(0);
  };

  /** call when the user jumps elsewhere on purpose (search hit, quote) */
  const release = () => {
    stick.current = false;
  };

  // a notification was clicked: back to the newest message, even when scrolled up reading
  const toLatest = useApp((s) => s.toLatest);
  const seen = useRef(toLatest);
  useEffect(() => {
    if (seen.current === toLatest) return;
    seen.current = toLatest;
    toBottom();
  }, [toLatest]);

  return { onScroll, toBottom, release, away, fresh, stick };
}
