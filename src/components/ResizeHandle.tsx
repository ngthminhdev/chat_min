/** Drag to resize a dock; writes --left-w / --right-w on <body> live, like the design system demo. */
export function ResizeHandle({ side }: { side: "left" | "right" }) {
  return (
    <div
      className={`resize-handle vertical ${side}`}
      role="separator"
      aria-orientation="vertical"
      aria-label={side === "left" ? "Kéo để đổi độ rộng danh sách hội thoại" : "Kéo để đổi độ rộng chi tiết hội thoại"}
      onPointerDown={(e) => {
        const h = e.currentTarget;
        h.setPointerCapture(e.pointerId);
        document.body.classList.add("resizing");
        const move = (ev: PointerEvent) => {
          const w = side === "left" ? Math.min(420, Math.max(220, ev.clientX)) : Math.min(480, Math.max(280, innerWidth - ev.clientX));
          document.body.style.setProperty(side === "left" ? "--left-w" : "--right-w", `${w}px`);
        };
        const up = () => {
          document.body.classList.remove("resizing");
          h.removeEventListener("pointermove", move);
          h.removeEventListener("pointerup", up);
        };
        h.addEventListener("pointermove", move);
        h.addEventListener("pointerup", up);
      }}
    />
  );
}
