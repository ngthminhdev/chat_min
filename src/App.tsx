import { useEffect, useState } from "react";
import { MotionConfig } from "motion/react";
import { api, openUrl } from "./lib/bridge";
import { PLATFORMS } from "./lib/platforms";
import { themeBase } from "./lib/themes";
import {
  boot, chatKeyOf, closeTab, confirmDialog, isThreadTab, cycleTab, jumpUnread, markRead, promptDialog, toast, totalUnread, useApp,
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

export default function App() {
  const booted = useApp((s) => s.booted);
  const route = useApp((s) => s.route);
  const prefs = useApp((s) => s.prefs);
  const left = useApp((s) => s.leftCollapsed);
  const right = useApp((s) => s.rightCollapsed);
  const unread = useApp((s) => totalUnread(s.chats));
  const threadTab = useApp((s) => (isThreadTab(s.active) ? s.active : null));
  const [bootError, setBootError] = useState("");
  const retryBoot = () => {
    setBootError("");
    boot().catch((e) => setBootError(String(e)));
  };

  useEffect(() => {
    retryBoot();
  }, []);

  useEffect(() => {
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
  }, [prefs]);

  const page = route === "welcome" || route === "wizard";
  const tabPage = route === "inbox" || route === "settings" || route === "search";
  useEffect(() => {
    if (tabPage && window.matchMedia("(max-width: 760px)").matches) useApp.setState({ leftCollapsed: true });
  }, [tabPage, route]);
  useEffect(() => {
    const cls = document.body.classList;
    cls.toggle("left-collapsed", left && !page);
    cls.toggle("right-collapsed", right);
    cls.toggle("inspector-unavailable", tabPage);
  }, [left, right, page, tabPage]);

  useEffect(() => {
    void api.setBadge(unread);
  }, [unread]);

  useGlobalHandlers();

  if (!booted) return (
    <div className="app-frame">
      <Titlebar />
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
        <Titlebar />
        <main className={`main${page ? " r2-page" : tabPage ? " r2-tab" : ""}`}>
          {page ? (
            <section className="page-view">{route === "welcome" ? <Welcome /> : <Wizard />}</section>
          ) : (
            <>
              <Sidebar />
              <ResizeHandle side="left" />
              <section className="workspace">
                <Tabs />
                {route === "inbox" ? (
                  <section className="page-view"><Inbox /></section>
                ) : route === "settings" ? (
                  <section className="page-view"><Settings /></section>
                ) : route === "search" ? (
                  <section className="page-view"><MessageSearch /></section>
                ) : threadTab ? (
                  <ThreadView tab={threadTab} />
                ) : (
                  <Conversation />
                )}
              </section>
              <ResizeHandle side="right" />
              <Inspector />
            </>
          )}
        </main>
        <footer className="footer-shell">
          <button
            className={`tool-btn panel-toggle${left ? "" : " active"}`}
            type="button"
            aria-label="Ẩn/hiện sidebar"
            aria-pressed={!left}
            data-tip="Sidebar"
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
            aria-label="Ẩn/hiện inspector"
            aria-pressed={!right}
            data-tip="Inspector"
            data-kbd="⌘I"
            disabled={page || tabPage}
            onClick={() => useApp.setState({ rightCollapsed: !right })}
          >
            <Icon name="panel-right" />
          </button>
        </footer>
      </div>
      <Overlays />
      <Viewer />
      <HoverPeek />
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
  promptDialog("Đổi tên account", a.name, (name) => {
    api.accountUpdate(a.id, { name }).then(() => toast(`Đã đổi tên thành “${name}”`)).catch((e) => toast(String(e), "circle-alert"));
  });
}

export function removeAccount(id = activeAccount()?.id) {
  const a = useApp.getState().accounts.find((x) => x.id === id);
  if (!a) return;
  confirmDialog(
    `Xoá account “${a.name}”?`,
    `ChatMin sẽ đăng xuất ${a.handle} và xoá cache tin nhắn trên máy này. Tài khoản ${PLATFORMS[a.platform].name} của bạn không bị ảnh hưởng.`,
    "Xoá account",
    () => {
      api.accountRemove(a.id).then(() => toast(`Đã xoá account ${a.name}`)).catch((e) => toast(String(e), "circle-alert"));
    },
  );
}

function useGlobalHandlers() {
  useEffect(() => {
    const st = useApp.setState;
    const onKey = (e: KeyboardEvent) => {
      const s = useApp.getState();
      const mod = e.metaKey || e.ctrlKey;
      const k = e.key;
      const inField = (e.target as HTMLElement).matches?.("input, textarea, select");
      if (k === "Escape") {
        if (s.viewer) return st({ viewer: null });
        if (s.dialog) return st({ dialog: null });
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
      if (!mod || s.dialog) return;
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
      if (lower === "i") {
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
      if (s.active && !isThreadTab(s.active) && s.route === "shell" && s.chats[s.active]?.unread) markRead(s.active);
    };
    // typing indicators expire on their own
    const tick = setInterval(() => {
      const t = useApp.getState().typing;
      const now = Date.now();
      if (Object.values(t).some((x) => x.until && x.until < now)) {
        st({ typing: Object.fromEntries(Object.entries(t).map(([k, v]) => [k, v.until < now ? { who: "", until: 0 } : v])) });
      }
    }, 1000);
    document.addEventListener("keydown", onKey);
    document.addEventListener("click", onClick);
    window.addEventListener("focus", onFocus);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("click", onClick);
      window.removeEventListener("focus", onFocus);
      clearInterval(tick);
    };
  }, []);
}
