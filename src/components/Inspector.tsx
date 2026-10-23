import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useShallow } from "zustand/react/shallow";
import { api, fileSrc } from "../lib/bridge";
import { dayLabel, fileSize, fmtCount, hm, listTime, norm, plain } from "../lib/format";
import { CAP_LABELS, CAP_OFF_NOTE, PLATFORMS, type Cap } from "../lib/platforms";
import type { Member, Msg } from "../lib/types";
import { fileActionLabel, mediaSection } from "../lib/micro-ux";
import { capsOf, chatKeyOf, fail, loadTopics, openThreadTab, openTopicTab, saveMedia, threadTabKey, threadUnread, toast, useApp, type InspTab } from "../store";
import { ChatAvatar, PersonAvatar } from "../ui/Avatar";
import { Glyph, Icon } from "../ui/Icon";
import { useDownload } from "./Conversation";

export function Inspector() {
  const active = useApp((s) => chatKeyOf(s.active));
  const chat = useApp((s) => s.chats[chatKeyOf(s.active) ?? ""]);
  const account = useApp((s) => s.accounts.find((a) => a.id === chat?.accountId));
  const requestedTab = useApp((s) => s.inspTab);
  const list = useApp((s) => s.msgs[chatKeyOf(s.active) ?? ""]);
  const panelId = useId();
  const reduceMotion = useReducedMotion();

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
      <button className="tool-btn icon-only lg" aria-label="Đóng chi tiết hội thoại" data-tip="Đóng chi tiết hội thoại" data-kbd="⌘R" onClick={() => useApp.setState({ rightCollapsed: true })}>
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
            {account.name} chạy bằng chính trang web của {PLATFORMS[account.platform].name}, đăng nhập riêng cho tài khoản này.
            Tin nhắn không đi qua ChatMin nên không có tìm kiếm, dịch hay tóm tắt.
          </div>
        </div>
      </aside>
    );
  }
  const msgs = (list ?? []).filter((m) => !m.deleted);
  const files = msgs.filter((m) => mediaSection(m.media) === "files");
  const imgs = msgs.filter((m) => mediaSection(m.media) === "media");
  const caps = capsOf(active);
  const tabs: [InspTab, string, number?][] = [
    // threads lead in a space (and topics in a forum): that's what you open the panel for
    ...(chat.threaded || chat.forum ? [["threads", chat.forum ? "Chủ đề" : "Luồng trả lời"] as [InspTab, string]] : []),
    ["info", "Thông tin"],
    ["members", "Thành viên", chat.kind === "dm" ? undefined : chat.memberCount || undefined],
    ["files", "Tệp", files.length || undefined],
    ["media", "Ảnh & video", imgs.length || undefined],
    ...(caps.pin ? [["pinned", "Ghim"] as [InspTab, string]] : []),
  ];
  const tab = tabs.some(([k]) => k === requestedTab) ? requestedTab : "info";

  return (
    <aside className="inspector" aria-label="Thông tin chat">
      {head}
      <InspectorTabs tabs={tabs} selected={tab} panelId={panelId} />
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={`${active}:${tab}`}
          className="inspector-scroll"
          id={panelId}
          role="tabpanel"
          aria-labelledby={`${panelId}-${tab}`}
          tabIndex={0}
          initial={reduceMotion ? false : { opacity: 0, x: 6 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, transition: { duration: reduceMotion ? 0 : 0.08 } }}
          transition={{ duration: reduceMotion ? 0 : 0.16 }}
        >
          <div className="inspector-surface">
          {tab === "info" && <InfoTab k={active} files={files} />}
          {tab === "members" && <MembersTab k={active} />}
          {tab === "files" && <><p className="history-scope">{files.length} tệp và tin nhắn thoại trong lịch sử đã tải</p><FilesTab files={files} /></>}
          {tab === "media" && <><p className="history-scope">{imgs.length} ảnh và video trong lịch sử đã tải</p><MediaTab imgs={imgs} /></>}
          {tab === "pinned" && <PinnedTab k={active} />}
          {tab === "threads" && (chat.forum ? <TopicsTab k={active} /> : chat.threaded ? <ThreadsTab k={active} /> : null)}
          </div>
        </motion.div>
      </AnimatePresence>
    </aside>
  );
}

function InspectorTabs({ tabs, selected, panelId }: { tabs: [InspTab, string, number?][]; selected: InspTab; panelId: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [overflow, setOverflow] = useState(false);
  const index = tabs.findIndex(([k]) => k === selected);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const reveal = () => {
      const button = el.querySelector<HTMLElement>('[aria-selected="true"]');
      if (!button) return;
      const bounds = el.getBoundingClientRect(), item = button.getBoundingClientRect();
      const inset = el.scrollWidth > el.clientWidth + 1 ? 16 : 4;
      if (item.left < bounds.left + inset) el.scrollLeft -= bounds.left + inset - item.left;
      else if (item.right > bounds.right - inset) el.scrollLeft += item.right - bounds.right + inset;
    };
    const resize = () => { setOverflow(el.scrollWidth > el.clientWidth + 1); reveal(); };
    const observer = new ResizeObserver(resize);
    observer.observe(el);
    resize();
    return () => observer.disconnect();
  }, [selected, tabs.map(([k, , n]) => `${k}:${n}`).join(",")]);
  const choose = (i: number) => {
    useApp.setState({ inspTab: tabs[i][0] });
    ref.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[i]?.focus();
  };
  return (
    <div className="inspector-tabbar">
      {overflow && <button className="tool-btn icon-only insp-tab-step prev" aria-label="Mục thông tin trước" data-tip="Mục thông tin trước" disabled={index === 0} onClick={() => choose(index - 1)}><Icon name="chevron-right" /></button>}
      <div ref={ref} className="mini-tabs" role="tablist" aria-label="Thông tin chat" onKeyDown={(e) => {
        const target = e.key === "ArrowRight" ? (index + 1) % tabs.length : e.key === "ArrowLeft" ? (index - 1 + tabs.length) % tabs.length : e.key === "Home" ? 0 : e.key === "End" ? tabs.length - 1 : -1;
        if (target < 0) return;
        e.preventDefault();
        choose(target);
      }}>
        {tabs.map(([k, label, count]) => (
          <button key={k} id={`${panelId}-${k}`} role="tab" aria-controls={panelId} aria-selected={selected === k} tabIndex={selected === k ? 0 : -1} aria-label={`${label}${count ? ` · ${count}${k === "files" || k === "media" ? " trong lịch sử đã tải" : ""}` : ""}`} className={selected === k ? "active" : ""} onClick={() => useApp.setState({ inspTab: k })}>
            {label}{count ? <small>{fmtCount(count)}</small> : null}
          </button>
        ))}
      </div>
      {overflow && <button className="tool-btn icon-only insp-tab-step" aria-label="Mục thông tin tiếp theo" data-tip="Mục thông tin tiếp theo" disabled={index === tabs.length - 1} onClick={() => choose(index + 1)}><Icon name="chevron-right" /></button>}
    </div>
  );
}

function InfoTabBody({ k, files }: { k: string; files: Msg[] }) {
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
        <span>Tài khoản</span>
        <span className="seg" style={{ minWidth: 0 }}>
          <span className="conn-dot" style={{ "--conn": `var(--conn-${account.color})` } as React.CSSProperties} />
          <span className="od-truncate">
            {account.name} · {account.handle}
          </span>
        </span>
      </div>
      <div className="kv">
        <span>ID hội thoại</span>
        <span className="chat-id-value"><code>{chat.id}</code><button className="tool-btn icon-only" aria-label="Sao chép ID hội thoại" data-tip="Sao chép ID hội thoại" onClick={() => void navigator.clipboard.writeText(chat.id).then(() => toast("Đã sao chép ID hội thoại")).catch(fail)}><Icon name="copy" /></button></span>
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
            <span>Tệp gần đây</span>
            <button className="inspector-link" onClick={() => useApp.setState({ inspTab: "files" })}>
              Xem danh sách
            </button>
          </div>
          <p className="history-scope">{files.length} tệp và tin nhắn thoại trong lịch sử đã tải</p>
          {files
            .slice(-2)
            .reverse()
            .map((m) => <FileRow key={m.id} m={m} recent />)}
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

function MembersTabBody({ k }: { k: string }) {
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
  if (!files.length) return <div className="insp-empty"><Icon name="file-text" />Chưa có tệp nào trong phần lịch sử đã tải</div>;
  return (
    <>
      {[...files].reverse().map((m) => (
        <FileRow key={m.id} m={m} />
      ))}
    </>
  );
}

function FileRow({ m, recent = false }: { m: Msg; recent?: boolean }) {
  const dl = useDownload(m.accountId, m.media, false);
  const [playing, setPlaying] = useState(false);
  const label = fileActionLabel(m.media!, !!dl.path);
  const open = async () => {
    const { openPath, openUrl } = await import("../lib/bridge");
    if (m.media!.url) return void openUrl(m.media!.url);
    const p = dl.path || (await dl.get());
    if (p) {
      if (m.media!.kind === "voice") setPlaying(true);
      else openPath(p).catch(fail);
    } else toast("Chưa tải được tệp. Hãy thử lại.", "circle-alert");
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
          { icon: "download", label: "Lưu vào thư mục tải về", run: () => void ensure().then((p) => { if (p) void saveMedia(p, m.media!.name, false); }) },
          { icon: "download", label: "Lưu thành…", run: () => void ensure().then((p) => { if (p) void saveMedia(p, m.media!.name, true); }) },
          { icon: "message-square-text", label: "Tới tin nhắn", run: () => useApp.setState({ jumpTo: m.id }) },
        ],
      },
    });
  };
  const icon = m.media!.kind === "voice" ? "audio-lines" : "file-text";
  const actionIcon = m.media!.url ? "external-link" : m.media!.kind === "voice" ? "play" : dl.path ? "folder-open" : "download";
  return (
    <>
    {recent ? (
      <button className="recent-file" aria-label={label} data-tip={label} disabled={dl.state === "loading"} onClick={() => void open()} onContextMenu={menu}>
        <Icon name={icon} />
        <span className="od-field"><b>{m.media!.name}</b><small>{[fileSize(m.media!.size), hm(m.ts)].filter(Boolean).join(" · ")}</small></span>
        {dl.state === "loading" ? <span className="veil-spinner" /> : <Icon name={actionIcon} />}
      </button>
    ) : (
    <div className="file-row" onContextMenu={menu}>
      <span className="file-ic"><Icon name={icon} /></span>
      <span style={{ minWidth: 0 }}>
        <b>{m.media!.name}</b>
        <small>{[fileSize(m.media!.size), m.outgoing ? "Bạn" : m.senderName, hm(m.ts)].filter(Boolean).join(" · ")}</small>
      </span>
      <button className="tool-btn icon-only" aria-label={label} data-tip={label} disabled={dl.state === "loading"} onClick={() => void open()}>
        {dl.state === "loading" ? <span className="veil-spinner" /> : <Icon name={actionIcon} />}
      </button>
    </div>
    )}
    {playing && dl.path && <audio className="voice-audio" src={fileSrc(dl.path)} controls autoPlay />}
    </>
  );
}

function MediaTab({ imgs }: { imgs: Msg[] }) {
  if (!imgs.length) return <div className="insp-empty"><Icon name="image" />Chưa có ảnh hoặc video trong phần lịch sử đã tải</div>;
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
    else toast("Chưa tải được tệp. Hãy thử lại.", "circle-alert");
  };
  return (
    <figure
      role="button"
      tabIndex={0}
      aria-label={`Xem ${m.media!.kind === "video" ? "video" : "ảnh"} ${m.media!.name}`}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); void view(); } }}
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
      {src ? <img className="od-media" src={src} alt="" /> : <div className="media-ph"><Icon name={m.media!.kind === "video" ? "film" : "image"} /></div>}
      {m.media!.kind === "video" && <span className="media-video-mark" aria-hidden="true"><Icon name="play" /></span>}
      <figcaption>
        {(m.outgoing ? "Bạn" : m.senderName).split(" ").pop()} · {hm(m.ts)}
      </figcaption>
    </figure>
  );
}

function PinnedTabBody({ k }: { k: string }) {
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
  const marks = useApp(useShallow((s) => ({ unreadMark: s.unreadMark, fresh: s.fresh, threadSeen: s.threadSeen })));
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
  if (!rows.length) return <div className="insp-empty"><Icon name="message-circle-reply" />Chưa có luồng trả lời nào trong phần đã tải</div>;
  return (
    <div className="side-threads">
      {rows.map(({ root, replies, last }) => {
        const faces = [...new Map(replies.map((r) => [r.senderName, r])).values()].slice(0, 3);
        const unread = threadUnread(marks, k, root.threadId, replies);
        return (
          <button key={root.id} className={`side-thread${tabs.includes(threadTabKey(k, root.threadId)) ? " open" : ""}${unread ? " has-new" : ""}`} onClick={() => openThreadTab(k, root)}>
            <span className="hd">
              <b>{root.outgoing ? "Bạn" : root.senderName}</b>
              <time>{dayLabel(last).split(" · ")[0]} {hm(last)}</time>
            </span>
            <span className="tx">{plain(root.text) || root.media?.name}</span>
            <span className="meta">
              <span className="faces">{faces.map((f) => <PersonAvatar key={f.senderName} name={f.senderName} accountId={f.accountId} photo={f.senderPhoto} />)}</span>
              {replies.length} trả lời
              {unread > 0 && <b className="thread-new">· {unread} mới</b>}
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
  if (!topics.length) return <div className="insp-empty"><Icon name="hash" />Nhóm chưa có chủ đề</div>;
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

/** The tabs read their chat unguarded: render them only while it exists, so a chat
 *  deleted elsewhere (another Telegram app) unmounts them instead of crashing. */
const withChat = <P extends { k: string }>(Body: React.ComponentType<P>) =>
  function Gate(p: P) {
    return useApp((s) => !!s.chats[p.k]) ? <Body {...p} /> : null;
  };
const InfoTab = withChat(InfoTabBody);
const MembersTab = withChat(MembersTabBody);
const PinnedTab = withChat(PinnedTabBody);
