import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL(".", import.meta.url)) },
  },
  test: {
    include: ["tests/integration/**/*.test.ts"],
    globals: true,
    setupFiles: ["./tests/setup.ts"],
    restoreMocks: true,
    testTimeout: 10_000,
  },
});
