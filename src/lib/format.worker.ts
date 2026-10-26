import { esc, fmt } from './format';
const scope = self as unknown as {
  onmessage: (event: MessageEvent<{ id: number; text: string }>) => void;
  postMessage: (message: { id: number; html: string }) => void;
};
scope.onmessage = ({ data }) => {
  let html: string;
  try { html = fmt(data.text); } catch { html = '<p>' + esc(data.text).replace(/\n/g, '<br>') + '</p>'; }
  scope.postMessage({ id: data.id, html });
};
