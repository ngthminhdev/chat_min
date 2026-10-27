import { useEffect, useRef, type RefObject } from "react";

/** Calls `run` once `ref` has stayed on screen for `delay` ms. Rows scrolled past quickly
 *  never ask; `key` re-arms it for another subject in the same element. */
export function useWhenVisible(ref: RefObject<Element | null>, run: () => void, key: string, enabled = true, delay = 250) {
  const latest = useRef(run);
  latest.current = run;
  useEffect(() => {
    const el = ref.current;
    if (!enabled || !el) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const observer = new IntersectionObserver(([entry]) => {
      clearTimeout(timer);
      if (entry?.isIntersecting) timer = setTimeout(() => latest.current(), delay);
    });
    observer.observe(el);
    return () => { clearTimeout(timer); observer.disconnect(); };
  }, [ref, key, enabled, delay]);
}
