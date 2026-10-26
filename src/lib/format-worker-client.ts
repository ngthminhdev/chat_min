type FormatWorker = {
  postMessage: (message: { id: number; text: string }) => void;
  onmessage: ((event: MessageEvent<{ id: number; html: string }>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  terminate: () => void;
};
type Job = { id: number; text: string; listeners: Set<(html: string) => void> };
const plainHtml = (text: string) => '<p>' + text.replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[c]!).replace(/\n/g, '<br>') + '</p>';

/** One worker job at a time; rows that unmount while waiting never enter its queue. */
export function createTextFormatter(makeWorker: () => FormatWorker, onEngine?: (engine: 'worker' | 'plain') => void) {
  let worker: FormatWorker | undefined, failed = false, serial = 0, active: Job | undefined;
  let reported = false;
  let retained = 0;
  const cache = new Map<string, string>(), jobs = new Map<string, Job>();
  const remember = (text: string, html: string) => {
    if (text.length + html.length > 1_000_000) return;
    const old = cache.get(text);
    if (old !== undefined) retained -= text.length + old.length;
    cache.delete(text); cache.set(text, html); retained += text.length + html.length;
    while (cache.size > 256 || retained > 1_000_000) {
      const first = cache.keys().next().value!;
      retained -= first.length + cache.get(first)!.length; cache.delete(first);
    }
  };
  const finish = (job: Job, html: string) => {
    jobs.delete(job.text); remember(job.text, html);
    for (const listener of job.listeners) listener(html);
  };
  const fail = () => {
    if (!reported) { reported = true; onEngine?.('plain'); }
    failed = true; worker?.terminate(); worker = undefined; active = undefined;
    for (const job of [...jobs.values()]) finish(job, plainHtml(job.text));
  };
  const drain = () => {
    if (active || failed) return;
    for (const job of jobs.values()) {
      if (!job.listeners.size) { jobs.delete(job.text); continue; }
      active = job;
      try {
        if (!worker) {
          worker = makeWorker();
          worker.onmessage = ({ data }) => {
            if (!active || data.id !== active.id) return;
            if (!reported) { reported = true; onEngine?.('worker'); }
            const done = active; active = undefined;
            finish(done, data.html); drain();
          };
          worker.onerror = event => { event.preventDefault?.(); fail(); };
        }
        worker.postMessage({ id: job.id, text: job.text });
      } catch { fail(); }
      break;
    }
  };
  return {
    peek(text: string) {
      const html = cache.get(text);
      if (html !== undefined) { cache.delete(text); cache.set(text, html); }
      return html;
    },
    subscribe(text: string, listener: (html: string) => void) {
      const cached = cache.get(text);
      if (cached !== undefined) { listener(cached); return () => {}; }
      if (failed) { const html = plainHtml(text); remember(text, html); listener(html); return () => {}; }
      let job = jobs.get(text);
      if (!job) { job = { id: ++serial, text, listeners: new Set() }; jobs.set(text, job); }
      job.listeners.add(listener); drain();
      return () => { job.listeners.delete(listener); if (active !== job && !job.listeners.size) jobs.delete(text); };
    },
  };
}
