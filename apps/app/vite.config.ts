import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

// App isolado do analisador de demo 2D (CS2 Demo Viewer), com porta própria.
export default defineConfig({
  plugins: [
    vue(),
    tailwindcss(),
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['icon.svg', 'apple-touch-icon-180x180.png'],
      manifest: {
        name: 'CS Demo Analyzer',
        short_name: 'CS Demo',
        description:
          'The fastest browser-based 2D replay viewer for CS2 demos. Runs 100% offline.',
        theme_color: '#0a0c12',
        background_color: '#0a0c12',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: 'pwa-64x64.png', sizes: '64x64', type: 'image/png' },
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'maskable-icon-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // Precache everything (app shell, wasm, maps, weapons, preview replays)
        // so the app works fully offline after the first visit.
        globPatterns: ['**/*.{js,css,html,svg,png,webp,jpg,ico,json,wasm}'],
        // Largest asset is a ~1.2MB preview replay; bump the cap to fit it.
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        // The app is an SPA: serve index.html for navigations while offline.
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5174,
    host: true,
  },
})
