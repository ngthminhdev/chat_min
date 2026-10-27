import { memo, useEffect, useState } from 'react';
import { createTextFormatter, plainHtml } from '../lib/format-worker-client';
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
  // Cold rows show escaped text at (near) final height. A skeleton resized every row
  // once the worker answered, and Virtuoso then shifted scrollTop under the reader.
  return <div className="tx" dangerouslySetInnerHTML={{ __html: html ?? plainHtml(text) }} />;
});
