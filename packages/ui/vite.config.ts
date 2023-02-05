import { defineConfig } from "vite";
import typescript from "@rollup/plugin-typescript";
import path from "path";
import { typescriptPaths } from "rollup-plugin-typescript-paths";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    minify: true,
    reportCompressedSize: true,
    lib: {
      entry: {
        main: path.resolve(__dirname, "src/main.ts"),
        standalone: path.resolve(__dirname, "src/standalone.tsx"),
      },
      name: "QueueDash App",
      formats: ["cjs", "es"],
    },
    rollupOptions: {
      external: ["react", "react-dom"],
      output: {
        manualChunks: () => "app",
      },
      plugins: [
        typescriptPaths({
          preserveExtensions: true,
        }),
        typescript({
          sourceMap: false,
          declaration: true,
          outDir: "dist",
        }),
      ],
    },
  },
});
