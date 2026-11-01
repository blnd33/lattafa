import { defineConfig, type Plugin } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import path from 'node:path'

/*
 * One web project, three apps, one domain:
 *
 *   /menu/       public perfume menu (customers, QR code in the shop)
 *   /pos/        store point of sale (tills, tablets)
 *   /delegate/   field-sales web app for delegates (phones)
 *   /admin/      admin panel for the owner and managers (any computer or tablet)
 *   /api/v1/...  the Laravel backend (backend/)
 *
 * In development Vite serves the three apps and forwards /api and /storage to Laravel (php artisan serve on :8000),
 * so everything already lives on one origin. `npm run build` writes dist/ and `npm run build:backend` also copies it into
 * backend/public/, where Laravel serves it next to the API — one domain in production too.
 *
 * Shared code (UI kit, i18n, money/pricing/permissions, data types, API client) lives in pos/src and is imported as `@/…`
 * by all three apps; each app keeps its own screens under <app>/src (`@delegate/…`, `@menu/…`).
 */
const root = import.meta.dirname
const API = process.env.LATTAFA_API ?? 'http://127.0.0.1:8000'

/** `/` → `/menu/`, and `/pos` → `/pos/` (same as Laravel does in production). */
function appRedirects(): Plugin {
  return {
    name: 'lattafa-app-redirects',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url ?? '/'
        const to = url === '/' ? '/menu/' : /^\/(pos|delegate|menu|admin)(\?.*)?$/.test(url) ? url.replace(/^\/(pos|delegate|menu|admin)/, '/$1/') : null
        if (!to) return next()
        res.statusCode = 302
        res.setHeader('Location', to)
        res.end()
      })
    },
  }
}

export default defineConfig({
  base: '/',
  plugins: [
    appRedirects(),
    react(),
    tailwindcss(),
    VitePWA({
      // One service worker for the domain; each app has its own manifest (public/*.webmanifest) so all four install as
      // apps. The POS, the delegate app and the admin register it; the public menu doesn't (it stays a light web page).
      registerType: 'autoUpdate',
      injectRegister: false,
      manifest: false,
      workbox: {
        // a new release takes over straight away (the apps reload into it; open bills are kept on the device).
        // The plugin only sets these itself when it injects the registration — the apps register it themselves.
        skipWaiting: true,
        clientsClaim: true,
        globPatterns: ['**/*.{js,css,html,png,svg,woff2,woff,webmanifest}'],
        navigateFallback: null,
        directoryIndex: 'index.html',
        // never let the service worker answer API or uploaded-image requests from its cache
        navigateFallbackDenylist: [/^\/api\//, /^\/storage\//],
      },
    }),
  ],
  resolve: {
    alias: [
      { find: /^@delegate\//, replacement: `${path.resolve(root, 'delegate/src')}/` },
      { find: /^@menu\//, replacement: `${path.resolve(root, 'menu/src')}/` },
      { find: /^@admin\//, replacement: `${path.resolve(root, 'admin/src')}/` },
      { find: /^@\//, replacement: `${path.resolve(root, 'pos/src')}/` },
    ],
  },
  server: {
    port: 5173,
    host: true,
    proxy: {
      '/api': { target: API, changeOrigin: true },
      '/storage': { target: API, changeOrigin: true },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        pos: path.resolve(root, 'pos/index.html'),
        delegate: path.resolve(root, 'delegate/index.html'),
        menu: path.resolve(root, 'menu/index.html'),
        admin: path.resolve(root, 'admin/index.html'),
      },
    },
  },
  test: {
    environment: 'node',
    setupFiles: ['./pos/src/test/setup.ts', './pos/src/test/dom-setup.ts'],
    include: ['{pos,delegate,menu,admin}/src/**/*.test.{ts,tsx}'],
  },
})
