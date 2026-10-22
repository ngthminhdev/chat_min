import { AnimatePresence, motion } from "motion/react";
import { summarize } from "../ai";
import { EASE } from "../lib/motion";
import { useApp } from "../store";
import { Icon } from "../ui/Icon";

const close = (tab: string) =>
  useApp.setState((s) => {
    const { [tab]: _, ...summary } = s.summary;
    return { summary };
  });

/** Header button: summarize, or hide the summary that is showing. */
export function SummaryButton({ tab }: { tab: string }) {
  const cur = useApp((s) => s.summary[tab]);
  const unread = useApp((s) => s.chats[tab]?.unread ?? 0);
  return (
    <button
      className={`tool-btn icon-only${cur ? " active" : ""}`}
      aria-label="Tóm tắt bằng AI"
      aria-pressed={!!cur}
      data-tip={cur ? "Ẩn tóm tắt" : unread > 0 ? `Tóm tắt ${unread} tin chưa đọc` : "Tóm tắt đoạn chat"}
      onClick={() => (cur ? close(tab) : void summarize(tab))}
    >
      <Icon name="sparkles" />
    </button>
  );
}

/** Floating card under the header; bullets as the model wrote them. */
export function SummaryCard({ tab }: { tab: string }) {
  const cur = useApp((s) => s.summary[tab]);
  return (
    <AnimatePresence>
      {cur && (
        <motion.section
          className={`summary-card${cur.state === "err" ? " err" : ""}`}
          aria-label="Tóm tắt"
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.18, ease: EASE }}
        >
          <header>
            <Icon name="sparkles" />
            <strong>Tóm tắt</strong>
            <small>{cur.n} tin gần nhất</small>
            {cur.state !== "loading" && (
              <button className="tool-btn icon-only" aria-label="Tóm tắt lại" data-tip="Tóm tắt lại" onClick={() => void summarize(tab)}>
                <Icon name="refresh-cw" />
              </button>
            )}
            <button className="tool-btn icon-only" aria-label="Đóng tóm tắt" onClick={() => close(tab)}>
              <Icon name="x" />
            </button>
          </header>
          {cur.state === "loading" ? (
            <p className="tr-loading">Đang đọc đoạn chat…</p>
          ) : (
            <div className="summary-body">
              {cur.text.split("\n").filter((l) => l.trim()).map((l, i) =>
                /^\s*[•\-*]\s*/.test(l) ? <p key={i} className="bullet">{l.replace(/^\s*[•\-*]\s*/, "")}</p> : <p key={i} className="label">{l}</p>,
              )}
            </div>
          )}
        </motion.section>
      )}
    </AnimatePresence>
  );
}
