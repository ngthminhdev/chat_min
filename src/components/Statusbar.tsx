import { HEALTH_LABELS } from "../lib/platforms";
import { totalUnread, useApp } from "../store";
import { Icon } from "../ui/Icon";

export function Statusbar() {
  const accounts = useApp((s) => s.accounts);
  const health = useApp((s) => s.health);
  const route = useApp((s) => s.route);
  const unread = useApp((s) => totalUnread(s.chats));
  const drafts = useApp((s) => Object.values(s.drafts).filter((d) => d.trim()).length);

  if (route === "welcome") {
    return (
      <div className="statusbar">
        <div><span>Chưa có tài khoản</span></div>
        <div className="right-status"><span>⌘N Thêm tài khoản</span></div>
      </div>
    );
  }
  return (
    <div className="statusbar">
      <div>
        {accounts.map((a) => {
          const h = health[a.id]?.health ?? "ok";
          return (
            <span key={a.id} className="acc-status" style={{ "--conn": `var(--conn-${a.color})` } as React.CSSProperties}>
              <span className="conn-dot" />
              {a.name}
              {h === "ok" ? (
                <span className="ok"><Icon name="check" /> Đã đồng bộ</span>
              ) : h === "syncing" || h === "reconnecting" ? (
                <span className="warn"><Icon name="refresh-cw" className="spin" /> {HEALTH_LABELS[h]}</span>
              ) : (
                <span className={`health-text ${h}`}>{HEALTH_LABELS[h]}</span>
              )}
            </span>
          );
        })}
      </div>
      <div className="right-status">
        <span>{unread} chưa đọc</span>
        <span>{drafts} nháp</span>
        <span><kbd className="kbd">⌘K</kbd> lệnh</span>
      </div>
    </div>
  );
}
