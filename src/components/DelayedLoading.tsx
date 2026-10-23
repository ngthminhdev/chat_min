import { useEffect, useState } from "react";

/** Fast requests never flash a spinner; content itself is never delayed. */
export function DelayedLoading({ label }: { label: string }) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setVisible(true), 140);
    return () => clearTimeout(timer);
  }, []);
  return visible ? <div className="section-veil on" role="status"><span className="veil-spinner" /><span>{label}</span></div> : null;
}
