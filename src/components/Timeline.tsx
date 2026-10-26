import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type MutableRefObject, type ReactNode } from 'react';
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso';
import { afterPaint, timelinePosition, timelineTarget } from '../lib/timeline';
import { messageRenderKey } from '../lib/message-identity';
import { preferredScrollBehavior } from '../lib/motion';
import type { layoutMessages } from '../lib/message-layout';
import type { Msg } from '../lib/types';
import { useApp } from '../store';
import { api, isTauri } from '../lib/bridge';
import { JumpBottom } from './Conversation';

type Row = ReturnType<typeof layoutMessages>[number];
type Context = { header?: ReactNode; footer?: ReactNode; empty?: ReactNode };
const Header = ({ context }: { context?: Context }) => <div className="timeline-row timeline-edge">{context?.header}</div>;
const Footer = ({ context }: { context?: Context }) => <div className="timeline-row timeline-edge">{context?.footer}</div>;
const Empty = ({ context }: { context?: Context }) => <div className="timeline-row">{context?.empty}</div>;
const COMPONENTS = { Header, Footer, EmptyPlaceholder: Empty };
const itemKey = (_index: number, row: Row) => messageRenderKey(row.m);
export type TimelineHandle = { toMessage: (id: string) => boolean };
type Props = Context & {
  rows: Row[];
  box: MutableRefObject<HTMLDivElement | null>;
  renderRow: (row: Row, index: number) => ReactNode;
  onTop?: () => void;
  onBottom?: (bottom: boolean) => void;
  headerMessage?: Msg;
};

export function TimelineSkeleton() {
  return <div className="timeline-skeleton" role="status" aria-label="Đang tải hội thoại">
    {Array.from({ length: 6 }, (_, i) => <div key={i} className={`skeleton-row${i % 3 === 2 ? ' outgoing' : ''}`} aria-hidden="true"><i /><span><b /><b /></span></div>)}
  </div>;
}

/** Only viewport rows mount. The cheap shell gets a paint before any timeline work. */
export const Timeline = forwardRef<TimelineHandle, Props>(function Timeline({ rows, box, renderRow, onTop, onBottom, headerMessage, ...content }, ref) {
  const [ready, setReady] = useState(false);
  useEffect(() => afterPaint(() => setReady(true)), []);
  useEffect(() => {
    if (!ready || !isTauri) return;
    let frame = 0, previous = performance.now();
    const gaps: number[] = [];
    const sample = (now: number) => {
      gaps.push(now - previous); previous = now;
      if (gaps.length < 32) { frame = requestAnimationFrame(sample); return; }
      gaps.sort((a, b) => a - b);
      const average = gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length;
      void api.logJs(JSON.stringify({ event: 'timeline-frames', p95Ms: Math.round(gaps[30] * 10) / 10,
        maxMs: Math.round(gaps[31] * 10) / 10, over25Ms: gaps.filter(n => n > 25).length,
        averageMs: Math.round(average * 10) / 10, averageFps: Math.round(1000 / average * 10) / 10,
        mountedRows: box.current?.querySelectorAll('.msg').length ?? 0 })).catch(() => {});
    };
    frame = requestAnimationFrame(sample);
    return () => cancelAnimationFrame(frame);
  }, [ready, box]);
  const virtuoso = useRef<VirtuosoHandle>(null);
  const position = useRef<ReturnType<typeof timelinePosition>>();
  const keys = useMemo(() => rows.map(row => messageRenderKey(row.m)), [rows]);
  const current = useMemo(() => {
    const next = timelinePosition(position.current, keys); position.current = next; return next;
  }, [keys]);
  const stick = useRef(true), gesture = useRef(0);
  const interaction = useRef(0);
  const previousFirst = useRef(current.firstIndex);
  const restoringAnchor = useRef(false);
  const prependAnchor = useRef<{ id: string; top: number }>();
  if (previousFirst.current !== current.firstIndex) {
    // Group/day labels can change the old first row's height on prepend. Capture
    // one actual visible row before commit rather than relying on estimated sizes.
    const el = box.current;
    if (current.firstIndex < previousFirst.current && !stick.current && el) {
      const view = el.getBoundingClientRect();
      const nodes = [...el.querySelectorAll<HTMLElement>('.msg[id]')];
      const node = nodes.find(node => { const r = node.getBoundingClientRect(); return r.top >= view.top && r.bottom <= view.bottom; })
        ?? nodes.find(node => node.getBoundingClientRect().bottom > view.top);
      if (node) prependAnchor.current = { id: node.id, top: node.getBoundingClientRect().top - view.top };
    }
    previousFirst.current = current.firstIndex;
  }
  useLayoutEffect(() => {
    const anchor = prependAnchor.current;
    prependAnchor.current = undefined;
    if (!anchor) return;
    restoringAnchor.current = true;
    let frame = 0, count = 0;
    const version = interaction.current;
    const restore = () => {
      const el = box.current, node = document.getElementById(anchor.id);
      if (version !== interaction.current || stick.current || !el || !node) { restoringAnchor.current = false; return; }
      const delta = node.getBoundingClientRect().top - el.getBoundingClientRect().top - anchor.top;
      if (Math.abs(delta) > 0.5) el.scrollTop += delta;
      if (++count < 8) frame = requestAnimationFrame(restore);
      else restoringAnchor.current = false;
    };
    frame = requestAnimationFrame(restore);
    return () => { cancelAnimationFrame(frame); restoringAnchor.current = false; };
  }, [current.firstIndex, box]);
  const [away, setAway] = useState(false), [fresh, setFresh] = useState(0);
  const [target, setTarget] = useState('');
  const [jumpRequest, requestJump] = useState(0);
  const previousLast = useRef(keys[keys.length - 1]);
  const toLatest = useApp(s => s.toLatest);
  const seenLatest = useRef(toLatest);
  const resizeFrame = useRef(0);
  useEffect(() => () => cancelAnimationFrame(resizeFrame.current), []);
  const contentResized = () => {
    cancelAnimationFrame(resizeFrame.current);
    resizeFrame.current = requestAnimationFrame(() => {
      if (stick.current && !target) virtuoso.current?.scrollToIndex({ index: 'LAST', align: 'end', behavior: 'auto' });
    });
  };
  const toBottom = () => {
    interaction.current++;
    stick.current = true; setFresh(0); setTarget('');
    virtuoso.current?.scrollToIndex({ index: 'LAST', align: 'end', behavior: preferredScrollBehavior() === 'smooth' ? 'smooth' : 'auto' });
  };
  useImperativeHandle(ref, () => ({
    toMessage(id) {
      if (timelineTarget(rows, id) < 0 && (!headerMessage || timelineTarget([{ m: headerMessage }], id) < 0)) return false;
      interaction.current++; stick.current = false; setTarget(id); requestJump(n => n + 1); setAway(true); onBottom?.(false); return true;
    },
  }), [rows, onBottom, headerMessage]);
  useEffect(() => {
    if (!ready || !target) return;
    const index = timelineTarget(rows, target);
    if (index >= 0) virtuoso.current?.scrollToIndex({ index, align: 'center', behavior: 'auto' });
    else if (headerMessage && timelineTarget([{ m: headerMessage }], target) >= 0) virtuoso.current?.scrollTo({ top: 0, behavior: 'auto' });
    const timer = setTimeout(() => setTarget(''), 1600);
    return () => clearTimeout(timer);
    // A highlight outlives its one navigation command. History prepends and new
    // messages must not re-center the old quote while the reader is scrolling.
  }, [target, ready, jumpRequest]);
  useEffect(() => {
    const last = keys[keys.length - 1];
    if (previousLast.current && last !== previousLast.current && !stick.current) setFresh(n => n + 1);
    previousLast.current = last;
  }, [keys]);
  useEffect(() => {
    if (!ready || seenLatest.current === toLatest) return;
    seenLatest.current = toLatest; stick.current = true; setFresh(0); setTarget('');
    interaction.current++;
    virtuoso.current?.scrollToIndex({ index: 'LAST', align: 'end', behavior: 'auto' });
  }, [toLatest, ready]);
  const userGesture = () => { interaction.current++; gesture.current = Date.now() + 800; };
  const bottomChanged = (bottom: boolean) => {
    // Measurement/initial positioning must not count as the user leaving the bottom.
    if (!bottom && stick.current && Date.now() > gesture.current && !target) return;
    stick.current = bottom; setAway(!bottom); if (bottom) setFresh(0); onBottom?.(bottom);
  };
  const top = () => {
    if (restoringAnchor.current) return;
    const el = box.current;
    if (el && Date.now() < gesture.current && !stick.current && el.scrollTop < 200 && el.scrollHeight > el.clientHeight + 80) onTop?.();
  };
  return <div className="timeline" onWheelCapture={userGesture} onTouchMoveCapture={userGesture} onKeyDownCapture={userGesture} onPointerDownCapture={userGesture}>
    {!ready ? <TimelineSkeleton /> : <Virtuoso<Row, Context>
      ref={virtuoso}
      className="msgs virtual-scroller"
      style={{ height: '100%' }}
      data={rows}
      context={content}
      components={COMPONENTS}
      computeItemKey={itemKey}
      firstItemIndex={current.firstIndex}
      initialTopMostItemIndex={{ index: Math.max(0, rows.length - 1), align: 'end' }}
      defaultItemHeight={120}
      increaseViewportBy={{ top: 100, bottom: 60 }}
      followOutput={() => stick.current ? 'auto' : false}
      atBottomThreshold={80}
      atBottomStateChange={bottomChanged}
      totalListHeightChanged={contentResized}
      startReached={top}
      onScroll={top}
      scrollerRef={el => { box.current = el instanceof HTMLDivElement ? el : null; }}
      itemContent={(index, row) => <div className={`timeline-row${target && timelineTarget([row], target) === 0 ? ' flash' : ''}`}>{renderRow(row, index - current.firstIndex)}</div>}
    />}
    <JumpBottom away={away} fresh={fresh} onClick={toBottom} />
  </div>;
});
