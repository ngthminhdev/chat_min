import { Icon } from "../ui/Icon";
import type { Suggestion } from "../lib/types";

export interface ReplySuggestionsState {
  state: "loading" | "ok" | "err";
  items: Suggestion[];
  err?: string;
}

export function ReplySuggestions({ id, value, language, onRetry, onClose, onChoose }: {
  id: string;
  value: ReplySuggestionsState;
  language: string;
  onRetry: () => void;
  onClose: () => void;
  onChoose: (item: Suggestion) => void;
}) {
  const busy = value.state === "loading";
  return (
    <section className="ai-suggest" id={id} aria-labelledby={`${id}-title`}>
      <header className="ai-suggest-head">
        <Icon name="sparkles" />
        <div className="ai-suggest-heading">
          <strong id={`${id}-title`}>Gợi ý trả lời</strong>
          <span>{language} · {busy ? value.items.length ? "Đang tạo gợi ý mới…" : "Đang tạo gợi ý…" : "Chọn để điền vào ô soạn tin"}</span>
        </div>
        <div className="ai-suggest-tools">
          <button type="button" className="tool-btn icon-only" aria-label="Tạo lại gợi ý" data-tip={busy ? "Đang tạo gợi ý…" : "Tạo lại gợi ý"} aria-busy={busy} aria-disabled={busy} onClick={() => { if (!busy) onRetry(); }}>
            {busy ? <span className="veil-spinner" /> : <Icon name="refresh-cw" />}
          </button>
          <button type="button" className="tool-btn icon-only" aria-label="Đóng gợi ý" data-tip="Đóng gợi ý" data-kbd="Esc" onClick={onClose}>
            <Icon name="x" />
          </button>
        </div>
      </header>
      <div className="ai-suggest-status" role="status" aria-live="polite">
        {busy ? value.items.length ? "Đang tạo gợi ý mới. Bạn vẫn có thể chọn gợi ý hiện tại." : "Đang tạo gợi ý…" : value.state === "ok" && value.items.length ? `${value.items.length} gợi ý · Chưa gửi tin nhắn` : ""}
      </div>
      {value.state === "err" && (
        <div className="ai-suggest-error" role="alert">
          <span>Chưa tạo được gợi ý. Bấm tạo lại để thử lần nữa.</span>
          {value.err && <details><summary>Chi tiết lỗi</summary><p>{value.err}</p></details>}
        </div>
      )}
      <div className="ai-suggest-body" aria-busy={busy}>
        {value.items.length ? (
          <div className="ai-suggest-options">
            {value.items.map((item, i) => (
              <button type="button" key={`${i}-${item.reply}`} className="ai-chip" aria-label={`Dùng gợi ý ${i + 1}: ${item.reply}`} onClick={() => onChoose(item)}>
                <span className="ai-choice-index" aria-hidden="true">{i + 1}</span>
                <span className="ai-choice-copy"><span>{item.reply}</span>{item.meaning && <small>{item.meaning}</small>}</span>
              </button>
            ))}
          </div>
        ) : busy ? (
          <div className="ai-suggest-options" aria-hidden="true">
            {[0, 1, 2].map((i) => <div key={i} className="ai-suggest-skeleton"><span /><span /><span /></div>)}
          </div>
        ) : value.state === "ok" ? <p className="ai-suggest-empty">Chưa có gợi ý. Hãy tải thêm tin nhắn hoặc bấm tạo lại.</p> : null}
      </div>
    </section>
  );
}
