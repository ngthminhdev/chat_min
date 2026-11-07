import { useEffect, useMemo, useState } from "react";
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
  const apply = () => {
    const [h = "0", mi = "0"] = time.split(":");
    onApply(toDateField(new Date(selected.y, selected.m, selected.d, Number(h), Number(mi)).getTime()));
  };

  // Capture phase: the editor form behind closes on Escape and submits on Enter.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Enter" && e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") onClose(); else apply();
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  });

  const inDays = (n: number) => dayOf(new Date(today.getFullYear(), today.getMonth(), today.getDate() + n));
  const presets: [string, Day][] = [["Hôm nay", inDays(0)], ["Ngày mai", inDays(1)], ["Tuần sau", inDays(7)]];

  return (
    <div className="modal" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="prompt-dialog dtp" role="dialog" aria-modal="true" aria-label={title}>
        <h3>{title}</h3>
        <div className="dtp-nav">
          <button type="button" className="tool-btn icon-only" aria-label="Tháng trước" onClick={() => shiftMonth(-1)}><Icon name="chevron-left" /></button>
          <span className="dtp-title">{MONTHS[view.m]} {view.y}</span>
          <button type="button" className="tool-btn icon-only" aria-label="Tháng sau" onClick={() => shiftMonth(1)}><Icon name="chevron-right" /></button>
        </div>
        <div className="dtp-grid">
          {WEEKDAYS.map(w => <span key={w} className="dtp-head">{w}</span>)}
          {cells.map((c, i) => (
            <button key={i} type="button" onClick={() => pick(c)}
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
          <button type="button" className="tool-btn primary" onClick={apply}><Icon name="check" /> Chọn</button>
        </div>
      </div>
    </div>
  );
}
