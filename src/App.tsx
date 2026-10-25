import { useEffect, useRef, useState } from "react";
import { MotionConfig } from "motion/react";
import { api, isTauri, onAppShortcut, openUrl, type AppShortcut } from "./lib/bridge";
import { windowAppearance } from "./lib/appearance";
import { Effect, EffectState, getCurrentWindow } from "@tauri-apps/api/window";
import { PLATFORMS } from "./lib/platforms";
import { themeBase } from "./lib/themes";
import { readIslandAppearance } from "./lib/island-appearance";
import {
  boot, chatKeyOf, closeTab, confirmDialog, isThreadTab, cycleTab, jumpUnread, markRead, promptDialog, toast, useApp, DEFAULT_NOTIFY,
  openChat, openSearch,
} from "./store";
import { Titlebar } from "./components/Titlebar";
import { HoverPeek, Sidebar } from "./components/Sidebar";
import { Tabs } from "./components/Tabs";
import { Conversation } from "./components/Conversation";
import { ThreadView } from "./components/ThreadView";
import { Inspector } from "./components/Inspector";
import { Statusbar } from "./components/Statusbar";
import { Overlays } from "./components/Overlays";
import { Viewer } from "./components/Viewer";
import { ResizeHandle } from "./components/ResizeHandle";
import { Welcome } from "./views/Welcome";
import { Wizard, startWizard } from "./views/Wizard";
import { Inbox } from "./views/Inbox";
import { MessageSearch } from "./views/MessageSearch";
import { Settings } from "./views/Settings";
import { Icon } from "./ui/Icon";
import { isMobile } from "./lib/mobile";
import { mobileConversationVisible } from "./lib/mobile-navigation";
import { useAndroidNavigation } from "./mobile";
import { MobileHeader } from "./components/MobileHeader";

export default function App() {
  const booted = useApp((s) => s.booted);
  const route = useApp((s) => s.route);
  const prefs = useApp((s) => s.prefs);
  const left = useApp((s) => s.leftCollapsed);
  const right = useApp((s) => s.rightCollapsed);
  const active = useApp((s) => s.active);
  const threadTab = useApp((s) => (isThreadTab(s.active) ? s.active : null));
  const [bootError, setBootError] = useState("");
  const windowEffectsUpdate = useRef(Promise.resolve());
  const retryBoot = () => {
    setBootError("");
    boot().catch((e) => setBootError(String(e)));
  };

  useEffect(() => {
    retryBoot();
  }, []);

  // the copy button of a ``` block: format.ts renders it as plain HTML inside any message body
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const btn = (e.target as HTMLElement).closest?.(".code-copy");
      const code = btn?.parentElement?.nextElementSibling?.textContent;
      if (!btn || code == null) return;
      e.stopPropagation();
      void navigator.clipboard.writeText(code).then(() => toast("Đã sao chép mã", "copy"));
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);

  useEffect(() => {
    if (isMobile) return;
    const compact = window.matchMedia("(max-width: 1180px)");
    const narrow = window.matchMedia("(max-width: 760px)");
    const adapt = () => {
      if (compact.matches) useApp.setState({ rightCollapsed: true });
      if (narrow.matches && useApp.getState().active) useApp.setState({ leftCollapsed: true });
    };
    adapt();
    compact.addEventListener("change", adapt);
    narrow.addEventListener("change", adapt);
    return () => {
      compact.removeEventListener("change", adapt);
      narrow.removeEventListener("change", adapt);
    };
  }, []);

  // appearance → design-system hooks on <html>/<body>
  useEffect(() => {
    const root = document.documentElement.style;
    root.setProperty("--ui-font-size", `${prefs.size}px`);
    root.setProperty("--font-body", prefs.uiFont || "var(--font-body-default)");
    root.setProperty("--font-mono", prefs.monoFont || "var(--font-mono-default)");
    if (prefs.theme) document.body.dataset.theme = prefs.theme;
    else delete document.body.dataset.theme;
    document.body.classList.toggle("light", !!prefs.theme && themeBase(prefs.theme) === "light");
    document.body.classList.toggle("chatmin-compact", prefs.compact);
    if (isTauri && !isMobile) {
      try {
        void api.notifyAppearance(readIslandAppearance()).catch((e) => api.logJs(`island appearance: ${e}`));
      } catch (e) {
        void api.logJs(`island appearance: ${e}`);
      }
    }
  }, [prefs]);

  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-transparency: reduce)");
    // Serialize native calls so rapid mode changes cannot leave an older effect applied.
    let disposed = false;
    const apply = () => {
      const { mode } = windowAppearance(prefs, reduced.matches);
      document.body.dataset.background = mode;
      // phones have no window effects: solid background, no toast
      if (document.documentElement.classList.contains("mobile")) { document.body.dataset.background = "solid"; return; }
      if (isTauri) windowEffectsUpdate.current = windowEffectsUpdate.current.then(async () => {
        if (disposed) return;
        const win = getCurrentWindow();
        if (mode === "glass") await win.setEffects({ effects: [Effect.UnderWindowBackground], state: EffectState.Active });
        else await win.clearEffects();
      }).catch((error) => {
        if (disposed) return;
        document.body.dataset.background = "solid";
        toast("Không bật được nền trong suốt. Đã dùng nền đặc.", "circle-alert");
        void api.logJs(`window appearance: ${String(error)}`).catch(() => {});
      });
    };
    apply();
    reduced.addEventListener("change", apply);
    return () => { disposed = true; reduced.removeEventListener("change", apply); };
  }, [prefs.backgroundMode]);

  useEffect(() => {
    const { transparency } = windowAppearance(prefs);
    document.documentElement.style.setProperty("--background-opacity", `${100 - transparency}%`);
  }, [prefs.backgroundTransparency]);

  const page = route === "welcome" || route === "wizard";
  const tabPage = route === "inbox" || route === "settings" || route === "search";
  useEffect(() => {
    if (!isMobile && tabPage && window.matchMedia("(max-width: 760px)").matches) useApp.setState({ leftCollapsed: true });
  }, [tabPage, route]);
  useEffect(() => {
    const cls = document.body.classList;
    cls.toggle("left-collapsed", left && !page);
    cls.toggle("right-collapsed", right);
    cls.toggle("inspector-unavailable", tabPage);
  }, [left, right, page, tabPage]);

  // Rust sends the notifications (and keeps the Dock badge): it needs every account's settings
  const notif = useApp((s) => s.notif);
  const accountIds = useApp((s) => s.accounts.map((a) => a.id).join("|"));
  useEffect(() => {
    void api.notifyPrefs(Object.fromEntries(useApp.getState().accounts.map((a) => [a.id, { ...DEFAULT_NOTIFY, ...notif[a.id] }])));
  }, [notif, accountIds]);

  useGlobalHandlers();
  useAndroidNavigation();

  if (!booted) return (
    <div className="app-frame">
      {isMobile ? <MobileHeader /> : <Titlebar />}
      <main className="r2-empty" role={bootError ? "alert" : "status"}>
        <Icon name={bootError ? "circle-alert" : "messages-square"} />
        <h1>{bootError ? "Chưa mở được ChatMin" : "Đang mở ChatMin…"}</h1>
        {bootError && <><p>{bootError}</p><button className="tool-btn primary" onClick={retryBoot}>Thử lại</button></>}
      </main>
    </div>
  );
  return (
    <MotionConfig reducedMotion="user" transition={{ duration: 0.18, ease: [0.2, 0, 0, 1] }}>
      <div className="app-frame">
        {isMobile ? <MobileHeader /> : <Titlebar />}
        <main className={`main${page ? " r2-page" : tabPage ? " r2-tab" : ""}`}>
          {page ? (
            <section className="page-view">{route === "welcome" ? <Welcome /> : <Wizard />}</section>
          ) : (
            <>
              {!isMobile && <><Sidebar /><ResizeHandle side="left" /></>}
              <section className="workspace">
                {!isMobile && <Tabs />}
                {isMobile && route === "shell" && (!left || !active) ? (
                  <section className="page-view mobile-list-page"><Inbox /></section>
                ) : route === "inbox" ? (
                  <section className="page-view"><Inbox /></section>
                ) : route === "settings" ? (
                  <section className="page-view"><Settings /></section>
                ) : route === "search" ? (
                  <section className="page-view"><MessageSearch /></section>
                ) : threadTab ? (
                  // keyed: each thread tab starts with its own scroll state (stuck to the bottom)
                  <ThreadView key={threadTab} tab={threadTab} />
                ) : (
                  <Conversation />
                )}
              </section>
              {!isMobile && <ResizeHandle side="right" />}
              {(!isMobile || (!right && !tabPage && left)) && <Inspector />}
            </>
          )}
        </main>
        <footer className="footer-shell">
          <button
            className={`tool-btn panel-toggle${left ? "" : " active"}`}
            type="button"
            aria-label="Ẩn/hiện danh sách hội thoại"
            aria-pressed={!left}
            data-tip="Danh sách hội thoại"
            data-kbd="⌘B"
            disabled={page}
            onClick={() => useApp.setState({ leftCollapsed: !left })}
          >
            <Icon name="panel-left" />
          </button>
          <Statusbar />
          <button
            className={`tool-btn panel-toggle${right ? "" : " active"}`}
            type="button"
            aria-label="Ẩn/hiện chi tiết hội thoại"
            aria-pressed={!right}
            data-tip="Chi tiết hội thoại"
            data-kbd="⌘R"
            disabled={page || tabPage}
            onClick={() => useApp.setState({ rightCollapsed: !right })}
          >
            <Icon name="panel-right" />
          </button>
        </footer>
      </div>
      <Overlays />
      <Viewer />
      {!isMobile && <HoverPeek />}
    </MotionConfig>
  );
}

function activeAccount() {
  const s = useApp.getState();
  const ck = chatKeyOf(s.active);
  const id = ck ? s.chats[ck]?.accountId : undefined;
  return s.accounts.find((a) => a.id === id) ?? s.accounts[0];
}

export function renameAccount(id = activeAccount()?.id) {
  const a = useApp.getState().accounts.find((x) => x.id === id);
  if (!a) return;
  promptDialog("Đổi tên tài khoản", a.name, (name) => {
    api.accountUpdate(a.id, { name }).then(() => toast(`Đã đổi tên thành “${name}”`)).catch((e) => toast(String(e), "circle-alert"));
  });
}

export function removeAccount(id = activeAccount()?.id) {
  const a = useApp.getState().accounts.find((x) => x.id === id);
  if (!a) return;
  confirmDialog(
    `Xoá tài khoản “${a.name}”?`,
    `ChatMin sẽ đăng xuất ${a.handle} và xoá cache tin nhắn trên máy này. Tài khoản ${PLATFORMS[a.platform].name} của bạn không bị ảnh hưởng.`,
    "Xoá tài khoản",
    () => {
      api.accountRemove(a.id).then(() => toast(`Đã xoá tài khoản ${a.name}`)).catch((e) => toast(String(e), "circle-alert"));
    },
  );
}

function useGlobalHandlers() {
  useEffect(() => {
    const st = useApp.setState;
    type AppKey = Omit<AppShortcut, "inField"> & { inField?: boolean; code?: string; target?: EventTarget | null; isComposing?: boolean; preventDefault: () => void };
    const onKey = (e: AppKey) => {
      if (e.isComposing || e.altKey) return;
      const s = useApp.getState();
      const mod = e.metaKey || e.ctrlKey;
      const k = e.code === "BracketLeft" ? "[" : e.code === "BracketRight" ? "]" : e.key;
      const target = e.target as HTMLElement | null | undefined;
      const inField = e.inField ?? !!(target?.isContentEditable || target?.closest?.('input, textarea, select, [contenteditable]:not([contenteditable="false"])'));
      if (k === "Escape") {
        if (s.viewer) return st({ viewer: null });
        if (s.dialog) return st({ dialog: null });
        if (s.themePicker) return st({ themePicker: false });
        if (s.forward) return st({ forward: null });
        if (s.pop) return st({ pop: null });
        if (s.palette) return st({ palette: null });
        if (s.active && (s.replyTo[s.active] || s.editing[s.active])) {
          e.preventDefault();
          const a = s.active;
          return st({
            replyTo: { ...s.replyTo, [a]: "" },
            editing: { ...s.editing, [a]: "" },
            drafts: s.editing[a] ? { ...s.drafts, [a]: "" } : s.drafts,
          });
        }
        if (s.route === "inbox" || s.route === "settings" || s.route === "search") return st({ route: "shell" });
        return;
      }
      if (!mod || s.dialog || s.themePicker) return;
      const lower = k.toLowerCase();
      // Modal controls own navigation; background shortcuts must not change chats/accounts.
      if ((s.palette || s.pop) && !["k", "f"].includes(lower)) return;
      // Welcome/wizard: only palette shortcuts make sense
      if ((s.route === "welcome" || s.route === "wizard") && !["k", "n", ","].includes(lower)) return;
      if (lower === "k" && !e.shiftKey) {
        e.preventDefault();
        return st({ palette: s.palette ? null : { mode: "chats" } });
      }
      if (lower === "f" && e.shiftKey) {
        e.preventDefault();
        return openSearch();
      }
      if (lower === "f" && chatKeyOf(s.active) && s.route === "shell") {
        e.preventDefault();
        return openSearch(chatKeyOf(s.active)!);
      }
      if (lower === "n") {
        e.preventDefault();
        return startWizard();
      }
      if (k === ",") {
        e.preventDefault();
        return st({ route: "settings" });
      }
      if (k === "Tab" && e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        return cycleTab(e.shiftKey ? -1 : 1);
      }
      if (k === "[" || k === "]") {
        e.preventDefault();
        return cycleTab(k === "]" ? 1 : -1);
      }
      if (k === "ArrowUp" || k === "ArrowDown") {
        if (inField) return;
        e.preventDefault();
        return jumpUnread(k === "ArrowDown" ? 1 : -1);
      }
      // ⌘1…8 → that open tab, ⌘9 → the last one (browser convention)
      if (/^[1-9]$/.test(k)) {
        const t = k === "9" ? s.tabs[s.tabs.length - 1] : s.tabs[Number(k) - 1];
        if (!t) return;
        e.preventDefault();
        void openChat(t);
        return;
      }
      if (lower === "e") {
        e.preventDefault();
        return renameAccount();
      }
      // ⌘⌫ always confirms; bare Backspace/Delete are never bound
      if (k === "Backspace" && !inField) {
        e.preventDefault();
        return removeAccount();
      }
      if (lower === "w") {
        e.preventDefault();
        if (s.route === "inbox" || s.route === "settings" || s.route === "search") return st({ route: "shell" });
        if (s.active) closeTab(s.active);
        return;
      }
      // ⌘B / ⌘R: left / right dock, like the other _min apps (⌘R would otherwise reload the webview)
      if (lower === "r") {
        e.preventDefault();
        return st({ rightCollapsed: !s.rightCollapsed });
      }
      if (lower === "b") {
        e.preventDefault();
        return st({ leftCollapsed: !s.leftCollapsed });
      }
    };
    // links inside messages must open in the browser, never navigate the webview
    const onClick = (e: MouseEvent) => {
      const a = (e.target as HTMLElement).closest?.("a[href]") as HTMLAnchorElement | null;
      if (a && /^https?:/.test(a.href)) {
        e.preventDefault();
        void openUrl(a.href);
      }
    };
    // coming back to the window reads whatever arrived in the open chat meanwhile
    const onFocus = () => {
      const s = useApp.getState();
      const c = s.active ? s.chats[s.active] : undefined;
      if (isMobile && !mobileConversationVisible(s)) return;
      if (s.active && !isThreadTab(s.active) && s.route === "shell" && s.atBottom && (c?.unread || c?.mention)) markRead(s.active);
    };
    // typing indicators expire on their own
    const tick = setInterval(() => {
      const t = useApp.getState().typing;
      const now = Date.now();
      if (Object.values(t).some((x) => x.until && x.until < now)) {
        st({ typing: Object.fromEntries(Object.entries(t).map(([k, v]) => [k, v.until < now ? { who: "", until: 0 } : v])) });
      }
    }, 1000);
    const offShortcut = onAppShortcut((shortcut) => onKey({ ...shortcut, preventDefault() {} }));
    document.addEventListener("keydown", onKey);
    document.addEventListener("click", onClick);
    window.addEventListener("focus", onFocus);
    return () => {
      offShortcut();
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("click", onClick);
      window.removeEventListener("focus", onFocus);
      clearInterval(tick);
    };
  }, []);
}
