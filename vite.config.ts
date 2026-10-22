import { readFileSync } from "node:fs";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const version = readFileSync(new URL("./VERSION", import.meta.url), "utf8").trim();

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  define: { __APP_VERSION__: JSON.stringify(version) },
  server: {
    port: 1424,
    strictPort: true,
    // design-system CSS is symlinked from ../design-systems and pulls fonts from there
    fs: { allow: [".", "../design-systems"] },
    watch: { ignored: ["**/src-tauri/**", "**/spike/**", "**/design/**"] },
  },
  build: { target: "safari15" },
});
