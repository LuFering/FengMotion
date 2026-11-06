import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";
import { fileURLToPath } from "node:url";
const dir = path.dirname(fileURLToPath(import.meta.url));
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": path.resolve(dir, "src") } },
  build: {
    outDir: path.resolve(dir, "demo-out-components"),
    emptyOutDir: true,
    rollupOptions: { input: path.resolve(dir, "ai-components-demo.html") },
  },
});
