// Builds the audit harness page (scripts/performance/audit.html) for the native audit app
// (tauri.audit.conf.json): the same fake-API benchmark, inside the real Tauri/WKWebView shell.
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const require = createRequire(new URL('../../package.json', import.meta.url));
const { build } = require('vite');
const react = require('@vitejs/plugin-react').default;
const root = fileURLToPath(new URL('.', import.meta.url));
await build({ configFile: false, root, base: './', plugins: [react()], resolve: { dedupe: ['react', 'react-dom'] }, define: { __APP_VERSION__: '"audit"' }, logLevel: 'warn',
  build: { outDir: fileURLToPath(new URL('../../dist-audit/', import.meta.url)), emptyOutDir: true, target: 'safari15', rollupOptions: { input: path.join(root, 'audit.html') } } });
