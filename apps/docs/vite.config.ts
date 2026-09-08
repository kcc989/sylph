import { defineConfig } from "vite"
import { tanstackStart } from "@tanstack/react-start/plugin/vite"
import viteReact from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"
import mdx from "fumadocs-mdx/vite"

const config = defineConfig({
  resolve: {
    dedupe: ["react", "react-dom", "@tanstack/react-router"],
    tsconfigPaths: true,
  },
  plugins: [mdx(), tailwindcss(), tanstackStart(), viteReact()],
})

export default config
