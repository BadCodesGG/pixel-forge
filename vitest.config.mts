import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    // The engine has no DOM, so it tests in plain Node, which is also how it
    // runs in CI replay verification. If a test needs jsdom, it is testing the
    // app layer, not the engine.
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
