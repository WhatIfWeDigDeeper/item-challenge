import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["tests/api/**/*.{test,spec}.?(c|m)[jt]s?(x)"],
  },
});
