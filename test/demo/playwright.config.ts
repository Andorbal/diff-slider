import { defineConfig } from '@playwright/test';

// Records the README animations; see demos.spec.ts. Not part of `npm run check`.
export default defineConfig({
  testDir: '.',
  testMatch: /demos\.spec\.ts/,
  timeout: 180_000,
  workers: 1,
  reporter: [['list']],
  outputDir: '../../.test-results/demos',
  use: { trace: 'retain-on-failure' },
});
