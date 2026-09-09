import { defineConfig } from "vite"
import viteReact from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"

const config = defineConfig({
  clearScreen: false,
  envPrefix: ["VITE_", "TAURI_ENV_*"],
  server: {
    port: 1420,
    strictPort: true,
  },
  resolve: {
    dedupe: ["react", "react-dom"],
    tsconfigPaths: true,
  },
  plugins: [tailwindcss(), viteReact()],
})

export default config
