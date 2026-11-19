import { builtinModules } from "node:module";
import path from "path";

import typescript from "@rollup/plugin-typescript";
import { typescriptPaths } from "rollup-plugin-typescript-paths";
import { defineConfig, type Plugin } from "vite";

import pkg from "./package.json";

// The Elysia and Hono adapters import their framework as the package loads, so
// those two optional peers stay bundled until the adapters load them lazily.
const bundledPeers = ["elysia", "hono"];

// Everything else the package declares is installed next to it. Leaving it
// external means apps run, and `npm audit` sees, the versions they installed
// instead of the ones the lockfile held when this package was built.
const externalPackages = [
  ...Object.keys(pkg.dependencies),
  ...Object.keys(pkg.peerDependencies),
].filter((name) => !bundledPeers.includes(name));

const external = (
  id: string,
  importer: string | undefined,
  isResolved: boolean,
): boolean => {
  if (isResolved || id.startsWith(".") || id.startsWith("\0")) return false;
  if (path.isAbsolute(id)) return false;
  if (id.startsWith("node:") || builtinModules.includes(id)) return true;
  // "@trpc/server/adapters/fetch" belongs to "@trpc/server".
  const name = id
    .split("/")
    .slice(0, id.startsWith("@") ? 2 : 1)
    .join("/");
  if (externalPackages.includes(name)) return true;
  if (bundledPeers.includes(name) || importer?.includes("/node_modules/")) {
    return false;
  }
  // Anything else Queuedash's own source imports would be bundled at whatever
  // version the lockfile holds, out of sight of the app's dependency audits.
  throw new Error(
    `${path.relative(__dirname, importer ?? "")} imports "${id}", which isn't in dependencies or peerDependencies.`,
  );
};

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
      name: "Queuedash API",
      formats: ["cjs", "es"],
    },
    rollupOptions: {
      external,
      plugins: [
        typescriptPaths({
          preserveExtensions: true,
        }) as Plugin,
        typescript({
          sourceMap: false,
          declaration: true,
          outDir: "dist",
          compilerOptions: {
            composite: false,
            incremental: false,
          },
        }) as Plugin,
      ],
    },
  },
});
