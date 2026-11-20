import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * iOS fetches the home screen icon in a separate process and then often fails behind a self-made
 * certificate or uses an old cached copy. Embedding the icon in the page avoids that second request.
 */
function inlineAppleIcon(): Plugin {
  return {
    name: 'inline-apple-touch-icon',
    transformIndexHtml: {
      order: 'pre',
      handler: (html) => html.replace('__APPLE_TOUCH_ICON__', `data:image/png;base64,${fs.readFileSync('public/icon-180.png').toString('base64')}`),
    },
  };
}

// One version for server, web app and image: the VERSION file in the repository root.
const appVersion = fs.readFileSync(fileURLToPath(new URL('../VERSION', import.meta.url)), 'utf8').trim();

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(appVersion) },
  plugins: [react(), inlineAppleIcon()],
  server: {
    port: 5173,
    proxy: { '/api': 'http://localhost:8080' },
  },
  build: { outDir: 'dist', sourcemap: false },
});
