import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Default to the fast node environment; tests that need DOM/localStorage
    // (e.g. persistence) opt in per-file with `// @vitest-environment jsdom`.
    environment: 'node',
    include: ['src/**/*.test.ts'],
    coverage: {
      exclude: ['src/**/*.test.ts', 'src/main.ts'],
      include: ['src/**/*.{ts,tsx}'],
      provider: 'v8',
    },
  },
});
