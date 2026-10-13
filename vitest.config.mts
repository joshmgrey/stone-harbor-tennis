import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  resolve: {
    // Resolve the `@/*` aliases from tsconfig.json natively.
    tsconfigPaths: true,
  },
  test: {
    // Default to node; component tests opt into jsdom with a
    // `// @vitest-environment jsdom` docblock at the top of the file.
    environment: "node",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["src/lib/**/*.ts", "src/app/api/**/*.ts"],
      // Floors ~2 points under the current numbers (README "Test and
      // coverage numbers"); `npm run coverage` -- and the required
      // `coverage` CI check -- fails if any metric drops below these.
      // Raise them as coverage improves.
      thresholds: {
        statements: 91,
        branches: 81,
        functions: 94,
        lines: 91,
      },
    },
  },
});
