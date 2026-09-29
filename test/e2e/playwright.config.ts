import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: /.*\.spec\.ts/,
  timeout: 180_000,
  workers: 1,
  reporter: [['list']],
  outputDir: '../../.test-results/e2e',
  use: { trace: 'retain-on-failure' },
});
