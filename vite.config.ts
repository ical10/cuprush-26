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
      // The Privy chunk (~4.3 MB) exceeds Workbox's 2 MiB precache limit and
      // shouldn't be precached anyway — the browser HTTP cache handles it.
      workbox: { globIgnores: ["**/privy-*.js"] },
      includeAssets: ["favicon.svg", "og.jpg"],
      manifest: {
        name: "CupRush 26",
        short_name: "CupRush 26",
        description: "CupRush 26 — make the call. Predict match outcomes and climb the leaderboard.",
        theme_color: "#07120D",
        background_color: "#07120D",
        display: "standalone",
        orientation: "portrait",
        start_url: "/",
        icons: [
          {
            src: "favicon.svg",
            sizes: "any",
            type: "image/svg+xml",
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
