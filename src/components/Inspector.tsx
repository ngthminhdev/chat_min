import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { api, fileSrc } from "../lib/bridge";
import { fileSize, fmtCount, hm, norm, plain } from "../lib/format";
import { CAP_LABELS, CAP_OFF_NOTE, PLATFORMS, type Cap } from "../lib/platforms";
import type { Member, Msg } from "../lib/types";
import { capsOf, chatKeyOf, fail, useApp, type InspTab } from "../store";
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
    if (p) void openPath(p);
  };
  return (
    <div className="file-row">
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
  return (
    <figure onClick={() => useApp.setState({ jumpTo: m.id })}>
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
