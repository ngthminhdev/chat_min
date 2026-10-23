interface NavigationState {
  route: string;
  active: string | null;
  leftCollapsed: boolean;
  rightCollapsed: boolean;
  threadTabs: Record<string, { chatKey: string }>;
  viewer?: unknown;
  dialog?: unknown;
  forward?: unknown;
  pop?: unknown;
  palette?: unknown;
}

export function mobileConversationVisible(s: Pick<NavigationState, "route" | "active" | "leftCollapsed" | "rightCollapsed">): boolean {
  return s.route === "shell" && !!s.active && s.leftCollapsed && s.rightCollapsed;
}

export function getMobileBackTarget(s: NavigationState) {
  if (s.viewer) return "viewer";
  if (s.dialog) return "dialog";
  if (s.forward) return "forward";
  if (s.pop) return "pop";
  if (s.palette) return "palette";
  if (s.route === "wizard") return "wizard";
  if (s.route === "welcome") return "root";
  if (s.route !== "shell") return "page";
  if (!s.rightCollapsed && s.leftCollapsed && s.active) return "details";
  if (s.leftCollapsed && s.active && s.threadTabs[s.active]) return "thread";
  if (s.leftCollapsed && s.active) return "list";
  return "root";
}

/** Software keyboards keep Enter for line breaks; desktop keeps its existing shortcut. */
export const enterSubmits = (mobile: boolean, shift: boolean, composing: boolean) => !mobile && !shift && !composing;
