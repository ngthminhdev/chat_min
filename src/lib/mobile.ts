/** Native mobile builds, or the explicit mobile fixture in the browser demo. */
export const isMobile = typeof navigator !== "undefined" &&
  (/Android|iPhone|iPad/i.test(navigator.userAgent) ||
    (typeof location !== "undefined" && new URLSearchParams(location.search).has("mobile")));
