/** Require a clear horizontal intent so ordinary reading and diagonal drags stay scrolls. */
export const isReplySwipe = (dx: number, dy: number) => dx <= -64 && Math.abs(dx) > Math.abs(dy) * 1.5;

export function viewerSwipe(dx: number, dy: number): "next" | "previous" | "close" | null {
  if (Math.abs(dx) >= 60 && Math.abs(dx) > Math.abs(dy) * 1.5) return dx < 0 ? "next" : "previous";
  if (dy >= 90 && dy > Math.abs(dx) * 1.5) return "close";
  return null;
}
