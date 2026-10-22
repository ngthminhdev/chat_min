import { useMemo, useState } from "react";
import { listTime, norm } from "../lib/format";
import { key, openChat, useApp } from "../store";
import { ChatAvatar } from "../ui/Avatar";
import { Icon } from "../ui/Icon";

export function Inbox() {
  const chats = useApp((s) => s.chats);
  const accounts = useApp((s) => s.accounts);
  const [account, setAccount] = useState("");
  const [filter, setFilter] = useState("all");
  const [q, setQ] = useState("");
  const [limit, setLimit] = useState(300);
  const rows = useMemo(
    () =>
      Object.values(chats)
        .filter(
          (c) =>
            (!account || c.accountId === account) &&
            (filter === "all" || (filter === "unread" ? c.unread > 0 : c.mention)) &&
            norm(`${c.title} ${c.preview}`).includes(norm(q)),
        )
        .sort((a, b) => b.lastTs - a.lastTs),
    [chats, account, filter, q],
  );
  return (
    <>
      <header className="r2-header">
        <div className="od-field">
          <h1>All inboxes</h1>
          <p>Hội thoại gần đây từ mọi account</p>
        </div>
      </header>
      <div className="inbox-shell">
        <div className="inbox-filters">
          <label>
            Account
            <select className="settings-select" value={account} onChange={(e) => setAccount(e.target.value)}>
              <option value="">Mọi account</option>
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </label>
          <label>
            Trạng thái
            <select className="settings-select" value={filter} onChange={(e) => setFilter(e.target.value)}>
              <option value="all">Tất cả</option>
              <option value="unread">Chưa đọc</option>
              <option value="mention">Được mention</option>
            </select>
          </label>
          <label className="inbox-search">
            Tìm hội thoại
            <input value={q} placeholder="Tên hoặc tin gần đây" onChange={(e) => setQ(e.target.value)} />
          </label>
        </div>
        <div className="inbox-count" role="status">{Math.min(limit, rows.length)} / {rows.length} hội thoại · mới nhất trước</div>
        <div className="inbox-list">
          {rows.length ? (
            rows.slice(0, limit).map((c) => {
              const a = accounts.find((x) => x.id === c.accountId);
              return (
                <button key={key(c.accountId, c.id)} className="inbox-row" onClick={() => void openChat(key(c.accountId, c.id))}>
                  <ChatAvatar chat={c} platform={a?.platform} />
                  <span className="od-field od-fill">
                    <strong>{c.title}</strong>
                    <span className="od-truncate">
                      {c.previewFrom ? `${c.previewFrom}: ` : ""}
                      {c.preview || "Chưa có tin nhắn"}
                    </span>
                  </span>
                  <span className="inbox-account" style={{ "--conn": `var(--conn-${a?.color})` } as React.CSSProperties}>
                    <span className="conn-dot" />
                    {a?.name}
                  </span>
                  <span className="inbox-unread">
                    {c.mention ? "@" : ""}
                    {c.unread > 0 && <span className={`badge ${c.muted ? "idle" : "unread"}`}>{c.unread}</span>}
                  </span>
                  <time>{listTime(c.lastTs) || "—"}</time>
                  <Icon name="chevron-right" />
                </button>
              );
            })
          ) : (
            <div className="r2-empty">
              <h2>{Object.keys(chats).length ? "Không có hội thoại phù hợp" : "Chưa có hội thoại"}</h2>
              <p>{Object.keys(chats).length ? "Thử đổi account, bỏ lọc hoặc tìm bằng tên khác." : "Hội thoại sẽ xuất hiện khi account đồng bộ xong."}</p>
              {(account || filter !== "all" || q) && <button className="tool-btn" onClick={() => (setAccount(""), setFilter("all"), setQ(""))}>Xoá bộ lọc</button>}
            </div>
          )}
        </div>
        {rows.length > limit && <button className="tool-btn" onClick={() => setLimit((n) => n + 300)}>Xem thêm hội thoại</button>}
      </div>
    </>
  );
}
