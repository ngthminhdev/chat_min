import { useLayoutEffect, useRef, type RefObject } from "react";

// Only properties that affect line wrapping or the textarea's measured height.
const MEASURE_STYLES = [
  "box-sizing", "width", "font-family", "font-size", "font-weight", "font-style",
  "font-stretch", "font-variant", "line-height", "letter-spacing", "word-spacing",
  "text-indent", "text-transform", "tab-size", "white-space", "word-break", "overflow-wrap",
  "padding-top", "padding-right", "padding-bottom", "padding-left",
  "border-top-width", "border-bottom-width", "border-left-width", "border-right-width", "border-style",
];

/** Measure offscreen: collapsing the focused input makes WebKit clamp the chat's scrollTop. */
export function useTextareaSize(ref: RefObject<HTMLTextAreaElement>, value: string, visible = true) {
  const measure = useRef<() => void>();

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !visible) return;
    const mirror = document.createElement("textarea");
    mirror.tabIndex = -1;
    mirror.setAttribute("aria-hidden", "true");
    mirror.readOnly = true;
    document.body.appendChild(mirror);
    const resize = () => {
      const css = getComputedStyle(el);
      if (!el.clientWidth) return;
      for (const prop of MEASURE_STYLES) mirror.style.setProperty(prop, css.getPropertyValue(prop));
      Object.assign(mirror.style, {
        position: "fixed", left: "-10000px", top: "0", visibility: "hidden",
        pointerEvents: "none", height: "0", minHeight: "0", maxHeight: "none", overflow: "hidden",
      });
      mirror.wrap = el.wrap;
      mirror.value = el.value || " ";
      const padding = parseFloat(css.paddingTop) + parseFloat(css.paddingBottom);
      const border = parseFloat(css.borderTopWidth) + parseFloat(css.borderBottomWidth);
      const natural = mirror.scrollHeight + (css.boxSizing === "border-box" ? border : -padding);
      const max = parseFloat(css.maxHeight) || Infinity;
      const min = parseFloat(css.minHeight) || 0;
      const height = `${Math.max(min, Math.min(natural, max))}px`;
      if (el.style.height !== height) el.style.height = height;
    };
    measure.current = resize;
    resize();
    let width = el.clientWidth;
    let frame = 0;
    const ro = new ResizeObserver(() => {
      // Our own height writes must not schedule another measurement.
      if (el.clientWidth === width) return;
      width = el.clientWidth;
      // Defer height writes out of ResizeObserver delivery to avoid a resize loop.
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(resize);
    });
    ro.observe(el);
    document.fonts.addEventListener("loadingdone", resize);
    return () => {
      measure.current = undefined;
      ro.disconnect();
      cancelAnimationFrame(frame);
      document.fonts.removeEventListener("loadingdone", resize);
      mirror.remove();
    };
  }, [ref, visible]);

  useLayoutEffect(() => { measure.current?.(); }, [value]);
}
