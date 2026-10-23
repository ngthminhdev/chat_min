import { useApp, openSearch } from "../store";
import { mobileBack } from "../mobile";
import { Icon } from "../ui/Icon";
import { Notifications } from "./Titlebar";

export function MobileHeader() {
  const route = useApp((s) => s.route);
  const active = useApp((s) => s.active);
  const left = useApp((s) => s.leftCollapsed);
  if (route === "welcome" || route === "wizard" || (route === "shell" && active && left)) return null;
  const list = route === "shell";
  const title = route === "settings" ? "Cài đặt" : route === "search" ? "Tìm tin nhắn" : route === "inbox" ? "Tất cả hội thoại" : "Hội thoại";
  return <header className="mobile-header">
    {!list && <button className="tool-btn icon-only" type="button" aria-label="Quay lại" onClick={mobileBack}><Icon name="chevron-left" /></button>}
    <h1>{title}</h1>
    {list && <>
      <button className="tool-btn icon-only" type="button" aria-label="Tìm tin nhắn" onClick={() => openSearch()}><Icon name="search" /></button>
      <Notifications />
      <button className="tool-btn icon-only" type="button" aria-label="Cài đặt" onClick={() => useApp.setState({ route: "settings" })}><Icon name="settings" /></button>
    </>}
  </header>;
}
