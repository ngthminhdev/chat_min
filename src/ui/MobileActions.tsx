import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { isMobile } from "../lib/mobile";
import { Icon, type IconName } from "./Icon";

/** Share the real action handlers with desktop, but give touch users a labeled sheet. */
export function MobileActions({ label, icon = "ellipsis", children, disabled = false }: { label: string; icon?: IconName; children: ReactNode; disabled?: boolean }) {
  const ref = useRef<HTMLDetailsElement>(null);
  const sheet = useRef<HTMLElement>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!isMobile || !open) return;
    const root = sheet.current;
    const frame = document.querySelector<HTMLElement>(".app-frame");
    const previous = document.activeElement as HTMLElement | null;
    const wasInert = frame?.hasAttribute("inert");
    frame?.setAttribute("inert", "");
    const buttons = () => [...(root?.querySelectorAll<HTMLButtonElement>("button:not(:disabled):not([aria-disabled=true])") ?? [])].filter(b => b.getClientRects().length);
    buttons()[0]?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault(); e.stopPropagation();
        if (ref.current) ref.current.open = false;
      } else if (e.key === "Tab") {
        const items = buttons(), first = items[0], last = items[items.length - 1];
        if (!first) return;
        if (!root?.contains(document.activeElement) || (e.shiftKey ? document.activeElement === first : document.activeElement === last)) {
          e.preventDefault(); (e.shiftKey ? last : first).focus();
        }
      }
    };
    document.addEventListener("keydown", key, true);
    return () => {
      document.removeEventListener("keydown", key, true);
      if (!wasInert) frame?.removeAttribute("inert");
      requestAnimationFrame(() => {
        if (document.activeElement === document.body || root?.contains(document.activeElement)) {
          (previous?.isConnected && previous !== document.body ? previous : ref.current?.querySelector<HTMLElement>("summary"))?.focus();
        }
      });
    };
  }, [open]);
  if (!isMobile) return <>{children}</>;
  const close = () => { if (ref.current) ref.current.open = false; };
  return (
    <details className="mobile-action-menu" ref={ref}
      onToggle={() => setOpen(!!ref.current?.open)}
      onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); ref.current?.querySelector<HTMLElement>("summary")?.focus(); } }}>
      <summary className="tool-btn icon-only" aria-label={label} aria-haspopup="dialog" aria-disabled={disabled}
        onClick={(e) => { if (disabled) e.preventDefault(); else (document.activeElement as HTMLElement | null)?.blur(); }}>
        <Icon name={icon} />
      </summary>
      {open && createPortal(<>
      <button type="button" className="mobile-sheet-backdrop" aria-label="Đóng menu" tabIndex={-1} onClick={close} />
      <section className="mobile-action-sheet" ref={sheet} role="dialog" aria-modal="true" aria-label={label}>
        <header><strong>{label}</strong><button type="button" className="tool-btn icon-only" aria-label="Đóng menu" onClick={close}><Icon name="x" /></button></header>
        <div className="mobile-action-items" onClick={(e) => {
          const button = (e.target as Element).closest<HTMLButtonElement>("button");
          if (button && !button.disabled && button.getAttribute("aria-disabled") !== "true") close();
        }}>{children}</div>
      </section>
      </>, document.body)}
    </details>
  );
}
