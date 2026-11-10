import type { Msg } from './types';

const sameDay = (a: Msg, b: Msg) => new Date(a.ts).toDateString() === new Date(b.ts).toDateString();
const together = (a: Msg | undefined, b: Msg | undefined) =>
  !!a && !!b && !a.deleted && !b.deleted && a.kind !== 'service' && b.kind !== 'service' &&
  a.senderId === b.senderId && a.outgoing === b.outgoing && sameDay(a, b) && Math.abs(a.ts - b.ts) < 5 * 60e3;
const tile = (m: Msg) => !!m.media && ['image', 'video'].includes(m.media.kind) && !['Sticker', 'GIF', 'Video tròn'].includes(m.media.name);
const ownMetadata = (m: Msg) => m.edited || m.status === 'sending' || m.status === 'failed' || !!m.reactions?.length || !!m.replyTo;
const albumNext = (a: Msg, b: Msg | undefined, unreadAt?: number) =>
  !!b && together(a, b) && tile(a) && tile(b) && !b.text && b.sort !== unreadAt &&
  !ownMetadata(a) && !ownMetadata(b) && a.status === b.status && a.threadId === b.threadId && a.mentionsMe === b.mentionsMe &&
  (a.albumId ? a.albumId === b.albumId : a.outgoing && !b.albumId && Math.abs(a.ts - b.ts) < 60e3);

/** Shared chronological layout for chat, topic and thread timelines. A later caption
 * starts its own bubble so every caption and its message actions stay associated. */
export function layoutMessages(messages: Msg[], unreadAt?: number) {
  const units: { m: Msg; album?: Msg[] }[] = [];
  for (let i = 0; i < messages.length;) {
    const m = messages[i++];
    const album = [m];
    while (albumNext(album[album.length - 1], messages[i], unreadAt)) album.push(messages[i++]);
    units.push({ m, album: album.length > 1 ? album : undefined });
  }
  return units.map((unit, i) => {
    const prev = units[i - 1];
    const prevEnd = prev?.album ? prev.album[prev.album.length - 1] : prev?.m;
    const next = units[i + 1]?.m;
    const end = unit.album ? unit.album[unit.album.length - 1] : unit.m;
    return {
      ...unit,
      newDay: !prevEnd || !sameDay(prevEnd, unit.m),
      first: !together(prevEnd, unit.m) || unit.m.sort === unreadAt,
      last: !together(end, next) || next?.sort === unreadAt,
    };
  });
}

/** Rough pixel height of a timeline row before it is measured. The virtualizer shifts scrollTop
 *  by (measured − estimate) for every row that first appears above the fold, so a flat guess
 *  made the list jump by the height of each photo while scrolling up. Calibrated on the demo
 *  at 13 px UI text; it only has to be close, the measurement still wins. */
export function estimateRowHeight(row: { m: Msg; album?: Msg[]; newDay?: boolean; first?: boolean }): number {
  const { m } = row;
  if (m.kind === 'service') return 40 + (row.newDay ? 44 : 0);
  let h = 46 + (row.first ? 24 : 0) + (row.newDay ? 44 : 0);
  if (m.text) {
    let lines = 0;
    for (const line of m.text.split('\n')) lines += Math.max(1, Math.ceil(line.length / 78));
    h += Math.min(lines, 60) * 20;
  }
  const media = m.media;
  if (row.album) h += Math.ceil(row.album.length / 2) * 182 - (m.text ? 0 : 20);
  else if (media?.kind === 'sticker' || media?.name === 'Sticker') h += 140;
  else if (media && (media.kind === 'image' || media.kind === 'video')) {
    // same box as Message.tsx fitWidth: 120–360 px wide, the whole picture shown
    const ratio = media.width > 0 && media.height > 0 ? media.height / media.width : 9 / 16;
    h += Math.round(Math.max(120, Math.min(360, 420 / ratio)) * ratio) - (m.text ? 0 : 20);
  } else if (media) h += 62;
  if (m.replyTo) h += 44;
  if (m.link) h += 96;
  return h;
}
