import { useEffect, useMemo, useRef, useState } from "react";
import { fromDateField, toDateField } from "../lib/todos";
import { Icon } from "./Icon";

const MONTHS = ["Tháng 1", "Tháng 2", "Tháng 3", "Tháng 4", "Tháng 5", "Tháng 6", "Tháng 7", "Tháng 8", "Tháng 9", "Tháng 10", "Tháng 11", "Tháng 12"];
const WEEKDAYS = ["T2", "T3", "T4", "T5", "T6", "T7", "CN"];
/** Hour a task is due when only a day is picked. */
export const DEFAULT_HOUR = 18;

type Day = { y: number; m: number; d: number };
const sameDay = (a: Day, b: Day) => a.y === b.y && a.m === b.m && a.d === b.d;
const dayOf = (date: Date): Day => ({ y: date.getFullYear(), m: date.getMonth(), d: date.getDate() });

/** Themed calendar + time, same look as the other *_min apps. `value` is a local "YYYY-MM-DDTHH:mm" field or "". */
export function DateTimeModal({ title, value, onApply, onClose }: {
  title: string;
  value: string;
  onApply: (value: string) => void;
  onClose: () => void;
}) {
  const initial = fromDateField(value);
  const base = initial === null ? null : new Date(initial);
  const today = new Date();
  const [view, setView] = useState<Day>(dayOf(base ?? today));
  const [selected, setSelected] = useState<Day>(dayOf(base ?? today));
  const [time, setTime] = useState(base ? toDateField(initial!).slice(11) : `${DEFAULT_HOUR}:00`);

  const cells = useMemo(() => {
    const first = new Date(view.y, view.m, 1);
    const lead = (first.getDay() + 6) % 7; // Monday-first
    return Array.from({ length: 42 }, (_, i) => {
      const d = new Date(view.y, view.m, 1 - lead + i);
      return { ...dayOf(d), inMonth: d.getMonth() === view.m };
    });
  }, [view]);

  const shiftMonth = (delta: number) => setView(dayOf(new Date(view.y, view.m + delta, 1)));
  const pick = (day: Day) => { setSelected(day); setView(day); };
  const apply = (day: Day = selected) => {
    const [h = "0", mi = "0"] = time.split(":");
    onApply(toDateField(new Date(day.y, day.m, day.d, Number(h), Number(mi)).getTime()));
  };
  const dialog = useRef<HTMLDivElement>(null);
  const focusDay = useRef(false);

  // Focus lands on the selected day; closing returns it to whatever opened the picker.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    dialog.current?.querySelector<HTMLElement>(".dtp-day.selected")?.focus();
    return () => { if (opener?.isConnected) opener.focus(); };
  }, []);
  // keyboard moves keep focus on the newly selected day (also across months)
  useEffect(() => {
    if (!focusDay.current) return;
    focusDay.current = false;
    dialog.current?.querySelector<HTMLElement>(".dtp-day.selected")?.focus();
  }, [selected, view]);

  // Capture phase, so the editor form behind neither closes on Escape nor submits on Enter.
  //  Escape: close (focus goes back to the field that opened the picker).
  //  Enter on a day: choose that day. Enter on another button: that button (Huỷ, tháng trước…).
  //  Enter elsewhere (time field): choose the selected day and time.
  //  Arrows / PageUp / PageDown / Home / End on the grid move the selection; Tab stays inside.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const inside = !!target && !!dialog.current?.contains(target);
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onClose(); return; }
      if (e.key === "Tab" && dialog.current) {
        const items = [...dialog.current.querySelectorAll<HTMLElement>("button:not([disabled]):not([tabindex='-1']), input")];
        const first = items[0], last = items[items.length - 1];
        if (!inside) { e.preventDefault(); first?.focus(); }
        else if (e.shiftKey && target === first) { e.preventDefault(); last?.focus(); }
        else if (!e.shiftKey && target === last) { e.preventDefault(); first?.focus(); }
        return;
      }
      if (e.key === "Enter") {
        e.stopPropagation();
        if (inside && target!.classList.contains("dtp-day")) { e.preventDefault(); const i = Number(target!.dataset.index); apply(cells[i] ?? selected); return; }
        if (inside && target!.tagName === "BUTTON") return; // its own click runs
        e.preventDefault(); apply(); return;
      }
      if (!inside || !target!.classList.contains("dtp-day")) return;
      const step: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
      let next: Date | null = null;
      if (e.key in step) next = new Date(selected.y, selected.m, selected.d + step[e.key]);
      else if (e.key === "PageUp" || e.key === "PageDown") next = new Date(selected.y, selected.m + (e.key === "PageUp" ? -1 : 1), Math.min(selected.d, 28));
      else if (e.key === "Home" || e.key === "End") { const wd = (new Date(selected.y, selected.m, selected.d).getDay() + 6) % 7; next = new Date(selected.y, selected.m, selected.d + (e.key === "Home" ? -wd : 6 - wd)); }
      if (!next) return;
      e.preventDefault(); e.stopPropagation();
      focusDay.current = true;
      pick(dayOf(next));
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  });

  const inDays = (n: number) => dayOf(new Date(today.getFullYear(), today.getMonth(), today.getDate() + n));
  const presets: [string, Day][] = [["Hôm nay", inDays(0)], ["Ngày mai", inDays(1)], ["Tuần sau", inDays(7)]];

  return (
    <div className="modal" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="prompt-dialog dtp" role="dialog" aria-modal="true" aria-label={title} ref={dialog}>
        <h3>{title}</h3>
        <div className="dtp-nav">
          <button type="button" className="tool-btn icon-only" aria-label="Tháng trước" onClick={() => shiftMonth(-1)}><Icon name="chevron-left" /></button>
          <span className="dtp-title">{MONTHS[view.m]} {view.y}</span>
          <button type="button" className="tool-btn icon-only" aria-label="Tháng sau" onClick={() => shiftMonth(1)}><Icon name="chevron-right" /></button>
        </div>
        <div className="dtp-grid" role="grid" aria-label={`${MONTHS[view.m]} ${view.y} — mũi tên để đổi ngày, Enter để chọn`}>
          {WEEKDAYS.map(w => <span key={w} className="dtp-head">{w}</span>)}
          {cells.map((c, i) => (
            <button key={i} type="button" data-index={i} onClick={() => pick(c)}
              tabIndex={sameDay(c, selected) ? 0 : -1}
              aria-selected={sameDay(c, selected)}
              aria-label={`${c.d} ${MONTHS[c.m]} ${c.y}${sameDay(c, dayOf(today)) ? " (hôm nay)" : ""}`}
              className={`dtp-day${c.inMonth ? "" : " muted"}${sameDay(c, selected) ? " selected" : ""}${sameDay(c, dayOf(today)) ? " today" : ""}`}>
              {c.d}
            </button>
          ))}
        </div>
        <div className="dtp-time">
          <input type="time" aria-label="Giờ" value={time} onChange={e => setTime(e.target.value)} />
          <span />
          {presets.map(([label, day]) => (
            <button key={label} type="button" className={`tool-btn${sameDay(day, selected) ? " active" : ""}`} onClick={() => pick(day)}>{label}</button>
          ))}
        </div>
        <div className="prompt-dialog-foot">
          <button type="button" className="tool-btn" onClick={onClose}>Huỷ</button>
          <button type="button" className="tool-btn primary" onClick={() => apply()}><Icon name="check" /> Chọn</button>
        </div>
      </div>
    </div>
  );
}
