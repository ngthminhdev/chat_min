import { memo, useEffect, useState } from 'react';
import { createTextFormatter } from '../lib/format-worker-client';
import { api } from '../lib/bridge';
const formatter = createTextFormatter(
  () => new Worker(new URL('../lib/format.worker.ts', import.meta.url), { type: 'module' }),
  engine => { void api.logJs(JSON.stringify({ event: 'text-format', engine })).catch(() => {}); },
);

/** Rich text never parses or detects syntax on the UI thread, including cold history. */
export const FormattedText = memo(function FormattedText({ text }: { text: string }) {
  const [result, setResult] = useState(() => ({ text, html: formatter.peek(text) }));
  useEffect(() => formatter.subscribe(text, html => setResult({ text, html })), [text]);
  const html = result.text === text ? result.html : formatter.peek(text);
  return html === undefined
    ? <div className="tx text-skeleton" role="status" aria-label="Đang hiển thị nội dung"><span /><span /></div>
    : <div className="tx" dangerouslySetInnerHTML={{ __html: html }} />;
});
