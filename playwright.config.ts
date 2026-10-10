import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './e2e',
  testMatch: 'invitation.spec.ts',
  workers: 1,
  retries: 0,
  forbidOnly: Boolean(process.env.CI),
  timeout: 120000,
  expect: { timeout: 20000 },
  reporter: './e2e/reporter.ts',
  use: {
    browserName: 'chromium',
    baseURL: 'http://127.0.0.1:5173',
    // Confirmation links and tokens must not enter traces/videos/reports.
    trace: 'off',
    screenshot: 'off',
    video: 'off',
  },
  webServer: {
    command: 'node scripts/e2e-stack.mjs',
    url: 'http://127.0.0.1:5173/api/v1/health',
    reuseExistingServer: false,
    timeout: 120000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
