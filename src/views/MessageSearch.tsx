import { useEffect, useRef, useState } from "react";
import { api } from "../lib/bridge";
import { hm, norm, plain } from "../lib/format";
import type { Msg } from "../lib/types";
import { key, openMessage, splitKey, useApp } from "../store";
import { ChatAvatar, PersonAvatar } from "../ui/Avatar";
import { Glyph, Icon } from "../ui/Icon";
import { PLATFORMS } from "../lib/platforms";
import { SearchCombobox } from "../ui/SearchCombobox";

const PAGE = 100;
/** the search command's own ceiling (lib.rs `search`) */
const MAX = 1000;

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
  // Editing the query keeps the previous results on screen (dimmed) until the new ones arrive,
  // so the list doesn't blink empty on every keystroke; a too-short query clears it.
  const [hitsFor, setHitsFor] = useState("");
  // what the results on screen were found with: they stay visible under a newer query, but only
  // highlight their own words, and can't be opened once the account/chat filter has moved on
  const [hitsIn, setHitsIn] = useState("");
  const where = `${account}\n${scope}`;
  // "older results": a bigger page of the same search, back to 100 for any other search
  // ponytail: grows the limit (the query sorts every match anyway); a ts cursor if 1000 is ever not enough
  const searchKey = `${q}\n${where}`;
  const [more, setMore] = useState({ key: "", limit: PAGE });
  const limit = more.key === searchKey ? more.limit : PAGE;
  useEffect(() => {
    let cancelled = false;
    setError("");
    setLoading(q.length >= 2);
    if (q.length < 2) { setHits([]); setHitsFor(""); return; }
    const timer = setTimeout(() => {
      const [a, c] = scope ? splitKey(scope) : [account || undefined, undefined];
      api.search(q, limit, a, c)
        .then((msgs) => { if (!cancelled) { setHits(msgs); setHitsFor(q); setHitsIn(where); } })
        .catch((e) => { if (!cancelled) setError(String(e)); })
        .finally(() => { if (!cancelled) setLoading(false); });
    }, 220);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [q, scope, account, attempt, limit]);
  const elsewhere = hitsIn !== where;

  const go = async (m: Msg) => {
    if (opening) return;
    setOpening(m.id);
    try {
      useApp.setState((s) => ({ convTab: { ...s.convTab, [key(m.accountId, m.chatId)]: "msgs" } }));
      await openMessage(m);
    } catch (e) { setError(String(e)); }
    finally { setOpening(""); }
  };
  const highlight = (text: string) => {
    const terms = norm(hitsFor || q).split(/\s+/).filter(Boolean);
    return text.split(/(\s+)/).map((word, i) => terms.some((t) => norm(word).includes(t)) ? <mark key={i}>{word}</mark> : word);
  };
  const options = Object.entries(chats).filter(([, c]) => !account || c.accountId === account)
    .sort((a, b) => b[1].lastTs - a[1].lastTs || a[1].title.localeCompare(b[1].title));
  return (
    <section className="message-search" aria-label="Tìm kiếm tin nhắn">
      <header className="message-search-head mobile-page-heading">
        <div><h1>Tìm tin nhắn</h1><p>Tìm nội dung tin nhắn trong lịch sử đã lưu trên máy này (những tin ChatMin đã tải hoặc đồng bộ), không tìm trên máy chủ. Tìm theo tên hội thoại: ô “Lọc hội thoại” ở sidebar hoặc ⌘K.</p></div>
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
        <p className="message-search-count" role="status">{loading ? (hits.length ? `Đang cập nhật kết quả cho “${q}”…` : "Đang tìm tin nhắn…") : q.length < 2 ? "Nhập ít nhất 2 ký tự để bắt đầu" : error ? "Không thể tìm tin nhắn" : `${hits.length === limit ? `${limit} kết quả mới nhất` : `${hits.length} kết quả`}${scope ? ` trong ${chats[scope]?.title ?? "hội thoại"}` : ""}`}</p>
        {error ? <div className="message-search-empty" role="alert"><Icon name="circle-alert" /><h2>Chưa tìm được tin nhắn</h2><p>Lỗi khi đọc lịch sử đã lưu trên máy này. Tìm kiếm không cần mạng hay đăng nhập lại — hãy thử lại.</p><button className="tool-btn" onClick={() => setAttempt((n) => n + 1)}>Thử lại</button></div>
          : (!loading && !hits.length && q.length >= 2 && hitsFor === q) || q.length < 2 ? <div className="message-search-empty"><Icon name="message-square-text" /><h2>{q.length < 2 ? "Tìm lại điều bạn cần" : "Không tìm thấy tin nhắn"}</h2><p>{q.length < 2 ? "Ví dụ: tên dự án, đường link, nội dung đã trao đổi hoặc tên tệp." : "Thử từ khóa ngắn hơn hoặc mở rộng bộ lọc tài khoản và hội thoại."}</p></div> : null}
        {!error && hits.map((m) => {
          const chat = chats[key(m.accountId, m.chatId)];
          const a = accounts.find((x) => x.id === m.accountId);
          return <button className={`message-search-hit${loading ? " stale" : ""}`} key={JSON.stringify([m.accountId, m.chatId, m.id])} disabled={!!opening || elsewhere} onClick={() => void go(m)}>
            <PersonAvatar name={m.outgoing ? "Bạn" : m.senderName} size="sm" accountId={m.accountId} photo={m.senderPhoto} />
            <span className="message-search-content"><span className="message-search-meta"><strong>{m.outgoing ? "Bạn" : m.senderName || "Người gửi"}</strong><span>{chat?.title ?? "Hội thoại"}</span><span>{a?.name}</span></span>
              <span className="message-search-text">{highlight(plain(m.text) || m.media?.name || "Tin nhắn")}</span>
              {m.media && !!m.text && <span className="message-search-file"><Icon name="paperclip" />{m.media.name}</span>}
            </span>
            <time dateTime={new Date(m.ts).toISOString()}>{new Date(m.ts).toLocaleDateString("vi-VN")}<span>{hm(m.ts)}</span></time><Icon name="chevron-right" />
          </button>;
        })}
        {!error && hits.length === limit && (limit < MAX
          ? <p className="message-search-count"><button className="tool-btn" disabled={loading} onClick={() => setMore({ key: searchKey, limit: limit + PAGE })}>{loading ? "Đang tìm thêm…" : "Xem kết quả cũ hơn"}</button></p>
          : <p className="message-search-count">Đã hiện {MAX} kết quả mới nhất. Thu hẹp từ khóa hoặc chọn hội thoại để tìm tin cũ hơn.</p>)}
      </div>
    </section>
  );
}
