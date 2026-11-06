import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@": path.resolve(dir, "src") } },
  build: {
    outDir: path.resolve(dir, "demo-out"),
    emptyOutDir: true,
    rollupOptions: { input: path.resolve(dir, "agent-progress-demo.html") },
  },
});
