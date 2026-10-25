// Pure parser — node-safe (tests read the real CSS from disk and run this).
// The vite `?raw` import that feeds it in the app lives in ui/ThemeGrid.tsx.

export type ThemeSwatch = { bg: string; text: string; accent: string };

function varsOf(block: string): Partial<Record<"pane" | "text" | "blue", string>> {
  const out: Partial<Record<"pane" | "text" | "blue", string>> = {};
  for (const match of block.matchAll(/--(pane|text|blue):\s*([^;]+);/g)) {
    out[match[1] as "pane" | "text" | "blue"] = match[2].trim();
  }
  return out;
}

function toSwatch(vars: Partial<Record<"pane" | "text" | "blue", string>>): ThemeSwatch | null {
  return vars.pane && vars.text && vars.blue
    ? { bg: vars.pane, text: vars.text, accent: vars.blue }
    : null;
}

/**
 * Swatch colors per theme id. The default pair ships in tokens.css
 * (:root = "dark", body.light = "light"); the other palettes live in
 * themes.css as body[data-theme="…"] blocks.
 */
export function parseThemeSwatches(themesCss: string, tokensCss: string): Record<string, ThemeSwatch> {
  const out: Record<string, ThemeSwatch> = {};

  // tokens.css splits the defaults across `:root {}` (fonts/motion) and `:root, body {}` (colors)
  const rootVars: Partial<Record<"pane" | "text" | "blue", string>> = {};
  for (const match of tokensCss.matchAll(/^:root[^{]*\{([^}]*)\}/gm)) {
    Object.assign(rootVars, varsOf(match[1]));
  }
  const dark = toSwatch(rootVars);
  if (dark) {
    out.dark = dark;
    out["default-dark"] = dark;
  }
  const lightBlock = tokensCss.match(/^body\.light\s*\{([^}]*)\}/m);
  const light = lightBlock ? toSwatch(varsOf(lightBlock[1])) : null;
  if (light) out.light = light;

  // a block may carry several selectors (several ids share one declaration)
  for (const match of themesCss.matchAll(/body\[data-theme="[^"]+"\][^{]*\{([^}]*)\}/g)) {
    const swatch = toSwatch(varsOf(match[1]));
    if (!swatch) continue;
    const selectorList = match[0].slice(0, match[0].indexOf("{"));
    for (const id of selectorList.matchAll(/data-theme="([^"]+)"/g)) {
      out[id[1]] = swatch;
    }
  }
  return out;
}
