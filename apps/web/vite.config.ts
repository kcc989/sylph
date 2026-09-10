import { defineConfig } from "vite"
import cloudflare from "@alchemy.run/cloudflare-runtime/vite"
import { devtools } from "@tanstack/devtools-vite"
import { tanstackStart } from "@tanstack/react-start/plugin/vite"
import viteReact from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"

const config = defineConfig({
  build: { rolldownOptions: { external: ["cloudflare:workers"] } },
  environments: {
    ssr: {
      build: { minify: true, rolldownOptions: { output: { keepNames: true } } },
    },
  },
  resolve: {
    dedupe: ["effect", "react", "react-dom", "@tanstack/react-router"],
    tsconfigPaths: true,
  },
  plugins: [
    process.env.ALCHEMY_CLOUDFLARE_VITE_INJECTED === "1"
      ? null
      : cloudflare({
          main: "src/worker.ts",
          compatibilityDate: "2026-03-17",
          compatibilityFlags: ["nodejs_compat"],
        }),
    devtools(),
    tailwindcss(),
    tanstackStart(),
    viteReact(),
  ],
})

export default config
