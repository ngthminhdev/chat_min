import { useEffect, useRef, useState } from "react";
import { api } from "../lib/bridge";
import { hm, norm, plain } from "../lib/format";
import type { Msg } from "../lib/types";
import { key, openChat, splitKey, useApp } from "../store";
import { ChatAvatar, PersonAvatar } from "../ui/Avatar";
import { Glyph, Icon } from "../ui/Icon";
import { PLATFORMS } from "../lib/platforms";
import { SearchCombobox } from "../ui/SearchCombobox";

export function MessageSearch() {
  const query = useApp((s) => s.searchQuery);
  const scope = useApp((s) => s.searchScope);
  const account = useApp((s) => s.searchAccount);
  const accounts = useApp((s) => s.accounts);
  const chats = useApp((s) => s.chats);
  const [hits, setHits] = useState<Msg[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [opening, setOpening] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const results = useRef<HTMLDivElement>(null);
  const q = query.trim();
  useEffect(() => { input.current?.focus(); }, [scope]);
  useEffect(() => {
    let cancelled = false;
    setHits([]);
    setError("");
    setLoading(q.length >= 2);
    if (q.length < 2) return;
    const timer = setTimeout(() => {
      const [a, c] = scope ? splitKey(scope) : [account || undefined, undefined];
      api.search(q, 100, a, c)
        .then((msgs) => { if (!cancelled) setHits(msgs); })
        .catch((e) => { if (!cancelled) setError(String(e)); })
        .finally(() => { if (!cancelled) setLoading(false); });
    }, 220);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [q, scope, account, attempt]);

  const go = async (m: Msg) => {
    if (opening) return;
    setOpening(m.id);
    try {
      await openChat(key(m.accountId, m.chatId));
      useApp.setState((s) => ({ convTab: { ...s.convTab, [key(m.accountId, m.chatId)]: "msgs" }, jumpTo: m.id }));
    } catch (e) { setError(String(e)); }
    finally { setOpening(""); }
  };
  const highlight = (text: string) => {
    const terms = norm(q).split(/\s+/).filter(Boolean);
    return text.split(/(\s+)/).map((word, i) => terms.some((t) => norm(word).includes(t)) ? <mark key={i}>{word}</mark> : word);
  };
  const options = Object.entries(chats).filter(([, c]) => !account || c.accountId === account)
    .sort((a, b) => b[1].lastTs - a[1].lastTs || a[1].title.localeCompare(b[1].title));
  return (
    <section className="message-search" aria-label="Tìm kiếm tin nhắn">
      <header className="message-search-head">
        <div><h1>Tìm tin nhắn</h1><p>Tìm nội dung trong lịch sử đã đồng bộ trên máy.</p></div>
        <button className="tool-btn" onClick={() => useApp.setState({ route: "shell" })}><Icon name="reply" />Về hội thoại</button>
      </header>
      <div className="message-search-controls">
        <div className="message-search-input">
          <Icon name="search" />
          <input ref={input} aria-label="Nội dung cần tìm" placeholder="Nhập từ khóa, nội dung hoặc tên tệp…" value={query} autoComplete="off"
            onChange={(e) => useApp.setState({ searchQuery: e.target.value })}
            onKeyDown={(e) => { if (e.key === "ArrowDown") { e.preventDefault(); results.current?.querySelector<HTMLButtonElement>(".message-search-hit")?.focus(); } }} />
          {query && <button className="tool-btn icon-only" aria-label="Xóa từ khóa" onClick={() => { useApp.setState({ searchQuery: "" }); input.current?.focus(); }}><Icon name="x" /></button>}
        </div>
        <div className="message-search-filters">
          <SearchCombobox label="Tài khoản" value={account} onChange={(value) => useApp.setState({ searchAccount: value, searchScope: "" })}
            options={[{ value: "", label: "Tất cả tài khoản", detail: "Tìm trên mọi tài khoản", avatar: <Icon name="layers" /> },
              ...accounts.map((a) => ({ value: a.id, label: a.name, detail: `${PLATFORMS[a.platform].name}${a.handle ? ` · ${a.handle}` : ""}`, avatar: <span className="search-account-logo"><Glyph platform={a.platform} /></span> }))]} />
          <SearchCombobox label="Hội thoại" value={scope} recent onChange={(value) => useApp.setState({ searchScope: value })}
            options={[{ value: "", label: "Tất cả hội thoại", detail: account ? `Trong ${accounts.find((a) => a.id === account)?.name ?? "tài khoản đã chọn"}` : "Tìm trên mọi hội thoại", avatar: <Icon name="messages-square" /> },
              ...options.map(([k, c]) => {
                const a = accounts.find((a) => a.id === c.accountId);
                return { value: k, label: c.title, detail: `${a?.name ?? ""} · ${a ? PLATFORMS[a.platform].name : ""}${c.lastTs ? ` · ${new Date(c.lastTs).toLocaleDateString("vi-VN")}` : ""}`, avatar: <ChatAvatar chat={c} size="sm" platform={a?.platform} /> };
              })]} />
          {(account || scope) && <button className="tool-btn" onClick={() => useApp.setState({ searchAccount: "", searchScope: "" })}>Bỏ bộ lọc</button>}
        </div>
      </div>
      <div className="message-search-results" ref={results} aria-busy={loading}
        onKeyDown={(e) => {
          if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
          const buttons = [...results.current!.querySelectorAll<HTMLButtonElement>(".message-search-hit")];
          const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
          if (i < 0) return;
          e.preventDefault();
          if (e.key === "ArrowUp" && i === 0) input.current?.focus();
          else buttons[Math.min(buttons.length - 1, i + (e.key === "ArrowDown" ? 1 : -1))]?.focus();
        }}>
        <p className="message-search-count" role="status">{loading ? "Đang tìm tin nhắn…" : q.length < 2 ? "Nhập ít nhất 2 ký tự để bắt đầu" : error ? "Không thể tìm tin nhắn" : `${hits.length === 100 ? "100 kết quả đầu tiên" : `${hits.length} kết quả`}${scope ? ` trong ${chats[scope]?.title ?? "hội thoại"}` : ""}`}</p>
        {error ? <div className="message-search-empty" role="alert"><Icon name="circle-alert" /><h2>Chưa tìm được tin nhắn</h2><p>Thử lại hoặc kiểm tra kết nối tài khoản.</p><button className="tool-btn" onClick={() => setAttempt((n) => n + 1)}>Thử lại</button></div>
          : !loading && !hits.length ? <div className="message-search-empty"><Icon name="message-square-text" /><h2>{q.length < 2 ? "Tìm lại điều bạn cần" : "Không tìm thấy tin nhắn"}</h2><p>{q.length < 2 ? "Ví dụ: tên dự án, đường link, nội dung đã trao đổi hoặc tên tệp." : "Thử từ khóa ngắn hơn hoặc mở rộng bộ lọc tài khoản và hội thoại."}</p></div> : null}
        {!loading && !error && hits.map((m) => {
          const chat = chats[key(m.accountId, m.chatId)];
          const a = accounts.find((x) => x.id === m.accountId);
          return <button className="message-search-hit" key={JSON.stringify([m.accountId, m.chatId, m.id])} disabled={!!opening} onClick={() => void go(m)}>
            <PersonAvatar name={m.outgoing ? "Bạn" : m.senderName} size="sm" accountId={m.accountId} photo={m.senderPhoto} />
            <span className="message-search-content"><span className="message-search-meta"><strong>{m.outgoing ? "Bạn" : m.senderName || "Người gửi"}</strong><span>{chat?.title ?? "Hội thoại"}</span><span>{a?.name}</span></span>
              <span className="message-search-text">{highlight(plain(m.text) || m.media?.name || "Tin nhắn")}</span>
              {m.media && !!m.text && <span className="message-search-file"><Icon name="paperclip" />{m.media.name}</span>}
            </span>
            <time dateTime={new Date(m.ts).toISOString()}>{new Date(m.ts).toLocaleDateString("vi-VN")}<span>{hm(m.ts)}</span></time><Icon name="chevron-right" />
          </button>;
        })}
        {!loading && hits.length === 100 && <p className="message-search-count">Thu hẹp từ khóa hoặc chọn hội thoại để tìm chính xác hơn.</p>}
      </div>
    </section>
  );
}
