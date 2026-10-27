import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type MutableRefObject, type ReactNode } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { afterPaint, timelineTarget } from '../lib/timeline';
import { messageRenderKey } from '../lib/message-identity';
import { preferredScrollBehavior } from '../lib/motion';
import type { layoutMessages } from '../lib/message-layout';
import type { Msg } from '../lib/types';
import { useApp } from '../store';
import { api, isTauri } from '../lib/bridge';
import { JumpBottom } from './Conversation';

type Row = ReturnType<typeof layoutMessages>[number];
export type TimelineHandle = { toMessage: (id: string) => boolean };
type Props = {
  rows: Row[];
  box: MutableRefObject<HTMLDivElement | null>;
  renderRow: (row: Row, index: number) => ReactNode;
  header?: ReactNode;
  footer?: ReactNode;
  empty?: ReactNode;
  onTop?: () => void;
  onBottom?: (bottom: boolean) => void;
  headerMessage?: Msg;
};

export function TimelineSkeleton() {
  return <div className="timeline-skeleton" role="status" aria-label="Đang tải hội thoại">
    {Array.from({ length: 6 }, (_, i) => <div key={i} className={`skeleton-row${i % 3 === 2 ? ' outgoing' : ''}`} aria-hidden="true"><i /><span><b /><b /></span></div>)}
  </div>;
}

function useEdgeHeight(ref: MutableRefObject<HTMLDivElement | null>, enabled: boolean) {
  const [height, setHeight] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!enabled || !el) return;
    const measure = () => setHeight(Math.ceil(el.getBoundingClientRect().height));
    measure(); const observer = new ResizeObserver(measure); observer.observe(el);
    return () => observer.disconnect();
  }, [ref, enabled]);
  return height;
}

/** The virtualizer owns measurement, reading anchors and following output.
 * A single prepend snapshot also preserves replies visible below a thread header. */
export const Timeline = forwardRef<TimelineHandle, Props>(function Timeline({ rows, box, renderRow, header, footer, empty, onTop, onBottom, headerMessage }, ref) {
  const [ready, setReady] = useState(false);
  useEffect(() => afterPaint(() => setReady(true)), []);
  const keys = useMemo(() => rows.map(row => messageRenderKey(row.m)), [rows]);
  const getItemKey = useCallback((index: number) => keys[index], [keys]);
  const headerRef = useRef<HTMLDivElement>(null), footerRef = useRef<HTMLDivElement>(null);
  const headerHeight = useEdgeHeight(headerRef, ready), footerHeight = useEdgeHeight(footerRef, ready);
  const stick = useRef(true), gesture = useRef(0);
  const previousKeys = useRef(keys), prependSnapshot = useRef<{ id: string; top: number }>();
  if (previousKeys.current[0] !== keys[0] && keys.includes(previousKeys.current[0]) && box.current) {
    const view = box.current.getBoundingClientRect();
    const anchor = [...box.current.querySelectorAll<HTMLElement>('[data-index] .msg')].find(el => el.getBoundingClientRect().top >= view.top);
    if (anchor) prependSnapshot.current = { id: anchor.id, top: anchor.getBoundingClientRect().top };
  }
  previousKeys.current = keys;
  const virtual = useVirtualizer<HTMLDivElement, HTMLDivElement>({
    count: rows.length,
    getScrollElement: () => box.current,
    getItemKey,
    estimateSize: () => 84,
    paddingStart: headerHeight,
    paddingEnd: footerHeight,
    anchorTo: 'end',
    followOnAppend: true,
    scrollEndThreshold: 2,
    overscan: 3,
    enabled: ready,
    directDomUpdates: true,
  });
  useLayoutEffect(() => {
    const snapshot = prependSnapshot.current; prependSnapshot.current = undefined;
    if (!snapshot || !box.current) return;
    const anchor = document.getElementById(snapshot.id);
    if (anchor) {
      const delta = anchor.getBoundingClientRect().top - snapshot.top;
      if (Math.abs(delta) > 1) virtual.scrollToOffset(box.current.scrollTop + delta);
    }
  });
  const setScroller = useCallback((el: HTMLDivElement | null) => { box.current = el; }, [box]);
  useLayoutEffect(() => { if (ready) virtual.scrollToEnd(); }, [ready, virtual]);

  const [away, setAway] = useState(false), [fresh, setFresh] = useState(0);
  const [target, setTarget] = useState('');
  const [jumpRequest, requestJump] = useState(0);
  const previousLast = useRef(keys[keys.length - 1]);
  const toLatest = useApp(s => s.toLatest), sent = useApp(s => s.sent);
  const probeScope = useApp(s => s.active);
  const seenLatest = useRef(toLatest), seenSent = useRef(sent);
  const toBottom = () => {
    stick.current = true; setFresh(0); setTarget('');
    virtual.scrollToEnd({ behavior: preferredScrollBehavior() === 'smooth' ? 'smooth' : 'auto' });
  };
  useImperativeHandle(ref, () => ({
    toMessage(id) {
      if (timelineTarget(rows, id) < 0 && (!headerMessage || timelineTarget([{ m: headerMessage }], id) < 0)) return false;
      virtual.cancelScroll(); stick.current = false; setTarget(id); requestJump(n => n + 1); setAway(true); onBottom?.(false); return true;
    },
  }), [rows, onBottom, headerMessage, virtual]);
  useEffect(() => {
    if (!ready || !target) return;
    const index = timelineTarget(rows, target);
    if (index >= 0) virtual.scrollToIndex(index, { align: 'center', behavior: 'auto' });
    else virtual.scrollToOffset(0, { behavior: 'auto' });
    const timer = setTimeout(() => setTarget(''), 1600);
    return () => clearTimeout(timer);
    // A highlight is not another navigation command when rows change.
  }, [target, ready, jumpRequest, virtual]);
  useEffect(() => {
    const last = keys[keys.length - 1];
    if (previousLast.current && last !== previousLast.current && !stick.current) setFresh(n => n + 1);
    previousLast.current = last;
  }, [keys]);
  useEffect(() => {
    if (!ready || seenLatest.current === toLatest) return;
    seenLatest.current = toLatest; stick.current = true; setFresh(0); setTarget(''); virtual.scrollToEnd();
  }, [toLatest, ready, virtual]);
  // my own send lands on the bottom wherever I had scrolled; incoming keeps the position
  useEffect(() => {
    if (!ready || seenSent.current === sent) return;
    seenSent.current = sent; stick.current = true; setFresh(0); setTarget(''); virtual.scrollToEnd();
  }, [sent, ready, virtual]);

  const userGesture = () => { gesture.current = Date.now() + 800; };
  const onScroll = () => {
    const el = box.current;
    if (!el) return;
    const distance = el.scrollHeight - el.clientHeight - el.scrollTop;
    const bottom = distance <= 2;
    stick.current = bottom; setAway(distance > 80);
    if (bottom) setFresh(0);
    onBottom?.(bottom);
    if (Date.now() < gesture.current && !bottom && el.scrollTop < 200 && el.scrollHeight > el.clientHeight + 80) onTop?.();
  };
  useEffect(() => {
    if (!ready || !isTauri) return;
    let frame = 0, previous = performance.now();
    const gaps: number[] = [];
    const sample = (now: number) => {
      gaps.push(now - previous); previous = now;
      if (gaps.length < 32) { frame = requestAnimationFrame(sample); return; }
      gaps.sort((a, b) => a - b);
      const average = gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length;
      void api.logJs(JSON.stringify({ event: 'timeline-frames', provider: useApp.getState().accounts.find(a => probeScope?.includes(a.id))?.platform ?? 'unknown', p95Ms: Math.round(gaps[30] * 10) / 10,
        maxMs: Math.round(gaps[31] * 10) / 10, over25Ms: gaps.filter(n => n > 25).length,
        averageMs: Math.round(average * 10) / 10, averageFps: Math.round(1000 / average * 10) / 10,
        mountedRows: box.current?.querySelectorAll('.msg').length ?? 0 })).catch(() => {});
    };
    frame = requestAnimationFrame(sample);
    return () => cancelAnimationFrame(frame);
  }, [ready, box, probeScope]);

  return <div className="timeline" onWheelCapture={userGesture} onTouchMoveCapture={userGesture} onKeyDownCapture={userGesture} onPointerDownCapture={userGesture}>
    {!ready ? <TimelineSkeleton /> : <div ref={setScroller} className="msgs virtual-scroller" style={{ height: '100%' }} onScroll={onScroll}>
      <div ref={virtual.containerRef} style={{ position: 'relative', width: '100%' }}>
        <div ref={headerRef} style={{ position: 'absolute', top: 0, left: 0, width: '100%' }}><div className="timeline-row timeline-edge">{header}{!rows.length && empty}</div></div>
        {virtual.getVirtualItems().map(item => {
          const index = item.index, row = rows[index];
          return <div key={item.key} ref={virtual.measureElement} data-index={item.index} style={{ position: 'absolute', top: 0, left: 0, width: '100%' }}>
            <div className={`timeline-row${target && timelineTarget([row], target) === 0 ? ' flash' : ''}`}>
              {renderRow(row, index)}
            </div>
          </div>;
        })}
        <div ref={footerRef} style={{ position: 'absolute', bottom: 0, left: 0, width: '100%' }}><div className="timeline-row timeline-edge">{footer}</div></div>
      </div>
    </div>}
    <JumpBottom away={away} fresh={fresh} onClick={toBottom} />
  </div>;
});
