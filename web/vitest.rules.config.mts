import { defineConfig } from "vitest/config";

// Firestore rules tests. They need the emulator: run `npm run test:rules`.
export default defineConfig({
  test: {
    environment: "node",
    include: ["rules-tests/**/*.test.ts"],
    fileParallelism: false,
    testTimeout: 20000,
    hookTimeout: 30000,
  },
});
