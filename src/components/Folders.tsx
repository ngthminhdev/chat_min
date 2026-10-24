// User folders: "Work", "Friends"… as collapsible groups in the sidebar, next to the pinned
// and account groups. A folder holds chats from any account (those leave their account
// group, like pinned ones do). Groups drag to reorder; right-click the header to rename,
// recolour, set an emoji or image icon, or delete.
import { Reorder, useDragControls } from "motion/react";
import { fileSrc, pickFile } from "../lib/bridge";
import { fuzzy, norm } from "../lib/format";
import type { Folder } from "../lib/types";
import { confirmDialog, promptDialog, toast, useApp, type MenuItem } from "../store";
import { Icon } from "../ui/Icon";
import { ChatRow, rowProps, useRowState } from "./Sidebar";

const set = useApp.setState;
const patch = (id: string, p: Partial<Folder>) => set((s) => ({ folders: s.folders.map((f) => (f.id === id ? { ...f, ...p } : f)) }));

export function addFolder(name: string, chats: string[] = []) {
  set((s) => ({ folders: [...s.folders, { id: `f${Date.now().toString(36)}`, name, color: "blue", icon: "", chats }] }));
}

/** Chats that live in some folder: they are listed there, not under their account. */
export const inFolders = (folders: Folder[]) => new Set(folders.flatMap((f) => f.chats));

function FolderIcon({ f }: { f: Folder }) {
  if (f.icon.startsWith("img:")) return <img className="folder-img" src={fileSrc(f.icon.slice(4))} alt="" />;
  if (f.icon) return <span className="folder-emoji">{f.icon}</span>;
  return <Icon name="folder" className="fav-ic" />;
}

function folderMenu(f: Folder, at: { x: number; y: number; top: number }): MenuItem[] {
  return [
    { icon: "pencil", label: "Đổi tên", run: () => promptDialog("Tên thư mục", f.name, (v) => v.trim() && patch(f.id, { name: v.trim() })) },
    { icon: "palette", label: "Màu", run: () => set({ pop: { kind: "color", ...at, value: f.color, onPick: (color) => patch(f.id, { color }) } }) },
    { icon: "smile", label: "Icon emoji", run: () => set({ pop: { kind: "emoji", ...at, onPick: (icon) => patch(f.id, { icon }) } }) },
    { icon: "image", label: "Icon ảnh…", run: () => void pickFile([{ name: "Ảnh", extensions: ["png", "jpg", "jpeg", "webp", "svg"] }]).then((p) => p && patch(f.id, { icon: `img:${p}` })) },
    ...(f.icon ? [{ icon: "x" as const, label: "Bỏ icon", run: () => patch(f.id, { icon: "" }) }] : []),
    { icon: "folder-plus", label: "Thư mục mới", run: () => promptDialog("Tên thư mục mới", "", (v) => v.trim() && addFolder(v.trim())) },
    { icon: "trash-2", label: "Xoá thư mục", danger: true, run: () => confirmDialog("Xoá thư mục", `Xoá "${f.name}"? Các hội thoại về lại nhóm tài khoản của chúng.`, "Xoá", () => set((s) => ({ folders: s.folders.filter((x) => x.id !== f.id) }))) },
  ];
}

export function FolderGroups() {
  const folders = useApp((s) => s.folders);
  if (!folders.length) return null;
  return (
    <Reorder.Group axis="y" as="div" values={folders.map((f) => f.id)} onReorder={(ids) => set((s) => ({ folders: ids.map((id) => s.folders.find((f) => f.id === id)!) }))}>
      {folders.map((f) => <FolderGroup key={f.id} f={f} />)}
    </Reorder.Group>
  );
}

function FolderGroup({ f }: { f: Folder }) {
  const chats = useApp((s) => s.chats);
  const accounts = useApp((s) => s.accounts);
  const filter = useApp((s) => s.filter);
  const q = norm(useApp((s) => s.query));
  const collapsed = useApp((s) => !!s.collapsed[f.id]) && !q;
  const rs = useRowState();
  const drag = useDragControls();
  const live = f.chats.filter((k) => chats[k]).map((k) => chats[k]);
  const shown = live
    .filter((c) => (!q || fuzzy(q, c.title) > 0) && (filter === "all" || (filter === "unread" ? c.unread > 0 : c.mention)))
    .sort((a, b) => b.lastTs - a.lastTs);
  const unread = live.filter((c) => !c.muted).reduce((n, c) => n + c.unread, 0);
  const menu = (e: React.MouseEvent) => {
    e.preventDefault();
    set({ pop: { kind: "menu", x: e.clientX, y: e.clientY, top: e.clientY, title: f.name, items: folderMenu(f, { x: e.clientX, y: e.clientY, top: e.clientY }) } });
  };
  return (
    <Reorder.Item
      value={f.id}
      as="div"
      dragListener={false}
      dragControls={drag}
      className={`acc-group folder-group${collapsed ? " collapsed" : ""}`}
      style={{ "--conn": `var(--conn-${f.color})` } as React.CSSProperties}
      whileDrag={{ scale: 1.01, boxShadow: "var(--shadow)", zIndex: 5 }}
    >
      <button
        className="acc-head"
        aria-label={`Thư mục ${f.name}${unread ? ` · ${unread} chưa đọc` : ""}`}
        aria-expanded={!collapsed}
        data-tip={`${live.length} hội thoại · chuột phải để sửa`}
        onClick={() => set((s) => ({ collapsed: { ...s.collapsed, [f.id]: !collapsed } }))}
        onContextMenu={menu}
      >
        <Icon name="chevron-down" className="chev" />
        <span className="conn-dot" />
        <FolderIcon f={f} />
        <span className="acc-name">{f.name}</span>
        {unread > 0 && <span className="badge">{unread}</span>}
        <span className="grip" aria-label="Kéo để đổi chỗ thư mục" data-tip="Kéo để đổi chỗ" onPointerDown={(e) => { e.preventDefault(); drag.start(e); }}>
          <Icon name="ellipsis" />
        </span>
      </button>
      {!collapsed && (
        <div className="acc-chats">
          {shown.length ? shown.map((c) => {
            const k = `${c.accountId}|${c.id}`;
            const a = accounts.find((x) => x.id === c.accountId);
            return (
              <div key={k} className="reorder-row" style={{ "--conn": `var(--conn-${a?.color ?? "blue"})` } as React.CSSProperties}>
                <ChatRow chat={c} k={k} platform={a?.platform} {...rowProps(k, c, a, rs)} />
              </div>
            );
          }) : (
            <div className="side-empty">{live.length ? "Không có hội thoại khớp bộ lọc." : <>Trống. Chuột phải một hội thoại → "Thêm vào {f.name}".</>}</div>
          )}
        </div>
      )}
    </Reorder.Item>
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
        run: () => {
          // a chat sits in one folder at a time
          set((s) => ({ folders: s.folders.map((x) => (x.id === f.id ? { ...x, chats: has ? x.chats.filter((c) => c !== k) : [...x.chats, k] } : { ...x, chats: x.chats.filter((c) => c !== k) })) }));
          toast(has ? `Đã bỏ khỏi ${f.name}` : `Đã thêm vào ${f.name}`, "folder");
        },
      };
    }),
    { icon: "folder-plus", label: "Thư mục mới với hội thoại này…", run: () => promptDialog("Tên thư mục mới", "", (v) => { if (v.trim()) { set((s) => ({ folders: s.folders.map((x) => ({ ...x, chats: x.chats.filter((c) => c !== k) })) })); addFolder(v.trim(), [k]); toast(`Đã tạo ${v.trim()}`, "folder"); } }) },
  ];
}
