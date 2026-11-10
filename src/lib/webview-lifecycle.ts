type Bounds = { x: number; y: number; w: number; h: number };
type Bridge = {
  webShow: (account: string, chat: string, bounds: Bounds, navigate: boolean) => Promise<unknown>;
  webHide: (account: string) => Promise<unknown>;
};

/** Native placement outlives React effects. Keep hide after the last in-flight show,
 * and never let a stale resize re-open a provider over the selected conversation. */
export function createWebviewLifecycle(bridge: Bridge, onError: (error: unknown) => void) {
  let pending = Promise.resolve();
  let desired: { account: string } | undefined;
  const queue = (action: () => Promise<unknown> | undefined) => {
    pending = pending.then(action).then(() => {}, onError);
  };
  return (account: string, chat: string) => {
    const owner = { account };
    let disposed = false;
    let shown = false;
    let last: Bounds | undefined;
    return {
      place(bounds: Bounds) {
        if (disposed) return;
        if (last && last.x === bounds.x && last.y === bounds.y && last.w === bounds.w && last.h === bounds.h) return;
        last = bounds;
        desired = owner;
        queue(async () => {
          if (disposed || last !== bounds) return;
          try {
            await bridge.webShow(account, chat, bounds, !shown);
            shown = true;
          } catch (error) {
            if (disposed) return;
            shown = false;
            await bridge.webHide(account).catch(() => {});
            throw error;
          }
        });
      },
      dispose() {
        if (disposed) return;
        disposed = true;
        if (desired === owner) desired = undefined;
        // React disposes and places the next thread in the same effect flush.
        // Leave the shared native surface in place when that thread owns it next.
        queue(() => desired?.account === account ? undefined : bridge.webHide(account));
      },
    };
  };
}
