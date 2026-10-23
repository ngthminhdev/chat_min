import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { api } from "../lib/bridge";
import { useApp } from "../store";
import { preferredScrollBehavior } from "../lib/motion";

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
  const travelling = useRef<"bottom" | "message" | null>(null);
  const settle = useRef<ReturnType<typeof setTimeout>>();

  const capture = () => {
    const el = box.current;
    if (!el) return;
    // Native smooth scrolling owns the viewport until it settles or the user interrupts.
    if (travelling.current) return;
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
    if (travelling.current) return;
    if (pending.current && el.querySelector("[id^='m-']")) {
      // the jump a notification asked for, done once the list is on screen: instant, so
      // a render landing mid-animation (the chat refetching its newest page) can't leave
      // it stranded halfway, as a smooth scroll did
      pending.current = false;
      stick.current = true;
      el.scrollTop = el.scrollHeight;
      setFresh(0);
      return;
    }
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

  const endTravel = () => {
    if (!travelling.current) return;
    const bottom = travelling.current === "bottom";
    travelling.current = null;
    clearTimeout(settle.current);
    stick.current = bottom;
    if (bottom) restore();
    capture();
  };
  const startTravel = (to: "bottom" | "message") => {
    clearTimeout(settle.current);
    const behavior = preferredScrollBehavior();
    travelling.current = behavior === "smooth" ? to : null;
    stick.current = to === "bottom";
    // scrollend is not available in every supported WKWebView. Scroll events reset this.
    if (travelling.current) settle.current = setTimeout(endTravel, 1400);
    return behavior;
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

  // when the user last scrolled on purpose (wheel, touch, keys, scrollbar). Only such a
  // scroll may un-stick the list: the browser also fires scroll events for its own clamps
  // and for our programmatic moves, and those must never leave a freshly opened chat
  // parked above its newest message. Also feeds the diagnostics in the app log.
  const gesture = useRef(0);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const mark = () => {
      gesture.current = Date.now();
      if (travelling.current) {
        travelling.current = null;
        clearTimeout(settle.current);
        stick.current = false;
        el.scrollTo({ top: el.scrollTop, behavior: "auto" });
        capture();
      }
    };
    for (const ev of ["wheel", "touchmove", "keydown", "mousedown"]) el.addEventListener(ev, mark, { passive: true });
    el.addEventListener("scrollend", endTravel);
    const t = setTimeout(() => {
      const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
      void api.logJs(`[scroll] settled dist=${Math.round(dist)} h=${el.scrollHeight} view=${el.clientHeight} stick=${stick.current} rows=${el.querySelectorAll("[id^='m-']").length}`);
    }, 2500);
    return () => {
      clearTimeout(t); clearTimeout(settle.current);
      el.removeEventListener("scrollend", endTravel);
      for (const ev of ["wheel", "touchmove", "keydown", "mousedown"]) el.removeEventListener(ev, mark);
    };
  }, []);

  const onScroll = () => {
    const el = box.current;
    if (!el) return;
    const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (travelling.current) {
      setAway(dist > 400);
      clearTimeout(settle.current);
      settle.current = setTimeout(endTravel, 140);
      return;
    }
    const was = stick.current;
    const byUser = Date.now() - gesture.current < 600;
    stick.current = dist < 80 || (byUser ? false : stick.current);
    if (was && !stick.current) void api.logJs(`[scroll] unstick dist=${Math.round(dist)} gesture=${gesture.current ? Date.now() - gesture.current : -1}ms h=${el.scrollHeight}`);
    setAway(dist > 400);
    if (stick.current) setFresh(0);
    capture();
    if (el.scrollTop < 200) onTop?.();
  };

  const toBottom = () => {
    const el = box.current;
    if (!el) return;
    const behavior = startTravel("bottom");
    el.scrollTo({ top: el.scrollHeight, behavior });
    setFresh(0);
  };

  /** call when the user jumps elsewhere on purpose (search hit, quote) */
  const toMessage = (node: HTMLElement) => {
    const behavior = startTravel("message");
    node.scrollIntoView({ block: "center", behavior });
    if (behavior === "auto") capture();
  };

  // a notification was clicked: back to the newest message, even when scrolled up reading.
  // A list mounted by that click starts stuck to the bottom anyway (`stick`).
  const toLatest = useApp((s) => s.toLatest);
  const seen = useRef(toLatest);
  const pending = useRef(false);
  useLayoutEffect(() => {
    if (seen.current === toLatest) return;
    seen.current = toLatest;
    travelling.current = null;
    clearTimeout(settle.current);
    pending.current = true;
    restore();
  }, [toLatest]);

  return { onScroll, toBottom, toMessage, away, fresh, stick };
}
