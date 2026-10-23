export type BackgroundMode = "solid" | "glass" | "clear";

/** Normalize old or damaged local preferences; never fade the window's content. */
export function windowAppearance(prefs: { backgroundMode?: unknown; backgroundTransparency?: unknown }, reduced = false) {
  const mode: BackgroundMode = reduced ? "solid"
    : prefs.backgroundMode === "solid" || prefs.backgroundMode === "clear" ? prefs.backgroundMode : "glass";
  const value = prefs.backgroundTransparency;
  const transparency = typeof value === "number" && Number.isFinite(value) ? Math.round(Math.max(0, Math.min(100, value))) : 35;
  return { mode, transparency };
}
