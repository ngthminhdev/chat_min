import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "../lib/bridge";
import { norm } from "../lib/format";
import { key, openChat, useApp } from "../store";
import { Icon } from "../ui/Icon";
import { startWizard } from "../views/Wizard";

type Contact = { id: string; name: string; photo: string };
export function ZaloContacts({ accountId }: { accountId: string }) {
  const [open, setOpen] = useState(false);
  const health = useApp(s => s.health[accountId]?.health);
  return <>
    <div className="zalo-account-actions">
      {health !== "ok" && <button type="button" className="tool-btn" onClick={() => startWizard(accountId)}><Icon name="qr-code" /> Kết nối Zalo</button>}
      <button type="button" className="tool-btn" disabled={health !== "ok"} onClick={() => setOpen(true)}><Icon name="message-square-text" /> Hội thoại mới</button>
    </div>
    {open && createPortal(<ContactDialog accountId={accountId} close={() => setOpen(false)} />, document.body)}
  </>;
}
function ContactDialog({ accountId, close }: { accountId: string; close: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [contacts, setContacts] = useState<Contact[]>();
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    ref.current?.showModal();
    let live = true;
    api.zaloContacts(accountId).then(rows => { if (live) setContacts(rows); }).catch(e => { if (live) setError(String(e)); });
    return () => { live = false; };
  }, [accountId]);
  const choose = async (contact: Contact) => {
    setBusy(true); setError("");
    try {
      const chat = await api.zaloOpenChat(accountId, contact.id);
      useApp.setState(s => ({ chats: { ...s.chats, [key(accountId, chat.id)]: chat } }));
      close(); void openChat(key(accountId, chat.id));
    } catch (e) { setError(String(e)); setBusy(false); }
  };
  const shown = contacts?.filter(c => norm(c.name).includes(norm(query)));
  return <dialog ref={ref} className="prompt-dialog zalo-contacts" aria-labelledby="zalo-contacts-title" onCancel={close} onClick={e => { if (e.target === e.currentTarget) { const r = e.currentTarget.getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) close(); } }}>
    <div className="zalo-contacts-heading"><h3 id="zalo-contacts-title">Hội thoại Zalo mới</h3><button className="tool-btn icon-only" type="button" aria-label="Đóng danh bạ" onClick={close}><Icon name="x" /></button></div>
    <input type="text" autoFocus aria-label="Tìm bạn Zalo" placeholder="Tìm trong danh bạ" value={query} onChange={e => setQuery(e.target.value)} />
    {error && <p className="field-error" role="alert">{error}</p>}
    <div className="zalo-contact-list" aria-busy={busy || !contacts}>
      {!contacts && !error ? <p className="r2-muted"><span className="veil-spinner" /> Đang tải danh bạ…</p> : shown?.length ? shown.map(c => <button type="button" key={c.id} className="zalo-contact-row" disabled={busy} onClick={() => void choose(c)}><Icon name="users" /><span>{c.name}</span><Icon name="chevron-right" /></button>) : <p className="r2-muted">Không có bạn khớp tìm kiếm.</p>}
    </div>
  </dialog>;
}
