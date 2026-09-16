import path from 'node:path'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [
    tailwindcss(),
    svelte(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg'],
      manifest: {
        name: 'ABCP Agent (AW)',
        short_name: 'AW',
        description: 'Agent chat over the abc agent backend (agent.v1 via Connect)',
        theme_color: '#0a0a0a',
        background_color: '#0a0a0a',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // WASM + the OPFS proxy worker must not be cached too aggressively:
        // stale-while-revalidate everything, precache the app shell.
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        navigateFallback: 'index.html',
        runtimeCaching: [
          {
            urlPattern: /sqlite3\.wasm$|opfs-async-proxy/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'sqlite-wasm',
              expiration: { maxEntries: 4 },
            },
          },
        ],
      },
    }),
  ],
  resolve: {
    alias: { $lib: path.resolve('./src/lib') },
  },
  // sqlite-wasm must NOT be prebundled: its `new URL(..., import.meta.url)`
  // wasm + worker references are resolved by Vite itself.
  optimizeDeps: { exclude: ['@sqlite.org/sqlite-wasm'] },
  server: {
    host: '0.0.0.0',
    port: 18400,
    strictPort: true,
    allowedHosts: true,
  },
  build: {
    outDir: 'dist',
    // OPFS needs a top-level-await-free chunk; keep default target but ensure
    // the worker chunk stays ES2022+.
    target: 'es2022',
  },
})
