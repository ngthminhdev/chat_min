export interface IslandAppearance {
  background: number[];
  foreground: number[];
  secondary: number[];
  accent: number[];
  border: number[];
  light: boolean;
}

/** Resolve actual semantic tokens, including color-mix/oklab/alpha, in the current WebKit. */
export function readIslandAppearance(): IslandAppearance {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Cannot resolve notification theme");
  const probe = document.createElement("span");
  probe.style.cssText = "position:fixed;visibility:hidden;pointer-events:none";
  document.body.appendChild(probe);
  const raw = (token: string) => {
    probe.style.color = `var(${token})`;
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = getComputedStyle(probe).color;
    ctx.fillRect(0, 0, 1, 1);
    return [...ctx.getImageData(0, 0, 1, 1).data].map((v) => v / 255);
  };
  try {
    const pane = raw("--pane");
    const window = raw("--window");
    const background = window.slice(0, 3).map((v, i) => v * window[3] + pane[i] * (1 - window[3]));
    const color = (token: string) => {
      const c = raw(token);
      return c.slice(0, 3).map((v, i) => v * c[3] + background[i] * (1 - c[3]));
    };
    return { background, foreground: color("--text"), secondary: color("--text-2"), accent: color("--accent"), border: color("--line-2"), light: background[0] * .2126 + background[1] * .7152 + background[2] * .0722 > .5 };
  } finally {
    probe.remove();
  }
}
