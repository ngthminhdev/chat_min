import themesCss from "../styles/themes.css?raw";
import tokensCss from "../styles/tokens.css?raw";
import { THEMES } from "../lib/themes";
import { parseThemeSwatches } from "../lib/themeSwatches";

// probed once at module load — swatches can never drift from the real palettes
const SWATCHES = parseThemeSwatches(themesCss, tokensCss);
// "default-dark" is a saved-ID alias of "dark" (Bearded Arc) — one chip is enough
const VISIBLE = THEMES.filter((theme) => theme.id !== "default-dark");

/** Chip grid with live swatches — the theme picker opened from ⌘K. `value` "" = default dark. */
export function ThemeGrid({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const current = value || "dark";
  return (
    <div className="theme-grid" role="listbox" aria-label="Giao diện">
      {(["dark", "light"] as const).map((base) => (
        <div key={base} className="theme-grid-base">
          <div className="theme-grid-group">{base === "dark" ? "Tối" : "Sáng"}</div>
          <div className="theme-grid-chips">
            {VISIBLE.filter((theme) => theme.base === base).map((theme) => {
              const swatch = SWATCHES[theme.id];
              return (
                <button
                  key={theme.id}
                  type="button"
                  role="option"
                  aria-selected={theme.id === current}
                  className={`theme-chip ${theme.id === current ? "active" : ""}`}
                  onClick={() => onChange(theme.id === "dark" ? "" : theme.id)}
                >
                  <span className="theme-swatch" style={{ background: swatch?.bg }}>
                    <span style={{ background: swatch?.accent }} />
                    <span style={{ background: swatch?.text }} />
                  </span>
                  <span className="theme-chip-label">{theme.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
