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
            // healthy accounts are just a dot and a name (status in the tooltip); words only
            // show up when something needs attention
            <span
              key={a.id}
              className={`acc-status${h === "ok" ? "" : ` ${h}`}`}
              style={{ "--conn": `var(--conn-${a.color})` } as React.CSSProperties}
              data-tip={`${a.name} · ${h === "ok" ? "Đã đồng bộ" : HEALTH_LABELS[h]}`}
            >
              <span className="conn-dot" />
              {a.name}
              {h === "ok" ? null : h === "syncing" || h === "reconnecting" ? (
                <span className="warn"><Icon name="refresh-cw" className="spin" /> {HEALTH_LABELS[h]}</span>
              ) : (
                <span className={`health-text ${h}`}>{HEALTH_LABELS[h]}</span>
              )}
            </span>
          );
        })}
      </div>
      <div className="right-status">
        {unread > 0 && <span>{unread} chưa đọc</span>}
        {drafts > 0 && <span>{drafts} nháp</span>}
        <span><kbd className="kbd">⌘K</kbd> lệnh</span>
      </div>
    </div>
  );
}
