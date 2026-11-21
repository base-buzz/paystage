import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  // Components use the automatic JSX runtime (as Next does); without this, rendering one in a test fails on a
  // missing `React` global that the app never needs.
  esbuild: { jsx: "automatic" },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
