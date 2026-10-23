export function queueToast<T extends { icon: string }>(current: T[], next: T): T[] {
  const stack = [...current, next];
  if (stack.length <= 3) return stack;
  const routine = stack.findIndex(item => item.icon !== "circle-alert");
  return stack.filter((_, i) => i !== (routine < 0 ? 0 : routine));
}
