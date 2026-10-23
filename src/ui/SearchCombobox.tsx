import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { norm } from "../lib/format";
import { Icon } from "./Icon";

export interface SearchOption {
  value: string;
  label: string;
  detail: string;
  avatar: ReactNode;
}

/** Editable single-select. Focus stays in the input while navigating the list. */
export function SearchCombobox({ label, value, options, onChange, recent = false }: {
  label: string; value: string; options: SearchOption[]; onChange: (value: string) => void; recent?: boolean;
}) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const control = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const [active, setActive] = useState(0);
  const [listHeight, setListHeight] = useState(340);
  const selected = options.find((option) => option.value === value) ?? options[0];
  const words = norm(filter).trim().split(/\s+/).filter(Boolean);
  const filtered = options.filter((option) => words.every((word) => norm(`${option.label} ${option.detail}`).includes(word)));
  const index = Math.min(active, filtered.length - 1);
  useLayoutEffect(() => {
    if (!open) return;
    const resize = () => setListHeight(Math.max(80, Math.min(340, window.innerHeight - (control.current?.getBoundingClientRect().bottom ?? 0) - 84)));
    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, [open]);
  useEffect(() => {
    if (open) list.current?.querySelector(`[data-index="${index}"]`)?.scrollIntoView({ block: "nearest" });
  }, [open, index]);
  const choose = (option: SearchOption) => { onChange(option.value); setOpen(false); setFilter(""); };
  const expand = () => { setOpen(true); setFilter(""); setActive(Math.max(0, options.findIndex((option) => option.value === value))); };
  return (
    <div className="search-combobox" onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false); }}>
      <label htmlFor={id}>{label}</label>
      <div ref={control} className={`search-combobox-control${open ? " open" : ""}`}>
        <span className="search-combobox-avatar" aria-hidden="true">{selected?.avatar}</span>
        <div className="search-combobox-value">
          <input id={id} ref={input} role="combobox" aria-expanded={open} aria-controls={`${id}-list`} aria-autocomplete="list"
            aria-activedescendant={open && index >= 0 ? `${id}-option-${index}` : undefined}
            autoComplete="off" placeholder={`Tìm ${label.toLocaleLowerCase("vi-VN")}…`} value={open ? filter : selected?.label ?? ""}
            onFocus={expand} onClick={() => { if (!open) expand(); }}
            onChange={(e) => { setFilter(e.target.value); setActive(0); setOpen(true); }}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing) return;
              if (e.key === "Escape") { e.stopPropagation(); setOpen(false); setFilter(""); return; }
              if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault();
                if (!open) expand();
                else setActive(Math.max(0, Math.min(filtered.length - 1, index + (e.key === "ArrowDown" ? 1 : -1))));
              }
              if (open && (e.key === "Home" || e.key === "End")) { e.preventDefault(); setActive(e.key === "Home" ? 0 : Math.max(0, filtered.length - 1)); }
              if (open && e.key === "Enter") { e.preventDefault(); if (filtered[index]) choose(filtered[index]); }
            }} />
          <span className="search-combobox-detail">{open ? "Gõ để lọc danh sách" : selected?.detail}</span>
        </div>
        <button type="button" className="tool-btn icon-only" aria-label={`${open ? "Đóng" : "Mở"} danh sách ${label.toLocaleLowerCase("vi-VN")}`} tabIndex={-1}
          onMouseDown={(e) => e.preventDefault()} onClick={() => { if (open) setOpen(false); else { input.current?.focus(); expand(); } }}><Icon name="chevron-down" /></button>
      </div>
      {open && <div className="search-combobox-popup">
        <div className="search-combobox-caption">{filter ? `${filtered.length} kết quả` : recent ? "Hội thoại gần đây · mới nhất trước" : "Chọn tài khoản"}</div>
        <div id={`${id}-list`} ref={list} role="listbox" aria-label={label} className="search-combobox-list" style={{ maxHeight: listHeight }}>
          {filtered.map((option, i) => <div key={option.value} id={`${id}-option-${i}`} data-index={i} role="option" aria-selected={option.value === value}
            className={`search-combobox-option${i === index ? " highlighted" : ""}`} onMouseDown={(e) => e.preventDefault()} onClick={() => choose(option)}>
            <span aria-hidden="true">{option.avatar}</span><span className="search-combobox-copy"><strong>{option.label}</strong><small>{option.detail}</small></span>
            {option.value === value && <Icon name="check" />}
          </div>)}
          {!filtered.length && <p className="search-combobox-empty">Không tìm thấy. Thử tên khác.</p>}
        </div>
      </div>}
    </div>
  );
}
