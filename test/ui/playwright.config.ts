import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: /.*\.spec\.ts/,
  timeout: 60_000,
  fullyParallel: true,
  reporter: [['list']],
  outputDir: '../../.test-results',
  use: {
    viewport: { width: 1280, height: 800 },
    trace: 'retain-on-failure',
  },
});
