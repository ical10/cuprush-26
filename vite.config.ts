import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";

const API_PORT = process.env.PORT ?? "3000";

export default defineConfig({
  root: "src/web",
  // env files live at the repo root, not under root (src/web)
  envDir: __dirname,
  publicDir: "public",
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src/web"),
    },
  },
  build: {
    outDir: "../../dist/client",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        app: path.resolve(__dirname, "src/web/app.html"),
        landing: path.resolve(__dirname, "src/web/index.html"),
      },
      output: {
        // Privy (+ its wallet stack) is large and changes rarely — split it out
        // so it caches separately and doesn't bloat the app chunk on every deploy.
        manualChunks(id: string) {
          if (
            id.includes("@privy-io") ||
            id.includes("@reown") ||
            id.includes("walletconnect") ||
            id.includes("@solana")
          ) {
            return "privy";
          }
        },
      },
    },
  },
  server: {
    proxy: {
      "/api": {
        target: `http://localhost:${API_PORT}`,
        changeOrigin: true,
      },
    },
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "autoUpdate",
      scope: "/app",
      // Registration lives in src/web/main.tsx (virtual:pwa-register) so the
      // app controls update polling and controllerchange reloads.
      injectRegister: false,
      // The Privy chunk (~4.3 MB) exceeds Workbox's 2 MiB precache limit and
      // shouldn't be precached anyway — it's runtime-cached below instead.
      workbox: {
        globIgnores: ["**/privy-*.js"],
        navigateFallback: "/app.html",
        navigateFallbackAllowlist: [/^\/app/],
        runtimeCaching: [
          {
            // Same-origin only: a RegExp route can never match a cross-origin
            // URL mid-string (Workbox requires index-0 matches cross-origin).
            urlPattern: /\/assets\/privy-[^/]+\.js$/,
            handler: "CacheFirst",
            options: {
              cacheName: "privy-chunk",
              expiration: { maxEntries: 4 },
              cacheableResponse: { statuses: [200] },
            },
          },
        ],
      },
      includeAssets: ["favicon.png", "og-cuprush.png"],
      manifest: {
        name: "CupRush 26",
        start_url: "/app",
        scope: "/app",
        short_name: "CupRush 26",
        description: "CupRush 26 — make the call. Predict match outcomes and climb the leaderboard.",
        theme_color: "#07120D",
        background_color: "#07120D",
        display: "standalone",
        orientation: "portrait",
        icons: [
          {
            src: "favicon.png",
            sizes: "1254x1254",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "pwa-192x192.png",
            sizes: "192x192",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "pwa-512x512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "pwa-maskable-512x512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
    }),
  ],
});
