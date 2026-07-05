import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";

const API_PORT = process.env.PORT ?? "3000";

export default defineConfig({
  root: "src/web",
  publicDir: "public",
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src/web"),
    },
  },
  build: {
    outDir: "../../dist/client",
    emptyOutDir: true,
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
      includeAssets: ["favicon.svg"],
      manifest: {
        name: "World Cup Hi-Lo",
        short_name: "Hi-Lo",
        description: "Predict match outcomes and climb the leaderboard.",
        theme_color: "#0b1120",
        background_color: "#0b1120",
        display: "standalone",
        orientation: "portrait",
        start_url: "/",
        icons: [
          {
            src: "favicon.svg",
            sizes: "any",
            type: "image/svg+xml",
            purpose: "any maskable",
          },
        ],
      },
    }),
  ],
});
