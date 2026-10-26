import type { Media } from "./types";
import { fmtCount, norm } from "./format.ts";

export function mediaSection(media: Pick<Media, "kind"> | null): "files" | "media" | null {
  if (media?.kind === "image" || media?.kind === "video") return "media";
  if (media?.kind === "file" || media?.kind === "voice") return "files";
  return null;
}

export function fileActionLabel(media: Pick<Media, "name" | "url" | "kind">, downloaded: boolean): string {
  if (media.url) return `Mở ${media.name} trên Google Drive`;
  if (media.kind === "voice") return downloaded ? "Phát tin nhắn thoại" : "Tải và phát tin nhắn thoại";
  return `${downloaded ? "Mở" : "Tải và mở"} ${media.name}`;
}

/** An unexpanded preview is a lower bound once it reaches the 20-reply cap. */
export function threadReplyCountLabel(loaded: number, nextToken?: string): string {
  const more = nextToken === undefined ? loaded >= 20 : !!nextToken;
  return `${fmtCount(loaded)}${more ? "+" : ""}`;
}

/** Emoji + Vietnamese name + searchable aliases. First sixteen are quick reactions. */
export const EMOJI = [
  ["👍", "Đồng ý", "like thumbs up"], ["❤️", "Yêu thích", "heart love trái tim"],
  ["😂", "Cười ra nước mắt", "laugh vui"], ["😮", "Ngạc nhiên", "surprise"],
  ["😢", "Buồn", "sad khóc"], ["🙏", "Cảm ơn", "thank please cầu nguyện"],
  ["🔥", "Rất hay", "fire lửa"], ["👀", "Đang xem", "eyes mắt"],
  ["✅", "Hoàn tất", "done check xong"], ["💯", "Hoàn toàn đồng ý", "100 hundred"],
  ["🫡", "Đã rõ", "salute chào"], ["🎉", "Chúc mừng", "party celebration"],
  ["🤔", "Đang suy nghĩ", "thinking"], ["😅", "Cười ngượng", "sweat"],
  ["🚀", "Tiến lên", "rocket tên lửa"], ["👏", "Vỗ tay", "clap"],
  ["😀", "Vui vẻ", "happy smile"], ["😊", "Mỉm cười", "smile"],
  ["😍", "Rất thích", "love heart eyes"], ["🥰", "Thương mến", "love"],
  ["🤣", "Cười lăn", "laugh"], ["😭", "Khóc lớn", "cry sad"],
  ["🥹", "Xúc động", "touched"], ["🥺", "Năn nỉ", "please"],
  ["😎", "Tự tin", "cool kính"], ["🤩", "Hào hứng", "excited star"],
  ["🤗", "Ôm", "hug"], ["🤭", "Che miệng cười", "giggle"],
  ["🤫", "Giữ bí mật", "quiet shush"], ["😴", "Buồn ngủ", "sleep"],
  ["😔", "Thất vọng", "sad"], ["😤", "Bực mình", "frustrated"],
  ["😡", "Tức giận", "angry"], ["🤯", "Kinh ngạc", "mind blown"],
  ["😱", "Hoảng hốt", "shock"], ["😬", "Khó xử", "awkward"],
  ["🙄", "Đảo mắt", "eye roll"], ["🤷", "Không biết", "shrug"],
  ["🤦", "Bất lực", "facepalm"], ["💪", "Cố lên", "strong muscle"],
  ["👌", "Ổn", "ok okay"], ["👎", "Không đồng ý", "dislike thumbs down"],
  ["🤝", "Bắt tay", "handshake"], ["👋", "Xin chào", "hello bye tạm biệt"],
  ["✌️", "Chiến thắng", "peace victory"], ["🙌", "Hoan hô", "hooray"],
  ["🫶", "Quan tâm", "heart hands"], ["💔", "Đau lòng", "broken heart"],
  ["💖", "Trái tim lấp lánh", "love sparkle"], ["✨", "Lấp lánh", "sparkles"],
  ["⭐", "Ngôi sao", "star"], ["🌟", "Tỏa sáng", "star"],
  ["🎂", "Sinh nhật", "birthday cake bánh"], ["🎁", "Quà tặng", "gift"],
  ["🥳", "Ăn mừng", "party"], ["🏆", "Thành công", "trophy cúp"],
  ["💡", "Ý tưởng", "idea bulb"], ["📌", "Ghi nhớ", "pin"],
  ["⏳", "Đang chờ", "waiting hourglass"], ["☕", "Cà phê", "coffee"],
  ["🍀", "May mắn", "lucky"], ["🌈", "Cầu vồng", "rainbow"],
  ["🌻", "Hoa hướng dương", "flower"], ["🐱", "Mèo", "cat"],
] as const;

/** Telegram writes some emoji without the U+FE0F variation selector (❤ vs ❤️). */
export const bare = (e: string) => e.replace(/\uFE0F/g, "");

export function searchEmoji(query: string, list: readonly (readonly [string, string, string])[] = EMOJI) {
  const q = norm(query.trim());
  return list.filter((item) => norm(item.join(" ")).includes(q));
}

export function nextEmojiIndex(index: number, key: string, count: number, columns = 8): number {
  if (!count) return -1;
  const i = Math.max(0, Math.min(index, count - 1));
  switch (key) {
    case "ArrowRight": return (i + 1) % count;
    case "ArrowLeft": return (i + count - 1) % count;
    case "ArrowDown": return i + columns < count ? i + columns : i % columns;
    case "ArrowUp": return i >= columns ? i - columns : i + Math.floor((count - 1 - i) / columns) * columns;
    case "Home": return 0;
    case "End": return count - 1;
    default: return i;
  }
}
