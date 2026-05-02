import { sveltekit } from "@sveltejs/kit/vite";
import { VitePWA } from "vite-plugin-pwa";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [
    sveltekit(),
    VitePWA({
      registerType: "autoUpdate",
      manifest: {
        name: "swift-newt",
        short_name: "swift-newt",
        description: "AI-curated personal feed.",
        theme_color: "#0a0a0a",
        background_color: "#0a0a0a",
        display: "standalone",
        start_url: "/",
        scope: "/",
        icons: [
          { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "/icon-512-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        navigateFallback: "/index.html",
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.startsWith("/api/feed"),
            handler: "NetworkFirst",
            options: { cacheName: "feed", networkTimeoutSeconds: 5, expiration: { maxEntries: 50, maxAgeSeconds: 86400 } },
          },
          {
            urlPattern: ({ request }) => request.destination === "image",
            handler: "CacheFirst",
            options: { cacheName: "images", expiration: { maxEntries: 500, maxAgeSeconds: 7 * 86400 } },
          },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
  server: {
    proxy: {
      "/api": { target: "http://localhost:8787", changeOrigin: true },
    },
  },
});
