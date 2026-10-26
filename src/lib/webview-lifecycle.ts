type Bounds = { x: number; y: number; w: number; h: number };
type Bridge = {
  webShow: (account: string, chat: string, bounds: Bounds, navigate: boolean) => Promise<unknown>;
  webHide: (account: string) => Promise<unknown>;
};

/** Native placement outlives React effects. Keep hide after the last in-flight show,
 * and never let a stale resize re-open a provider over the selected conversation. */
export function createWebviewLifecycle(bridge: Bridge, onError: (error: unknown) => void) {
  let pending = Promise.resolve();
  const queue = (action: () => Promise<unknown> | undefined) => {
    pending = pending.then(action).then(() => {}, onError);
  };
  return (account: string, chat: string) => {
    let disposed = false;
    let last = "";
    return {
      place(bounds: Bounds) {
        if (disposed) return;
        const value = JSON.stringify(bounds);
        if (last === value) return;
        const navigate = !last;
        last = value;
        queue(() => disposed ? undefined : bridge.webShow(account, chat, bounds, navigate));
      },
      dispose() {
        if (disposed) return;
        disposed = true;
        queue(() => bridge.webHide(account));
      },
    };
  };
}
