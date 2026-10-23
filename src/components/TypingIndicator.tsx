/** Same quiet rhythm in the compact sidebar and the message list. */
export function TypingIndicator({ label, compact = false }: { label: string; compact?: boolean }) {
  return <span className={`typing-indicator${compact ? " compact" : ""}`}>
    <span className="typing-copy">{label}</span>
    <span className="typing-dots" aria-hidden="true"><i /><i /><i /></span>
  </span>;
}
