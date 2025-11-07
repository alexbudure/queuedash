import { defineConfig, type Plugin } from "vite";
import typescript from "@rollup/plugin-typescript";
import path from "path";
import { typescriptPaths } from "rollup-plugin-typescript-paths";

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
      external: [
        "events",
        "elysia",
        "@elysiajs/trpc",
        "express",
        "fastify",
        "hono",
        "@hono/trpc-server",
        "bull",
        "bullmq",
        "bee-queue",
        "groupmq",
      ],
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
