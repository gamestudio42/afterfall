import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  // Relative paths, so the build runs from any folder (GitHub Pages serves it under /afterfall/).
  base: "./",
  plugins: [react()],
  server: { port: 5173, host: true },
  build: { target: "es2022", chunkSizeWarningLimit: 1500 },
});
