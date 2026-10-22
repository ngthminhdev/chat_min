import { useEffect, useRef } from "react";
import { THEMES } from "../lib/themes";
import { useApp, openSearch } from "../store";
import { startWizard } from "../views/Wizard";
import { Icon } from "../ui/Icon";

export function Titlebar() {
  const theme = useApp((s) => s.prefs.theme);
  const menu = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (menu.current?.open && !menu.current.contains(e.target as Node)) menu.current.open = false;
    };
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, []);

  return (
    <header className="titlebar" data-tauri-drag-region>
      <div className="traffic" data-tauri-drag-region>
        <span className="app-name">ChatMin</span>
      </div>
      <button className="search" type="button" aria-label="Tìm trong tin nhắn" onClick={() => openSearch()}>
        <Icon name="search" />
        <span>Tìm tin nhắn…</span>
        <kbd>⌘⇧F</kbd>
      </button>
      <div className="toolbar" data-tauri-drag-region>
        <button
          className="tool-btn icon-only lg"
          type="button"
          aria-label="Mở bảng lệnh"
          data-tip="Chuyển chat và chạy lệnh"
          data-kbd="⌘K"
          onClick={() => useApp.setState({ palette: { mode: "chats" } })}
        >
          <Icon name="layers" />
        </button>
        <details
          className="appearance-menu"
          ref={menu}
          onKeyDown={(e) => {
            if (e.key === "Escape" && menu.current?.open) {
              e.stopPropagation();
              menu.current.open = false;
            }
          }}
        >
          <summary className="tool-btn icon-only lg" aria-label="Giao diện" data-tip="Giao diện">
            <Icon name="palette" />
          </summary>
          <div className="appearance-panel">
            <label htmlFor="theme-select">Giao diện</label>
            <select
              className="theme-select"
              id="theme-select"
              value={theme}
              onChange={(e) => {
                const v = e.target.value;
                useApp.setState((s) => ({ prefs: { ...s.prefs, theme: v === "dark" ? "" : v } }));
                if (menu.current) menu.current.open = false;
              }}
            >
              <option value="">Bearded Arc · dark</option>
              {THEMES.filter((t) => t.id !== "dark" && t.id !== "default-dark").map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                  {t.base === "light" ? " · light" : ""}
                </option>
              ))}
            </select>
            <span>Áp dụng cho toàn bộ cửa sổ</span>
          </div>
        </details>
        <button className="tool-btn icon-only lg" type="button" aria-label="Thêm tài khoản" data-tip="Thêm tài khoản" data-kbd="⌘N" onClick={() => startWizard()}>
          <Icon name="user-plus" />
        </button>
        <button
          className="tool-btn icon-only lg"
          type="button"
          aria-label="Cài đặt"
          data-tip="Cài đặt"
          data-kbd="⌘,"
          onClick={() => useApp.setState({ route: "settings" })}
        >
          <Icon name="settings" />
        </button>
      </div>
    </header>
  );
}
