import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { api, fileSrc } from "../lib/bridge";
import { dayLabel, fileSize, fmtCount, hm, listTime, norm, plain } from "../lib/format";
import { CAP_LABELS, CAP_OFF_NOTE, PLATFORMS, type Cap } from "../lib/platforms";
import type { Member, Msg } from "../lib/types";
import { capsOf, chatKeyOf, fail, loadTopics, openThreadTab, openTopicTab, saveMedia, threadTabKey, toast, useApp, type InspTab } from "../store";
import { ChatAvatar, PersonAvatar } from "../ui/Avatar";
import { Glyph, Icon } from "../ui/Icon";
import { useDownload } from "./Conversation";

export function Inspector() {
  const active = useApp((s) => chatKeyOf(s.active));
  const chat = useApp((s) => s.chats[chatKeyOf(s.active) ?? ""]);
  const account = useApp((s) => s.accounts.find((a) => a.id === chat?.accountId));
  const tab = useApp((s) => s.inspTab);
  const list = useApp((s) => s.msgs[chatKeyOf(s.active) ?? ""]);

  if (!active || !chat || !account) return <aside className="inspector" aria-label="Thông tin chat" />;
  const conn = { "--conn": `var(--conn-${account.color})` } as React.CSSProperties;
  const head = (
    <div className="inspector-head">
      <div className="h">
        <strong>Chi tiết hội thoại</strong>
        <span>
          <span className="conn-dot" style={conn} />
          <Glyph platform={account.platform} />
          <em>
            {account.name} · {PLATFORMS[account.platform].name}
          </em>
        </span>
      </div>
      <button className="tool-btn icon-only lg" aria-label="Đóng inspector" data-tip="Đóng inspector" data-kbd="⌘I" onClick={() => useApp.setState({ rightCollapsed: true })}>
        <Icon name="x" />
      </button>
    </div>
  );

  if (chat.kind === "web") {
    return (
      <aside className="inspector" aria-label="Thông tin chat">
        {head}
        <div className="inspector-scroll">
          <div className="insp-empty">
            <Icon name="external-link" />
            {account.name} chạy bằng chính trang web của {PLATFORMS[account.platform].name}, đăng nhập riêng cho account này.
            Tin nhắn không đi qua ChatMin nên không có tìm kiếm, dịch hay tóm tắt.
          </div>
        </div>
      </aside>
    );
  }
  const msgs = (list ?? []).filter((m) => !m.deleted);
  const files = msgs.filter((m) => m.media && (m.media.kind === "file" || m.media.kind === "voice" || (m.media.kind === "video" && !m.media.thumb)));
  const imgs = msgs.filter((m) => m.media && (m.media.kind === "image" || (m.media.kind === "video" && m.media.thumb)));
  const caps = capsOf(active);
  const tabs: [InspTab, string, number?][] = [
    ["info", "Info"],
    ["members", "Người", chat.kind === "dm" ? undefined : chat.memberCount || undefined],
    ["files", "File", files.length || undefined],
    ["media", "Ảnh", imgs.length || undefined],
    ...(caps.pin ? [["pinned", "Ghim"] as [InspTab, string]] : []),
    ...(chat.threaded || chat.forum ? [["threads", chat.forum ? "Topics" : "Threads"] as [InspTab, string]] : []),
  ];

  return (
    <aside className="inspector" aria-label="Thông tin chat">
      {head}
      <div className="mini-tabs" role="tablist" aria-label="Thông tin chat">
        {tabs.map(([k, l, n]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? "active" : ""} onClick={() => useApp.setState({ inspTab: k })}>
            {l}
            {n ? <small>{n > 999 ? `${Math.round(n / 100) / 10}k` : n}</small> : null}
          </button>
        ))}
      </div>
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={`${active}:${tab}`}
          className="inspector-scroll"
          initial={{ opacity: 0, x: 6 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, transition: { duration: 0.08 } }}
          transition={{ duration: 0.16 }}
        >
          {tab === "info" && <InfoTab k={active} files={files} />}
          {tab === "members" && <MembersTab k={active} />}
          {tab === "files" && <FilesTab files={files} />}
          {tab === "media" && <MediaTab imgs={imgs} />}
          {tab === "pinned" && <PinnedTab k={active} />}
          {tab === "threads" && (chat.forum ? <TopicsTab k={active} /> : chat.threaded ? <ThreadsTab k={active} /> : null)}
        </motion.div>
      </AnimatePresence>
    </aside>
  );
}

function InfoTab({ k, files }: { k: string; files: Msg[] }) {
  const chat = useApp((s) => s.chats[k])!;
  const account = useApp((s) => s.accounts.find((a) => a.id === chat.accountId))!;
  const pl = PLATFORMS[account.platform];
  const kind = chat.kind === "dm" ? "Chat riêng" : chat.kind === "space" ? "Space" : chat.kind === "channel" ? "Kênh" : "Nhóm";
  return (
    <>
      <div className="insp-hero">
        <ChatAvatar chat={chat} size="lg" platform={account.platform} />
        <strong>{chat.title}</strong>
        <span>
          {kind}
          {chat.memberCount ? ` · ${fmtCount(chat.memberCount)} thành viên` : ""}
        </span>
      </div>
      {chat.description && <p className="insp-desc">{chat.description}</p>}
      <div className="insp-section">Chi tiết</div>
      <div className="kv">
        <span>Account</span>
        <span className="seg" style={{ minWidth: 0 }}>
          <span className="conn-dot" style={{ "--conn": `var(--conn-${account.color})` } as React.CSSProperties} />
          <span className="od-truncate">
            {account.name} · {account.handle}
          </span>
        </span>
      </div>
      <div className="kv">
        <span>Chat ID</span>
        <code>{chat.id}</code>
      </div>
      {chat.created && (
        <div className="kv">
          <span>Tạo</span>
          <code>{chat.created}</code>
        </div>
      )}
      <div className="kv">
        <span>Thông báo</span>
        <label className="switch">
          <input
            type="checkbox"
            checked={!chat.muted}
            aria-label="Bật thông báo"
            onChange={(e) => {
              const muted = !e.target.checked;
              useApp.setState((s) => ({ chats: { ...s.chats, [k]: { ...chat, muted } } }));
              api.setMuted(chat.accountId, chat.id, muted).catch(fail);
            }}
          />
          <span />
        </label>
      </div>
      {files.length > 0 && (
        <>
          <div className="insp-section">
            <span>File gần đây</span>
            <button className="inspector-link" onClick={() => useApp.setState({ inspTab: "files" })}>
              {files.length} file
            </button>
          </div>
          {files
            .slice(-2)
            .reverse()
            .map((m) => (
              <button key={m.id} className="recent-file" onClick={() => useApp.setState({ inspTab: "files" })}>
                <Icon name="file-text" />
                <span className="od-field">
                  <b>{m.media!.name}</b>
                  <small>
                    {[fileSize(m.media!.size), hm(m.ts)].filter(Boolean).join(" · ")}
                  </small>
                </span>
                <Icon name="chevron-right" />
              </button>
            ))}
        </>
      )}
      <details className="capabilities">
        <summary>Khả năng · {pl.name}</summary>
        {(Object.entries(pl.caps) as [Cap, boolean][]).map(([c, v]) => (
          <div key={c} className={`cap-row ${v ? "yes" : "no"}`}>
            <Icon name={v ? "check" : "x"} />
            <span>
              {CAP_LABELS[c]}
              {!v && CAP_OFF_NOTE[c] && <small>{CAP_OFF_NOTE[c]}</small>}
            </span>
          </div>
        ))}
      </details>
    </>
  );
}

function MembersTab({ k }: { k: string }) {
  const chat = useApp((s) => s.chats[k])!;
  const [members, setMembers] = useState<Member[] | null>(null);
  const [err, setErr] = useState("");
  const [q, setQ] = useState("");
  useEffect(() => {
    if (chat.kind === "dm") return;
    api.members(chat.accountId, chat.id).then(setMembers).catch((e) => setErr(String(e)));
  }, [chat.accountId, chat.id, chat.kind]);
  if (chat.kind === "dm") return <div className="insp-empty"><Icon name="users" />Chat 1-1 với {chat.title}</div>;
  if (err) return <div className="insp-empty"><Icon name="circle-alert" />{err}</div>;
  if (!members) return <div className="insp-empty"><span className="veil-spinner" /></div>;
  const shown = members.filter((m) => !q || norm(m.name).includes(norm(q)));
  const rest = chat.memberCount - members.length;
  return (
    <>
      <div className="side-search-wrap" style={{ marginBottom: 8 }}>
        <Icon name="search" />
        <input className="side-search" placeholder="Tìm thành viên" aria-label="Tìm thành viên" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {shown.map((m) => (
        <div key={m.id} className="member-row">
          <PersonAvatar name={m.name} size="sm" />
          <span className="who">
            <b>{m.name}</b>
            {m.status && <small className={m.status === "online" ? "on" : ""}>{m.status}</small>}
          </span>
          {m.role && <span className="badge blue">{m.role}</span>}
        </div>
      ))}
      {rest > 0 && !q && <div className="insp-note">Hiện {members.length} người đầu · còn {fmtCount(rest)} thành viên</div>}
    </>
  );
}

function FilesTab({ files }: { files: Msg[] }) {
  if (!files.length) return <div className="insp-empty"><Icon name="file-text" />Chưa có file nào trong phần lịch sử đã tải</div>;
  return (
    <>
      {[...files].reverse().map((m) => (
        <FileRow key={m.id} m={m} />
      ))}
    </>
  );
}

function FileRow({ m }: { m: Msg }) {
  const dl = useDownload(m.accountId, m.media, false);
  const open = async () => {
    const { openPath, openUrl } = await import("../lib/bridge");
    if (m.media!.url) return void openUrl(m.media!.url);
    const p = dl.path || (await dl.get());
    if (p) openPath(p).catch(fail);
  };
  const menu = (e: React.MouseEvent) => {
    e.preventDefault();
    if (m.media!.url) return;
    const ensure = async () => dl.path || (await dl.get());
    useApp.setState({
      pop: {
        kind: "menu", x: e.clientX, y: e.clientY, top: e.clientY,
        items: [
          { icon: "external-link", label: "Mở", run: () => void open() },
          { icon: "download", label: "Lưu vào Downloads", run: () => void ensure().then((p) => { if (p) void saveMedia(p, m.media!.name, false); }) },
          { icon: "download", label: "Lưu thành…", run: () => void ensure().then((p) => { if (p) void saveMedia(p, m.media!.name, true); }) },
          { icon: "message-square-text", label: "Tới tin nhắn", run: () => useApp.setState({ jumpTo: m.id }) },
        ],
      },
    });
  };
  return (
    <div className="file-row" onContextMenu={menu}>
      <span className="file-ic"><Icon name={m.media!.kind === "voice" ? "audio-lines" : "file-text"} /></span>
      <span style={{ minWidth: 0 }}>
        <b>{m.media!.name}</b>
        <small>{[fileSize(m.media!.size), m.outgoing ? "Bạn" : m.senderName, hm(m.ts)].filter(Boolean).join(" · ")}</small>
      </span>
      <button className="tool-btn icon-only" aria-label={`Tải ${m.media!.name}`} data-tip={dl.path ? "Mở" : "Tải về"} onClick={open}>
        {dl.state === "loading" ? <span className="veil-spinner" /> : <Icon name={dl.path ? "folder-open" : "download"} />}
      </button>
    </div>
  );
}

function MediaTab({ imgs }: { imgs: Msg[] }) {
  if (!imgs.length) return <div className="insp-empty"><Icon name="image" />Chưa có ảnh trong phần lịch sử đã tải</div>;
  return (
    <div className="media-grid">
      {[...imgs].reverse().map((m) => (
        <MediaCell key={m.id} m={m} />
      ))}
    </div>
  );
}

function MediaCell({ m }: { m: Msg }) {
  const dl = useDownload(m.accountId, m.media, m.media!.kind === "image");
  const src = dl.path && m.media!.kind === "image" ? fileSrc(dl.path) : m.media!.thumb;
  const view = async () => {
    const p = dl.path || (await dl.get());
    if (p) useApp.setState({ viewer: { media: m.media!, path: p } });
    else toast("Tải file không được", "circle-alert");
  };
  return (
    <figure
      onClick={() => void view()}
      onContextMenu={(e) => {
        e.preventDefault();
        useApp.setState({
          pop: {
            kind: "menu", x: e.clientX, y: e.clientY, top: e.clientY,
            items: [
              { icon: "image", label: "Xem", run: () => void view() },
              { icon: "message-square-text", label: "Tới tin nhắn", run: () => useApp.setState({ jumpTo: m.id }) },
            ],
          },
        });
      }}
    >
      {src ? <img className="od-media" src={src} alt="" /> : <div className="media-ph" />}
      <figcaption>
        {(m.outgoing ? "Bạn" : m.senderName).split(" ").pop()} · {hm(m.ts)}
      </figcaption>
    </figure>
  );
}

function PinnedTab({ k }: { k: string }) {
  const chat = useApp((s) => s.chats[k])!;
  const local = useApp((s) => s.msgs[k]);
  const [pins, setPins] = useState<Msg[] | null>(null);
  const localPins = useMemo(() => (local ?? []).filter((m) => m.pinned).map((m) => m.id).join(), [local]);
  useEffect(() => {
    api.pinned(chat.accountId, chat.id).then(setPins).catch(() => setPins([]));
  }, [chat.accountId, chat.id, localPins]);
  if (!pins) return <div className="insp-empty"><span className="veil-spinner" /></div>;
  if (!pins.length)
    return (
      <div className="insp-empty">
        <Icon name="pin" />
        Chưa ghim tin nào.
        <br />
        Di chuột lên tin → <Icon name="ellipsis" /> → Ghim.
      </div>
    );
  return (
    <>
      {pins.map((m) => (
        <button key={m.id} className="pin-row" onClick={() => useApp.setState({ jumpTo: m.id })}>
          <Icon name="pin" />
          <span style={{ minWidth: 0 }}>
            <small>
              {m.outgoing ? "Bạn" : m.senderName} · {hm(m.ts)}
            </small>
            <span>{plain(m.text) || m.media?.name}</span>
          </span>
        </button>
      ))}
    </>
  );
}

/** Google Chat threads of the loaded history, most recently active first. */
function ThreadsTab({ k }: { k: string }) {
  const list = useApp((s) => s.msgs[k]);
  const tabs = useApp((s) => s.tabs);
  const rows = useMemo(() => {
    const roots = (list ?? []).filter((m) => !m.threadReply && m.threadId && !m.deleted && m.kind !== "service");
    const replies: Record<string, Msg[]> = {};
    for (const m of list ?? []) if (m.threadReply) (replies[m.threadId] ??= []).push(m);
    return roots
      .map((r) => ({ root: r, replies: replies[r.threadId] ?? [], last: Math.max(r.ts, ...(replies[r.threadId] ?? []).map((x) => x.ts)) }))
      .filter((x) => x.replies.length)
      .sort((a, b) => b.last - a.last);
  }, [list]);
  if (!list) return <div className="insp-empty"><span className="veil-spinner" /></div>;
  if (!rows.length) return <div className="insp-empty"><Icon name="message-circle-reply" />Chưa có thread nào trong phần đã tải</div>;
  return (
    <div className="side-threads">
      {rows.map(({ root, replies, last }) => {
        const faces = [...new Map(replies.map((r) => [r.senderName, r])).values()].slice(0, 3);
        return (
          <button key={root.id} className={`side-thread${tabs.includes(threadTabKey(k, root.threadId)) ? " open" : ""}`} onClick={() => openThreadTab(k, root)}>
            <span className="hd">
              <b>{root.outgoing ? "Bạn" : root.senderName}</b>
              <time>{dayLabel(last).split(" · ")[0]} {hm(last)}</time>
            </span>
            <span className="tx">{plain(root.text) || root.media?.name}</span>
            <span className="meta">
              <span className="faces">{faces.map((f) => <PersonAvatar key={f.senderName} name={f.senderName} accountId={f.accountId} photo={f.senderPhoto} />)}</span>
              {replies.length} trả lời
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** Telegram forum topics: name, unread, last message; click opens the topic tab. */
function TopicsTab({ k }: { k: string }) {
  const topics = useApp((s) => s.topics[k]);
  const tabs = useApp((s) => s.tabs);
  useEffect(() => {
    void loadTopics(k);
  }, [k]);
  if (!topics) return <div className="insp-empty"><span className="veil-spinner" /></div>;
  if (!topics.length) return <div className="insp-empty"><Icon name="hash" />Nhóm chưa có topic</div>;
  return (
    <div className="side-threads">
      {topics.map((t) => (
        <button key={t.id} className={`side-thread topic${tabs.includes(threadTabKey(k, t.id)) ? " open" : ""}`} onClick={() => openTopicTab(k, t)}>
          <span className="hd">
            <b>
              <i className="topic-dot" style={{ background: `#${(t.color || 0x6fb9f0).toString(16).padStart(6, "0")}` }} />
              {t.name}
              {t.pinned && <Icon name="pin" />}
              {t.closed && <Icon name="lock" />}
            </b>
            <time>{listTime(t.lastTs)}</time>
          </span>
          <span className="tx">{t.previewFrom ? `${t.previewFrom}: ` : ""}{t.preview || "Chưa có tin nhắn"}</span>
          {(t.unread > 0 || t.mention) && (
            <span className="meta">
              {t.mention && <Icon name="at-sign" />}
              {t.unread > 0 && <span className="badge unread">{t.unread}</span>}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}
