import { defineConfig } from "vitest/config";

// Opt-in audit reproductions; intentionally fail until the reported bugs are fixed.
export default defineConfig({
  test: {
    include: ["docs/audit/repros.test.ts"],
    environment: "node",
    setupFiles: ["tests/setup.ts"],
  },
});
