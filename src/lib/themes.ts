// Theme metadata generated from netherize_editor/config/themes.
export interface ThemeDef { id: string; label: string; base: "dark" | "light" }

export const THEMES: ThemeDef[] = [
  { id: "dark", label: "Bearded Arc", base: "dark" },
  { id: "light", label: "Min Light", base: "light" },
  { id: "aura-dark", label: "Aura Dark", base: "dark" },
  { id: "ayu-mirage", label: "Ayu Mirage", base: "dark" },
  { id: "bearded-arc-blueberry", label: "Bearded Arc Blueberry", base: "dark" },
  { id: "bearded-arc-eggplant", label: "Bearded Arc Eggplant", base: "dark" },
  { id: "bearded-arc-eolstorm", label: "Bearded Arc Eolstorm", base: "dark" },
  { id: "bearded-arc-reversed", label: "Bearded Arc Reversed", base: "dark" },
  { id: "bearded-solarized-dark", label: "Bearded Solarized", base: "dark" },
  { id: "bearded-solarized-light", label: "Bearded Solarized Light", base: "light" },
  { id: "bearded-solarized-reversed", label: "Bearded Solarized Reversed", base: "dark" },
  { id: "bearded-solarized", label: "Bearded Solarized", base: "dark" },
  { id: "catppuccin-mocha", label: "Catppuccin Mocha", base: "dark" },
  { id: "cyberpunk-neon", label: "Cyberpunk Neon", base: "dark" },
  { id: "default-dark", label: "Bearded Arc", base: "dark" },
  { id: "dracula", label: "Dracula", base: "dark" },
  { id: "gruv-box", label: "Gruvbox Soft", base: "dark" },
  { id: "monokai", label: "Monokai", base: "dark" },
  { id: "night-owl", label: "Night Owl", base: "dark" },
  { id: "nord-ford", label: "Nord Frost", base: "dark" },
  { id: "one-dark", label: "One Dark", base: "dark" },
  { id: "rose-milk", label: "Rose Milk", base: "light" },
  { id: "rose-pine", label: "Rose Pine", base: "dark" },
  { id: "sakura-pastel", label: "Sakura Pastel", base: "light" },
  { id: "slate-neutral-dark-schematic", label: "Slate Neutral Dark", base: "dark" },
  { id: "slate-neutral-dark", label: "Slate Neutral Dark", base: "dark" },
  { id: "soft-light", label: "Soft Light", base: "light" },
  { id: "tokyo-night", label: "Tokyo Night", base: "dark" },
  { id: "vscode-dark", label: "Vscode Dark", base: "dark" },
];

export const themeBase = (id: string): "dark" | "light" => THEMES.find((theme) => theme.id === id)?.base ?? "dark";
export const isThemeId = (id: string): boolean => THEMES.some((theme) => theme.id === id);
