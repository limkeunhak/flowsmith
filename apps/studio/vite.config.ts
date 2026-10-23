import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// 개발: vite(5173)가 /api를 서버(4400)로 넘긴다. 빌드: dist를 서버가 내준다.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { "/api": { target: process.env["FLOWSMITH_API"] ?? "http://127.0.0.1:4400", changeOrigin: false, ws: true } },
  },
  build: { outDir: "dist", emptyOutDir: true },
});
