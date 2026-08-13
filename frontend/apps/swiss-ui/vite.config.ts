import path from "path"
import { fileURLToPath } from "node:url"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const extensionRoot = path.resolve(__dirname, "../../../SwissExtensions")

export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: "./",
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@workspace/ui/globals.css": path.resolve(
        __dirname,
        "../../packages/ui/src/styles/globals.css"
      ),
    },
  },
  build: {
    outDir: path.join(extensionRoot, "ui-dist"),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        side_panel: path.resolve(__dirname, "side_panel.html"),
        history: path.resolve(__dirname, "history.html"),
        result: path.resolve(__dirname, "result.html"),
        suspended: path.resolve(__dirname, "suspended.html"),
      },
    },
  },
})
