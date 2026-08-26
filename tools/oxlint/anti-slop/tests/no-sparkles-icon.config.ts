import { defineConfig } from "oxlint"

export default defineConfig({
  jsPlugins: [
    {
      name: "anti-slop",
      specifier: "../index.ts",
    },
  ],
  rules: {
    "anti-slop/no-sparkles-icon": "error",
  },
})
