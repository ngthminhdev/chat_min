// User folders: "Work", "Family"… as a tab strip over the sidebar (Telegram-style). A folder
// holds chats from any account; its tab shows the folder's unread count. Tabs reorder by drag,
// right-click renames, recolours, sets an emoji or image icon, or deletes.
import { Reorder } from "motion/react";
import { fileSrc, pickFile } from "../lib/bridge";
import { fuzzy, norm } from "../lib/format";
import type { Folder } from "../lib/types";
import { confirmDialog, promptDialog, toast, useApp, type MenuItem } from "../store";
import { Icon } from "../ui/Icon";
import { ChatRow, rowProps, useRowState } from "./Sidebar";

const set = useApp.setState;
const patch = (id: string, p: Partial<Folder>) => set((s) => ({ folders: s.folders.map((f) => (f.id === id ? { ...f, ...p } : f)) }));

export function addFolder(name: string, chats: string[] = []) {
  const id = `f${Date.now().toString(36)}`;
  set((s) => ({ folders: [...s.folders, { id, name, color: "blue", icon: "", chats }], folder: id }));
}

/** The folder's icon slot: emoji, picked image, or a dot in its colour. */
function FolderIcon({ f }: { f: Folder }) {
  if (f.icon.startsWith("img:")) return <img className="folder-img" src={fileSrc(f.icon.slice(4))} alt="" />;
  if (f.icon) return <span className="folder-emoji">{f.icon}</span>;
  return <span className="conn-dot" />;
}

function folderMenu(f: Folder, at: { x: number; y: number; top: number }): MenuItem[] {
  return [
    { icon: "pencil", label: "Đổi tên", run: () => promptDialog("Tên thư mục", f.name, (v) => v.trim() && patch(f.id, { name: v.trim() })) },
    { icon: "palette", label: "Màu", run: () => set({ pop: { kind: "color", ...at, value: f.color, onPick: (color) => patch(f.id, { color }) } }) },
    { icon: "smile", label: "Icon emoji", run: () => set({ pop: { kind: "emoji", ...at, onPick: (icon) => patch(f.id, { icon }) } }) },
    { icon: "image", label: "Icon ảnh…", run: () => void pickFile([{ name: "Ảnh", extensions: ["png", "jpg", "jpeg", "webp", "svg"] }]).then((p) => p && patch(f.id, { icon: `img:${p}` })) },
    ...(f.icon ? [{ icon: "x" as const, label: "Bỏ icon", run: () => patch(f.id, { icon: "" }) }] : []),
    { icon: "trash-2", label: "Xoá thư mục", danger: true, run: () => confirmDialog("Xoá thư mục", `Xoá "${f.name}"? Các hội thoại vẫn còn, chỉ mất nhóm.`, "Xoá", () => set((s) => ({ folders: s.folders.filter((x) => x.id !== f.id), folder: s.folder === f.id ? "" : s.folder }))) },
  ];
}

export function FolderTabs() {
  const folders = useApp((s) => s.folders);
  const active = useApp((s) => s.folder);
  const chats = useApp((s) => s.chats);
  if (!folders.length) return null;
  const unread = (f: Folder) => f.chats.reduce((n, k) => n + (chats[k] && !chats[k].muted ? chats[k].unread : 0), 0);
  return (
    <div className="folder-tabs" role="tablist" aria-label="Thư mục">
      <button role="tab" aria-selected={!active} className={`folder-tab${active ? "" : " active"}`} onClick={() => set({ folder: "" })}>
        <span>Tất cả</span>
      </button>
      <Reorder.Group axis="x" as="div" className="folder-tab-list" values={folders.map((f) => f.id)} onReorder={(ids) => set((s) => ({ folders: ids.map((id) => s.folders.find((f) => f.id === id)!) }))}>
        {folders.map((f) => {
          const n = unread(f);
          return (
            <Reorder.Item key={f.id} value={f.id} as="div" className="folder-tab-item" whileDrag={{ scale: 1.04, zIndex: 5 }}>
              <button
                role="tab"
                aria-selected={active === f.id}
                className={`folder-tab${active === f.id ? " active" : ""}`}
                style={{ "--conn": `var(--conn-${f.color})` } as React.CSSProperties}
                data-tip={`${f.chats.length} hội thoại · chuột phải để sửa`}
                onClick={() => set({ folder: active === f.id ? "" : f.id })}
                onContextMenu={(e) => { e.preventDefault(); set({ pop: { kind: "menu", x: e.clientX, y: e.clientY, top: e.clientY, title: f.name, items: folderMenu(f, { x: e.clientX, y: e.clientY, top: e.clientY }) } }); }}
              >
                <FolderIcon f={f} />
                <span>{f.name}</span>
                {n > 0 && <span className="badge unread">{n > 99 ? "99+" : n}</span>}
              </button>
            </Reorder.Item>
          );
        })}
      </Reorder.Group>
      <button className="folder-tab folder-add" aria-label="Thư mục mới" data-tip="Thư mục mới" onClick={() => { promptDialog("Tên thư mục mới", "", (v) => v.trim() && addFolder(v.trim())); }}>
        <Icon name="plus" />
      </button>
    </div>
  );
}

/** The selected folder's chats as one flat list, newest activity first. */
export function FolderChats() {
  const f = useApp((s) => s.folders.find((x) => x.id === s.folder));
  const chats = useApp((s) => s.chats);
  const accounts = useApp((s) => s.accounts);
  const filter = useApp((s) => s.filter);
  const q = norm(useApp((s) => s.query));
  const rs = useRowState();
  if (!f) return null;
  const list = f.chats
    .filter((k) => chats[k])
    .map((k) => chats[k])
    .filter((c) => (!q || fuzzy(q, c.title) > 0) && (filter === "all" || (filter === "unread" ? c.unread > 0 : c.mention)))
    .sort((a, b) => b.lastTs - a.lastTs);
  if (!list.length) {
    return (
      <div className="side-empty">
        {f.chats.length ? "Không có hội thoại khớp bộ lọc." : <>Thư mục trống.<br />Chuột phải một hội thoại → "Thêm vào {f.name}".</>}
      </div>
    );
  }
  return (
    <div className="acc-chats folder-chats">
      {list.map((c) => {
        const k = `${c.accountId}|${c.id}`;
        const a = accounts.find((x) => x.id === c.accountId);
        return (
          <div key={k} className="reorder-row" style={{ "--conn": `var(--conn-${a?.color ?? "blue"})` } as React.CSSProperties}>
            <ChatRow chat={c} k={k} platform={a?.platform} {...rowProps(k, c, a, rs)} />
          </div>
        );
      })}
    </div>
  );
}

/** Chat context menu: one line per folder (add/remove), plus "new folder with this chat". */
export function folderItems(k: string): MenuItem[] {
  const { folders } = useApp.getState();
  return [
    ...folders.map((f): MenuItem => {
      const has = f.chats.includes(k);
      return {
        icon: has ? "check" : "folder",
        label: has ? `Bỏ khỏi ${f.name}` : `Thêm vào ${f.name}`,
        run: () => { patch(f.id, { chats: has ? f.chats.filter((x) => x !== k) : [...f.chats, k] }); toast(has ? `Đã bỏ khỏi ${f.name}` : `Đã thêm vào ${f.name}`, "folder"); },
      };
    }),
    { icon: "folder-plus", label: "Thư mục mới với hội thoại này…", run: () => promptDialog("Tên thư mục mới", "", (v) => { if (v.trim()) { addFolder(v.trim(), [k]); toast(`Đã tạo ${v.trim()}`, "folder"); } }) },
  ];
}

