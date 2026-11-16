import { defineConfig } from "vite";

// `pnpm dev:server` runs the game server on 8787 (OWAMBE_DEV=1); the page proxies to it.
const server = process.env.OWAMBE_SERVER ?? "http://localhost:8787";

export default defineConfig({
  build: { target: "es2020", cssCodeSplit: false, assetsInlineLimit: 0, reportCompressedSize: false },
  server: {
    port: 5173,
    proxy: {
      "/api": server,
      "/dev": { target: server, ws: true },
    },
  },
});
