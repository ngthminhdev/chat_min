import { motion } from "motion/react";
import { EASE } from "../lib/motion";
import { Glyph, Icon } from "../ui/Icon";
import { startWizard } from "./Wizard";

export function Welcome() {
  const item = (i: number) => ({ initial: { opacity: 0, y: 10 }, animate: { opacity: 1, y: 0 }, transition: { delay: 0.05 * i, duration: 0.32, ease: EASE } });
  return (
    <div className="welcome-view">
      <motion.div className="welcome-mark" {...item(0)}>
        <Icon name="messages-square" />
      </motion.div>
      <motion.span className="welcome-eyebrow" {...item(1)}>CHATMIN</motion.span>
      <motion.h1 {...item(2)}>
        Mọi cuộc trò chuyện.
        <br />
        Một nơi làm việc.
      </motion.h1>
      <motion.p {...item(3)}>
        Thêm tài khoản đầu tiên để bắt đầu.
        <br />
        Hội thoại công việc và cá nhân, trong cùng một ứng dụng.
      </motion.p>
      <motion.button type="button" className="tool-btn primary" onClick={() => startWizard()} {...item(4)}>
        Thêm tài khoản <kbd className="kbd">⌘N</kbd>
      </motion.button>
      <motion.div className="welcome-platforms" {...item(5)}>
        <span><Glyph platform="telegram" /> Telegram</span>
        <span><Glyph platform="gchat" /> Google Chat</span>
        <span><Glyph platform="messenger" /> Messenger</span>
        <span><Glyph platform="zalo" /> Zalo</span>
      </motion.div>
      <motion.small {...item(6)}>Tài khoản được quản lý riêng · Không trộn lịch sử hội thoại</motion.small>
    </div>
  );
}
