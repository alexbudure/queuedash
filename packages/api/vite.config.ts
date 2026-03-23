import path from "path";

import typescript from "@rollup/plugin-typescript";
import { typescriptPaths } from "rollup-plugin-typescript-paths";
import { defineConfig, type Plugin } from "vite";

export default defineConfig({
  define: {
    "process.env.NODE_ENV": JSON.stringify("production"),
  },
  build: {
    minify: true,
    reportCompressedSize: true,
    lib: {
      entry: path.resolve(__dirname, "src/main.ts"),
      fileName: "main",
      name: "QueueDash API",
      formats: ["cjs", "es"],
    },
    rollupOptions: {
      external: ["events", "node:http"],
      plugins: [
        typescriptPaths({
          preserveExtensions: true,
        }) as Plugin,
        typescript({
          sourceMap: false,
          declaration: true,
          outDir: "dist",
        }) as Plugin,
      ],
    },
  },
});
