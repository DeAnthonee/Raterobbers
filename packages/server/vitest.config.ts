import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    passWithNoTests: true,
    testTimeout: 15_000,
    hookTimeout: 30_000,
    // The Colyseus test server binds a port; keep room tests in one worker.
    fileParallelism: false,
  },
});
