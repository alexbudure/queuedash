import path from "path";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Browsers run this bundle as it is published, so it is built as an
// application rather than a library. Vite leaves the whitespace in a library's
// ES output for the consumer's minifier, and here there is none: that cost the
// file about a third of its size. Nothing loads a CommonJS copy.
export default defineConfig({
  plugins: [react()],
  define: {
    "process.env.NODE_ENV": JSON.stringify("production"),
  },
  build: {
    reportCompressedSize: true,
    rollupOptions: {
      input: path.resolve(__dirname, "src/main.tsx"),
      output: {
        // The server adapters load dist/main.mjs by name.
        entryFileNames: "main.mjs",
        inlineDynamicImports: true,
      },
    },
  },
});
