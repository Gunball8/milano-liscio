import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

/** GitHub Pages serves the app under /<repo>/ (SPEC §10): set BASE_PATH at build time. */
const base = process.env['BASE_PATH'] ?? '/';

export default defineConfig({
  base,
  plugins: [
    react(),
    VitePWA({
      // Own service worker (src/sw.ts): precache the shell, serve /data/* from the versioned caches.
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      injectRegister: false,
      manifest: {
        name: 'Milano Liscio',
        short_name: 'Liscio',
        description: 'Itinéraires vélo sans pavé ni rails à Milan, hors-ligne.',
        lang: 'fr',
        display: 'standalone',
        orientation: 'portrait',
        start_url: base,
        scope: base,
        background_color: '#123a31',
        theme_color: '#123a31',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      injectManifest: {
        rollupFormat: 'iife',
        // Shell, fonts and sprites are precached; data files are too big and are handled by the app (SPEC §8).
        globPatterns: ['**/*.{js,mjs,css,html,svg,png,webmanifest,pbf}', 'sprites/**/*.json'],
        globIgnores: ['data/**'],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
      },
      devOptions: { enabled: false },
    }),
  ],
  build: { target: 'es2022' },
});
