import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    outDir: "dist/web",
    // Keep prior hashed assets so pages opened before a rebuild can finish
    // loading while the local production server starts serving the new entry.
    emptyOutDir: false,
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
    proxy: {
      "/api": "http://127.0.0.1:3030",
      "/ws": {
        target: "ws://127.0.0.1:3030",
        ws: true,
      },
    },
  },
});
