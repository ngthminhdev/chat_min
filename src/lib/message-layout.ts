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
