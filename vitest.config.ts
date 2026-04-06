import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    // Exclude infrastructure CDK tests (require separate npm install + esbuild)
    // and API integration tests (require Docker + DynamoDB Local).
    // Run CDK tests with: cd infrastructure && npm install && npm test
    // Run API tests with: pnpm test:api
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "infrastructure/**",
      ".pnpm-store/**",
      "tests/api/**",
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      exclude: ["node_modules/", "dist/", "**/*.config.ts", "**/*.d.ts"],
    },
  },
});
