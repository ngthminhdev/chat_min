import { useEffect } from "react";
import { api } from "./lib/bridge";
import { isMobile } from "./lib/mobile";
import { getMobileBackTarget } from "./lib/mobile-navigation";
import { chatKeyOf, openChat, splitKey, useApp } from "./store";

declare global {
  interface Window { __chatminBack?: () => boolean }
}

export function showMobileList() {
  const chat = chatKeyOf(useApp.getState().active);
  (document.activeElement as HTMLElement | null)?.blur();
  useApp.setState({ route: "shell", leftCollapsed: false, rightCollapsed: true });
  if (chat) void api.setOpen(...splitKey(chat), false).catch(() => {});
}

/** Let local panels (sticker picker, wizard) consume Back after global overlays. */
export function useMobileBack(handler: () => void, enabled = true) {
  useEffect(() => {
    if (!isMobile || !enabled) return;
    const back = (event: Event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      handler();
    };
    document.addEventListener("chatmin:back", back);
    return () => document.removeEventListener("chatmin:back", back);
  }, [handler, enabled]);
}

/** Called by the Android Activity. False means the root task may move to the background. */
export function mobileBack(): boolean {
  const s = useApp.getState();
  const target = getMobileBackTarget(s);
  if (["viewer", "dialog", "forward", "pop", "palette"].includes(target)) {
    useApp.setState({ [target]: null });
    return true;
  }
  const sheet = document.querySelector<HTMLDetailsElement>(".mobile-action-menu[open]");
  if (sheet) { sheet.open = false; return true; }
  const local = new Event("chatmin:back", { cancelable: true });
  if (!document.dispatchEvent(local)) return true;
  if (target === "details") useApp.setState({ rightCollapsed: true });
  else if (target === "page" || target === "wizard") {
    useApp.setState({ route: s.accounts.length ? "shell" : "welcome", rightCollapsed: true });
  } else if (target === "thread") void openChat(s.threadTabs[s.active!].chatKey);
  else if (target === "list") showMobileList();
  else return false;
  return true;
}

export function useAndroidNavigation() {
  useEffect(() => {
    if (!isMobile) return;
    window.__chatminBack = mobileBack;
    // Rust mutes the open chat only while the app is on screen; Android 13+ needs the
    // notification permission asked once
    const visibility = () => void api.setForeground(document.visibilityState === "visible").catch(() => {});
    document.addEventListener("visibilitychange", visibility);
    visibility();
    void api.notifyPermission(true).then((state) => useApp.setState({ notifyPermission: state })).catch(() => {});
    return () => { delete window.__chatminBack; document.removeEventListener("visibilitychange", visibility); };
  }, []);
}
