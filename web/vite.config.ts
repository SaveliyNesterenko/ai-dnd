import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig(({ command }) => ({
  base: command === "build" ? "/app-assets/" : "/",
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8000",
        changeOrigin: false,
        ws: true,
      },
      "/demo-assets": {
        target: "http://127.0.0.1:8000",
      },
    },
  },
}));
