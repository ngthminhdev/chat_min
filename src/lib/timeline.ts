import type { Msg } from './types';

type Position = { keys: string[]; firstIndex: number };
/** Absolute indexes let the virtualizer prepend history without moving the current row. */
export function timelinePosition(previous: Position | undefined, keys: string[]): Position {
  if (!previous || !keys.length) return { keys, firstIndex: 1_000_000 };
  const oldFirst = keys.indexOf(previous.keys[0]);
  if (oldFirst >= 0) return { keys, firstIndex: previous.firstIndex - oldFirst };
  const removed = previous.keys.indexOf(keys[0]);
  return { keys, firstIndex: removed >= 0 ? previous.firstIndex + removed : 1_000_000 };
}
export function timelineTarget(rows: { m: Msg; album?: Msg[] }[], id: string): number {
  return rows.findIndex(({ m, album }) => [m, ...(album ?? [])].some(x => x.id === id || x.uiPreviousIds?.includes(id)));
}
/** Two animation frames allow the lightweight shell/skeleton to paint before list work. */
export function afterPaint(callback: () => void, scheduler = {
  request: (fn: FrameRequestCallback) => requestAnimationFrame(fn),
  cancel: (id: number) => cancelAnimationFrame(id),
}) {
  let pending = true;
  let frame = 0;
  const cancel = () => {
    pending = false;
    clearTimeout(fallback);
    scheduler.cancel(frame);
  };
  const reveal = () => {
    if (!pending) return;
    cancel();
    callback();
  };
  // WKWebView can suspend animation frames while the window is occluded.
  const fallback = setTimeout(reveal, 120);
  frame = scheduler.request(() => {
    if (pending) frame = scheduler.request(reveal);
  });
  return cancel;
}
