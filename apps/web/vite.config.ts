import { resolve } from "node:path"
import { cloudflare } from "@cloudflare/vite-plugin"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

// One dev server runs the React app and the Worker together in workerd (ADR 0004).
export default defineConfig({
  plugins: [react(), tailwindcss(), cloudflare({ configPath: "../worker/wrangler.jsonc" })],
  resolve: {
    alias: {
      "@": resolve(import.meta.dirname, "./src"),
    },
  },
})
