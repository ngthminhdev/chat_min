/** The design system's --ease-ui curve, for motion's JS animations. */
export const EASE: [number, number, number, number] = [0.2, 0, 0, 1];

/** Explicit JS scrolling must respect the same preference as CSS and MotionConfig. */
export function preferredScrollBehavior(): ScrollBehavior {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
}
